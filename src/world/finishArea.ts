import * as THREE from "three";
import { TrackGeometryHelper } from "../utils/track";

export interface FinishAreaController {
  update: (elapsedSec: number, playerRank: number, isFinished: boolean) => void;
}

export function buildFinishArea(scene: THREE.Scene, trackHelper: TrackGeometryHelper): FinishAreaController {
  // --- 1. SPECTATOR STADIUM GRANDSTANDS ---
  const grandstandsGroup = new THREE.Group();
  const structuralSteelMat = new THREE.MeshStandardMaterial({ color: "#444c56", metalness: 0.8, roughness: 0.2 });
  const brandBlueBenchMat = new THREE.MeshStandardMaterial({ color: "#005cff", roughness: 0.45 });

  const fanColors = ["#e53935", "#1e88e5", "#43a047", "#ffb300", "#8e24aa", "#e91e63", "#ffffff", "#00e5ff"];
  const skinColors = ["#ffd1a4", "#f1c27d", "#c68642", "#8d5524", "#ffdbac"];

  trackHelper.grandstands.forEach((gs, standIdx) => {
    const benchSet = new THREE.Group();
    benchSet.position.copy(gs.position);
    benchSet.rotation.y = gs.rotation;

    // Tiered rows
    for (let tier = 0; tier < 4; tier++) {
      const stepW = gs.scale.x;
      const stepH = 1.0;
      const stepD = 2.2;

      // Steel foundation for current tier
      const baseMock = new THREE.Mesh(new THREE.BoxGeometry(stepW, stepH, stepD), structuralSteelMat);
      baseMock.position.set(0, tier * stepH + stepH / 2, tier * stepD);
      baseMock.castShadow = true;
      baseMock.receiveShadow = true;
      benchSet.add(baseMock);

      // Bench seat
      const seatMock = new THREE.Mesh(new THREE.BoxGeometry(stepW - 1.5, 0.18, 0.7), brandBlueBenchMat);
      seatMock.position.set(0, tier * stepH + stepH + 0.1, tier * stepD);
      seatMock.castShadow = true;
      benchSet.add(seatMock);

      // --- ADD SPECTATORS (Cheering colorful miniature high-fidelity capsule characters) ---
      const numFans = 9;
      for (let f = 0; f < numFans; f++) {
        // Place fans spaced along the bench width
        const fanX = -stepW / 2 + 1.8 + (f * (stepW - 3.6)) / (numFans - 1) + Math.sin(standIdx + tier + f) * 0.3;

        const fanGroup = new THREE.Group();
        fanGroup.position.set(fanX, tier * stepH + stepH + 0.45, tier * stepD);

        // Lower torso (colored clothing)
        const torso = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.26, 0.45, 5),
          new THREE.MeshStandardMaterial({
            color: fanColors[(standIdx * 72 + tier * 9 + f) % fanColors.length],
            roughness: 0.65,
          }),
        );
        torso.castShadow = true;
        fanGroup.add(torso);

        // Cheerful round head
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 6, 6),
          new THREE.MeshStandardMaterial({
            color: skinColors[(standIdx * 19 + f) % skinColors.length],
            roughness: 0.88,
          }),
        );
        head.position.y = 0.35;
        head.castShadow = true;
        fanGroup.add(head);

        // Cheering hat (on some spectators!)
        if ((f + standIdx) % 3 === 0) {
          const hat = new THREE.Mesh(
            new THREE.ConeGeometry(0.18, 0.18, 5),
            new THREE.MeshStandardMaterial({ color: "#ffea00" }),
          );
          hat.position.y = 0.48;
          fanGroup.add(hat);
        }

        benchSet.add(fanGroup);
      }
    }

    grandstandsGroup.add(benchSet);
  });
  scene.add(grandstandsGroup);

  // --- 2. ALPINE SNOW ICE PEAK CONES ---
  const snowPeaksGroup = new THREE.Group();
  const icyPeakMat = new THREE.MeshStandardMaterial({ color: "#f0f6ff", roughness: 0.95, flatShading: true });

  trackHelper.snowPeaks.forEach((sp) => {
    const iceCone = new THREE.Mesh(new THREE.ConeGeometry(sp.radius, sp.height, 5), icyPeakMat);
    iceCone.position.copy(sp.position);
    iceCone.position.y += sp.height / 2;
    iceCone.castShadow = true;
    iceCone.receiveShadow = true;
    snowPeaksGroup.add(iceCone);
  });
  scene.add(snowPeaksGroup);

  // --- 3. PREMIUM HIGH-TECH FINISH GATE ARCHWAY ---
  const finishArchway = new THREE.Group();
  finishArchway.position.copy(trackHelper.finishGatePos);

  // Align finish line orientation
  const finU = 0.95;
  const finTangent = trackHelper.curve.getTangentAt(finU).normalize();
  finishArchway.rotation.y = -Math.atan2(finTangent.z, finTangent.x) + Math.PI / 2;

  // High fidelity framework pillars
  const pilL = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 16, 2.4),
    new THREE.MeshStandardMaterial({ color: "#1a1d22", metalness: 0.95, roughness: 0.1 }),
  );
  pilL.position.set(-15, 8, 0);
  pilL.castShadow = true;
  finishArchway.add(pilL);

  const pilR = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 16, 2.4),
    new THREE.MeshStandardMaterial({ color: "#1a1d22", metalness: 0.95, roughness: 0.1 }),
  );
  pilR.position.set(15, 8, 0);
  pilR.castShadow = true;
  finishArchway.add(pilR);

  // Dynamic horizontal truss structure
  const topTruss = new THREE.Mesh(
    new THREE.BoxGeometry(32.4, 2.8, 2.4),
    new THREE.MeshStandardMaterial({ color: "#d32f2f", metalness: 0.5, roughness: 0.3 }),
  );
  topTruss.position.set(0, 15, 0);
  topTruss.castShadow = true;
  finishArchway.add(topTruss);

  // Digital timer board display mapping
  const ledCanvas = document.createElement("canvas");
  ledCanvas.width = 256;
  ledCanvas.height = 64;
  const ledCtx = ledCanvas.getContext("2d");
  if (ledCtx) {
    ledCtx.fillStyle = "#0a0a0a";
    ledCtx.fillRect(0, 0, 256, 64);
    ledCtx.strokeStyle = "#ffe500";
    ledCtx.lineWidth = 2;
    ledCtx.strokeRect(2, 2, 252, 60);

    ledCtx.fillStyle = "#ff1122";
    ledCtx.font = "bold 32px Courier New";
    ledCtx.textAlign = "center";
    ledCtx.fillText("★ FINISH ★", 128, 44);
  }
  const displayPanel = new THREE.Mesh(
    new THREE.BoxGeometry(16.5, 2.0, 0.4),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(ledCanvas), emissive: new THREE.Color("#330505") }),
  );
  displayPanel.position.set(0, 15, 1.3);
  finishArchway.add(displayPanel);
  scene.add(finishArchway);

  // --- 4. HIGH-PERFORMANCE 3D FIREWORKS PARTICLE SYSTEM ---
  const fireworksGroup = new THREE.Group();
  scene.add(fireworksGroup);

  const maxSparksPerExplosion = 40;
  interface ActiveFirework {
    sparks: THREE.Mesh[];
    velocities: THREE.Vector3[];
    life: number;
    maxLife: number;
    color: string;
  }
  let activeFireworks: ActiveFirework[] = [];

  const sparkGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  const fwColors = ["#ff0055", "#33ff00", "#00e5ff", "#ffea00", "#ff00ff", "#ffffff"];

  // Launches an aerial firework blast with customized colors above the finish archway
  const triggerExplosion = (xOffset = 0, yOffset = 0, zOffset = 0) => {
    const explosionCenter = trackHelper.finishGatePos.clone().add(new THREE.Vector3(xOffset, 20 + yOffset, zOffset));
    const chosenColor = fwColors[Math.floor(Math.random() * fwColors.length)];
    const sparkMat = new THREE.MeshBasicMaterial({ color: chosenColor, transparent: true, opacity: 1.0 });

    const sparks: THREE.Mesh[] = [];
    const velocities: THREE.Vector3[] = [];

    for (let s = 0; s < maxSparksPerExplosion; s++) {
      const spark = new THREE.Mesh(sparkGeo, sparkMat);
      spark.position.copy(explosionCenter);
      fireworksGroup.add(spark);
      sparks.push(spark);

      // Distribute vectors uniformly across a 3D spherical shell
      const phi = Math.acos(Math.random() * 2 - 1);
      const theta = Math.random() * Math.PI * 2;
      const speed = 8.5 + Math.random() * 12.0;

      const vx = Math.sin(phi) * Math.cos(theta) * speed;
      const vy = Math.sin(phi) * Math.sin(theta) * speed + 2.5; // slight thermal draft rising
      const vz = Math.cos(phi) * speed;

      velocities.push(new THREE.Vector3(vx, vy, vz));
    }

    activeFireworks.push({
      sparks,
      velocities,
      life: 0.0,
      maxLife: 1.4 + Math.random() * 0.8,
      color: chosenColor,
    });
  };

  let victoryLaunchTimer = 0.0;
  let ambientLaunchTimer = 0.0;

  // --- RETURN CONTROLLER ---
  return {
    update: (elapsedSec: number, playerRank: number, isFinished: boolean) => {
      // 1. Ambient Firework launcher (slow starry sparks while the match is underway)
      ambientLaunchTimer += elapsedSec;
      if (ambientLaunchTimer >= 7.5 && !isFinished) {
        ambientLaunchTimer = 0;
        const sideOffset = (Math.random() > 0.5 ? 1 : -1) * (20 + Math.random() * 32);
        triggerExplosion(sideOffset, 5 + Math.random() * 12, Math.random() * 20 - 10);
      }

      // 2. Victory Firework Cascade (rapid-fire bursts when player enters finished state!)
      if (isFinished) {
        victoryLaunchTimer += elapsedSec;
        const triggerRate = playerRank === 1 ? 0.35 : 0.82; // Faster spectacular bursts for gold rank!
        if (victoryLaunchTimer >= triggerRate) {
          victoryLaunchTimer = 0.0;
          const randomX = Math.random() * 60 - 30;
          const randomY = Math.random() * 16;
          const randomZ = Math.random() * 40 - 20;
          triggerExplosion(randomX, randomY, randomZ);
        }
      }

      // 3. Drive physical mechanics of flying sparks expanding and cascading down
      activeFireworks.forEach((fw, fwIdx) => {
        fw.life += elapsedSec;
        const progress = fw.life / fw.maxLife;

        if (progress >= 1.0) {
          // Dispose resources and clear mesh models from group
          fw.sparks.forEach((s) => fireworksGroup.remove(s));
          activeFireworks.splice(fwIdx, 1);
        } else {
          fw.sparks.forEach((spark, idx) => {
            const vel = fw.velocities[idx];
            // Apply air resistance friction drag and gravitational gravity pull downward
            vel.x *= 0.94;
            vel.z *= 0.94;
            vel.y -= 9.8 * elapsedSec; // downward weight trail

            spark.position.addScaledVector(vel, elapsedSec);

            // Shimmer sparkling scales & fade opacity smoothly
            const sparkleScale = 1.0 - progress * 0.85;
            spark.scale.set(sparkleScale, sparkleScale, sparkleScale);
            (spark.material as THREE.MeshBasicMaterial).opacity = 1.0 - progress;
          });
        }
      });
    },
  };
}
