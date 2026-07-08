import * as THREE from "three";
import { TrackGeometryHelper } from "../utils/track";

export function buildTunnel(scene: THREE.Scene, trackHelper: TrackGeometryHelper): void {
  // --- 1. PROCEDURAL TUNNEL ARCHES & MOUTHS ---
  const tunnelGroup = new THREE.Group();
  trackHelper.curve.getSpacedPoints(180).forEach((pt, idx) => {
    const u = idx / 180;
    const type = trackHelper.getRoadTypeAt(u);

    if (type === "tunnel") {
      const tangent = trackHelper.curve.getTangentAt(u).normalize();
      const width = trackHelper.getRoadWidthAt(u);

      // Heavy reinforced realistic stone tunnel archway
      const tunnelArchGeo = new THREE.CylinderGeometry(width / 2 + 0.8, width / 2 + 1.2, 4.2, 16, 1, true, 0, Math.PI);
      const tunnelArchMat = new THREE.MeshStandardMaterial({
        color: "#2a2c2f", // concrete tunnel
        roughness: 0.9,
        metalness: 0.1,
        side: THREE.DoubleSide,
        flatShading: true,
      });
      const arch = new THREE.Mesh(tunnelArchGeo, tunnelArchMat);
      arch.position.copy(pt);
      arch.rotation.z = Math.PI / 2; // arch ceiling
      arch.rotation.y = -Math.atan2(tangent.z, tangent.x);
      tunnelGroup.add(arch);

      // Add safety warning yellow stripes at both outer entrance mouths!
      const isMouth =
        idx > 0 &&
        (trackHelper.getRoadTypeAt((idx - 1) / 180) !== "tunnel" ||
          trackHelper.getRoadTypeAt((idx + 1) / 180) !== "tunnel");
      if (isMouth) {
        const mouthCapGeo = new THREE.CylinderGeometry(width / 2 + 1.2, width / 2 + 1.4, 0.4, 16, 1, true, 0, Math.PI);
        mouthCapGeo.rotateZ(Math.PI / 2);
        mouthCapGeo.rotateY(-Math.atan2(tangent.z, tangent.x));
        const stripeCanvas = document.createElement("canvas");
        stripeCanvas.width = 128;
        stripeCanvas.height = 32;
        const sCtx = stripeCanvas.getContext("2d");
        if (sCtx) {
          sCtx.fillStyle = "#ffcc00";
          sCtx.fillRect(0, 0, 128, 32);
          sCtx.fillStyle = "#111111";
          for (let s = 0; s < 8; s++) {
            sCtx.beginPath();
            sCtx.moveTo(s * 16, 0);
            sCtx.lineTo(s * 16 + 8, 0);
            sCtx.lineTo(s * 16 + 16, 32);
            sCtx.lineTo(s * 16 + 8, 32);
            sCtx.fill();
          }
        }
        const capMesh = new THREE.Mesh(
          mouthCapGeo,
          new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(stripeCanvas), roughness: 0.5 }),
        );
        capMesh.position.copy(pt).addScaledVector(tangent, idx === 0 ? 0.3 : -0.3);
        tunnelGroup.add(capMesh);
      }
    }
  });
  scene.add(tunnelGroup);

  // --- 2. REALISTIC ALPINE SODIUM-VAPOR CEILING LIGHTS & SUPPORTING RIBS ---
  const tunnelRibsGroup = new THREE.Group();
  const tunnelLampsGroup = new THREE.Group();

  const ribMat = new THREE.MeshStandardMaterial({
    color: "#1a1c1d", // heavy cast iron dark concrete
    roughness: 0.95,
    metalness: 0.15,
  });

  const sodiumGlowMat = new THREE.MeshBasicMaterial({
    color: "#ff9900", // warm sodium orange/yellow glow
  });
  const backPlateMat = new THREE.MeshStandardMaterial({
    color: "#0e1112",
    roughness: 0.9,
  });

  trackHelper.curve.getSpacedPoints(180).forEach((pt, idx) => {
    const u = idx / 180;
    if (trackHelper.getRoadTypeAt(u) === "tunnel") {
      const tangent = trackHelper.curve.getTangentAt(u).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const width = trackHelper.getRoadWidthAt(u);

      const theta = -Math.atan2(tangent.z, tangent.x);

      // Periodic Structural Support Ribs (placed instead of colored neon arches)
      if (idx % 3 === 0) {
        const ringGeo = new THREE.CylinderGeometry(width / 2 + 0.61, width / 2 + 0.72, 0.6, 12, 1, true, 0, Math.PI);
        const ring = new THREE.Mesh(ringGeo, ribMat);
        ring.position.copy(pt);
        ring.rotation.z = Math.PI / 2;
        ring.rotation.y = theta;
        tunnelRibsGroup.add(ring);

        // Warm Sodium Lamp Fixture suspended from the vault center
        const lampSet = new THREE.Group();
        lampSet.position.copy(pt);
        lampSet.position.y += width / 2 - 0.1;
        lampSet.rotation.y = theta;

        const lampBody = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.5), backPlateMat);
        const lampBulb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.35), sodiumGlowMat);
        lampBulb.position.y = -0.11;
        lampSet.add(lampBody, lampBulb);

        tunnelLampsGroup.add(lampSet);
      }

      // Add standard European road safety chevron signs (non-neon reflective yellow/black plates)
      if (idx % 5 === 0) {
        const wallPlacementOffset = width / 2 + 0.38;

        [-1, 1].forEach((side) => {
          const arrowGroup = new THREE.Group();
          arrowGroup.position.copy(pt).addScaledVector(normal, side * wallPlacementOffset);
          arrowGroup.position.y += 1.6;
          arrowGroup.rotation.y = theta + (side === 1 ? -Math.PI / 2 : Math.PI / 2);

          // Standard European yellow/black hazard stripe canvas
          const chevronCanvas = document.createElement("canvas");
          chevronCanvas.width = 128;
          chevronCanvas.height = 64;
          const cCtx = chevronCanvas.getContext("2d");
          if (cCtx) {
            cCtx.fillStyle = "#ffcc00"; // Traffic yellow
            cCtx.fillRect(0, 0, 128, 64);
            cCtx.fillStyle = "#111111"; // Black chevrons pointer
            for (let c = 0; c < 4; c++) {
              cCtx.beginPath();
              const sx = 14 + c * 28;
              cCtx.moveTo(sx, 12);
              cCtx.lineTo(sx + 14, 32);
              cCtx.lineTo(sx, 52);
              cCtx.lineTo(sx + 6, 52);
              cCtx.lineTo(sx + 20, 32);
              cCtx.lineTo(sx + 6, 12);
              cCtx.fill();
            }
          }

          const signBoard = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 0.65, 0.1),
            new THREE.MeshStandardMaterial({
              map: new THREE.CanvasTexture(chevronCanvas),
              roughness: 0.45,
            }),
          );
          arrowGroup.add(signBoard);
          tunnelLampsGroup.add(arrowGroup);
        });
      }
    }
  });

  scene.add(tunnelRibsGroup);
  scene.add(tunnelLampsGroup);
}
