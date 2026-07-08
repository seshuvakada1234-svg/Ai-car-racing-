import * as THREE from "three";
import { TrackGeometryHelper, getTerrainHeight } from "../utils/track";

export function buildTemple(scene: THREE.Scene, trackHelper: TrackGeometryHelper): void {
  // --- 1. MAJESTIC SEEMLESS EUROPEAN HILLSIDE CASTLE RUINS (BURGRUINE OVERLOOK) ---
  const castleGroup = new THREE.Group();
  castleGroup.name = "european_castle_overlook";

  // Offset the castle ruins slightly from the church spire to make space on the hill
  const basePos = trackHelper.pagodaPos.clone().add(new THREE.Vector3(-48, 14, -60));
  castleGroup.position.copy(basePos);

  // Materials config
  const stoneMat = new THREE.MeshStandardMaterial({
    color: "#5a5d64",
    roughness: 0.95,
    flatShading: true, // gives a beautiful faceted masonry brick feel
  });
  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: "#3d2511",
    roughness: 0.85,
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: "#212224",
    metalness: 0.8,
    roughness: 0.45,
  });
  const flagMat = new THREE.MeshStandardMaterial({
    color: "#2c3e50", // deep indigo-blue knight heraldry flag
    roughness: 0.6,
  });

  // Main Keep Square Tower
  const towerHeight = 18;
  const towerGeo = new THREE.BoxGeometry(8, towerHeight, 8);
  const towerMesh = new THREE.Mesh(towerGeo, stoneMat);
  towerMesh.position.set(0, towerHeight / 2, 0);
  towerMesh.castShadow = true;
  towerMesh.receiveShadow = true;
  castleGroup.add(towerMesh);

  // Tower crenulated battlements (guards walkway)
  const battlementCount = 4;
  for (let b = 0; b < battlementCount; b++) {
    const batGeo = new THREE.BoxGeometry(2.2, 1.8, 1.0);
    const bat = new THREE.Mesh(batGeo, stoneMat);
    bat.castShadow = true;

    // Arrange around top circumference
    const angle = (b / battlementCount) * Math.PI * 2 + Math.PI / 4;
    bat.position.set(Math.sin(angle) * 3.7, towerHeight + 0.9, Math.cos(angle) * 3.7);
    bat.rotation.y = angle;
    castleGroup.add(bat);
  }

  // Nested outer lower defensive ramparts (walls)
  const wallGeo = new THREE.BoxGeometry(16, 8, 2.5);
  const wallMesh = new THREE.Mesh(wallGeo, stoneMat);
  wallMesh.position.set(0, 4.0, -5.5);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  castleGroup.add(wallMesh);

  const ruinedWallGeo = new THREE.BoxGeometry(10, 5, 2.5);
  const ruinedWallMesh = new THREE.Mesh(ruinedWallGeo, stoneMat);
  ruinedWallMesh.position.set(7.5, 2.5, 0);
  ruinedWallMesh.rotation.y = Math.PI / 3;
  ruinedWallMesh.castShadow = true;
  ruinedWallMesh.receiveShadow = true;
  castleGroup.add(ruinedWallMesh);

  // Flagpole on the top of the Keep with heraldic banner
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), ironMat);
  flagPole.position.set(0, towerHeight + 4, 0);
  flagPole.castShadow = true;
  castleGroup.add(flagPole);

  const flagGeo = new THREE.BoxGeometry(3.5, 1.8, 0.12);
  const flagMesh = new THREE.Mesh(flagGeo, flagMat);
  flagMesh.position.set(1.75, towerHeight + 7.0, 0);
  flagMesh.castShadow = true;
  castleGroup.add(flagMesh);

  scene.add(castleGroup);

  // --- 2. MEDIEVAL MASONRY PASS/TOLL GATE ARCHWAYS ---
  // Replaces the Torii gates spanning the countryside road at progress positions 0.70 and 0.78
  const stoneArchwaysGroup = new THREE.Group();
  stoneArchwaysGroup.name = "scenery_country_archways";

  const archPlacements = [0.7, 0.78];
  archPlacements.forEach((u, idx) => {
    const pt = trackHelper.curve.getPointAt(u);
    const tangent = trackHelper.curve.getTangentAt(u).normalize();
    const angle = -Math.atan2(tangent.z, tangent.x) + Math.PI / 2;
    const width = trackHelper.getRoadWidthAt(u);

    const archway = new THREE.Group();
    archway.position.copy(pt);
    archway.rotation.y = angle;

    const columnOffset = width / 2 + 1.4;

    // Left Supporting Masonry Column (Thick Octagonal pillar)
    const baseColL = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.1, 7.8, 8), stoneMat);
    baseColL.position.set(-columnOffset, 3.9, 0);
    baseColL.castShadow = true;
    baseColL.receiveShadow = true;
    archway.add(baseColL);

    // Right Supporting Masonry Column
    const baseColR = baseColL.clone();
    baseColR.position.x = columnOffset;
    archway.add(baseColR);

    // Horizontal heavy masonry spanning arc block
    const spanWidth = columnOffset * 2 + 2.0;
    const spanBar = new THREE.Mesh(new THREE.BoxGeometry(spanWidth, 1.8, 1.8), stoneMat);
    spanBar.position.set(0, 8.5, 0);
    spanBar.castShadow = true;
    spanBar.receiveShadow = true;
    archway.add(spanBar);

    // Decorative rustic Alpine wood shingle pitched rooflet atop the archway
    const roofTorus = new THREE.Mesh(new THREE.BoxGeometry(spanWidth + 0.6, 0.65, 2.4), darkWoodMat);
    roofTorus.position.set(0, 9.6, 0);
    roofTorus.castShadow = true;
    archway.add(roofTorus);

    // Suspended rusty metal lantern casting realistic night glow on road
    const lampGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 5, 5),
      new THREE.MeshBasicMaterial({ color: "#ffb94f" }),
    );
    lampGlow.position.set(0, 7.0, 0);
    archway.add(lampGlow);

    // Add street / pass sign to the arches
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.15), darkWoodMat);
    signBoard.position.set(0, 7.8, 1.01);
    signBoard.castShadow = true;
    archway.add(signBoard);

    // Procedural text texture decoration
    const signCanvas = document.createElement("canvas");
    signCanvas.width = 128;
    signCanvas.height = 64;
    const sc = signCanvas.getContext("2d");
    if (sc) {
      sc.fillStyle = "#1e2022";
      sc.fillRect(0, 0, 128, 64);
      sc.font = "bold 16px Courier New";
      sc.fillStyle = "#ecc94b";
      sc.textAlign = "center";
      sc.textBaseline = "middle";
      sc.fillText(idx === 0 ? "ALP-PASS" : "ST-GOTHARD", 64, 32);
    }
    const signTextMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(signCanvas) });
    const textPlate = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), signTextMat);
    textPlate.position.set(0, 7.8, 1.1);
    archway.add(textPlate);

    stoneArchwaysGroup.add(archway);
  });

  scene.add(stoneArchwaysGroup);
}
