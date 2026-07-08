import * as THREE from "three";
import { TrackGeometryHelper } from "../utils/track";
import { createProceduralRockGeo } from "./procedural";
import { buildTerrain, chunkManager } from "./terrain";
import { buildForest, forestSystem } from "./forest";
import { buildVillage } from "./village";
import { buildBridge } from "./bridge";
import { buildTunnel } from "./tunnel";
import { buildWaterfall, WaterfallController } from "./waterfall";
import { buildHairpins } from "./hairpins";
import { buildTemple } from "./temple";
import { buildHighway } from "./highway";
import { buildFinishArea, FinishAreaController } from "./finishArea";
import { buildAnimals, AnimalController } from "./animals";
import { terrainManager } from "./TerrainManager";
import { lodManager } from "./lodManager";

export class DragonTrackWorld {
  public static initialized = false;

  private waterfallCtrl: WaterfallController | null = null;
  private finishAreaCtrl: FinishAreaController | null = null;
  private animalsCtrl: AnimalController | null = null;

  // Active PBR physical materials for dynamic environment weather updates
  private roadMaterial: THREE.MeshStandardMaterial | null = null;
  private shoulderMaterial: THREE.MeshStandardMaterial | null = null;

  // Street lighting collection to drive localized dynamic shadow allocation
  private streetLights: { mesh: THREE.Group; light: THREE.PointLight; position: THREE.Vector3 }[] = [];

  // Pre-baked procedural road sign backing textures
  private signTextures: { [key: string]: THREE.CanvasTexture } = {};

  constructor(scene: THREE.Scene, trackHelper: TrackGeometryHelper) {
    if (DragonTrackWorld.initialized) {
      console.log("DragonTrackWorld: Already initialized. Guarding against duplicate initialization.");
      (window as any).mapLoaded = true;
      (window as any).worldReady = true;
      return;
    }
    DragonTrackWorld.initialized = true;

    // Set mapLoaded to true
    (window as any).mapLoaded = true;

    // 1. Pre-bake Terrain Heightmap once before anything else
    terrainManager.initialize(trackHelper);

    // 2. Procedural Backdrop, Fog, Sky, Clouds, Lake, Canyon River
    buildTerrain(scene, trackHelper);

    // Dynamic sign texture generation
    this.prebakeSignsTextures();

    // Decorative craggy slate rock piles
    const rockBaseGeo = createProceduralRockGeo();
    const rockMatShared = new THREE.MeshStandardMaterial({ color: "#4a4d53", roughness: 0.95, flatShading: true });
    const rockInst = new THREE.InstancedMesh(rockBaseGeo, rockMatShared, trackHelper.rocks.length);
    rockInst.castShadow = false;
    rockInst.receiveShadow = false;

    const dummyObj = new THREE.Object3D();
    trackHelper.rocks.forEach((rk, index) => {
      dummyObj.position.copy(rk.position);
      dummyObj.scale.copy(rk.scale);
      dummyObj.rotation.copy(rk.rotation);
      dummyObj.updateMatrix();
      rockInst.setMatrixAt(index, dummyObj.matrix);
    });
    rockInst.instanceMatrix.needsUpdate = true;
    scene.add(rockInst);

    // 3. Road Network, Skidmarks, center lines, barriers guardrails
    this.buildRoadNetwork(scene, trackHelper);

    // 4. Section Sceneries & Landmarks (Staggered asynchronous background loading)
    console.log("[SceneryLoader] Starting background asynchronous world streaming...");

    // Forest system (trees & vegetation) loaded first
    setTimeout(() => {
      const start = performance.now();
      buildForest(scene, trackHelper);
      console.log(`[SceneryLoader] Background: Forest loaded in ${(performance.now() - start).toFixed(1)}ms`);
    }, 40);

    // Village loaded second
    setTimeout(() => {
      const start = performance.now();
      buildVillage(scene, trackHelper);
      console.log(`[SceneryLoader] Background: Village loaded in ${(performance.now() - start).toFixed(1)}ms`);
    }, 120);

    // Structural elements (Bridge & Tunnel)
    setTimeout(() => {
      const start = performance.now();
      buildBridge(scene, trackHelper);
      buildTunnel(scene, trackHelper);
      console.log(`[SceneryLoader] Background: Bridge & Tunnel loaded in ${(performance.now() - start).toFixed(1)}ms`);
    }, 200);

    // Natural landscape visualizers
    setTimeout(() => {
      const start = performance.now();
      this.waterfallCtrl = buildWaterfall(scene, trackHelper);
      buildHairpins(scene, trackHelper);
      console.log(
        `[SceneryLoader] Background: Waterfall & Hairpins loaded in ${(performance.now() - start).toFixed(1)}ms`,
      );
    }, 280);

    // Temple & Highway sections
    setTimeout(() => {
      const start = performance.now();
      buildTemple(scene, trackHelper);
      buildHighway(scene, trackHelper);
      console.log(`[SceneryLoader] Background: Temple & Highway loaded in ${(performance.now() - start).toFixed(1)}ms`);
    }, 360);

    // Celebratory area & wildlife
    setTimeout(() => {
      const start = performance.now();
      this.finishAreaCtrl = buildFinishArea(scene, trackHelper);
      this.animalsCtrl = buildAnimals(scene, trackHelper);
      console.log(
        `[SceneryLoader] Background: Finish Area & Animals loaded in ${(performance.now() - start).toFixed(1)}ms`,
      );
    }, 440);

    (window as any).worldReady = true;
  }

  public update(
    elapsedSec: number,
    trackHelper: TrackGeometryHelper,
    playerRank = 1,
    isFinished = false,
    weather = "sunny",
  ): void {
    // Dynamic preloading of terrain chunks around player
    if (terrainManager.playerPos) {
      chunkManager.update(terrainManager.playerPos);
    }

    // Animate the interactive waterfall texture scrolls and splashing mist
    if (this.waterfallCtrl) {
      this.waterfallCtrl.update(elapsedSec);
    }
    // Animate fireworks and other celebrating spectators
    if (this.finishAreaCtrl) {
      this.finishAreaCtrl.update(elapsedSec, playerRank, isFinished);
    }
    // Animate the European countryside animal herds and flying birds
    if (this.animalsCtrl) {
      this.animalsCtrl.update(elapsedSec);
    }

    // Update dynamic forest system LOD ranges
    forestSystem.update(terrainManager.playerPos);

    // --- Weather Dynamic Reflective Wetness (Interpolate standard material roughness/metalness) ---
    if (this.roadMaterial) {
      const targetRoughness = weather === "rain" ? 0.08 : 0.45;
      const targetMetalness = weather === "rain" ? 0.65 : 0.22;
      this.roadMaterial.roughness = THREE.MathUtils.lerp(
        this.roadMaterial.roughness,
        targetRoughness,
        4.0 * elapsedSec,
      );
      this.roadMaterial.metalness = THREE.MathUtils.lerp(
        this.roadMaterial.metalness,
        targetMetalness,
        4.0 * elapsedSec,
      );
    }

    if (this.shoulderMaterial) {
      const targetRoughness = weather === "rain" ? 0.22 : 0.88;
      const targetMetalness = weather === "rain" ? 0.45 : 0.1;
      this.shoulderMaterial.roughness = THREE.MathUtils.lerp(
        this.shoulderMaterial.roughness,
        targetRoughness,
        4.0 * elapsedSec,
      );
      this.shoulderMaterial.metalness = THREE.MathUtils.lerp(
        this.shoulderMaterial.metalness,
        targetMetalness,
        4.0 * elapsedSec,
      );
    }

    // --- Localized Street Lights Shadow Casting Allocation (Shadow ONLY on streetlight closest to the player) ---
    if (terrainManager.playerPos && this.streetLights.length > 0) {
      let closestSL: any = null;
      let minDist = Infinity;
      const pPos = terrainManager.playerPos;

      for (let s = 0; s < this.streetLights.length; s++) {
        const sl = this.streetLights[s];
        const d = pPos.distanceTo(sl.position);
        if (d < minDist) {
          minDist = d;
          closestSL = sl;
        }
        // Turn shadow off for all lamps by default to boost GPU performance
        sl.light.castShadow = false;
      }

      // Activate realcast shadow on the closest lamp within 85.0 meters of physical range
      if (closestSL && minDist < 85.0) {
        closestSL.light.castShadow = true;
      }
    }
  }

  /**
   * Generates and cache authentic high-visibility sign boards to prevent redundant draw allocations
   */
  private prebakeSignsTextures(): void {
    const createCachedSignTex = (drawFn: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (ctx) drawFn(ctx);
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      return tex;
    };

    // 1. circular Speed Limit 80 Sign
    this.signTextures["speed_80"] = createCachedSignTex((ctx) => {
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(0, 0, 256, 256);
      ctx.beginPath();
      ctx.arc(128, 128, 110, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 18;
      ctx.strokeStyle = "#d32f2f"; // signal red ring
      ctx.stroke();

      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 96px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("80", 128, 128);
    });

    // 2. circular Speed Limit 120 Sign
    this.signTextures["speed_120"] = createCachedSignTex((ctx) => {
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(0, 0, 256, 256);
      ctx.beginPath();
      ctx.arc(128, 128, 110, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 18;
      ctx.strokeStyle = "#d32f2f";
      ctx.stroke();

      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 88px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("120", 128, 128);
    });

    // 3. warning curvy hairpin ahead sign
    this.signTextures["curve"] = createCachedSignTex((ctx) => {
      // diamond background
      ctx.fillStyle = "#f9f9f9";
      ctx.fillRect(0, 0, 256, 256);

      ctx.translate(128, 128);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#ffcc00"; // warning amber
      ctx.fillRect(-80, -80, 160, 160);
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#111111";
      ctx.strokeRect(-80, -80, 160, 160);
      ctx.rotate(-Math.PI / 4);
      ctx.translate(-128, -128);

      // Squiggle Arrow line
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(128, 185);
      ctx.lineTo(128, 150);
      ctx.bezierCurveTo(90, 140, 90, 110, 128, 100);
      ctx.lineTo(128, 75);
      ctx.stroke();

      // arrow pointer head
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.moveTo(128, 56);
      ctx.lineTo(112, 80);
      ctx.lineTo(144, 80);
      ctx.fill();
    });

    // 4. welcome to alpine village sign
    this.signTextures["village"] = createCachedSignTex((ctx) => {
      ctx.fillStyle = "#ffea00"; // Yellow city limit sign
      ctx.fillRect(0, 0, 256, 256);
      ctx.lineWidth = 10;
      ctx.strokeStyle = "#111111";
      ctx.strokeRect(10, 10, 236, 236);

      ctx.fillStyle = "#111111";
      ctx.textAlign = "center";
      ctx.font = "bold 30px Arial";
      ctx.fillText("WELCOME TO", 128, 80);
      ctx.font = "bold 36px Arial";
      ctx.fillText("ALPINE", 128, 140);
      ctx.fillText("VILLAGE", 128, 188);
    });

    // 5. tunnel warning sign
    this.signTextures["tunnel_sign"] = createCachedSignTex((ctx) => {
      ctx.fillStyle = "#0288d1"; // Warning blue square
      ctx.fillRect(0, 0, 256, 256);
      ctx.lineWidth = 12;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(12, 12, 232, 232);

      // Tunnel arch silhouette
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(128, 140, 55, Math.PI, 0, false);
      ctx.lineTo(183, 200);
      ctx.lineTo(73, 200);
      ctx.fill();

      ctx.fillStyle = "#0288d1";
      ctx.beginPath();
      ctx.arc(128, 140, 36, Math.PI, 0, false);
      ctx.lineTo(164, 200);
      ctx.lineTo(92, 200);
      ctx.fill();
    });
  }

  /**
   * Helper that compiles a road sign 3D layout using the cached textures
   */
  private createRoadSignMesh(type: "speed_80" | "speed_120" | "curve" | "village" | "tunnel_sign"): THREE.Group {
    const signGroup = new THREE.Group();

    // 1. Metal support post
    const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.5, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: "#888888", metalness: 0.85, roughness: 0.15 });
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.y = 1.25;
    post.castShadow = false;
    signGroup.add(post);

    // 2. Sign face plate
    const isRound = type === "speed_80" || type === "speed_120";
    let boardGeo: THREE.BufferGeometry;

    if (isRound) {
      boardGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.03, 16);
      boardGeo.rotateX(Math.PI / 2); // face front
    } else {
      boardGeo = new THREE.BoxGeometry(0.9, 0.9, 0.03);
    }

    const faceTexture = this.signTextures[type];
    const boardMat = new THREE.MeshStandardMaterial({
      map: faceTexture,
      roughness: 0.45,
      metalness: 0.15,
    });

    const plate = new THREE.Mesh(boardGeo, boardMat);
    plate.position.set(0, 2.1, 0.02);
    plate.castShadow = false;
    signGroup.add(plate);

    return signGroup;
  }

  /**
   * Generates a massive overhead highway gantry to welcome cars onto the dual highway strip
   */
  private createOverheadHighwayGantry(pos: THREE.Vector3, normal: THREE.Vector3, width: number): THREE.Group {
    const gantry = new THREE.Group();
    gantry.position.copy(pos);

    const metalMat = new THREE.MeshStandardMaterial({ color: "#555e65", metalness: 0.9, roughness: 0.1 });

    // Left and Right support legs on the shoulders
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 7.5, 8), metalMat);
    legL.position.set(width / 2 + 1.5, 3.75, 0);
    legL.castShadow = false;
    legL.receiveShadow = true;

    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 7.5, 8), metalMat);
    legR.position.set(-(width / 2 + 1.5), 3.75, 0);
    legR.castShadow = false;
    legR.receiveShadow = true;

    gantry.add(legL, legR);

    // Cross beam spanning over the lanes
    const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(width + 4.2, 0.4, 0.4), metalMat);
    crossBeam.position.set(0, 7.3, 0);
    crossBeam.castShadow = false;
    gantry.add(crossBeam);

    // Overhead highway green information guide board
    const boardCanvas = document.createElement("canvas");
    boardCanvas.width = 512;
    boardCanvas.height = 128;
    const bCtx = boardCanvas.getContext("2d");
    if (bCtx) {
      bCtx.fillStyle = "#1c6a2f"; // Highway green
      bCtx.fillRect(0, 0, 512, 128);

      bCtx.lineWidth = 8;
      bCtx.strokeStyle = "#ffffff";
      bCtx.strokeRect(10, 10, 492, 108);

      bCtx.fillStyle = "#ffffff";
      bCtx.font = "bold 32px Arial";
      bCtx.fillText("↑  CANYON BRIDGE   5.0 km", 30, 58);
      bCtx.fillText("↗  TEMPLE GORGE   1.5 km", 30, 96);
    }

    const infoBoardGeo = new THREE.BoxGeometry(width * 0.72, 1.8, 0.12);
    const infoBoardMat = new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(boardCanvas),
      roughness: 0.45,
    });
    const infoBoard = new THREE.Mesh(infoBoardGeo, infoBoardMat);
    infoBoard.position.set(0, 6.3, 0.15);
    infoBoard.castShadow = false;
    gantry.add(infoBoard);

    // Rotate gantry to look down the track path
    gantry.rotation.y = -Math.atan2(normal.z, normal.x) + Math.PI / 2;

    return gantry;
  }

  private buildRoadNetwork(scene: THREE.Scene, trackHelper: TrackGeometryHelper): void {
    // Increased slices to 1200 for extremely smooth curves and 3-5m spacing post barriers
    const trackSlices = 1200;

    const roadVertices: number[] = [];
    const roadUVs: number[] = [];
    const roadIndices: number[] = [];

    // Distinct shoulder & curb geometry vertices arrays
    const shoulderVertices: number[] = [];
    const shoulderUVs: number[] = [];
    const shoulderIndices: number[] = [];

    const centerLinePoints: THREE.Vector3[] = [];
    const leftEdgeLinePoints: THREE.Vector3[] = [];
    const rightEdgeLinePoints: THREE.Vector3[] = [];

    // Parallel Tire rubber skid decals wrapping precisely on hairpins
    const skidGroup = new THREE.Group();
    const skidMat = new THREE.MeshBasicMaterial({
      color: "#0d0d0e",
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });

    const asphaltTex = this.createAsphaltTexture();
    const asphaltBumpTex = this.createAsphaltBumpTexture();

    // Store reference to road material for weather updates
    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: asphaltTex,
      bumpMap: asphaltBumpTex,
      bumpScale: 0.007,
      roughness: 0.45,
      metalness: 0.22,
    });

    // Procedural shoulder curb & gravel texture
    const shoulderTex = this.createShoulderTexture();
    this.shoulderMaterial = new THREE.MeshStandardMaterial({
      map: shoulderTex,
      roughness: 0.88,
      metalness: 0.1,
    });

    // Helper to get smoothed road Y offset to eliminate vertical gaps at transitions
    const getSmoothedRoadYOffset = (progressValue: number): number => {
      let sumOffset = 0;
      const ws = 9;
      for (let s = -4; s <= 4; s++) {
        const p = (((progressValue + s * 0.004) % 1.0) + 1.0) % 1.0;
        const rType = trackHelper.getRoadTypeAt(p);
        sumOffset += rType === "bridge" ? 0.3 : 0.02;
      }
      return sumOffset / ws;
    };

    // Arrays to collect matrices for physical instanced barriers
    const postMatrices: THREE.Matrix4[] = [];
    const railMatrices: THREE.Matrix4[] = [];
    const concreteMatrices: THREE.Matrix4[] = [];

    let signCooldown = 0;

    for (let i = 0; i < trackSlices; i++) {
      const u1 = i / trackSlices;
      const u2 = (i + 1) / trackSlices;
      const progress1 = u1 % 1.0;
      const progress2 = u2 % 1.0;

      const pt1 = trackHelper.curve.getPointAt(progress1);
      const tangent1 = trackHelper.curve.getTangentAt(progress1).normalize();
      const normal1 = new THREE.Vector3(-tangent1.z, 0, tangent1.x).normalize();

      const pt2 = trackHelper.curve.getPointAt(progress2);
      const tangent2 = trackHelper.curve.getTangentAt(progress2).normalize();
      const normal2 = new THREE.Vector3(-tangent2.z, 0, tangent2.x).normalize();

      const width1 = trackHelper.getRoadWidthAt(progress1);
      const width2 = trackHelper.getRoadWidthAt(progress2);

      const rType = trackHelper.getRoadTypeAt(progress1);
      const roadYOffset1 = getSmoothedRoadYOffset(progress1);
      const roadYOffset2 = getSmoothedRoadYOffset(progress2);

      // We overlap adjacent segments by 0.02m total along the forward direction
      const pt1Overlapped = new THREE.Vector3().copy(pt1).addScaledVector(tangent1, -0.01);
      const pt2Overlapped = new THREE.Vector3().copy(pt2).addScaledVector(tangent2, 0.01);

      // --- Main Tarmac Mesh Vertices (Shaped dynamically closer to physical track) ---
      const lPt1 = new THREE.Vector3().copy(pt1Overlapped).addScaledVector(normal1, width1 / 2);
      lPt1.y += roadYOffset1;
      const rPt1 = new THREE.Vector3().copy(pt1Overlapped).addScaledVector(normal1, -width1 / 2);
      rPt1.y += roadYOffset1;

      const lPt2 = new THREE.Vector3().copy(pt2Overlapped).addScaledVector(normal2, width2 / 2);
      lPt2.y += roadYOffset2;
      const rPt2 = new THREE.Vector3().copy(pt2Overlapped).addScaledVector(normal2, -width2 / 2);
      rPt2.y += roadYOffset2;

      // Pushing 4 vertices for tarmac ribbon
      roadVertices.push(lPt1.x, lPt1.y, lPt1.z); // V0
      roadVertices.push(rPt1.x, rPt1.y, rPt1.z); // V1
      roadVertices.push(lPt2.x, lPt2.y, lPt2.z); // V2
      roadVertices.push(rPt2.x, rPt2.y, rPt2.z); // V3

      // UVs mapping nicely with high-density tiling along the ribbon length
      const vTile1 = u1 * 64;
      const vTile2 = u2 * 64;
      roadUVs.push(0, vTile1);
      roadUVs.push(1, vTile1);
      roadUVs.push(0, vTile2);
      roadUVs.push(1, vTile2);

      const currL = i * 4;
      const currR = i * 4 + 1;
      const nextL = i * 4 + 2;
      const nextR = i * 4 + 3;

      roadIndices.push(currL, nextL, currR);
      roadIndices.push(nextL, nextR, currR);

      // --- Left and Right Decorative Beveled Curbs / Gravel Shoulders Geometry ---
      // Bevel down and outward to blend into terrainManager smoothly.
      const bevelWidth = 1.6;
      const bevelDrop = 0.08;

      const lPtOut1 = lPt1.clone().addScaledVector(normal1, bevelWidth);
      lPtOut1.y -= bevelDrop;
      const lPtOut2 = lPt2.clone().addScaledVector(normal2, bevelWidth);
      lPtOut2.y -= bevelDrop;

      const rPtOut1 = rPt1.clone().addScaledVector(normal1, -bevelWidth);
      rPtOut1.y -= bevelDrop;
      const rPtOut2 = rPt2.clone().addScaledVector(normal2, -bevelWidth);
      rPtOut2.y -= bevelDrop;

      // Left shoulder segment (V0: lPtOut1, V1: lPt1, V2: lPtOut2, V3: lPt2)
      // Bevel nested 0.002m lower to prevent Z-fighting at tarmac joints.
      const sl1 = lPt1.clone();
      sl1.y -= 0.002;
      const sl2 = lPt2.clone();
      sl2.y -= 0.002;
      shoulderVertices.push(lPtOut1.x, lPtOut1.y, lPtOut1.z);
      shoulderVertices.push(sl1.x, sl1.y, sl1.z);
      shoulderVertices.push(lPtOut2.x, lPtOut2.y, lPtOut2.z);
      shoulderVertices.push(sl2.x, sl2.y, sl2.z);

      // Right shoulder segment (V0: rPt1, V1: rPtOut1, V2: rPt2, V3: rPtOut2)
      const sr1 = rPt1.clone();
      sr1.y -= 0.002;
      const sr2 = rPt2.clone();
      sr2.y -= 0.002;
      shoulderVertices.push(sr1.x, sr1.y, sr1.z);
      shoulderVertices.push(rPtOut1.x, rPtOut1.y, rPtOut1.z);
      shoulderVertices.push(sr2.x, sr2.y, sr2.z);
      shoulderVertices.push(rPtOut2.x, rPtOut2.y, rPtOut2.z);

      // UV mapping across the shoulder width & along path length
      shoulderUVs.push(0, vTile1);
      shoulderUVs.push(1, vTile1);
      shoulderUVs.push(0, vTile2);
      shoulderUVs.push(1, vTile2);

      shoulderUVs.push(1, vTile1);
      shoulderUVs.push(0, vTile1);
      shoulderUVs.push(1, vTile2);
      shoulderUVs.push(0, vTile2);

      const shIdxOffset = i * 8;
      // Left shoulder index winding
      shoulderIndices.push(shIdxOffset, shIdxOffset + 2, shIdxOffset + 1);
      shoulderIndices.push(shIdxOffset + 2, shIdxOffset + 3, shIdxOffset + 1);

      // Right shoulder index winding
      shoulderIndices.push(shIdxOffset + 4, shIdxOffset + 6, shIdxOffset + 5);
      shoulderIndices.push(shIdxOffset + 6, shIdxOffset + 7, shIdxOffset + 5);

      // --- Decorative 3D elevated centerline and edge boundary stripes ---
      const centerPt = new THREE.Vector3().copy(pt1);
      centerPt.y += roadYOffset1 + 0.015;
      centerLinePoints.push(centerPt);

      const leftEdgePt = new THREE.Vector3().copy(pt1).addScaledVector(normal1, width1 / 2 - 0.45);
      leftEdgePt.y += roadYOffset1 + 0.015;
      leftEdgeLinePoints.push(leftEdgePt);

      const rightEdgePt = new THREE.Vector3().copy(pt1).addScaledVector(normal1, -(width1 / 2 - 0.45));
      rightEdgePt.y += roadYOffset1 + 0.015;
      rightEdgeLinePoints.push(rightEdgePt);

      // --- Pre-baked tyre skid rubber marks on hairpins ---
      if (rType === "hairpin" && i % 3 === 0) {
        const trackWidth = 1.35;
        const leftSkidGeo = new THREE.PlaneGeometry(0.24, 2.2);
        leftSkidGeo.rotateX(-Math.PI / 2);

        const skidL = new THREE.Mesh(leftSkidGeo, skidMat);
        skidL.position.copy(pt1).addScaledVector(normal1, -trackWidth / 2 + (Math.random() * 0.2 - 0.1));
        skidL.position.y += roadYOffset1 + 0.006;
        skidL.lookAt(new THREE.Vector3().copy(skidL.position).add(tangent1));
        skidGroup.add(skidL);

        const skidR = new THREE.Mesh(leftSkidGeo, skidMat);
        skidR.position.copy(pt1).addScaledVector(normal1, trackWidth / 2 + (Math.random() * 0.2 - 0.1));
        skidR.position.y += roadYOffset1 + 0.006;
        skidR.lookAt(new THREE.Vector3().copy(skidR.position).add(tangent1));
        skidGroup.add(skidR);
      }

      // --- Solid Barriers Matrix Collections (Placing Concrete Jersey Blocks vs Polished Steel Guardrails) ---
      const isBridge = rType === "bridge";
      const isCliffsDangerous = rType === "hairpin" || pt1.y > 9.5;

      if (isBridge) {
        // JERSEY GLASSLESS CONCRETE WALLS (perfectly aligned with bridge joints)
        const dummyJ = new THREE.Object3D();
        const segDist = lPt1.distanceTo(lPt2);

        const lMid = new THREE.Vector3().copy(lPt1).add(lPt2).multiplyScalar(0.5);
        lMid.y += 0.5; // elevate to center the 1.1m box
        dummyJ.position.copy(lMid);
        dummyJ.lookAt(lPt2.clone().add(new THREE.Vector3(0, 0.5, 0)));
        dummyJ.scale.set(1, 1, segDist);
        dummyJ.updateMatrix();
        concreteMatrices.push(dummyJ.matrix.clone());

        const rMid = new THREE.Vector3().copy(rPt1).add(rPt2).multiplyScalar(0.5);
        rMid.y += 0.5;
        dummyJ.position.copy(rMid);
        dummyJ.lookAt(rPt2.clone().add(new THREE.Vector3(0, 0.5, 0)));
        dummyJ.scale.set(1, 1, segDist);
        dummyJ.updateMatrix();
        concreteMatrices.push(dummyJ.matrix.clone());
      } else if (isCliffsDangerous) {
        // Spaced metal support post on cliffs every slice (spaced perfectly at 3.4 meters!)
        const dummyP = new THREE.Object3D();

        dummyP.position.copy(lPt1).add(new THREE.Vector3(0, 0.35, 0));
        dummyP.updateMatrix();
        postMatrices.push(dummyP.matrix.clone());

        dummyP.position.copy(rPt1).add(new THREE.Vector3(0, 0.35, 0));
        dummyP.updateMatrix();
        postMatrices.push(dummyP.matrix.clone());

        // Seamless polished metallic corrugated safety rail
        const dummyR = new THREE.Object3D();
        const segDist = lPt1.distanceTo(lPt2);

        const lMid = new THREE.Vector3().copy(lPt1).add(lPt2).multiplyScalar(0.5);
        lMid.y += 0.48;
        dummyR.position.copy(lMid);
        dummyR.lookAt(lPt2.clone().add(new THREE.Vector3(0, 0.48, 0)));
        dummyR.scale.set(1, 1, segDist);
        dummyR.updateMatrix();
        railMatrices.push(dummyR.matrix.clone());

        const rMid = new THREE.Vector3().copy(rPt1).add(rPt2).multiplyScalar(0.5);
        rMid.y += 0.48;
        dummyR.position.copy(rMid);
        dummyR.lookAt(rPt2.clone().add(new THREE.Vector3(0, 0.48, 0)));
        dummyR.scale.set(1, 1, segDist);
        dummyR.updateMatrix();
        railMatrices.push(dummyR.matrix.clone());
      }

      // --- Scattered Road and Speedway Signs (CurveWarnings, SpeedLimits, WelcomeVillage, Tunnel Blue) ---
      if (signCooldown > 0) {
        signCooldown--;
      }

      if (signCooldown === 0) {
        const signOffset = 2.0;

        // A. Lookahead to check if approaching hairpin turns
        let approachingHairpin = false;
        for (let s = 1; s <= 15; s++) {
          const checkProgress = ((i + s) / trackSlices) % 1.0;
          if (trackHelper.getRoadTypeAt(checkProgress) === "hairpin") {
            approachingHairpin = true;
            break;
          }
        }

        if (approachingHairpin && rType !== "hairpin") {
          const signGroup = this.createRoadSignMesh("curve");
          signGroup.position.copy(rPt1).addScaledVector(normal1, -signOffset);
          signGroup.position.y += roadYOffset1;
          signGroup.lookAt(new THREE.Vector3().copy(signGroup.position).add(tangent1));
          scene.add(signGroup);
          signCooldown = 50; // prevent overlapping signs
        }
        // B. Welcome to alpine village boards right at town boundary entrance
        else if (i === 215) {
          const signGroup = this.createRoadSignMesh("village");
          signGroup.position.copy(rPt1).addScaledVector(normal1, -signOffset);
          signGroup.position.y += roadYOffset1;
          signGroup.lookAt(new THREE.Vector3().copy(signGroup.position).add(tangent1));
          scene.add(signGroup);
          signCooldown = 40;
        }
        // C. Tunnel entry warnings right before tunnel mouth
        else if (i === 560) {
          const signGroup = this.createRoadSignMesh("tunnel_sign");
          signGroup.position.copy(rPt1).addScaledVector(normal1, -signOffset);
          signGroup.position.y += roadYOffset1;
          signGroup.lookAt(new THREE.Vector3().copy(signGroup.position).add(tangent1));
          scene.add(signGroup);
          signCooldown = 40;
        }
        // D. Speed limits along straight dual pass speedways
        else if (rType === "straight" && i % 130 === 0) {
          const signGroup = this.createRoadSignMesh(i % 260 === 0 ? "speed_80" : "speed_120");
          signGroup.position.copy(rPt1).addScaledVector(normal1, -signOffset);
          signGroup.position.y += roadYOffset1;
          signGroup.lookAt(new THREE.Vector3().copy(signGroup.position).add(tangent1));
          scene.add(signGroup);
          signCooldown = 50;
        }
      }

      // --- Overhead Highway Gantry Welcomer placement at highway start ---
      if (i === 950) {
        const gantry = this.createOverheadHighwayGantry(pt1, normal1, width1);
        gantry.position.y += roadYOffset1;
        scene.add(gantry);
      }

      // --- Warm Amber Streetlights near Villages and Start/Finish lines ---
      const inVillage = progress1 >= 0.18 && progress1 <= 0.28;
      const inFinishStraight = progress1 >= 0.92 || progress1 <= 0.05;

      if ((inVillage || inFinishStraight) && i % 18 === 0) {
        const sideSym = i % 36 === 0 ? 1 : -1;
        const lPos = pt1.clone().addScaledVector(normal1, sideSym * (width1 / 2 + 1.3));
        lPos.y += roadYOffset1;

        const streetLightGroup = new THREE.Group();
        streetLightGroup.position.copy(lPos);

        const poleMat = new THREE.MeshStandardMaterial({ color: "#2c3539", metalness: 0.9, roughness: 0.1 });
        const bulbMat = new THREE.MeshBasicMaterial({ color: "#fff0b3" }); // glowing bulb

        // Sleek curved metallic lamp pole
        const slPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 7.5, 6), poleMat);
        slPole.position.y = 3.75;
        slPole.castShadow = false;
        streetLightGroup.add(slPole);

        const slArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5), poleMat);
        slArm.rotation.z = Math.PI / 2;
        slArm.position.set(sideSym * -0.7, 7.4, 0);
        slArm.castShadow = false;
        streetLightGroup.add(slArm);

        // Hanging sodium bulb
        const slBulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), bulbMat);
        slBulb.position.set(sideSym * -1.4, 7.15, 0);
        streetLightGroup.add(slBulb);

        // Rotate pole slightly to align with curved normal vector
        streetLightGroup.rotation.y = -Math.atan2(normal1.z, normal1.x) + Math.PI / 2;

        // Realistic warm sodium/halogen physical point light sources
        const lightColor = inVillage ? "#ff851b" : "#ffea00"; // warm orange vs bright warm halogen
        const pointLight = new THREE.PointLight(lightColor, 6.0, 32.0, 1.4);
        pointLight.position.set(sideSym * -1.4, 7.0, 0);
        pointLight.castShadow = false; // toggled closest-light dynamic shadow inside update()
        pointLight.shadow.mapSize.width = 512;
        pointLight.shadow.mapSize.height = 512;
        pointLight.shadow.bias = -0.003;

        streetLightGroup.add(pointLight);
        scene.add(streetLightGroup);

        // We register streetlight details with absolute coordinate vector
        this.streetLights.push({
          mesh: streetLightGroup,
          light: pointLight,
          position: new THREE.Vector3()
            .copy(lPos)
            .add(new THREE.Vector3(sideSym * -1.4, 7.0, 0).applyEuler(streetLightGroup.rotation)),
        });
      }
    }

    scene.add(skidGroup);

    // Main road mesh creation
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(roadVertices), 3));
    roadGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(roadUVs), 2));
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();

    const roadMesh = new THREE.Mesh(roadGeo, this.roadMaterial);
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    // Bake main road mesh into terrainManager's BVH collision tree
    terrainManager.bakeRoadMeshBVH([roadMesh]);

    // Sloped gravel shoulder and curb mesh creation
    const shoulderGeo = new THREE.BufferGeometry();
    shoulderGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(shoulderVertices), 3));
    shoulderGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(shoulderUVs), 2));
    shoulderGeo.setIndex(shoulderIndices);
    shoulderGeo.computeVertexNormals();

    const shoulderMesh = new THREE.Mesh(shoulderGeo, this.shoulderMaterial);
    shoulderMesh.receiveShadow = true;
    scene.add(shoulderMesh);

    // --- Instanced barriers generation using cached vector matrices to prevent gap leaks ---
    const bConcreteGeo = new THREE.BoxGeometry(0.32, 1.1, 1.0);
    const bConcreteMat = new THREE.MeshStandardMaterial({ color: "#bbbdc0", roughness: 0.95 });

    const bPostGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.3, 5);
    const bPostMat = new THREE.MeshStandardMaterial({ color: "#888888", metalness: 0.8, roughness: 0.2 });

    const bRailGeo = new THREE.BoxGeometry(0.1, 0.42, 1.0);
    const bRailMat = new THREE.MeshStandardMaterial({ color: "#dedede", metalness: 0.95, roughness: 0.15 });

    if (concreteMatrices.length > 0) {
      const bConcreteInst = new THREE.InstancedMesh(bConcreteGeo, bConcreteMat, concreteMatrices.length);
      bConcreteInst.castShadow = false;
      bConcreteInst.receiveShadow = false;
      concreteMatrices.forEach((mat, idx) => bConcreteInst.setMatrixAt(idx, mat));
      bConcreteInst.instanceMatrix.needsUpdate = true;
      scene.add(bConcreteInst);
    }

    if (postMatrices.length > 0) {
      const bPostInst = new THREE.InstancedMesh(bPostGeo, bPostMat, postMatrices.length);
      bPostInst.castShadow = false;
      bPostInst.receiveShadow = true;
      postMatrices.forEach((mat, idx) => bPostInst.setMatrixAt(idx, mat));
      bPostInst.instanceMatrix.needsUpdate = true;
      scene.add(bPostInst);
    }

    if (railMatrices.length > 0) {
      const bRailInst = new THREE.InstancedMesh(bRailGeo, bRailMat, railMatrices.length);
      bRailInst.castShadow = false;
      bRailInst.receiveShadow = false;
      railMatrices.forEach((mat, idx) => bRailInst.setMatrixAt(idx, mat));
      bRailInst.instanceMatrix.needsUpdate = true;
      scene.add(bRailInst);
    }
  }

  private createAsphaltTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // base dark asphalt carbon gray
      ctx.fillStyle = "#1c1e22";
      ctx.fillRect(0, 0, 1024, 1024);

      // tiny varied intensity aggregate sands/grains
      for (let i = 0; i < 28000; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        const size = Math.random() * 1.8;
        const noiseColor = Math.floor(Math.random() * 32) + 36; // dark graphite grey specks
        ctx.fillStyle = `rgb(${noiseColor}, ${noiseColor}, ${noiseColor})`;
        ctx.fillRect(x, y, size, size);
      }

      // adding light aggregate quartzite flecks
      ctx.fillStyle = "rgba(215, 220, 225, 0.15)";
      for (let i = 0; i < 4000; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        const size = Math.random() * 1.5;
        ctx.fillRect(x, y, size, size);
      }

      // tire wear lanes (darken where car tires travel on the left and right sectors)
      const gradL = ctx.createLinearGradient(0, 0, 1024, 0);
      gradL.addColorStop(0.12, "rgba(10,10,12,0.65)");
      gradL.addColorStop(0.24, "rgba(10,10,12,0.65)");
      gradL.addColorStop(0.38, "rgba(28,30,34,0)");
      gradL.addColorStop(0.62, "rgba(28,30,34,0)");
      gradL.addColorStop(0.76, "rgba(10,10,12,0.65)");
      gradL.addColorStop(0.88, "rgba(10,10,12,0.65)");
      ctx.fillStyle = gradL;
      ctx.fillRect(0, 0, 1024, 1024);

      // dark engine oil stains
      for (let j = 0; j < 35; j++) {
        const cx = Math.random() * 1024;
        const cy = Math.random() * 1024;
        const r = 12 + Math.random() * 35;
        const oGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
        oGrad.addColorStop(0, "rgba(10,8,6,0.62)");
        oGrad.addColorStop(0.5, "rgba(12,12,14,0.3)");
        oGrad.addColorStop(1, "rgba(28,30,34,0)");
        ctx.fillStyle = oGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // organic paving asphalt cracks
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const numCracks = 6;
      for (let c = 0; c < numCracks; c++) {
        let cx = Math.random() * 1024;
        let cy = Math.random() * 1024;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let s = 0; s < 12; s++) {
          cx += Math.random() * 24 - 12;
          cy += Math.random() * 20 + 8;
          ctx.lineTo(cx, cy);
        }

        // 3D recession effect: stroke dark then offset light grey highlighted bevel
        ctx.strokeStyle = "rgba(8, 8, 10, 0.72)";
        ctx.lineWidth = 1.6;
        ctx.stroke();

        ctx.strokeStyle = "rgba(210, 215, 230, 0.14)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // weather-worn yellow dashed centerline in center of texture
      ctx.fillStyle = "#ffaa00";
      ctx.globalAlpha = 0.88;
      for (let y = 14; y < 1024; y += 128) {
        ctx.fillRect(504, y, 16, 68);

        // grit erosion omissions
        ctx.fillStyle = "#1c1e22";
        for (let g = 0; g < 4; g++) {
          ctx.fillRect(504 + Math.random() * 16, y + Math.random() * 68, 2 + Math.random() * 3, 2 + Math.random() * 3);
        }
        ctx.fillStyle = "#ffaa00";
      }

      // weather-worn solid white outer boundary lines
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(36, 0, 15, 1024);
      ctx.fillRect(1024 - 51, 0, 15, 1024);

      // boundary paint grain wears
      ctx.fillStyle = "#1c1e22";
      for (let w = 0; w < 400; w++) {
        ctx.fillRect(36 + Math.random() * 15, Math.random() * 1024, 2 + Math.random() * 3, 2 + Math.random() * 3);
        ctx.fillRect(
          1024 - 51 + Math.random() * 15,
          Math.random() * 1024,
          2 + Math.random() * 3,
          2 + Math.random() * 3,
        );
      }
      ctx.globalAlpha = 1.0;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 48); // tile tightly along track ribbon
    return tex;
  }

  private createAsphaltBumpTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // flat middle level
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, 512, 512);

      // high frequency bump aggregates noise
      for (let i = 0; i < 22000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = Math.random() * 1.6;
        const gray = Math.floor(Math.random() * 90) + 110; // high contrast white-grey aggregates
        ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
        ctx.fillRect(x, y, size, size);
      }

      // crack recesses (black recessed grooves)
      ctx.strokeStyle = "#222222";
      ctx.lineWidth = 1.5;
      for (let c = 0; c < 4; c++) {
        let cx = Math.random() * 512;
        let cy = Math.random() * 512;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let s = 0; s < 10; s++) {
          cx += Math.random() * 16 - 8;
          cy += Math.random() * 18 + 5;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 48);
    return tex;
  }

  private createShoulderTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, 512, 512);

      // 1. Curb Strip (U: 0 to 180 pixels / ~35% width)
      // Alternating concrete red and white blocks with joint shadow lines
      const bs = 32; // height of block block
      for (let y = 0; y < 512; y += bs) {
        const isRed = Math.floor(y / bs) % 2 === 0;

        ctx.fillStyle = isRed ? "#bc473a" : "#dcdfe3"; // red vs concrete white
        ctx.fillRect(0, y, 160, bs);

        // Concrete grain shading noise
        ctx.fillStyle = isRed ? "#9a3528" : "#bbbfc3";
        for (let n = 0; n < 30; n++) {
          ctx.fillRect(Math.random() * 160, y + Math.random() * bs, 2, 2);
        }

        // Joint shadow line
        ctx.fillStyle = "rgba(10, 10, 12, 0.45)";
        ctx.fillRect(0, y + bs - 2, 160, 2);
      }

      // Curb border side bevel shadow groove
      ctx.fillStyle = "rgba(5, 5, 5, 0.85)";
      ctx.fillRect(158, 0, 6, 512);

      // 2. Rough Gravel shoulder strip (U: 161 to 380 pixels / ~45% width)
      ctx.fillStyle = "#7a6a58"; // stone brown-grey
      ctx.fillRect(164, 0, 220, 512);

      // rough gravel noise stones
      for (let i = 0; i < 9000; i++) {
        const x = 164 + Math.random() * 220;
        const y = Math.random() * 512;
        const size = 1.0 + Math.random() * 2.8;
        const gr = Math.floor(Math.random() * 40) + 70; // stone colors variation
        ctx.fillStyle = `rgb(${gr + 20}, ${gr + 12}, ${gr})`;
        ctx.fillRect(x, y, size, size);
      }

      // 3. Grass blending transition (U: 381 to 512 pixels / ~20% width)
      // Use alpha gradient in combination with canvas clearing to generate true blending transparent fade!
      const pGrad = ctx.createLinearGradient(370, 0, 512, 0);
      pGrad.addColorStop(0, "#7a6a58");
      pGrad.addColorStop(0.15, "#5c6c40"); // transitional green-brown grass
      pGrad.addColorStop(0.55, "#3e502c"); // dense mountain grass green
      pGrad.addColorStop(1.0, "rgba(62, 80, 44, 0)"); // fade out 100% to blend cleanly onto terrainMesh beneath!

      // We set composite destination-out on transparency sectors
      ctx.fillStyle = pGrad;
      ctx.fillRect(370, 0, 142, 512);

      // Sprinkle noise dots along grass border
      ctx.fillStyle = "rgba(62, 80, 44, 0.6)";
      for (let i = 0; i < 2000; i++) {
        const x = 370 + Math.random() * 110;
        const y = Math.random() * 512;
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 48);
    return tex;
  }
}
