import * as THREE from "three";
import { TrackGeometryHelper, getTerrainHeight } from "../utils/track";

/**
 * Modern highway bridge — replaces the old suspension bridge with hanging cables.
 *
 * Style:
 *   - Concrete deck supported by simple square concrete pillars (no giant towers).
 *   - Metal guard rails on both sides.
 *   - Street lights every ~40 m along the deck.
 *   - Reflective lane-edge markings.
 *   - Smooth approach: deck sits just above terrain (matches `getTerrainHeight` bridge carve).
 */
export function buildBridge(scene: THREE.Scene, trackHelper: TrackGeometryHelper): void {
  // Shared materials
  const concreteMat = new THREE.MeshStandardMaterial({
    color: "#9a9c9e",
    roughness: 0.85,
    metalness: 0.05,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: "#c9ccd1",
    roughness: 0.35,
    metalness: 0.9,
  });
  const lampPoleMat = new THREE.MeshStandardMaterial({
    color: "#2f3236",
    roughness: 0.55,
    metalness: 0.7,
  });
  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: "#fff7d6",
    emissive: "#ffe28a",
    emissiveIntensity: 1.4,
    roughness: 0.4,
    metalness: 0.2,
  });
  const laneMat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    emissive: "#ffffff",
    emissiveIntensity: 0.35,
    roughness: 0.6,
    metalness: 0.0,
  });

  const basePillarGeo = new THREE.BoxGeometry(2.2, 1.0, 2.2);
  const lampPoleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.2, 8);
  const lampHeadGeo = new THREE.BoxGeometry(1.4, 0.25, 0.6);

  const SAMPLES = 240;
  const lampSpacingMeters = 40;
  let metersSinceLamp = lampSpacingMeters;
  let prevPt: THREE.Vector3 | null = null;

  trackHelper.curve.getSpacedPoints(SAMPLES).forEach((pt, idx) => {
    const u = idx / SAMPLES;
    if (trackHelper.getRoadTypeAt(u) !== "bridge") {
      prevPt = pt;
      return;
    }

    const tangent = trackHelper.curve.getTangentAt(u).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const roadWidth = trackHelper.getRoadWidthAt(u);
    const halfW = roadWidth / 2;

    // --- 1. Concrete support pillars (every ~3 samples ≈ short spacing for solid look) ---
    if (idx % 3 === 0) {
      const terrainY = getTerrainHeight(pt.x, pt.z, trackHelper);
      const pillarHeight = Math.max(0.6, pt.y - terrainY);
      for (const side of [-1, 1]) {
        const sx = pt.x + normal.x * side * (halfW - 0.6);
        const sz = pt.z + normal.z * side * (halfW - 0.6);
        const support = new THREE.Mesh(basePillarGeo, concreteMat);
        support.scale.set(1.0, pillarHeight, 1.0);
        support.position.set(sx, pt.y - pillarHeight / 2 - 0.2, sz);
        support.castShadow = true;
        support.receiveShadow = true;
        scene.add(support);
      }
    }

    // --- 2. Metal guard rails on both edges (short box segment per sample) ---
    if (prevPt) {
      const segLen = pt.distanceTo(prevPt);
      const midX = (pt.x + prevPt.x) / 2;
      const midZ = (pt.z + prevPt.z) / 2;
      const midY = (pt.y + prevPt.y) / 2;
      const angle = Math.atan2(tangent.x, tangent.z);

      for (const side of [-1, 1]) {
        const offX = normal.x * side * (halfW + 0.4);
        const offZ = normal.z * side * (halfW + 0.4);
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 1.1, Math.max(0.5, segLen + 0.1)),
          railMat,
        );
        rail.position.set(midX + offX, midY + 0.9, midZ + offZ);
        rail.rotation.y = angle;
        rail.castShadow = false;
        rail.receiveShadow = true;
        scene.add(rail);

        // Reflective lane-edge marking, slightly inboard of the rail.
        const lane = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.04, Math.max(0.5, segLen + 0.1)),
          laneMat,
        );
        const laneOffX = normal.x * side * (halfW - 0.4);
        const laneOffZ = normal.z * side * (halfW - 0.4);
        lane.position.set(midX + laneOffX, midY + 0.02, midZ + laneOffZ);
        lane.rotation.y = angle;
        scene.add(lane);
      }

      metersSinceLamp += segLen;
    }

    // --- 3. Street lights every ~40 m, alternating sides ---
    if (metersSinceLamp >= lampSpacingMeters) {
      metersSinceLamp = 0;
      const side = idx % 2 === 0 ? 1 : -1;
      const lx = pt.x + normal.x * side * (halfW + 0.5);
      const lz = pt.z + normal.z * side * (halfW + 0.5);

      const pole = new THREE.Mesh(lampPoleGeo, lampPoleMat);
      pole.position.set(lx, pt.y + 2.6, lz);
      pole.castShadow = true;
      scene.add(pole);

      const head = new THREE.Mesh(lampHeadGeo, lampHeadMat);
      // arm head reaches slightly toward the road centerline
      head.position.set(lx - normal.x * side * 0.9, pt.y + 5.1, lz - normal.z * side * 0.9);
      head.rotation.y = Math.atan2(tangent.x, tangent.z);
      scene.add(head);
    }

    prevPt = pt;
  });
}
