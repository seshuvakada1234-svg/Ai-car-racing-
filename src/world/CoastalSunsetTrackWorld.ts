import * as THREE from "three";
import { TrackGeometryHelper, getTerrainHeight } from "../utils/track";
import { buildTerrain, chunkManager } from "./terrain";
import { terrainManager } from "./TerrainManager";
import { buildFinishArea, FinishAreaController } from "./finishArea";

export class CoastalSunsetTrackWorld {
  public static initialized = false;

  private finishAreaCtrl: FinishAreaController | null = null;
  private roadMaterial: THREE.MeshStandardMaterial | null = null;
  private shoulderMaterial: THREE.MeshStandardMaterial | null = null;
  private tunnelAestheticGroup = new THREE.Group();
  private neonTime = 0.0;
  private oceanSpecularWaveMesh: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, trackHelper: TrackGeometryHelper) {
    if (CoastalSunsetTrackWorld.initialized) {
      console.log("CoastalSunsetTrackWorld: Already initialized. Guarding against duplicate initialization.");
      (window as any).mapLoaded = true;
      (window as any).worldReady = true;
      return;
    }
    CoastalSunsetTrackWorld.initialized = true;

    // Set mapLoaded to true
    (window as any).mapLoaded = true;

    // 1. Prepack height cache
    terrainManager.initialize(trackHelper);

    // 2. Procedural Backdrop, Sky, Clouds and the big Ocean plane
    buildTerrain(scene, trackHelper);

    // 3. Construct Sunset Lighting Setup
    this.setupSunsetAtmosphere(scene);

    // 4. Draw Smooth Road Asphalt and Shoulders
    this.buildRoadNetwork(scene, trackHelper);

    // 5. Instanced Meshes for massive 3D asset speed
    this.buildInstancedAtmosphere(scene, trackHelper);

    // 6. Build the Neon Tunnel section geometry
    this.buildTunnelCavernSlabs(scene, trackHelper);

    // 7. Finish Straight Gate Banner
    this.buildFinishStraightGate(scene, trackHelper);

    (window as any).worldReady = true;
    console.log("Coastal Sunset Track World loaded successfully. Fast and super optimized.");
  }

  /**
   * Inject high-fidelity sunset lighting and disable real-time shadow computation to hit 60 FPS target
   */
  private setupSunsetAtmosphere(scene: THREE.Scene) {
    // Soft twilight indigo/orange ambient hemisphere fill
    const ambientLight = new THREE.HemisphereLight("#2a1240", "#4a2220", 1.8);
    scene.add(ambientLight);

    // Low-angle strong orange sunset sun
    const sunLight = new THREE.DirectionalLight("#ff6b3b", 4.5);
    sunLight.position.set(400, 48, -120);
    sunLight.castShadow = false; // STRIKT RULE: Disable real-time shadow maps
    scene.add(sunLight);
  }

  /**
   * Procedurally generate asphalt road geometry along Map 2 CatmullRom spline path
   */
  private buildRoadNetwork(scene: THREE.Scene, trackHelper: TrackGeometryHelper): void {
    const trackSlices = 1000;

    const roadVertices: number[] = [];
    const roadUVs: number[] = [];
    const roadIndices: number[] = [];

    const shoulderVertices: number[] = [];
    const shoulderUVs: number[] = [];
    const shoulderIndices: number[] = [];

    // Asphalt styling
    const asphaltTex = this.generateAsphaltTexture();
    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: asphaltTex,
      roughness: 0.28, // wet tarmac look
      metalness: 0.15,
    });

    const shoulderTex = this.generateCurbTexture();
    this.shoulderMaterial = new THREE.MeshStandardMaterial({
      map: shoulderTex,
      roughness: 0.72,
    });

    for (let i = 0; i < trackSlices; i++) {
      const u1 = i / trackSlices;
      const u2 = (i + 1) / trackSlices;

      const pt1 = trackHelper.curve.getPointAt(u1);
      const tangent1 = trackHelper.curve.getTangentAt(u1).normalize();
      const normal1 = new THREE.Vector3(-tangent1.z, 0, tangent1.x).normalize();

      const pt2 = trackHelper.curve.getPointAt(u2);
      const tangent2 = trackHelper.curve.getTangentAt(u2).normalize();
      const normal2 = new THREE.Vector3(-tangent2.z, 0, tangent2.x).normalize();

      const rWidth1 = trackHelper.getRoadWidthAt(u1);
      const rWidth2 = trackHelper.getRoadWidthAt(u2);

      const rType1 = trackHelper.getRoadTypeAt(u1);
      const rType2 = trackHelper.getRoadTypeAt(u2);

      // Fine height offset to keep tires flat and smooth transition
      const yOffset1 = rType1 === "tunnel" ? 0.05 : 0.08;
      const yOffset2 = rType2 === "tunnel" ? 0.05 : 0.08;

      const halfW1 = rWidth1 / 2;
      const halfW2 = rWidth2 / 2;

      // 1. Asphalt positions
      const pL1 = new THREE.Vector3().copy(pt1).addScaledVector(normal1, -halfW1);
      const pR1 = new THREE.Vector3().copy(pt1).addScaledVector(normal1, halfW1);
      const pL2 = new THREE.Vector3().copy(pt2).addScaledVector(normal2, -halfW2);
      const pR2 = new THREE.Vector3().copy(pt2).addScaledVector(normal2, halfW2);

      pL1.y += yOffset1;
      pR1.y += yOffset1;
      pL2.y += yOffset2;
      pR2.y += yOffset2;

      const roadVOffset = roadVertices.length / 3;

      roadVertices.push(pL1.x, pL1.y, pL1.z); // 0
      roadVertices.push(pR1.x, pR1.y, pR1.z); // 1
      roadVertices.push(pL2.x, pL2.y, pL2.z); // 2
      roadVertices.push(pR2.x, pR2.y, pR2.z); // 3

      // Repetitive road pattern UVs
      const vScale = 6.0;
      roadUVs.push(0, u1 * vScale);
      roadUVs.push(1, u1 * vScale);
      roadUVs.push(0, u2 * vScale);
      roadUVs.push(1, u2 * vScale);

      roadIndices.push(roadVOffset + 0, roadVOffset + 1, roadVOffset + 2);
      roadIndices.push(roadVOffset + 2, roadVOffset + 1, roadVOffset + 3);

      // 2. Concrete curbs positions
      const cOuterL1 = new THREE.Vector3().copy(pt1).addScaledVector(normal1, -halfW1 - 1.2);
      const cOuterR1 = new THREE.Vector3().copy(pt1).addScaledVector(normal1, halfW1 + 1.2);
      const cOuterL2 = new THREE.Vector3().copy(pt2).addScaledVector(normal2, -halfW2 - 1.2);
      const cOuterR2 = new THREE.Vector3().copy(pt2).addScaledVector(normal2, halfW2 + 1.2);

      cOuterL1.y += yOffset1 + 0.1;
      cOuterR1.y += yOffset1 + 0.1;
      cOuterL2.y += yOffset2 + 0.1;
      cOuterR2.y += yOffset2 + 0.1;

      // Shoulder Left Lane
      const shLOffset = shoulderVertices.length / 3;
      shoulderVertices.push(cOuterL1.x, cOuterL1.y, cOuterL1.z); // 0
      shoulderVertices.push(pL1.x, pL1.y, pL1.z); // 1
      shoulderVertices.push(cOuterL2.x, cOuterL2.y, cOuterL2.z); // 2
      shoulderVertices.push(pL2.x, pL2.y, pL2.z); // 3

      shoulderUVs.push(0, u1 * 40);
      shoulderUVs.push(1, u1 * 40);
      shoulderUVs.push(0, u2 * 40);
      shoulderUVs.push(1, u2 * 40);

      shoulderIndices.push(shLOffset + 0, shLOffset + 1, shLOffset + 2);
      shoulderIndices.push(shLOffset + 2, shLOffset + 1, shLOffset + 3);

      // Shoulder Right Lane
      const shROffset = shoulderVertices.length / 3;
      shoulderVertices.push(pR1.x, pR1.y, pR1.z); // 0
      shoulderVertices.push(cOuterR1.x, cOuterR1.y, cOuterR1.z); // 1
      shoulderVertices.push(pR2.x, pR2.y, pR2.z); // 2
      shoulderVertices.push(cOuterR2.x, cOuterR2.y, cOuterR2.z); // 3

      shoulderUVs.push(0, u1 * 40);
      shoulderUVs.push(1, u1 * 40);
      shoulderUVs.push(0, u2 * 40);
      shoulderUVs.push(1, u2 * 40);

      shoulderIndices.push(shROffset + 0, shROffset + 1, shROffset + 2);
      shoulderIndices.push(shROffset + 2, shROffset + 1, shROffset + 3);
    }

    // Assembly asphalt road model
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(roadVertices, 3));
    roadGeo.setAttribute("uv", new THREE.Float32BufferAttribute(roadUVs, 2));
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();

    const roadMesh = new THREE.Mesh(roadGeo, this.roadMaterial);
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    // Assembly curbs model
    const shGeo = new THREE.BufferGeometry();
    shGeo.setAttribute("position", new THREE.Float32BufferAttribute(shoulderVertices, 3));
    shGeo.setAttribute("uv", new THREE.Float32BufferAttribute(shoulderUVs, 2));
    shGeo.setIndex(shoulderIndices);
    shGeo.computeVertexNormals();

    const shoulderMesh = new THREE.Mesh(shGeo, this.shoulderMaterial);
    shoulderMesh.receiveShadow = true;
    scene.add(shoulderMesh);

    // Dynamic skidding rubber overlays (drift marks) on hairpin nodes
    this.bakeTunnelWarningSlabs(scene, trackHelper);
  }

  /**
   * InstancedMesh for Palm/Pine trees, Beach Side Rocks, and Port Warehouses
   * Combines high-resolution aesthetics with zero rendering overhead
   */
  private buildInstancedAtmosphere(scene: THREE.Scene, trackHelper: TrackGeometryHelper) {
    const dummy = new THREE.Object3D();

    // 1. Palm / Pine Trees (Exactly and safely below the 300 tree limit)
    // Cylinder Trunk + Cone Double Crown to look highly stylized low-poly
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 5.0, 5);
    trunkGeo.translate(0, 2.5, 0);
    const leafGeo = new THREE.ConeGeometry(2.4, 3.5, 5);
    leafGeo.translate(0, 5.0, 0);

    const mergedTreeGeo = new THREE.Group();
    const trunkMesh = new THREE.Mesh(trunkGeo);
    const leafMesh = new THREE.Mesh(leafGeo);
    mergedTreeGeo.add(trunkMesh, leafMesh);

    // Build compound geometry for instancing
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: "#8a5c37", roughness: 0.9 });
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: "#165c3b", roughness: 0.85, flatShading: true });

    // Instance Trunks and Leaves
    const trunkInst = new THREE.InstancedMesh(trunkGeo, treeTrunkMat, trackHelper.trees.length);
    const leafInst = new THREE.InstancedMesh(leafGeo, treeLeafMat, trackHelper.trees.length);

    trackHelper.trees.forEach((tr, idx) => {
      dummy.position.copy(tr.position);
      dummy.scale.set(tr.scale, tr.scale, tr.scale);
      dummy.rotation.set(0, Math.sin(idx) * 6.28, 0);
      dummy.updateMatrix();

      trunkInst.setMatrixAt(idx, dummy.matrix);
      leafInst.setMatrixAt(idx, dummy.matrix);
    });

    scene.add(trunkInst);
    scene.add(leafInst);

    // 2. Coastal Highway Barriers & Rocky Cliffs
    const rockGeo = new THREE.BoxGeometry(1.6, 1.4, 1.6);
    const rockMat = new THREE.MeshStandardMaterial({ color: "#4d515a", roughness: 0.95, flatShading: true });
    const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, trackHelper.rocks.length);

    trackHelper.rocks.forEach((rk, idx) => {
      dummy.position.copy(rk.position);
      dummy.scale.copy(rk.scale);
      dummy.rotation.copy(rk.rotation);
      dummy.updateMatrix();

      rockInst.setMatrixAt(idx, dummy.matrix);
    });

    scene.add(rockInst);

    // 3. Stacked Cargo Shippers & Port Factories (Limit safe: 40 buildings max)
    // Define shipping container model with simple bevel boxes and vibrant harbor colors
    const containerGeo = new THREE.BoxGeometry(6.5, 3.5, 3.2);
    const containerColors = ["#df2b2b", "#1a64df", "#df961a", "#16b251"]; // colorful containers

    containerColors.forEach((colorHex, groupIdx) => {
      const groupCount = Math.ceil(trackHelper.villageHouses.length / containerColors.length);
      const cMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.45, roughness: 0.4 });
      const instC = new THREE.InstancedMesh(containerGeo, cMat, groupCount);
      let instIdx = 0;

      trackHelper.villageHouses.forEach((house, idx) => {
        if (idx % containerColors.length === groupIdx) {
          dummy.position.copy(house.position);
          dummy.position.y += 1.75; // rest on ground offset
          dummy.scale.set(house.scale, house.scale, house.scale);
          dummy.rotation.set(0, house.rotation, 0);
          dummy.updateMatrix();

          instC.setMatrixAt(instIdx++, dummy.matrix);
        }
      });

      scene.add(instC);
    });

    // 4. Custom Harbor landmark: A fully rendered cute Low-Poly Gantry Crane!
    this.buildCuteHarborCrane(scene, trackHelper);
  }

  /**
   * Beautiful Neon rings and covers wrapping along the mountain tunnel (u: 0.28 to 0.44)
   */
  private buildTunnelCavernSlabs(scene: THREE.Scene, trackHelper: TrackGeometryHelper) {
    const tGroup = new THREE.Group();
    const portalCount = 28;
    const neonMat = new THREE.MeshBasicMaterial({ color: "#00f2ff", side: THREE.DoubleSide });

    for (let c = 0; c < portalCount; c++) {
      const prog = 0.28 + (c / (portalCount - 1)) * 0.16;
      const pt = trackHelper.curve.getPointAt(prog);
      const tangent = trackHelper.curve.getTangentAt(prog).normalize();
      const headingAngle = Math.atan2(tangent.x, tangent.z);
      const width = trackHelper.getRoadWidthAt(prog);

      // Light ring
      const ringGeo = new THREE.TorusGeometry(width / 2 + 0.5, 0.18, 5, 12, Math.PI);
      const ring = new THREE.Mesh(ringGeo, neonMat);
      ring.position.copy(pt);
      ring.position.y += 0.1;
      ring.rotation.set(0, headingAngle + Math.PI / 2, 0);

      tGroup.add(ring);
    }

    scene.add(tGroup);
    this.tunnelAestheticGroup = tGroup;
  }

  /**
   * Custom stylized harbor layout low poly crane
   */
  private buildCuteHarborCrane(scene: THREE.Scene, trackHelper: TrackGeometryHelper) {
    const craneGroup = new THREE.Group();
    const ironMat = new THREE.MeshStandardMaterial({ color: "#ffb91a", metalness: 0.6, roughness: 0.35 }); // orange steel yellow

    // Four Legs structure
    const legGeo = new THREE.CylinderGeometry(0.2, 0.4, 18.0, 4);
    const legLeft = new THREE.Mesh(legGeo, ironMat);
    legLeft.position.set(-6, 9, 0);
    const legRight = legLeft.clone();
    legRight.position.set(6, 9, 0);

    // Overhead boom arm beam
    const boomGeo = new THREE.BoxGeometry(22, 1.8, 1.8);
    const boom = new THREE.Mesh(boomGeo, ironMat);
    boom.position.set(2, 17, 0);

    // Operator cabin box
    const cabinGeo = new THREE.BoxGeometry(3.5, 3.5, 3.5);
    const cabMat = new THREE.MeshStandardMaterial({ color: "#333333", roughness: 0.4 });
    const cabin = new THREE.Mesh(cabinGeo, cabMat);
    cabin.position.set(-3, 15, 0);

    // Support trolley cabling lines
    const lineGeo = new THREE.CylinderGeometry(0.04, 0.04, 9.5);
    const cabel = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: "#888888" }));
    cabel.position.set(7, 12, 0);

    craneGroup.add(legLeft, legRight, boom, cabin, cabel);

    // Pitch Crane on the Harbor Bay side bypassed around u: 0.76 (grand crane docks bypass coordinate x: 100, z: -300)
    craneGroup.position.set(90, 1.5, -290);
    craneGroup.rotation.y = -Math.PI / 3;
    craneGroup.scale.set(1.4, 1.4, 1.4);

    scene.add(craneGroup);
  }

  /**
   * Finish straight starting gate banner (arched finish sign at u: 0.0)
   */
  private buildFinishStraightGate(scene: THREE.Scene, trackHelper: TrackGeometryHelper) {
    const startPt = trackHelper.curve.getPointAt(0.0);
    const tangent = trackHelper.curve.getTangentAt(0.0).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const roadWidth = trackHelper.getRoadWidthAt(0.0);
    const headingAngle = Math.atan2(tangent.x, tangent.z);

    const gate = new THREE.Group();
    const steelMat = new THREE.MeshStandardMaterial({ color: "#27292d", roughness: 0.4, metalness: 0.8 });

    // Left support pylon column
    const colGeo = new THREE.CylinderGeometry(0.35, 0.45, 11, 6);
    const colL = new THREE.Mesh(colGeo, steelMat);
    colL.position.set(-roadWidth / 2 - 1.2, 5.5, 0);

    const colR = colL.clone();
    colR.position.set(roadWidth / 2 + 1.2, 5.5, 0);

    // Cross horizontal header beam
    const beamGeo = new THREE.BoxGeometry(roadWidth + 4, 1.5, 1.5);
    const beam = new THREE.Mesh(beamGeo, steelMat);
    beam.position.set(0, 10.5, 0);

    // "COASTAL CIRCUIT" sign box
    const signGeo = new THREE.BoxGeometry(14.0, 2.2, 0.25);
    const bannerTex = this.createBannerTextTexture();
    const signMat = new THREE.MeshBasicMaterial({ map: bannerTex });
    const signBoard = new THREE.Mesh(signGeo, signMat);
    signBoard.position.set(0, 11.2, 0);

    gate.add(colL, colR, beam, signBoard);

    // Reposition around starting line point
    gate.position.copy(startPt);
    gate.rotation.set(0, headingAngle, 0);

    scene.add(gate);

    // Store finish area controller to spin celebrations (fireworks) when player cross line
    this.finishAreaCtrl = buildFinishArea(scene, trackHelper);
  }

  /**
   * Bake a colorful series of horizontal white stripes representing start slots
   */
  private bakeTunnelWarningSlabs(scene: THREE.Scene, trackHelper: TrackGeometryHelper) {
    const linesGroup = new THREE.Group();
    const stripesMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });

    for (let s = 1; s <= 6; s++) {
      const u = s * 0.012; // first 50 meters
      const pt = trackHelper.curve.getPointAt(u);
      const tangent = trackHelper.curve.getTangentAt(u).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const headingAngle = Math.atan2(tangent.x, tangent.z);

      const stripeGeo = new THREE.PlaneGeometry(12.0, 0.6);
      const stripe = new THREE.Mesh(stripeGeo, stripesMat);
      stripe.rotation.set(-Math.PI / 2, 0, headingAngle);
      stripe.position.copy(pt);
      stripe.position.y += 0.12;

      linesGroup.add(stripe);
    }

    scene.add(linesGroup);
  }

  /**
   * Utility canvas context bakes asphalt tarmac details on startup
   */
  private generateAsphaltTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // background tarmac grey
      ctx.fillStyle = "#222326";
      ctx.fillRect(0, 0, 256, 256);

      // granular grains filter
      for (let g = 0; g < 4000; g++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const s = 1 + Math.random() * 2;
        ctx.fillStyle = Math.random() > 0.5 ? "#111214" : "#2b2d30";
        ctx.fillRect(x, y, s, s);
      }

      // beach road side sand sprinkles
      for (let s = 0; s < 500; s++) {
        const x = Math.random() > 0.5 ? Math.random() * 20 : 236 + Math.random() * 20;
        const y = Math.random() * 256;
        ctx.fillStyle = "#dfaf73"; // soft beach sand speckles
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    return tex;
  }

  /**
   * Utility canvas context bakes warning yellow/black chevron curb stripes
   */
  private generateCurbTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffcc00"; // highway yellow
      ctx.fillRect(0, 0, 128, 256);

      ctx.fillStyle = "#1d1e22"; // chevron black
      for (let stripe = 0; stripe < 16; stripe++) {
        ctx.beginPath();
        ctx.moveTo(0, stripe * 32);
        ctx.lineTo(128, stripe * 32 + 16);
        ctx.lineTo(128, stripe * 32 + 32);
        ctx.lineTo(0, stripe * 32 + 16);
        ctx.closePath();
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    return tex;
  }

  /**
   * Custom banner text bitmap generator
   */
  private createBannerTextTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Background racing stripes
      ctx.fillStyle = "#ff6b3b";
      ctx.fillRect(0, 0, 512, 128);

      // Checker boards
      ctx.fillStyle = "#ffffff";
      for (let j = 0; j < 32; j++) {
        ctx.fillRect(j * 16, 0, 8, 16);
        ctx.fillRect(j * 16 + 8, 112, 8, 16);
      }
      ctx.fillStyle = "#000000";
      for (let j = 0; j < 32; j++) {
        ctx.fillRect(j * 16 + 8, 0, 8, 16);
        ctx.fillRect(j * 16, 112, 8, 16);
      }

      // Display typography font pairing
      ctx.font = 'bold 36px "Space Grotesk", "Verdana", sans-serif';
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("SUNSET CIRCUIT", 256, 64);
    }
    return new THREE.CanvasTexture(canvas);
  }

  /**
   * Main game updates connector (updates waterfalls, banners, ocean ripples, celebrations)
   */
  public update(
    elapsedSec: number,
    trackHelper: TrackGeometryHelper,
    rank: number,
    isFinished: boolean,
    activeWeather: "clear" | "sunset" | "overcast" | "rainy",
  ): void {
    // 1. Neon glowing pulse animations
    this.neonTime += elapsedSec;
    const intense = 0.5 + Math.sin(this.neonTime * 4.0) * 0.5;
    this.tunnelAestheticGroup.children.forEach((mesh) => {
      const castMesh = mesh as THREE.Mesh;
      if (castMesh.material && "color" in castMesh.material) {
        (castMesh.material as THREE.MeshBasicMaterial).color.setHSL(0.52 + intense * 0.05, 1.0, 0.42 + intense * 0.18);
      }
    });

    // 2. Victory/Fireworks triggers
    if (isFinished && this.finishAreaCtrl) {
      this.finishAreaCtrl.update(elapsedSec, rank, isFinished);
    }
  }
}
