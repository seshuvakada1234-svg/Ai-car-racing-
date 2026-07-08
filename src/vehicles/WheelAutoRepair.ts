import * as THREE from "three";

/**
 * Geometry-based wheel auto-repair (v2).
 *
 * Handles three nasty real-world GLB cases:
 *
 *   A) Per-corner wheel meshes already exist → cluster & wrap each in a
 *      helper pivot.
 *   B) Wheels named but pivots wrong → ditto, helper sits at true mesh
 *      centroid (not the broken authored pivot).
 *   C) **Merged geometry** (Sketchfab) — all 4 wheels share ONE BufferGeometry
 *      whose centre is at the car centreline. The old quadrant cluster would
 *      drop the whole mesh into one bucket, leaving the opposite-side rear
 *      "floating" because no helper existed there. We now SPLIT the merged
 *      geometry by world-space (x,z) sign into up to 4 sub-meshes so every
 *      quadrant gets its own visual wheel.
 *
 * After clustering we enforce **left/right symmetry**: paired wheels share
 * |x|, y, and z so the rear axle is perfectly level even when one side's
 * authored geometry was slightly off.
 */

const WHEEL_TERMS = ["wheel", "tire", "tyre", "rim", "pneu"];
const FORBID_TERMS = [
  "caliper",
  "disc",
  "brake",
  "rotor",
  "drum",
  "arch",
  "housing",
  "well",
  "fender",
  "shadow",
  "lod",
  "collision",
  "helper",
  "pivot",
  "dummy",
];
const WHEEL_RE = /wheel|tire|tyre|rim|pneu/gi;

type Quadrant = "FL" | "FR" | "RL" | "RR";
const QUADS: Quadrant[] = ["FL", "FR", "RL", "RR"];

function isNameWheelish(name: string): boolean {
  const l = name.toLowerCase();
  return WHEEL_TERMS.some((t) => l.includes(t)) && !FORBID_TERMS.some((t) => l.includes(t));
}
function isForbidden(name: string): boolean {
  const l = name.toLowerCase();
  return FORBID_TERMS.some((t) => l.includes(t));
}
function ancestorIsWheelish(o: THREE.Object3D, root: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o.parent;
  while (p && p !== root) {
    if (isNameWheelish(p.name)) return true;
    p = p.parent;
  }
  return false;
}

interface Candidate {
  mesh: THREE.Mesh;
  worldCenter: THREE.Vector3;
  worldBox: THREE.Box3;
  radius: number;
}

export interface WheelRepairReport {
  helpers: THREE.Object3D[];
  detectedByName: number;
  detectedByGeometry: number;
  geometrySplit: number; // # meshes split because they spanned >1 quadrant
  quadrants: Record<Quadrant, number>;
  missing: Quadrant[];
}

function quadrantOf(p: THREE.Vector3, center: THREE.Vector3): Quadrant {
  const left = p.x - center.x > 0;
  const front = p.z - center.z > 0;
  return ((front ? "F" : "R") + (left ? "L" : "R")) as Quadrant;
}

/**
 * Split a mesh whose world-space bbox spans more than one quadrant into up
 * to 4 sub-meshes (one per occupied quadrant). New meshes inherit material
 * and share the same parent transform as the original; the original is
 * removed from its parent.
 *
 * Returns the new sub-meshes already placed in the scene under the original
 * parent. Each sub-mesh has its own BufferGeometry containing only triangles
 * whose centroid falls inside that quadrant (world space, relative to
 * `chassisCenter`).
 */
function splitMeshByQuadrant(
  mesh: THREE.Mesh,
  chassisCenter: THREE.Vector3,
): THREE.Mesh[] {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!posAttr) return [];

  mesh.updateMatrixWorld(true);
  const m = mesh.matrixWorld;

  const indexAttr = geo.getIndex();
  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

  // Per-quadrant triangle index arrays (into original vertices)
  const quadIndices: Record<Quadrant, number[]> = { FL: [], FR: [], RL: [], RR: [] };

  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  const getVert = (i: number, out: THREE.Vector3) => {
    out.fromBufferAttribute(posAttr, i).applyMatrix4(m);
  };

  for (let t = 0; t < triCount; t++) {
    const ia = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const ib = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const ic = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
    getVert(ia, a);
    getVert(ib, b);
    getVert(ic, c);
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const q = quadrantOf(centroid, chassisCenter);
    quadIndices[q].push(ia, ib, ic);
  }

  const occupied = QUADS.filter((q) => quadIndices[q].length > 0);
  if (occupied.length <= 1) return []; // nothing to split

  // Pre-extract original world-space vertex array so each new mesh sits in
  // local space identical to its parent (parent transform reapplied later).
  const parent = mesh.parent;
  if (!parent) return [];
  parent.updateMatrixWorld(true);
  const parentInv = parent.matrixWorld.clone().invert();

  const newMeshes: THREE.Mesh[] = [];
  for (const q of occupied) {
    const tris = quadIndices[q];

    // Compact: map old-index → new-index for this quadrant
    const remap = new Map<number, number>();
    const newPositions: number[] = [];
    const newNormals: number[] = [];
    const newUVs: number[] = [];
    const newIndex: number[] = [];

    const normalAttr = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
    const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute | undefined;

    for (const oldIdx of tris) {
      let newIdx = remap.get(oldIdx);
      if (newIdx === undefined) {
        newIdx = newPositions.length / 3;
        remap.set(oldIdx, newIdx);
        // World→local for new mesh (parent local frame)
        v.fromBufferAttribute(posAttr, oldIdx).applyMatrix4(m).applyMatrix4(parentInv);
        newPositions.push(v.x, v.y, v.z);
        if (normalAttr) newNormals.push(normalAttr.getX(oldIdx), normalAttr.getY(oldIdx), normalAttr.getZ(oldIdx));
        if (uvAttr) newUVs.push(uvAttr.getX(oldIdx), uvAttr.getY(oldIdx));
      }
      newIndex.push(newIdx);
    }

    const subGeo = new THREE.BufferGeometry();
    subGeo.setAttribute("position", new THREE.Float32BufferAttribute(newPositions, 3));
    if (newNormals.length) subGeo.setAttribute("normal", new THREE.Float32BufferAttribute(newNormals, 3));
    else subGeo.computeVertexNormals();
    if (newUVs.length) subGeo.setAttribute("uv", new THREE.Float32BufferAttribute(newUVs, 2));
    subGeo.setIndex(newIndex);
    subGeo.computeBoundingBox();
    subGeo.computeBoundingSphere();

    const subMesh = new THREE.Mesh(subGeo, mesh.material);
    subMesh.name = `${mesh.name || "wheel"}_split_${q}`;
    subMesh.castShadow = mesh.castShadow;
    subMesh.receiveShadow = mesh.receiveShadow;
    subMesh.visible = mesh.visible;
    parent.add(subMesh);
    newMeshes.push(subMesh);
  }

  // Remove the original merged mesh
  parent.remove(mesh);
  geo.dispose();

  return newMeshes;
}

export function autoRepairWheels(modelRoot: THREE.Object3D): WheelRepairReport {
  modelRoot.updateMatrixWorld(true);

  const fullBox = new THREE.Box3().setFromObject(modelRoot);
  const fullCenter = fullBox.getCenter(new THREE.Vector3());
  const midY = (fullBox.min.y + fullBox.max.y) / 2;

  let byName = 0;
  let byGeometry = 0;
  let geometrySplit = 0;
  const candidates: Candidate[] = [];
  const seen = new Set<THREE.Mesh>();

  const collectCandidates = (): void => {
    candidates.length = 0;
    modelRoot.updateMatrixWorld(true);
    modelRoot.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (!o.geometry) return;
      if (isForbidden(o.name)) return;
      if (seen.has(o)) return;

      const wheelishByName = isNameWheelish(o.name) || ancestorIsWheelish(o, modelRoot);

      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
      const diameter = dims[1];
      const radius = diameter * 0.5;

      const roundish = dims[1] > 0 && dims[0] / dims[1] < 1.8;
      const sizeOk = radius > 0.18 && radius < 0.6;
      const lowerHalf = center.y < midY;

      if (wheelishByName) {
        candidates.push({ mesh: o, worldCenter: center, worldBox: box, radius });
        byName++;
      } else if (roundish && sizeOk && lowerHalf) {
        candidates.push({ mesh: o, worldCenter: center, worldBox: box, radius });
        byGeometry++;
      }
    });
  };

  collectCandidates();

  // Pass 2 — split any merged meshes that span >1 quadrant. We re-collect
  // candidates afterwards so the new sub-meshes participate in clustering.
  const toSplit = candidates.filter((c) => {
    const halfX = (c.worldBox.max.x - c.worldBox.min.x) * 0.5;
    const halfZ = (c.worldBox.max.z - c.worldBox.min.z) * 0.5;
    const offX = Math.abs(c.worldCenter.x - fullCenter.x);
    const offZ = Math.abs(c.worldCenter.z - fullCenter.z);
    // Spans the centreline in X or Z = covers multiple quadrants.
    return halfX > offX + 0.1 || halfZ > offZ + 0.1;
  });

  if (toSplit.length > 0) {
    for (const c of toSplit) {
      const subs = splitMeshByQuadrant(c.mesh, fullCenter);
      if (subs.length > 0) geometrySplit++;
    }
    byName = 0;
    byGeometry = 0;
    seen.clear();
    collectCandidates();
  }

  for (const c of candidates) seen.add(c.mesh);

  // Cluster into quadrants. Convention: +X = LEFT, +Z = FRONT.
  const buckets: Record<Quadrant, Candidate[]> = { FL: [], FR: [], RL: [], RR: [] };
  for (const c of candidates) {
    buckets[quadrantOf(c.worldCenter, fullCenter)].push(c);
  }

  // Compute per-quadrant centroid + bottom-Y in WORLD space
  const quadCenters: Partial<Record<Quadrant, THREE.Vector3>> = {};
  const quadBottomY: Partial<Record<Quadrant, number>> = {};
  const quadRadius: Partial<Record<Quadrant, number>> = {};
  for (const q of QUADS) {
    const items = buckets[q];
    if (items.length === 0) continue;
    const box = new THREE.Box3();
    let rMax = 0;
    for (const it of items) {
      box.union(it.worldBox);
      if (it.radius > rMax) rMax = it.radius;
    }
    quadCenters[q] = box.getCenter(new THREE.Vector3());
    quadBottomY[q] = box.min.y;
    quadRadius[q] = rMax;
  }

  // ── Enforce L/R symmetry ────────────────────────────────────────────────
  // For each axle (Front, Rear), if both sides exist, set them to share
  // |x|, y, z. If only one side exists, mirror it to the missing side.
  const symmetrise = (left: Quadrant, right: Quadrant): void => {
    const lc = quadCenters[left];
    const rc = quadCenters[right];
    if (lc && rc) {
      const absX = (Math.abs(lc.x - fullCenter.x) + Math.abs(rc.x - fullCenter.x)) * 0.5;
      const avgY = (lc.y + rc.y) * 0.5;
      const avgZ = (lc.z + rc.z) * 0.5;
      lc.set(fullCenter.x + absX, avgY, avgZ);
      rc.set(fullCenter.x - absX, avgY, avgZ);
      const rAvg = ((quadRadius[left] ?? 0) + (quadRadius[right] ?? 0)) * 0.5;
      quadRadius[left] = rAvg;
      quadRadius[right] = rAvg;
      const bMin = Math.min(quadBottomY[left] ?? 0, quadBottomY[right] ?? 0);
      quadBottomY[left] = bMin;
      quadBottomY[right] = bMin;
    } else if (lc && !rc) {
      const mirrored = lc.clone();
      mirrored.x = fullCenter.x - (lc.x - fullCenter.x);
      quadCenters[right] = mirrored;
      quadRadius[right] = quadRadius[left];
      quadBottomY[right] = quadBottomY[left];
    } else if (rc && !lc) {
      const mirrored = rc.clone();
      mirrored.x = fullCenter.x - (rc.x - fullCenter.x);
      quadCenters[left] = mirrored;
      quadRadius[left] = quadRadius[right];
      quadBottomY[left] = quadBottomY[right];
    }
  };
  symmetrise("FL", "FR");
  symmetrise("RL", "RR");

  // ── Create helpers at the locked symmetric positions ───────────────────
  // Y is anchored so that helper.y - radius == ground line of the wheel
  // (i.e. helper sits at wheel CENTRE). Meshes are attached preserving world
  // transforms, so visually nothing snaps — but the pivot is now correct.
  const helpers: THREE.Object3D[] = [];
  const quadCounts: Record<Quadrant, number> = { FL: 0, FR: 0, RL: 0, RR: 0 };

  for (const q of QUADS) {
    const center = quadCenters[q];
    if (!center) continue;
    const radius = quadRadius[q] ?? 0.35;
    const bottomY = quadBottomY[q] ?? center.y - radius;
    // Force helper to wheel-centre Y derived from bottomY + radius so left/
    // right share the exact same ground contact line.
    center.y = bottomY + radius;

    const helper = new THREE.Group();
    helper.name = `helper_wheel_${q}`;
    // Store the repaired pivot in chassis-local space. `center` is measured in
    // world space for robust clustering, but wheel mounts must never be placed
    // with world coordinates under the GLB root.
    helper.position.copy(modelRoot.worldToLocal(center.clone()));
    modelRoot.add(helper);
    modelRoot.updateMatrixWorld(true);

    quadCounts[q] = buckets[q].length;
    for (const it of buckets[q]) helper.attach(it.mesh);
    helpers.push(helper);
  }

  // Strip wheel-ish names from leftover groups outside helpers so the
  // downstream WheelSystem name-walk only matches our 4 helpers.
  const helperSet = new Set<THREE.Object3D>(helpers);
  modelRoot.traverse((o) => {
    if (helperSet.has(o)) return;
    let p: THREE.Object3D | null = o.parent;
    let underHelper = false;
    while (p) {
      if (helperSet.has(p)) {
        underHelper = true;
        break;
      }
      p = p.parent;
    }
    if (underHelper) return;
    if (WHEEL_RE.test(o.name)) {
      WHEEL_RE.lastIndex = 0;
      o.name = o.name.replace(WHEEL_RE, "wh1");
    }
    WHEEL_RE.lastIndex = 0;
  });

  const missing = QUADS.filter((k) => !quadCenters[k]);

  return {
    helpers,
    detectedByName: byName,
    detectedByGeometry: byGeometry,
    geometrySplit,
    quadrants: quadCounts,
    missing,
  };
}
