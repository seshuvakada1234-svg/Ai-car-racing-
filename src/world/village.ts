import * as THREE from "three";
import { TrackGeometryHelper } from "../utils/track";
import { terrainManager } from "./TerrainManager";
import { lodManager } from "./lodManager";

export function buildVillage(scene: THREE.Scene, trackHelper: TrackGeometryHelper): void {
  const villageGroup = new THREE.Group();
  villageGroup.name = "scenery_village";

  const wallPlasterMat = new THREE.MeshStandardMaterial({ color: "#fcfaf2", roughness: 0.85 });
  const slateRoofMat = new THREE.MeshStandardMaterial({ color: "#1a1f2c", roughness: 0.55, flatShading: true });
  const foundationMat = new THREE.MeshStandardMaterial({ color: "#55585d", roughness: 0.95, flatShading: true });
  const woodTrimMat = new THREE.MeshStandardMaterial({ color: "#4a2f13", roughness: 0.8 });
  const bridgeWoodMat = new THREE.MeshStandardMaterial({ color: "#8e1f18", roughness: 0.72 });

  // --- 1. INSTANCED VILLAGE HOUSES ---
  const houseCount = trackHelper.villageHouses.length;
  if (houseCount > 0) {
    const dummy = new THREE.Object3D();

    const foundationGeo = new THREE.BoxGeometry(1, 1, 1);
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    const roofGeo = new THREE.ConeGeometry(0.577, 1, 4); // unit-scaled cone
    roofGeo.rotateY(Math.PI / 4);

    const doorGeo = new THREE.BoxGeometry(0.1, 1.8, 1.0);

    const foundationInst = new THREE.InstancedMesh(foundationGeo, foundationMat, houseCount);
    const wallInst = new THREE.InstancedMesh(wallGeo, wallPlasterMat, houseCount);
    const roofInst = new THREE.InstancedMesh(roofGeo, slateRoofMat, houseCount);
    const doorInst = new THREE.InstancedMesh(doorGeo, woodTrimMat, houseCount);

    foundationInst.castShadow = false;
    foundationInst.receiveShadow = true;
    wallInst.castShadow = false;
    wallInst.receiveShadow = true;
    roofInst.castShadow = false;

    trackHelper.villageHouses.forEach((vh, idx) => {
      const baseWidth = 4.8 * vh.scale;
      const baseHeight = 3.2 * vh.scale;
      const baseDepth = 4.8 * vh.scale;

      // 1. Foundation Matrix
      dummy.position.set(vh.position.x, vh.position.y - 3.0, vh.position.z);
      dummy.rotation.set(0, vh.rotation, 0);
      dummy.scale.set(baseWidth + 0.2, 6.0, baseDepth + 0.2);
      dummy.updateMatrix();
      foundationInst.setMatrixAt(idx, dummy.matrix);

      // 2. Wall Matrix
      dummy.position.set(vh.position.x, vh.position.y + baseHeight / 2, vh.position.z);
      dummy.scale.set(baseWidth, baseHeight, baseDepth);
      dummy.updateMatrix();
      wallInst.setMatrixAt(idx, dummy.matrix);

      // 3. Roof Matrix
      dummy.position.set(
        vh.position.x,
        vh.position.y + baseHeight + (2.6 * vh.scale) / 2 - 0.15 * vh.scale,
        vh.position.z,
      );
      dummy.scale.set(baseWidth * 1.4, 2.6 * vh.scale, baseDepth * 1.4);
      dummy.updateMatrix();
      roofInst.setMatrixAt(idx, dummy.matrix);

      // 4. Door Matrix
      dummy.position.set(vh.position.x, vh.position.y, vh.position.z);
      dummy.rotation.set(0, vh.rotation, 0);
      dummy.updateMatrix();
      // Apply offset relative to house coordinate
      const relativeOffset = new THREE.Vector3(baseWidth / 2, 0.9 * vh.scale, 0).applyEuler(
        new THREE.Euler(0, vh.rotation, 0),
      );
      dummy.position.add(relativeOffset);
      dummy.scale.set(1, vh.scale, vh.scale);
      dummy.updateMatrix();
      doorInst.setMatrixAt(idx, dummy.matrix);
    });

    foundationInst.instanceMatrix.needsUpdate = true;
    wallInst.instanceMatrix.needsUpdate = true;
    roofInst.instanceMatrix.needsUpdate = true;
    doorInst.instanceMatrix.needsUpdate = true;

    villageGroup.add(foundationInst, wallInst, roofInst, doorInst);
  }

  // --- 2. INSTANCED DECORATIVE Small Footbridges ---
  const bridgePositions = [
    { x: 1240, z: 1950, rotation: 0.4 },
    { x: 1320, z: 2200, rotation: -0.3 },
    { x: 1360, z: 2360, rotation: 1.1 },
  ];

  const bridgeDummy = new THREE.Object3D();
  const deckGeo = new THREE.BoxGeometry(3.5, 0.24, 7.5);
  const railGeo = new THREE.BoxGeometry(0.18, 0.9, 7.5);
  const postGeo = new THREE.BoxGeometry(0.24, 1.2, 0.24);
  const pillarGeo = new THREE.CylinderGeometry(0.28, 0.28, 4.0);

  const deckInst = new THREE.InstancedMesh(deckGeo, woodTrimMat, bridgePositions.length);
  const railInst = new THREE.InstancedMesh(railGeo, bridgeWoodMat, bridgePositions.length * 2);
  const postInst = new THREE.InstancedMesh(postGeo, bridgeWoodMat, bridgePositions.length * 10);
  const pillarInst = new THREE.InstancedMesh(pillarGeo, woodTrimMat, bridgePositions.length * 2);

  deckInst.castShadow = false;
  deckInst.receiveShadow = true;
  railInst.castShadow = false;
  postInst.castShadow = false;
  pillarInst.castShadow = false;

  let railIdx = 0;
  let postIdx = 0;
  let pillarIdx = 0;

  bridgePositions.forEach((pos, idx) => {
    const terrainY = terrainManager.getHeight(pos.x, pos.z);
    const bY = terrainY + 0.25;

    // Deck
    bridgeDummy.position.set(pos.x, bY, pos.z);
    bridgeDummy.rotation.set(0, pos.rotation, 0);
    bridgeDummy.scale.set(1, 1, 1);
    bridgeDummy.updateMatrix();
    deckInst.setMatrixAt(idx, bridgeDummy.matrix);

    // Rails (Left & Right)
    const euler = new THREE.Euler(0, pos.rotation, 0);
    const leftOffset = new THREE.Vector3(-1.65, 0.45, 0).applyEuler(euler);
    const rightOffset = new THREE.Vector3(1.65, 0.45, 0).applyEuler(euler);

    bridgeDummy.position.set(pos.x + leftOffset.x, bY + leftOffset.y, pos.z + leftOffset.z);
    bridgeDummy.updateMatrix();
    railInst.setMatrixAt(railIdx++, bridgeDummy.matrix);

    bridgeDummy.position.set(pos.x + rightOffset.x, bY + rightOffset.y, pos.z + rightOffset.z);
    bridgeDummy.updateMatrix();
    railInst.setMatrixAt(railIdx++, bridgeDummy.matrix);

    // Posts along rails
    for (let offsetZ = -3.5; offsetZ <= 3.5; offsetZ += 1.75) {
      const pL = new THREE.Vector3(-1.65, 0.5, offsetZ).applyEuler(euler);
      bridgeDummy.position.set(pos.x + pL.x, bY + pL.y, pos.z + pL.z);
      bridgeDummy.updateMatrix();
      postInst.setMatrixAt(postIdx++, bridgeDummy.matrix);

      const pR = new THREE.Vector3(1.65, 0.5, offsetZ).applyEuler(euler);
      bridgeDummy.position.set(pos.x + pR.x, bY + pR.y, pos.z + pR.z);
      bridgeDummy.updateMatrix();
      postInst.setMatrixAt(postIdx++, bridgeDummy.matrix);
    }

    // Pillars (Left & Right support)
    const pilL = new THREE.Vector3(-1.4, -2.0, 0).applyEuler(euler);
    bridgeDummy.position.set(pos.x + pilL.x, bY + pilL.y, pos.z + pilL.z);
    bridgeDummy.position.y = bY - 2.0;
    bridgeDummy.scale.set(1, 1, 1);
    bridgeDummy.updateMatrix();
    pillarInst.setMatrixAt(pillarIdx++, bridgeDummy.matrix);

    const pilR = new THREE.Vector3(1.4, -2.0, 0).applyEuler(euler);
    bridgeDummy.position.set(pos.x + pilR.x, bY - 2.0, pos.z + pilR.z);
    bridgeDummy.updateMatrix();
    pillarInst.setMatrixAt(pillarIdx++, bridgeDummy.matrix);
  });

  deckInst.instanceMatrix.needsUpdate = true;
  railInst.instanceMatrix.needsUpdate = true;
  postInst.instanceMatrix.needsUpdate = true;
  pillarInst.instanceMatrix.needsUpdate = true;

  villageGroup.add(deckInst, railInst, postInst, pillarInst);

  // --- 3. INSTANCED STREET LAMPS ---
  const villageLights = trackHelper.lights.filter((l) => l.color === "#ff7700" || l.color === "#ff9900");
  const lightCount = villageLights.length;
  if (lightCount > 0) {
    const lampPoleMat = new THREE.MeshStandardMaterial({ color: "#2c2d30", roughness: 0.35, metalness: 0.85 });
    const lampGlassMat = new THREE.MeshBasicMaterial({ color: "#ff9900" });

    const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 4.2, 6);
    poleGeo.translate(0, 2.1, 0); // self-grounding pivot
    const armGeo = new THREE.BoxGeometry(0.9, 0.12, 0.12);
    const lanternGeo = new THREE.BoxGeometry(0.42, 0.58, 0.42);
    const sphereGeo = new THREE.SphereGeometry(0.18, 6, 6);

    const poleInst = new THREE.InstancedMesh(poleGeo, lampPoleMat, lightCount);
    const armInst = new THREE.InstancedMesh(armGeo, lampPoleMat, lightCount);
    const lanternInst = new THREE.InstancedMesh(lanternGeo, lampPoleMat, lightCount);
    const sphereInst = new THREE.InstancedMesh(sphereGeo, lampGlassMat, lightCount);

    poleInst.castShadow = false;
    armInst.castShadow = false;
    lanternInst.castShadow = false;

    const lampDummy = new THREE.Object3D();

    villageLights.forEach((light, i) => {
      const terrainY = terrainManager.getHeight(light.position.x, light.position.z);

      // Pole
      lampDummy.position.set(light.position.x, terrainY, light.position.z);
      lampDummy.rotation.set(0, 0, 0);
      lampDummy.scale.set(1, 1, 1);
      lampDummy.updateMatrix();
      poleInst.setMatrixAt(i, lampDummy.matrix);

      // Arm
      lampDummy.position.set(light.position.x, terrainY + 4.1, light.position.z);
      lampDummy.updateMatrix();
      armInst.setMatrixAt(i, lampDummy.matrix);

      // Lantern
      lampDummy.position.set(light.position.x + 0.35, terrainY + 3.85, light.position.z);
      lampDummy.updateMatrix();
      lanternInst.setMatrixAt(i, lampDummy.matrix);

      // Sphere lens
      lampDummy.position.set(light.position.x + 0.35, terrainY + 3.75, light.position.z);
      lampDummy.updateMatrix();
      sphereInst.setMatrixAt(i, lampDummy.matrix);

      // Place occasional light sources (limit to keep high performance)
      if (i % 3 === 0) {
        const pointLight = new THREE.PointLight("#ff7700", 3.0, 15, 1.2);
        pointLight.position.set(light.position.x + 0.35, terrainY + 3.75, light.position.z);
        scene.add(pointLight);
      }
    });

    poleInst.instanceMatrix.needsUpdate = true;
    armInst.instanceMatrix.needsUpdate = true;
    lanternInst.instanceMatrix.needsUpdate = true;
    sphereInst.instanceMatrix.needsUpdate = true;

    // Attach submesh names for dynamic LOD occlusion hiding!
    poleInst.name = "lamp_pole";
    armInst.name = "lamp_pole";
    lanternInst.name = "lamp_pole";
    sphereInst.name = "lamp_pole";

    villageGroup.add(poleInst, armInst, lanternInst, sphereInst);
  }

  scene.add(villageGroup);

  // --- 4. MAJESTIC CHURCH SPIRE LANDMARK ---
  if (trackHelper.pagodaPos) {
    const p = trackHelper.pagodaPos;
    const churchGroup = new THREE.Group();
    churchGroup.name = "village_church_landmark";

    const stoneMat = foundationMat;
    const plasterMat = wallPlasterMat;
    const slateMat = slateRoofMat;

    // Stone foundation
    const fGeo = new THREE.BoxGeometry(8, 6, 8);
    const fMesh = new THREE.Mesh(fGeo, stoneMat);
    fMesh.position.set(p.x, p.y + 3, p.z);
    fMesh.castShadow = true;
    fMesh.receiveShadow = true;
    churchGroup.add(fMesh);

    // Main plaster body
    const bGeo = new THREE.BoxGeometry(7, 12, 7);
    const bMesh = new THREE.Mesh(bGeo, plasterMat);
    bMesh.position.set(p.x, p.y + 12, p.z);
    bMesh.castShadow = true;
    bMesh.receiveShadow = true;
    churchGroup.add(bMesh);

    // Steep needle spire roof (Alpine German clocktower style)
    const spireGeo = new THREE.ConeGeometry(4.2, 12, 4);
    spireGeo.rotateY(Math.PI / 4);
    const spireMesh = new THREE.Mesh(spireGeo, slateMat);
    spireMesh.position.set(p.x, p.y + 24, p.z);
    spireMesh.castShadow = true;
    churchGroup.add(spireMesh);

    // Clock faces (All 4 directions)
    const clockGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.4, 8);
    clockGeo.rotateX(Math.PI / 2);
    const clockMat = new THREE.MeshBasicMaterial({ color: "#fcf8f0" });
    const clockMesh = new THREE.Mesh(clockGeo, clockMat);
    clockMesh.position.set(p.x, p.y + 15, p.z + 3.6);
    churchGroup.add(clockMesh);

    scene.add(churchGroup);
  }

  // --- 5. RUSTIC TIMBER WATERMILL LANDMARK (Slow-spin anim wheel) ---
  if ((trackHelper as any).waterfallPos) {
    const wp = (trackHelper as any).waterfallPos;
    const millGroup = new THREE.Group();
    millGroup.name = "scenery_watermill";

    const plasterMat = wallPlasterMat;
    const roofMat = bridgeWoodMat;

    // Mill building
    const mhGeo = new THREE.BoxGeometry(6, 6, 8);
    const mhMesh = new THREE.Mesh(mhGeo, plasterMat);
    mhMesh.position.set(wp.x, wp.y + 3, wp.z);
    mhMesh.castShadow = true;
    mhMesh.receiveShadow = true;
    millGroup.add(mhMesh);

    // Barn roof
    const mrGeo = new THREE.ConeGeometry(4.8, 4, 4);
    mrGeo.rotateY(Math.PI / 4);
    const mrMesh = new THREE.Mesh(mrGeo, roofMat);
    mrMesh.position.set(wp.x, wp.y + 7, wp.z);
    mrMesh.castShadow = true;
    millGroup.add(mrMesh);

    // Spinning Watermill Wheel
    const wheelGroup = new THREE.Group();
    wheelGroup.name = "watermill_wheel";

    const rimGeo = new THREE.TorusGeometry(2.4, 0.2, 6, 24);
    const rimMesh = new THREE.Mesh(rimGeo, woodTrimMat);
    wheelGroup.add(rimMesh);

    // Spokes inside
    const spokes = 8;
    for (let s = 0; s < spokes; s++) {
      const angle = (s / spokes) * Math.PI * 2;
      const bladeGeo = new THREE.BoxGeometry(0.18, 2.4, 0.45);
      const bladeMesh = new THREE.Mesh(bladeGeo, woodTrimMat);
      bladeMesh.position.set(Math.sin(angle) * 1.2, Math.cos(angle) * 1.2, 0);
      bladeMesh.rotation.z = -angle;
      wheelGroup.add(bladeMesh);
    }

    wheelGroup.position.set(wp.x - 3.4, wp.y + 1.2, wp.z);
    wheelGroup.rotation.y = Math.PI / 2;
    wheelGroup.userData = { isRotating: true, rotationSpeed: 0.6 };

    millGroup.add(wheelGroup);
    scene.add(millGroup);
  }

  // Register the village sector in our LOD culler
  lodManager.registerSector("Village", 1250, 10, 2150, villageGroup, 280, 520);
}
