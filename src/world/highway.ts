import * as THREE from "three";
import { TrackGeometryHelper, getTerrainHeight } from "../utils/track";

export function buildHighway(scene: THREE.Scene, trackHelper: TrackGeometryHelper): void {
  // LANDMARK 5: HIGHWAY COMMERCIAL BILLBOARDS
  const billboardGroup = new THREE.Group();

  trackHelper.billboards.forEach((bb) => {
    const bSet = new THREE.Group();

    // Anchor billboard directly at the terrain level to prevent any floating gaps on hills!
    const terrainY = getTerrainHeight(bb.position.x, bb.position.z, trackHelper);
    bSet.position.set(bb.position.x, terrainY, bb.position.z);
    bSet.rotation.y = bb.rotation;

    // Heavy industrially-welded metallic supporting stanchion (sinks deep into hillbed)
    const poleHeight = 24.0;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, poleHeight, 8),
      new THREE.MeshStandardMaterial({ color: "#252930", metalness: 0.95, roughness: 0.12 }),
    );
    // Let the pole sink 2m into bedrock to guarantee complete grounding
    pole.position.y = poleHeight / 2 - 2.0;
    pole.castShadow = false;
    bSet.add(pole);

    // Create a high visual quality billboard canvas texture with realistic European branding
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Classic deep Alpine forest spruce-green or sleek navy background
      const isAlt = bb.text.includes("SPEED");
      ctx.fillStyle = isAlt ? "#0f2027" : "#1e3a1e";
      ctx.fillRect(0, 0, 512, 256);

      // Fine classic architectural border lines
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 6;
      ctx.strokeRect(12, 12, 488, 232);
      ctx.strokeStyle = isAlt ? "#ecc94b" : "#a7f3d0";
      ctx.lineWidth = 2;
      ctx.strokeRect(20, 20, 472, 216);

      // Simple yellow warning / service bar at the bottom
      ctx.fillStyle = isAlt ? "#ecc94b" : "#34d399";
      ctx.fillRect(32, 200, 448, 12);

      // Center glowing title
      ctx.fillStyle = "#ffffff";
      ctx.font = 'bold 32px "Space Grotesk", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(isAlt ? "⛰️ AUTOBAHN SERVICE ⛰️" : "⛰️ SWISS ALPINE RALLY ⛰️", 256, 88);

      // Subtitle with bb message
      ctx.fillStyle = isAlt ? "#fef08a" : "#cbd5e1";
      ctx.font = 'bold 26px "JetBrains Mono", monospace';
      ctx.fillText(bb.text, 256, 142);
    }

    // Massive AAA scale billboard: BoxGeometry(22, 11, 0.6) - UPDATED!
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(22, 11, 0.6),
      new THREE.MeshStandardMaterial({
        map: new THREE.CanvasTexture(canvas),
        roughness: 0.28,
        metalness: 0.2,
      }),
    );
    // Position billboard crowning the pole high above the tarmac
    board.position.y = poleHeight - 5.0;
    board.castShadow = false;
    bSet.add(board);

    billboardGroup.add(bSet);
  });

  scene.add(billboardGroup);
}
