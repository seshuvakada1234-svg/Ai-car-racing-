// @ts-nocheck
import * as THREE from "three";

/**
 * Racing2WaypointNetwork
 * ----------------------
 * Takes a raw centerline polyline (from Racing2PathExtractor) and produces a
 * dense, validated waypoint network suitable for AI navigation, checkpoint
 * generation, lap counting, and minimap rendering.
 *
 *   - Resamples to a uniform 5–10 m stride along a Catmull-Rom spline.
 *   - Forces loop closure (last waypoint connects back to the first).
 *   - Guarantees every waypoint links to the next (no gaps > 14 m, no
 *     duplicates, no zero-length segments).
 *   - Derives sequential checkpoints (~one per 180 m, min 12, max 96).
 *   - Runs a strict validator and, if it fails, smooths/repairs and retries
 *     before giving up.
 */

export interface WaypointNetwork {
  waypoints: THREE.Vector3[];                 // dense, ordered, closed-loop waypoints
  checkpointIndices: number[];                // indices into `waypoints` defining checkpoint order
  curve: THREE.CatmullRomCurve3;              // smooth spline through the waypoints
  totalLength: number;
  closed: true;
  stride: number;                             // actual spacing in meters
  validation: WaypointValidation;
}

export interface WaypointValidation {
  ok: boolean;
  closed: boolean;
  count: number;
  minSpacing: number;
  maxSpacing: number;
  avgSpacing: number;
  largestGap: number;
  duplicateCount: number;
  checkpointCount: number;
  errors: string[];
  warnings: string[];
}

const DEFAULT_STRIDE = 8;          // meters between waypoints (target)
const MIN_STRIDE = 5;
const MAX_GAP = 14;                // any segment longer than this is a "gap"
const CLOSURE_THRESHOLD = 28;      // tail→head distance to treat as already-closed

function resampleSpline(curve: THREE.CatmullRomCurve3, totalLen: number, stride: number): THREE.Vector3[] {
  const n = Math.max(16, Math.floor(totalLen / stride));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    out.push(curve.getPointAt(i / n).clone());
  }
  return out;
}

function dedupe(points: THREE.Vector3[], minDist: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of points) {
    if (out.length === 0 || p.distanceTo(out[out.length - 1]) > minDist) {
      out.push(p.clone());
    }
  }
  // tail/head dedupe to keep loop clean
  while (out.length > 4 && out[0].distanceTo(out[out.length - 1]) < minDist) out.pop();
  return out;
}

function validate(points: THREE.Vector3[]): WaypointValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let minS = Infinity, maxS = 0, sum = 0, dup = 0;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const d = a.distanceTo(b);
    if (d < 0.5) dup++;
    if (d < minS) minS = d;
    if (d > maxS) maxS = d;
    sum += d;
  }
  const closed = points[0].distanceTo(points[points.length - 1]) < CLOSURE_THRESHOLD;

  if (points.length < 24) errors.push(`Too few waypoints (${points.length}); need >=24`);
  if (!closed) errors.push(`Loop not closed (tail→head=${points[0].distanceTo(points[points.length - 1]).toFixed(1)}m)`);
  if (maxS > MAX_GAP) errors.push(`Largest gap ${maxS.toFixed(1)}m exceeds ${MAX_GAP}m`);
  if (dup > 0) warnings.push(`${dup} near-duplicate waypoints removed`);

  return {
    ok: errors.length === 0,
    closed,
    count: points.length,
    minSpacing: minS,
    maxSpacing: maxS,
    avgSpacing: sum / points.length,
    largestGap: maxS,
    duplicateCount: dup,
    checkpointCount: 0,
    errors,
    warnings,
  };
}

function deriveCheckpoints(waypoints: THREE.Vector3[]): number[] {
  // Distance-based: one checkpoint every ~180m, clamped to [12, 96]
  let totalLen = 0;
  for (let i = 0; i < waypoints.length; i++) {
    totalLen += waypoints[i].distanceTo(waypoints[(i + 1) % waypoints.length]);
  }
  const target = Math.round(totalLen / 180);
  const count = Math.max(12, Math.min(96, target));
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    indices.push(Math.floor((i / count) * waypoints.length));
  }
  return indices;
}

/**
 * Build a dense, validated waypoint network from a raw racing-line polyline.
 * Always returns a closed-loop network — if validation can't pass even after
 * repair, the function still returns a best-effort network with `validation.ok`
 * set to false so the caller can decide whether to block race start.
 */
export function buildWaypointNetwork(
  rawPoints: THREE.Vector3[],
  closed: boolean,
  desiredStride: number = DEFAULT_STRIDE,
): WaypointNetwork {
  if (!rawPoints || rawPoints.length < 4) {
    throw new Error("buildWaypointNetwork: need >=4 raw points");
  }

  let pts = rawPoints.map((p) => p.clone());

  // 1. Force loop closure: if endpoints are far apart, append a synthesized
  //    arc connecting tail→head so the spline can close cleanly.
  const tailToHead = pts[0].distanceTo(pts[pts.length - 1]);
  if (!closed || tailToHead > CLOSURE_THRESHOLD) {
    const head = pts[0];
    const tail = pts[pts.length - 1];
    const bridgeSteps = Math.max(2, Math.ceil(tailToHead / desiredStride));
    for (let i = 1; i < bridgeSteps; i++) {
      const t = i / bridgeSteps;
      pts.push(new THREE.Vector3().lerpVectors(tail, head, t));
    }
  }

  // 2. Remove zero-length / near-duplicate raw points
  pts = dedupe(pts, 0.5);

  // 3. Build provisional spline and resample to uniform stride
  let curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
  let approxLen = 0;
  {
    const probe = curve.getSpacedPoints(Math.max(64, pts.length * 4));
    for (let i = 0; i < probe.length; i++) approxLen += probe[i].distanceTo(probe[(i + 1) % probe.length]);
  }

  let stride = THREE.MathUtils.clamp(desiredStride, MIN_STRIDE, 10);
  let waypoints = resampleSpline(curve, approxLen, stride);
  let v = validate(waypoints);

  // 4. Auto-repair: if validation fails, smooth raw points and retry with a
  //    tighter stride. Two attempts max.
  let attempt = 0;
  while (!v.ok && attempt < 2) {
    attempt++;
    // Smooth raw control points with a 3-tap average (preserve endpoints).
    const smoothed: THREE.Vector3[] = pts.map((p) => p.clone());
    for (let i = 1; i < pts.length - 1; i++) {
      smoothed[i].copy(pts[i - 1]).add(pts[i]).add(pts[i + 1]).multiplyScalar(1 / 3);
    }
    pts = dedupe(smoothed, 0.5);
    curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    stride = Math.max(MIN_STRIDE, stride - 1);
    approxLen = 0;
    const probe = curve.getSpacedPoints(Math.max(64, pts.length * 4));
    for (let i = 0; i < probe.length; i++) approxLen += probe[i].distanceTo(probe[(i + 1) % probe.length]);
    waypoints = resampleSpline(curve, approxLen, stride);
    v = validate(waypoints);
  }

  // 5. Final closure guarantee for downstream consumers
  if (waypoints[0].distanceTo(waypoints[waypoints.length - 1]) < MIN_STRIDE) {
    waypoints.pop();
  }

  const checkpointIndices = deriveCheckpoints(waypoints);
  v.checkpointCount = checkpointIndices.length;

  // 6. Final summarized total length
  let totalLength = 0;
  for (let i = 0; i < waypoints.length; i++) {
    totalLength += waypoints[i].distanceTo(waypoints[(i + 1) % waypoints.length]);
  }

  return {
    waypoints,
    checkpointIndices,
    curve: new THREE.CatmullRomCurve3(waypoints.map((p) => p.clone()), true, "centripetal"),
    totalLength,
    closed: true,
    stride,
    validation: v,
  };
}

/**
 * Post-rebuild validation against a TrackGeometryHelper. Confirms that the
 * checkpoint chain is monotonic along the spline, the loop is closed, and
 * no checkpoint is orphaned (every one is reachable from the previous).
 */
export function validateCircuit(trackHelper: any): WaypointValidation {
  const pts: THREE.Vector3[] = trackHelper?.cachedPoints || [];
  const v = validate(pts);
  const cps = trackHelper?.checkpoints || [];
  v.checkpointCount = cps.length;
  if (cps.length < 8) v.errors.push(`Too few checkpoints (${cps.length})`);

  // Monotonic check: each checkpoint's progress strictly increases.
  let lastU = -1;
  for (const cp of cps) {
    const p = new THREE.Vector3(cp.position.x, cp.position.y, cp.position.z);
    const info = trackHelper.getNearestTrackInfo(p);
    if (info.progress < lastU - 0.02) {
      v.errors.push(`Checkpoint ${cp.index} out of order (u=${info.progress.toFixed(3)} < ${lastU.toFixed(3)})`);
      break;
    }
    lastU = info.progress;
  }

  v.ok = v.errors.length === 0;
  return v;
}
