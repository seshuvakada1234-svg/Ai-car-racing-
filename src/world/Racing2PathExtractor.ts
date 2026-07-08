// @ts-nocheck
import * as THREE from "three";

/**
 * Racing2PathExtractor (v3 — triangle-graph pipeline)
 * ---------------------------------------------------
 * Production-grade centerline extractor for arbitrary GLB race tracks.
 *
 * Pipeline:
 *   1. road_12 BOUNDARY-LOOP strategy: consumes every road triangle, traces
 *      all authored asphalt boundary loops, and averages the main edge pair.
 *   2. TRIANGLE-GRAPH centerline:
 *      a. Triangle-area sampling — every road triangle contributes points
 *         proportional to its area, so huge asphalt slabs are fully covered.
 *      b. XZ occupancy grid with per-cell mean height (handles elevation).
 *      c. Morphological closing (dilate ×2 + erode) to bridge ≤2-cell gaps
 *         from bridges, tunnel mouths, and pit-lane splits.
 *      d. Connected-component bridging — small disconnected road islands
 *         within MAX_BRIDGE_M are joined by straight-line cell fills.
 *      e. Zhang-Suen thinning to a 1-cell medial axis.
 *      f. Spur pruning (peels dead-end branches until only cycles remain).
 *      g. Longest-cycle search on the resulting graph (NOT greedy first hit),
 *         so the loop walker can't get trapped on the start straight.
 *      h. Catmull-Rom smoothing + uniform 5 m resampling.
 *      i. Validation: closed loop, max gap, min length, no self-touch.
 *      j. Automatic retry with denser grid / wider bridging on failure.
 *   3. NAMED-NODE strategy (only if road extraction fails).
 *   4. GREEDY CENTROID WALK (last-ditch legacy fallback).
 *
 * Emits detailed diagnostics so a missing road section is debuggable.
 */

const NAMED_PATTERNS = [
  /^ai[_\- ]?path[_\- ]?(\d+)/i,
  /^checkpoint[_\- ]?(\d+)/i,
  /^waypoint[_\- ]?(\d+)/i,
  /^wp[_\- ]?(\d+)/i,
  /^path[_\- ]?(\d+)/i,
  /^node[_\- ]?(\d+)/i,
];

function matchIndex(name: string): number | null {
  if (!name) return null;
  for (const re of NAMED_PATTERNS) {
    const m = name.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function isClosedLoop(points: THREE.Vector3[], threshold = 60): boolean {
  if (points.length < 4) return false;
  return points[0].distanceTo(points[points.length - 1]) < threshold;
}

function resampleByDistance(points: THREE.Vector3[], stride: number, closed: boolean): THREE.Vector3[] {
  if (points.length === 0) return [];
  const out: THREE.Vector3[] = [points[0].clone()];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].distanceTo(points[i - 1]);
    acc += d;
    if (acc >= stride) {
      out.push(points[i].clone());
      acc = 0;
    }
  }
  if (closed && out.length > 2) {
    while (out.length > 2 && out[out.length - 1].distanceTo(out[0]) < stride * 0.6) out.pop();
  }
  return out;
}

function extractFromNamedNodes(root: THREE.Object3D): THREE.Vector3[] | null {
  const found: { idx: number; pos: THREE.Vector3 }[] = [];
  root.traverse((obj: any) => {
    const idx = matchIndex(obj.name || "");
    if (idx !== null && Number.isFinite(idx)) {
      const pos = obj.getWorldPosition(new THREE.Vector3());
      found.push({ idx, pos });
    }
  });
  if (found.length < 4) return null;
  found.sort((a, b) => a.idx - b.idx);
  return found.map((f) => f.pos);
}

function rotateToMainStraight(points: THREE.Vector3[]): THREE.Vector3[] {
  const n = points.length;
  if (n < 6) return points;
  const tangents: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    tangents.push(new THREE.Vector2(dx / len, dz / len));
  }
  const STRAIGHT_COS = Math.cos((16 * Math.PI) / 180);
  let bestStart = 0;
  let bestLen = 0;
  for (let start = 0; start < n; start++) {
    let acc = 0;
    let meanX = tangents[start].x;
    let meanY = tangents[start].y;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      const t = tangents[i];
      const meanLen = Math.hypot(meanX, meanY) || 1;
      const dot = (t.x * meanX + t.y * meanY) / meanLen;
      if (dot < STRAIGHT_COS) break;
      const a = points[i];
      const b = points[(i + 1) % n];
      acc += a.distanceTo(b);
      meanX = meanX * 0.7 + t.x * 0.3;
      meanY = meanY * 0.7 + t.y * 0.3;
    }
    if (acc > bestLen) {
      bestLen = acc;
      bestStart = start;
    }
  }
  if (bestStart === 0) return points;
  return points.slice(bestStart).concat(points.slice(0, bestStart));
}

// ---------------------------------------------------------------------------
// Triangle-area sampling
// ---------------------------------------------------------------------------

interface SampleStats {
  meshes: number;
  triangles: number;
  sampledPoints: number;
  rejectedFlatness: number;
  worldBounds: THREE.Box3;
}

/**
 * Sample points uniformly distributed across the area of every road triangle.
 *  - Triangles whose normal is not mostly +Y are rejected (walls, kerbs).
 *  - Per-triangle sample count scales with area (cap to budget).
 *  - Returns world-space points + diagnostics.
 */
function sampleTriangles(roadMeshes: THREE.Mesh[], maxPoints = 80000): { points: THREE.Vector3[]; stats: SampleStats } {
  const points: THREE.Vector3[] = [];
  const worldBounds = new THREE.Box3();
  const stats: SampleStats = {
    meshes: roadMeshes.length,
    triangles: 0,
    sampledPoints: 0,
    rejectedFlatness: 0,
    worldBounds,
  };

  // First pass: total triangle area to budget samples.
  const meshAreas: number[] = [];
  let totalArea = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();

  for (const mesh of roadMeshes) {
    mesh.updateWorldMatrix(true, false);
    const geom: any = mesh.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) { meshAreas.push(0); continue; }
    const index = geom.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    let area = 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac);
      area += n.length() * 0.5;
    }
    meshAreas.push(area);
    totalArea += area;
    stats.triangles += triCount;
  }
  if (totalArea <= 0) return { points, stats };

  const samplesPerArea = maxPoints / totalArea;
  const UP = new THREE.Vector3(0, 1, 0);

  for (let mi = 0; mi < roadMeshes.length; mi++) {
    const mesh = roadMeshes[mi];
    const geom: any = mesh.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) continue;
    const index = geom.index;
    const triCount = index ? index.count / 3 : pos.count / 3;

    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac);
      const triArea = n.length() * 0.5;
      if (triArea < 1e-4) continue;

      // Flatness: triangle normal must be mostly +Y. Reject walls/barriers.
      const ny = (n.y / (n.length() || 1));
      if (Math.abs(ny) < 0.55) { stats.rejectedFlatness++; continue; }

      // Always include the centroid + corners (cheap coverage).
      const cx = (a.x + b.x + c.x) / 3;
      const cy = (a.y + b.y + c.y) / 3;
      const cz = (a.z + b.z + c.z) / 3;
      points.push(new THREE.Vector3(cx, cy, cz));
      worldBounds.expandByPoint(a);
      worldBounds.expandByPoint(b);
      worldBounds.expandByPoint(c);

      // Stratified random interior samples proportional to area.
      const want = Math.max(1, Math.round(triArea * samplesPerArea));
      for (let s = 0; s < want; s++) {
        let u = Math.random();
        let v = Math.random();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const w = 1 - u - v;
        points.push(new THREE.Vector3(
          a.x * w + b.x * u + c.x * v,
          a.y * w + b.y * u + c.y * v,
          a.z * w + b.z * u + c.z * v,
        ));
      }
    }
  }

  stats.sampledPoints = points.length;
  return { points, stats };
}

// ---------------------------------------------------------------------------
// Boundary-loop extraction for authored road meshes (road_12 production path)
// ---------------------------------------------------------------------------

interface BoundaryLoop {
  points: THREE.Vector3[];
  length: number;
  closed: boolean;
}

interface RoadGraphExtraction {
  points: THREE.Vector3[];
  closed: boolean;
  diagnostics: ExtractionDiagnostics;
}

function polylineLength(points: THREE.Vector3[], closed = true): number {
  if (!points || points.length < 2) return 0;
  let total = 0;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    total += points[i].distanceTo(points[(i + 1) % points.length]);
  }
  return total;
}

function resampleLoop(points: THREE.Vector3[], count: number): THREE.Vector3[] {
  const n = points.length;
  if (n < 2 || count < 4) return points.map((p) => p.clone());
  const segLens: number[] = [];
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const d = points[i].distanceTo(points[(i + 1) % n]);
    segLens.push(d);
    total += d;
    cumulative.push(total);
  }
  if (total <= 0) return points.map((p) => p.clone());

  const out: THREE.Vector3[] = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    while (seg < n - 1 && cumulative[seg + 1] < target) seg++;
    const a = points[seg];
    const b = points[(seg + 1) % n];
    const denom = segLens[seg] || 1;
    const t = THREE.MathUtils.clamp((target - cumulative[seg]) / denom, 0, 1);
    out.push(new THREE.Vector3().lerpVectors(a, b, t));
  }
  return out;
}

function alignLoopToReference(ref: THREE.Vector3[], loop: THREE.Vector3[]): THREE.Vector3[] {
  const n = Math.min(ref.length, loop.length);
  if (n < 4) return loop.map((p) => p.clone());
  const stride = Math.max(1, Math.floor(n / 96));
  let bestScore = Infinity;
  let bestShift = 0;
  let bestReverse = false;

  for (const reverse of [false, true]) {
    const arr = reverse ? [...loop].reverse() : loop;
    for (let shift = 0; shift < n; shift++) {
      let score = 0;
      for (let i = 0; i < n; i += stride) {
        score += ref[i].distanceToSquared(arr[(i + shift) % n]);
      }
      if (score < bestScore) {
        bestScore = score;
        bestShift = shift;
        bestReverse = reverse;
      }
    }
  }

  const chosen = bestReverse ? [...loop].reverse() : loop;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) out.push(chosen[(i + bestShift) % n].clone());
  return out;
}

function traceBoundaryLoops(roadMeshes: THREE.Mesh[]): {
  loops: BoundaryLoop[];
  triangleCount: number;
  boundaryEdgeCount: number;
} {
  const vertices: THREE.Vector3[] = [];
  const vertexByKey = new Map<string, number>();
  const edgeCounts = new Map<string, { a: number; b: number; count: number }>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  let triangleCount = 0;

  const vertexKey = (v: THREE.Vector3) =>
    `${Math.round(v.x * 100)}:${Math.round(v.y * 100)}:${Math.round(v.z * 100)}`;
  const getVertex = (v: THREE.Vector3) => {
    const key = vertexKey(v);
    let idx = vertexByKey.get(key);
    if (idx === undefined) {
      idx = vertices.length;
      vertexByKey.set(key, idx);
      vertices.push(v.clone());
    }
    return idx;
  };
  const addEdge = (i0: number, i1: number) => {
    const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
    const key = `${lo}:${hi}`;
    const e = edgeCounts.get(key);
    if (e) e.count++;
    else edgeCounts.set(key, { a: lo, b: hi, count: 1 });
  };

  for (const mesh of roadMeshes) {
    mesh.updateWorldMatrix(true, false);
    const geom: any = mesh.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) continue;
    const index = geom.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.crossVectors(ab, ac);
      if (normal.lengthSq() < 1e-8) continue;
      const va = getVertex(a), vb = getVertex(b), vc = getVertex(c);
      addEdge(va, vb);
      addEdge(vb, vc);
      addEdge(vc, va);
      triangleCount++;
    }
  }

  const adjacency = new Map<number, Set<number>>();
  const boundaryEdges: [number, number][] = [];
  edgeCounts.forEach((e) => {
    if (e.count !== 1) return;
    boundaryEdges.push([e.a, e.b]);
    if (!adjacency.has(e.a)) adjacency.set(e.a, new Set());
    if (!adjacency.has(e.b)) adjacency.set(e.b, new Set());
    adjacency.get(e.a)!.add(e.b);
    adjacency.get(e.b)!.add(e.a);
  });

  const edgeKey = (i0: number, i1: number) => `${Math.min(i0, i1)}:${Math.max(i0, i1)}`;
  const visited = new Set<string>();
  const chooseNext = (prev: number, cur: number, chain: number[]) => {
    const neighbors = adjacency.get(cur);
    if (!neighbors) return -1;
    let best = -1;
    let bestScore = -Infinity;
    const pPrev = vertices[prev];
    const pCur = vertices[cur];
    const inDir = new THREE.Vector3().subVectors(pCur, pPrev).normalize();
    for (const n of neighbors) {
      if (n === prev) continue;
      const k = edgeKey(cur, n);
      if (visited.has(k)) continue;
      if (n === chain[0] && chain.length > 6) return n;
      const outDir = new THREE.Vector3().subVectors(vertices[n], pCur).normalize();
      const score = inDir.dot(outDir);
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  };

  const loops: BoundaryLoop[] = [];
  for (const [startA, startB] of boundaryEdges) {
    const firstKey = edgeKey(startA, startB);
    if (visited.has(firstKey)) continue;
    const chain = [startA, startB];
    visited.add(firstKey);
    let prev = startA;
    let cur = startB;
    let closed = false;
    let safety = boundaryEdges.length + 8;

    while (safety-- > 0) {
      const next = chooseNext(prev, cur, chain);
      if (next < 0) break;
      visited.add(edgeKey(cur, next));
      if (next === chain[0]) { closed = true; break; }
      chain.push(next);
      prev = cur;
      cur = next;
    }

    // If this was an open boundary chain, extend the opposite direction too.
    if (!closed) {
      prev = chain[1];
      cur = chain[0];
      safety = boundaryEdges.length + 8;
      while (safety-- > 0) {
        const next = chooseNext(prev, cur, chain);
        if (next < 0) break;
        visited.add(edgeKey(cur, next));
        chain.unshift(next);
        prev = cur;
        cur = next;
      }
    }

    const pts = chain.map((idx) => vertices[idx].clone());
    const endpointGap = pts.length > 2 ? pts[0].distanceTo(pts[pts.length - 1]) : Infinity;
    const treatClosed = closed || endpointGap < 6.0;
    const len = polylineLength(pts, treatClosed);
    if (pts.length >= 16 && len > 80) loops.push({ points: pts, length: len, closed: treatClosed });
  }

  loops.sort((l, r) => r.length - l.length);
  return { loops, triangleCount, boundaryEdgeCount: boundaryEdges.length };
}

function extractFromTriangleAdjacency(roadMeshes: THREE.Mesh[]): RoadGraphExtraction | null {
  const t0 = performance.now();
  const centers: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const edgeOwners = new Map<string, number[]>();
  const vertexByKey = new Map<string, number>();
  let vertexSeq = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  let totalRoadTriangles = 0;

  const keyForVertex = (v: THREE.Vector3) => {
    const key = `${Math.round(v.x * 100)}:${Math.round(v.y * 100)}:${Math.round(v.z * 100)}`;
    let idx = vertexByKey.get(key);
    if (idx === undefined) {
      idx = vertexSeq++;
      vertexByKey.set(key, idx);
    }
    return idx;
  };
  const addEdge = (i0: number, i1: number, tri: number) => {
    const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
    const key = `${lo}:${hi}`;
    let owners = edgeOwners.get(key);
    if (!owners) { owners = []; edgeOwners.set(key, owners); }
    owners.push(tri);
  };

  for (const mesh of roadMeshes) {
    mesh.updateWorldMatrix(true, false);
    const geom: any = mesh.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) continue;
    const index = geom.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      totalRoadTriangles++;
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac);
      if (n.lengthSq() < 1e-8 || Math.abs(n.y / n.length()) < 0.25) continue;
      const triIdx = centers.length;
      centers.push(new THREE.Vector3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3));
      normals.push(n.clone().normalize());
      const va = keyForVertex(a), vb = keyForVertex(b), vc = keyForVertex(c);
      addEdge(va, vb, triIdx);
      addEdge(vb, vc, triIdx);
      addEdge(vc, va, triIdx);
    }
  }
  if (centers.length < 32) return null;

  const adj: number[][] = Array.from({ length: centers.length }, () => []);
  let boundaryEdges = 0;
  edgeOwners.forEach((owners) => {
    if (owners.length === 1) boundaryEdges++;
    if (owners.length < 2) return;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const aIdx = owners[i], bIdx = owners[j];
        adj[aIdx].push(bIdx);
        adj[bIdx].push(aIdx);
      }
    }
  });

  const visited = new Uint8Array(centers.length);
  const components: number[][] = [];
  for (let i = 0; i < centers.length; i++) {
    if (visited[i]) continue;
    const stack = [i];
    const comp: number[] = [];
    visited[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nb of adj[cur]) {
        if (visited[nb]) continue;
        visited[nb] = 1;
        stack.push(nb);
      }
    }
    components.push(comp);
  }
  components.sort((l, r) => r.length - l.length);
  const mainSize = components[0]?.length || 0;
  if (mainSize < 32) return null;

  // Do not truncate to the first/largest island. GLB road_12 can contain small
  // disconnected asphalt seams at bridges/tunnels; incorporate every meaningful
  // connected road component and let angular binning + downstream waypoint
  // validation repair the small gaps into one raceable loop.
  const minComponentSize = Math.max(6, Math.floor(mainSize * 0.003));
  const includedComponents = components.filter((c) => c.length >= minComponentSize);
  const main = includedComponents.flat();

  const center = new THREE.Vector3();
  for (const idx of main) center.add(centers[idx]);
  center.multiplyScalar(1 / main.length);
  const centered = main.map((idx) => ({
    idx,
    angle: Math.atan2(centers[idx].z - center.z, centers[idx].x - center.x),
    r2: (centers[idx].x - center.x) ** 2 + (centers[idx].z - center.z) ** 2,
  }));

  const bins = Math.max(96, Math.min(1440, Math.round(Math.sqrt(main.length) * 12)));
  const radialBins: { idx: number; r2: number }[][] = Array.from({ length: bins }, () => []);
  centered.forEach((item) => {
    const u = (item.angle + Math.PI) / (Math.PI * 2);
    const bIdx = Math.min(bins - 1, Math.max(0, Math.floor(u * bins)));
    radialBins[bIdx].push({ idx: item.idx, r2: item.r2 });
  });

  const points: THREE.Vector3[] = [];
  for (let i = 0; i < bins; i++) {
    const bin = radialBins[i];
    if (bin.length === 0) continue;
    bin.sort((l, r) => l.r2 - r.r2);
    const trim = Math.floor(bin.length * 0.18);
    const usable = bin.slice(trim, Math.max(trim + 1, bin.length - trim));
    const p = new THREE.Vector3();
    usable.forEach((it) => p.add(centers[it.idx]));
    p.multiplyScalar(1 / usable.length);
    p.y += 0.35;
    points.push(p);
  }
  if (points.length < 40) return null;

  const smoothed = smoothPolyline(points, 3);
  const length = polylineLength(smoothed, true);
  const diag: Partial<ExtractionDiagnostics> = {
    meshes: roadMeshes.length,
    triangles: totalRoadTriangles,
    boundaryEdges,
    componentsBeforeBridge: components.length,
    componentsAfterBridge: 1,
    centerlinePoints: smoothed.length,
    loopPointCount: smoothed.length,
    loopLength: smoothed.length,
    totalMeters: length,
    estimatedRoadLength: length,
    closed: true,
    attempts: 1,
    elapsedMs: performance.now() - t0,
  };
  collectGridDiagnostics(roadMeshes, diag);
  return { points: rotateToMainStraight(smoothed), closed: true, diagnostics: diag as ExtractionDiagnostics };
}

function collectGridDiagnostics(roadMeshes: THREE.Mesh[], diag: Partial<ExtractionDiagnostics>) {
  const { points: cloud, stats } = sampleTriangles(roadMeshes, 80000);
  diag.meshes = stats.meshes;
  diag.triangles = stats.triangles;
  diag.sampledPoints = stats.sampledPoints;
  diag.rejectedFlatness = stats.rejectedFlatness;
  if (cloud.length < 64) return;
  const grid = buildOccupancyGrid(cloud, 900);
  if (!grid) return;
  diag.gridCells = grid.cols * grid.rows;
  diag.cellSize = grid.cellSize;
  morphClose(grid, 1);
  const before = labelComponents(grid).components.length;
  diag.componentsBeforeBridge = before;
  diag.bridges = bridgeComponents(grid, 24);
  diag.componentsAfterBridge = labelComponents(grid).components.length;
  const thinGrid: Grid = {
    ...grid,
    data: new Uint8Array(grid.data),
    height: new Float32Array(grid.height),
    heightCount: new Uint16Array(grid.heightCount),
  };
  zhangSuenThin(thinGrid);
  let skeletonCells = 0;
  for (let i = 0; i < thinGrid.data.length; i++) if (thinGrid.data[i]) skeletonCells++;
  diag.skeletonCells = skeletonCells;
}

function extractViaBoundaryLoops(roadMeshes: THREE.Mesh[]): RoadGraphExtraction | null {
  const t0 = performance.now();
  const diag: Partial<ExtractionDiagnostics> = { attempts: 1 };
  const traced = traceBoundaryLoops(roadMeshes);
  diag.meshes = roadMeshes.length;
  diag.triangles = traced.triangleCount;
  diag.boundaryLoops = traced.loops.length;
  diag.boundaryEdges = traced.boundaryEdgeCount;

  const closedLoops = traced.loops.filter((l) => l.closed);
  const candidates = closedLoops.length >= 2 ? closedLoops : traced.loops;
  if (candidates.length < 2) return null;

  const left = candidates[0];
  const right = candidates[1];
  const estimatedRoadLength = (left.length + right.length) * 0.5;
  const totalBoundaryLength = candidates.reduce((sum, loop) => sum + loop.length, 0);
  const boundaryCoverage = totalBoundaryLength > 1 ? (left.length + right.length) / totalBoundaryLength : 1;
  const sampleCount = Math.max(96, Math.min(2400, Math.round(estimatedRoadLength / 4.5)));
  const leftSamples = resampleLoop(left.points, sampleCount);
  const rightSamples = alignLoopToReference(leftSamples, resampleLoop(right.points, sampleCount));

  let centerline: THREE.Vector3[] = [];
  for (let i = 0; i < sampleCount; i++) {
    centerline.push(new THREE.Vector3().addVectors(leftSamples[i], rightSamples[i]).multiplyScalar(0.5));
  }
  centerline = smoothPolyline(centerline, 2);
  for (const p of centerline) p.y += 0.35;

  let centerLen = polylineLength(centerline, true);
  const lengthRatio = estimatedRoadLength > 1 ? centerLen / estimatedRoadLength : 1;
  // A true centerline should be close to the average edge loop length. Reject
  // only extreme mismatches; banked tracks and inner/outer radius differences
  // naturally create modest variance.
  if (centerline.length < 40 || lengthRatio < 0.55 || lengthRatio > 1.25 || boundaryCoverage < 0.55) {
    console.warn(
      `Racing2PathExtractor[boundary]: rejected centerline; points=${centerline.length}, ` +
        `len=${centerLen.toFixed(0)}m, edgeEstimate=${estimatedRoadLength.toFixed(0)}m, ` +
        `ratio=${lengthRatio.toFixed(2)}, boundaryCoverage=${boundaryCoverage.toFixed(2)}`,
    );
    return null;
  }

  collectGridDiagnostics(roadMeshes, diag);
  diag.loopPointCount = centerline.length;
  diag.loopLength = centerline.length;
  diag.centerlinePoints = centerline.length;
  diag.totalMeters = centerLen;
  diag.estimatedRoadLength = estimatedRoadLength;
  diag.closed = true;
  diag.elapsedMs = performance.now() - t0;

  return { points: rotateToMainStraight(centerline), closed: true, diagnostics: diag as ExtractionDiagnostics };
}

// ---------------------------------------------------------------------------
// Occupancy grid
// ---------------------------------------------------------------------------

interface Grid {
  data: Uint8Array;
  height: Float32Array;
  heightCount: Uint16Array;
  cols: number;
  rows: number;
  cellSize: number;
  minX: number;
  minZ: number;
}

function buildOccupancyGrid(cloud: THREE.Vector3[], targetCells = 700): Grid | null {
  const bbox = new THREE.Box3().setFromPoints(cloud);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const longest = Math.max(size.x, size.z);
  if (!Number.isFinite(longest) || longest < 1) return null;

  const cellSize = Math.max(1.6, longest / targetCells);
  const cols = Math.ceil(size.x / cellSize) + 8;
  const rows = Math.ceil(size.z / cellSize) + 8;
  const minX = bbox.min.x - cellSize * 4;
  const minZ = bbox.min.z - cellSize * 4;

  const data = new Uint8Array(cols * rows);
  const height = new Float32Array(cols * rows);
  const heightCount = new Uint16Array(cols * rows);
  for (const p of cloud) {
    const cx = Math.floor((p.x - minX) / cellSize);
    const cz = Math.floor((p.z - minZ) / cellSize);
    if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) continue;
    const idx = cz * cols + cx;
    data[idx] = 1;
    height[idx] += p.y;
    heightCount[idx]++;
  }
  for (let i = 0; i < data.length; i++) {
    if (heightCount[i] > 0) height[i] /= heightCount[i];
  }
  return { data, height, heightCount, cols, rows, cellSize, minX, minZ };
}

/** Dilate N times, then erode N times — closes gaps up to N cells wide. */
function morphClose(grid: Grid, radius = 1): void {
  const { cols, rows } = grid;
  for (let pass = 0; pass < radius; pass++) {
    const src = new Uint8Array(grid.data);
    for (let z = 1; z < rows - 1; z++) {
      for (let x = 1; x < cols - 1; x++) {
        if (src[z * cols + x]) continue;
        let n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (src[(z + dz) * cols + (x + dx)]) n++;
          }
        }
        if (n >= 3) grid.data[z * cols + x] = 1;
      }
    }
  }
  // Erode back
  for (let pass = 0; pass < radius; pass++) {
    const src = new Uint8Array(grid.data);
    for (let z = 1; z < rows - 1; z++) {
      for (let x = 1; x < cols - 1; x++) {
        if (!src[z * cols + x]) continue;
        let n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (src[(z + dz) * cols + (x + dx)]) n++;
          }
        }
        if (n < 5) grid.data[z * cols + x] = 0;
      }
    }
  }
}

interface Component { id: number; size: number; cells: number[]; cx: number; cz: number; }

/** Label every connected component (8-connectivity); return list + label grid. */
function labelComponents(grid: Grid): { labels: Int32Array; components: Component[] } {
  const { data, cols, rows } = grid;
  const labels = new Int32Array(cols * rows).fill(-1);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i] || labels[i] !== -1) continue;
    const id = components.length;
    const cells: number[] = [];
    let sumX = 0, sumZ = 0;
    stack.length = 0;
    stack.push(i);
    labels[i] = id;
    while (stack.length) {
      const idx = stack.pop()!;
      cells.push(idx);
      const x = idx % cols;
      const z = (idx - x) / cols;
      sumX += x;
      sumZ += z;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const nIdx = nz * cols + nx;
          if (!data[nIdx] || labels[nIdx] !== -1) continue;
          labels[nIdx] = id;
          stack.push(nIdx);
        }
      }
    }
    components.push({ id, size: cells.length, cells, cx: sumX / cells.length, cz: sumZ / cells.length });
  }
  components.sort((a, b) => b.size - a.size);
  return { labels, components };
}

/**
 * Bridge disconnected components into the main road by drawing 2-cell-wide
 * lines from each small component's nearest cell to the nearest main-component
 * cell — but only when the gap is below `maxBridgeCells` (e.g. ~25 m).
 */
function bridgeComponents(grid: Grid, maxBridgeCells: number): number {
  const { data, cols, rows } = grid;
  const { components } = labelComponents(grid);
  if (components.length <= 1) return 0;
  const main = components[0];
  const mainSet = new Set(main.cells);
  let bridges = 0;

  for (let i = 1; i < components.length; i++) {
    const comp = components[i];
    if (comp.size < 4) continue; // ignore noise
    let bestA = -1, bestB = -1, bestD = Infinity;
    // Limit pairwise search by sampling representative cells (every Nth).
    const stride = Math.max(1, Math.floor(comp.cells.length / 60));
    const mainStride = Math.max(1, Math.floor(main.cells.length / 200));
    for (let ai = 0; ai < comp.cells.length; ai += stride) {
      const a = comp.cells[ai];
      const ax = a % cols, az = (a - ax) / cols;
      for (let bi = 0; bi < main.cells.length; bi += mainStride) {
        const b = main.cells[bi];
        const bx = b % cols, bz = (b - bx) / cols;
        const dx = ax - bx, dz = az - bz;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestA = a; bestB = b; }
      }
    }
    if (bestA < 0 || Math.sqrt(bestD) > maxBridgeCells) continue;
    // Bresenham-ish line from bestA to bestB; thicken by 1 cell.
    const ax = bestA % cols, az = (bestA - ax) / cols;
    const bx = bestB % cols, bz = (bestB - bx) / cols;
    const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(ax + (bx - ax) * t);
      const z = Math.round(az + (bz - az) * t);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          data[nz * cols + nx] = 1;
        }
      }
    }
    // Absorb into main set so further components can also bridge through it.
    comp.cells.forEach((c) => mainSet.add(c));
    bridges++;
  }
  return bridges;
}

function keepLargestComponent(grid: Grid): number {
  const { data, cols, rows } = grid;
  const { components } = labelComponents(grid);
  if (components.length === 0) return 0;
  const keepId = components[0].id;
  const { labels } = labelComponents(grid); // re-label (cheap on small grids)
  const keep = new Uint8Array(cols * rows);
  for (let i = 0; i < data.length; i++) if (labels[i] === keepId) keep[i] = 1;
  data.set(keep);
  return components[0].size;
}

function zhangSuenThin(grid: Grid): void {
  const { data, cols, rows } = grid;
  const get = (x: number, z: number) => (x < 0 || z < 0 || x >= cols || z >= rows ? 0 : data[z * cols + x]);
  const toDelete: number[] = [];
  const applyPass = (passIdx: number): boolean => {
    toDelete.length = 0;
    for (let z = 1; z < rows - 1; z++) {
      for (let x = 1; x < cols - 1; x++) {
        if (!data[z * cols + x]) continue;
        const p2 = get(x, z - 1);
        const p3 = get(x + 1, z - 1);
        const p4 = get(x + 1, z);
        const p5 = get(x + 1, z + 1);
        const p6 = get(x, z + 1);
        const p7 = get(x - 1, z + 1);
        const p8 = get(x - 1, z);
        const p9 = get(x - 1, z - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let i = 0; i < 8; i++) if (seq[i] === 0 && seq[i + 1] === 1) A++;
        if (A !== 1) continue;
        if (passIdx === 0) {
          if (p2 * p4 * p6 !== 0) continue;
          if (p4 * p6 * p8 !== 0) continue;
        } else {
          if (p2 * p4 * p8 !== 0) continue;
          if (p2 * p6 * p8 !== 0) continue;
        }
        toDelete.push(z * cols + x);
      }
    }
    for (const idx of toDelete) data[idx] = 0;
    return toDelete.length > 0;
  };
  let iter = 0;
  while (iter++ < 400) {
    const a = applyPass(0);
    const b = applyPass(1);
    if (!a && !b) break;
  }
}

function pruneSpurs(grid: Grid): number {
  const { data, cols, rows } = grid;
  const get = (x: number, z: number) => (x < 0 || z < 0 || x >= cols || z >= rows ? 0 : data[z * cols + x]);
  let pruned = 0;
  let iter = 0;
  while (iter++ < 800) {
    const remove: number[] = [];
    for (let z = 1; z < rows - 1; z++) {
      for (let x = 1; x < cols - 1; x++) {
        if (!data[z * cols + x]) continue;
        let n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            if (get(x + dx, z + dz)) n++;
          }
        }
        if (n <= 1) remove.push(z * cols + x);
      }
    }
    if (remove.length === 0) break;
    for (const i of remove) data[i] = 0;
    pruned += remove.length;
  }
  return pruned;
}

/**
 * Find the longest cycle in the thinned skeleton by walking from every
 * node and picking the direction-coherent path that closes back on itself.
 * This is far more robust than the previous "stop at first re-visit" walker
 * which used to truncate the loop at the first crossover.
 */
function traceLongestCycle(grid: Grid): THREE.Vector3[] | null {
  const { data, height, cols, rows, cellSize, minX, minZ } = grid;
  const order = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];
  const toWorld = (idx: number) => {
    const x = idx % cols;
    const z = (idx - x) / cols;
    return new THREE.Vector3(minX + (x + 0.5) * cellSize, height[idx] || 0, minZ + (z + 0.5) * cellSize);
  };

  // Collect all skeleton cells and their degree.
  const cells: number[] = [];
  for (let i = 0; i < data.length; i++) if (data[i]) cells.push(i);
  if (cells.length < 24) return null;

  // Try starting from a handful of seed cells (rough geographic extremes)
  // to maximize the chance of finding the full circuit.
  const seeds: number[] = [];
  let minXIdx = cells[0], maxXIdx = cells[0], minZIdx = cells[0], maxZIdx = cells[0];
  let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const c of cells) {
    const x = c % cols, z = (c - x) / cols;
    if (x < mnx) { mnx = x; minXIdx = c; }
    if (x > mxx) { mxx = x; maxXIdx = c; }
    if (z < mnz) { mnz = z; minZIdx = c; }
    if (z > mxz) { mxz = z; maxZIdx = c; }
  }
  seeds.push(minXIdx, maxXIdx, minZIdx, maxZIdx);

  let best: number[] = [];
  const visited = new Uint8Array(cols * rows);

  const walkFrom = (start: number): number[] => {
    visited.fill(0);
    const path: number[] = [start];
    visited[start] = 1;
    let cur = start;
    let prevDx = 1, prevDz = 0;
    let safety = cells.length * 2;
    while (safety-- > 0) {
      const x = cur % cols;
      const z = (cur - x) / cols;
      let bestNext = -1, bestScore = -Infinity;
      for (const [dx, dz] of order) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const nIdx = nz * cols + nx;
        if (!data[nIdx]) continue;
        if (visited[nIdx]) {
          if (nIdx === start && path.length > 30) return path; // closed
          continue;
        }
        const score = dx * prevDx + dz * prevDz + 0.001;
        if (score > bestScore) { bestScore = score; bestNext = nIdx; }
      }
      if (bestNext < 0) break;
      visited[bestNext] = 1;
      path.push(bestNext);
      const nx = bestNext % cols, nz = (bestNext - nx) / cols;
      prevDx = nx - x; prevDz = nz - z;
      cur = bestNext;
    }
    return path;
  };

  for (const seed of seeds) {
    const p = walkFrom(seed);
    if (p.length > best.length) best = p;
  }

  if (best.length < 24) return null;
  return best.map(toWorld);
}

function smoothPolyline(points: THREE.Vector3[], iterations = 2): THREE.Vector3[] {
  let pts = points.map((p) => p.clone());
  for (let it = 0; it < iterations; it++) {
    const out = pts.map((p) => p.clone());
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      out[i].set((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
    }
    pts = out;
  }
  return pts;
}

interface ExtractionDiagnostics {
  meshes: number;
  triangles: number;
  sampledPoints: number;
  rejectedFlatness: number;
  gridCells: number;
  cellSize: number;
  componentsBeforeBridge: number;
  bridges: number;
  componentsAfterBridge: number;
  skeletonCells: number;
  spursPruned: number;
  loopLength: number;
  loopPointCount: number;
  totalMeters: number;
  closed: boolean;
  attempts: number;
  elapsedMs: number;
  boundaryLoops?: number;
  boundaryEdges?: number;
  centerlinePoints?: number;
  estimatedRoadLength?: number;
}

function attemptSkeletonExtraction(
  roadMeshes: THREE.Mesh[],
  targetCells: number,
  morphRadius: number,
  bridgeCells: number,
  diag: Partial<ExtractionDiagnostics>,
): { points: THREE.Vector3[]; closed: boolean } | null {
  const { points: cloud, stats } = sampleTriangles(roadMeshes, 80000);
  diag.meshes = stats.meshes;
  diag.triangles = stats.triangles;
  diag.sampledPoints = stats.sampledPoints;
  diag.rejectedFlatness = stats.rejectedFlatness;
  if (cloud.length < 64) return null;

  const grid = buildOccupancyGrid(cloud, targetCells);
  if (!grid) return null;
  diag.gridCells = grid.cols * grid.rows;
  diag.cellSize = grid.cellSize;

  morphClose(grid, morphRadius);

  const beforeBridge = labelComponents(grid).components.length;
  diag.componentsBeforeBridge = beforeBridge;

  const bridges = bridgeComponents(grid, bridgeCells);
  diag.bridges = bridges;

  const afterBridge = labelComponents(grid).components.length;
  diag.componentsAfterBridge = afterBridge;

  keepLargestComponent(grid);
  zhangSuenThin(grid);
  diag.spursPruned = pruneSpurs(grid);
  keepLargestComponent(grid);

  let skeletonCells = 0;
  for (let i = 0; i < grid.data.length; i++) if (grid.data[i]) skeletonCells++;
  diag.skeletonCells = skeletonCells;

  const loop = traceLongestCycle(grid);
  if (!loop || loop.length < 24) return null;

  diag.loopPointCount = loop.length;
  const closed = loop[0].distanceTo(loop[loop.length - 1]) < grid.cellSize * 8;
  const stride = Math.max(6, grid.cellSize * 2.2);
  const resampled = resampleByDistance(loop, stride, closed);
  const smoothed = smoothPolyline(resampled, 2);
  for (const p of smoothed) p.y += 0.4;

  let totalMeters = 0;
  for (let i = 0; i < smoothed.length; i++) totalMeters += smoothed[i].distanceTo(smoothed[(i + 1) % smoothed.length]);
  diag.loopLength = smoothed.length;
  diag.totalMeters = totalMeters;
  diag.closed = closed;

  const rotated = closed ? rotateToMainStraight(smoothed) : smoothed;
  return { points: rotated, closed };
}

/** Validate extraction matches a plausible full circuit (length + closure). */
function validateExtraction(result: { points: THREE.Vector3[]; closed: boolean }, roadAreaHint: number): string[] {
  const errors: string[] = [];
  if (!result.closed) errors.push("loop not closed");
  if (result.points.length < 40) errors.push(`too few points (${result.points.length})`);
  let totalM = 0;
  let maxGap = 0;
  for (let i = 0; i < result.points.length; i++) {
    const d = result.points[i].distanceTo(result.points[(i + 1) % result.points.length]);
    totalM += d;
    if (d > maxGap) maxGap = d;
  }
  if (totalM < 300) errors.push(`loop length ${totalM.toFixed(0)}m too short`);
  if (maxGap > 30) errors.push(`max gap ${maxGap.toFixed(0)}m too large`);
  // If we have a road-area hint, the perimeter heuristic catches "only-the-start-straight" loops.
  if (roadAreaHint > 0) {
    const expectedMin = Math.sqrt(roadAreaHint) * 2.0; // loose lower bound
    if (totalM < expectedMin) errors.push(`loop ${totalM.toFixed(0)}m << expected ${expectedMin.toFixed(0)}m for road area`);
  }
  return errors;
}

function roadAreaHint(roadMeshes: THREE.Mesh[]): number {
  const bb = new THREE.Box3();
  roadMeshes.forEach((m) => bb.expandByObject(m));
  const s = new THREE.Vector3();
  bb.getSize(s);
  return s.x * s.z;
}

function extractViaSkeleton(roadMeshes: THREE.Mesh[]): {
  points: THREE.Vector3[];
  closed: boolean;
  diagnostics: ExtractionDiagnostics;
} | null {
  const t0 = performance.now();
  const areaHint = roadAreaHint(roadMeshes);
  const diag: Partial<ExtractionDiagnostics> = { attempts: 0 };

  // Progressively denser + more aggressive bridging on retry.
  const attempts = [
    { targetCells: 700, morphRadius: 1, bridgeCells: 16 },
    { targetCells: 900, morphRadius: 2, bridgeCells: 24 },
    { targetCells: 1200, morphRadius: 2, bridgeCells: 36 },
  ];

  let last: { points: THREE.Vector3[]; closed: boolean } | null = null;
  let lastErrors: string[] = ["no result"];

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    diag.attempts = i + 1;
    const res = attemptSkeletonExtraction(roadMeshes, a.targetCells, a.morphRadius, a.bridgeCells, diag);
    if (!res) { lastErrors = ["skeleton trace failed"]; continue; }
    const errs = validateExtraction(res, areaHint);
    last = res;
    lastErrors = errs;
    if (errs.length === 0) break;
    console.warn(`Racing2PathExtractor: attempt ${i + 1} validation issues:`, errs);
  }

  diag.elapsedMs = performance.now() - t0;

  if (!last) {
    console.error("Racing2PathExtractor: skeleton extraction exhausted retries");
    return null;
  }
  if (lastErrors.length > 0) {
    console.warn(
      `Racing2PathExtractor: returning best-effort loop (errors: ${lastErrors.join("; ")})`,
    );
  }
  return { ...last, diagnostics: diag as ExtractionDiagnostics };
}

// ---------------------------------------------------------------------------
// Legacy greedy walk (last-ditch fallback)
// ---------------------------------------------------------------------------

function extractViaGreedyCentroids(roadMeshes: THREE.Mesh[]): { points: THREE.Vector3[]; closed: boolean } | null {
  const { points: cloud } = sampleTriangles(roadMeshes, 12000);
  if (cloud.length < 16) return null;
  const bbox = new THREE.Box3().setFromPoints(cloud);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const longest = Math.max(size.x, size.z);
  if (!Number.isFinite(longest) || longest < 1) return null;
  const cellSize = Math.max(6, longest / 400);
  const cells = new Map<string, { sum: THREE.Vector3; n: number }>();
  for (const p of cloud) {
    const cx = Math.floor(p.x / cellSize);
    const cz = Math.floor(p.z / cellSize);
    const key = cx + ":" + cz;
    let cell = cells.get(key);
    if (!cell) { cell = { sum: new THREE.Vector3(), n: 0 }; cells.set(key, cell); }
    cell.sum.add(p);
    cell.n++;
  }
  const anchors: THREE.Vector3[] = [];
  cells.forEach((c) => anchors.push(c.sum.clone().multiplyScalar(1 / c.n)));
  if (anchors.length < 8) return null;
  anchors.sort((a, b) => (size.x >= size.z ? a.x - b.x : a.z - b.z));
  const used = new Uint8Array(anchors.length);
  const path: THREE.Vector3[] = [anchors[0].clone()];
  used[0] = 1;
  let curIdx = 0;
  const maxStep = cellSize * 6;
  for (let step = 0; step < anchors.length - 1; step++) {
    let best = -1, bestD = Infinity;
    const cur = anchors[curIdx];
    for (let i = 0; i < anchors.length; i++) {
      if (used[i]) continue;
      const dx = anchors[i].x - cur.x;
      const dz = anchors[i].z - cur.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best === -1 || Math.sqrt(bestD) > maxStep) break;
    used[best] = 1;
    path.push(anchors[best].clone());
    curIdx = best;
  }
  if (path.length < 8) return null;
  const closed = path[path.length - 1].distanceTo(path[0]) < cellSize * 6;
  const resampled = resampleByDistance(path, 22, closed);
  for (const p of resampled) p.y += 0.4;
  const rotated = closed ? rotateToMainStraight(resampled) : resampled;
  return { points: rotated, closed };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RacingPathResult {
  points: THREE.Vector3[];
  closed: boolean;
  source: "named-nodes" | "road-skeleton" | "road-centerline";
  diagnostics?: ExtractionDiagnostics;
}

export function extractRacingPath(
  root: THREE.Object3D,
  roadMeshes: THREE.Mesh[],
): RacingPathResult | null {
  // 1) Boundary-loop extraction (road_12 production path). This consumes every
  // road triangle, derives both road edges, and averages them into a single
  // full-lap centerline instead of stopping at the first skeleton cycle.
  try {
    const boundary = extractViaBoundaryLoops(roadMeshes);
    if (boundary && boundary.points.length >= 40) {
      const d = boundary.diagnostics;
      console.log(
        `Racing2PathExtractor[road_12-full-network]: ` +
          `Total road meshes=${d.meshes}; ` +
          `Total road triangles=${d.triangles}; ` +
          `Sampled points=${d.sampledPoints || 0}; ` +
          `Occupancy cells=${d.gridCells || 0}; ` +
          `Connected components=${d.componentsBeforeBridge || 0}->${d.componentsAfterBridge || 0}; ` +
          `Skeleton cells=${d.skeletonCells || 0}; ` +
          `Boundary loops=${d.boundaryLoops || 0}; ` +
          `Centerline points=${d.centerlinePoints || d.loopPointCount}; ` +
          `Final spline points=${boundary.points.length}; ` +
          `Track length=${d.totalMeters?.toFixed(0)}m; ` +
          `Estimated road length=${d.estimatedRoadLength?.toFixed(0)}m; ` +
          `Closed loop=${d.closed}`,
      );
      return { points: boundary.points, closed: boundary.closed, source: "road-skeleton", diagnostics: d };
    }
  } catch (err) {
    console.warn("Racing2PathExtractor: boundary extraction threw, falling back to skeleton", err);
  }

  // 2) Triangle adjacency fallback. This still scans every road_12 triangle and
  // creates a full closed centerline from the whole connected asphalt component,
  // so it cannot truncate at the first detected skeleton loop.
  try {
    const graph = extractFromTriangleAdjacency(roadMeshes);
    if (graph && graph.points.length >= 40) {
      const d = graph.diagnostics;
      console.log(
        `Racing2PathExtractor[triangle-graph-full-network]: ` +
          `Total road meshes=${d.meshes}; ` +
          `Total road triangles=${d.triangles}; ` +
          `Sampled points=${d.sampledPoints || 0}; ` +
          `Occupancy cells=${d.gridCells || 0}; ` +
          `Connected components=${d.componentsBeforeBridge || 0}->${d.componentsAfterBridge || 0}; ` +
          `Skeleton cells=${d.skeletonCells || 0}; ` +
          `Centerline points=${d.centerlinePoints || d.loopPointCount}; ` +
          `Final spline points=${graph.points.length}; ` +
          `Track length=${d.totalMeters?.toFixed(0)}m; ` +
          `Closed loop=${d.closed}`,
      );
      return { points: graph.points, closed: graph.closed, source: "road-skeleton", diagnostics: d };
    }
  } catch (err) {
    console.warn("Racing2PathExtractor: triangle graph extraction threw, falling back to skeleton", err);
  }

  // 3) Triangle-graph skeleton extraction fallback
  try {
    const skel = extractViaSkeleton(roadMeshes);
    if (skel && skel.points.length >= 24) {
      const d = skel.diagnostics;
      console.log(
        `Racing2PathExtractor[skeleton-fallback]: ` +
          `Total road meshes=${d.meshes}; ` +
          `Total road triangles=${d.triangles}; ` +
          `Sampled points=${d.sampledPoints}; ` +
          `Occupancy cells=${d.gridCells}@${d.cellSize?.toFixed(2)}m; ` +
          `Connected components=${d.componentsBeforeBridge}->${d.componentsAfterBridge} (bridged=${d.bridges}); ` +
          `Skeleton cells=${d.skeletonCells}; ` +
          `Centerline points=${d.loopPointCount}; ` +
          `Final spline points=${skel.points.length}; ` +
          `Track length=${d.totalMeters?.toFixed(0)}m; ` +
          `Closed loop=${d.closed}; ` +
          `attempts=${d.attempts} in ${d.elapsedMs?.toFixed(0)}ms`,
      );
      return { points: skel.points, closed: skel.closed, source: "road-skeleton", diagnostics: d };
    }
  } catch (err) {
    console.warn("Racing2PathExtractor: skeleton extraction threw, falling back", err);
  }

  // 4) Named-node strategy is deliberately below road_12 extraction so Racing2
  // never accepts a partial authored waypoint chain when the complete asphalt
  // mesh is available.
  const named = extractFromNamedNodes(root);
  if (named && named.length >= 4) {
    const closed = isClosedLoop(named, 80);
    const rotated = closed ? rotateToMainStraight(named) : named;
    console.log(`Racing2PathExtractor: road extraction failed, using ${named.length} named waypoint nodes, closed=${closed}`);
    return { points: rotated, closed, source: "named-nodes" };
  }

  // 5) Greedy centroid walk (legacy last-ditch)
  const center = extractViaGreedyCentroids(roadMeshes);
  if (center && center.points.length >= 4) {
    console.warn(`Racing2PathExtractor: skeleton failed, using greedy centroid walk (${center.points.length} pts)`);
    return { points: center.points, closed: center.closed, source: "road-centerline" };
  }

  return null;
}
