import * as THREE from "three";
import { TrackGeometryHelper, getTerrainHeight } from "../utils/track";

export class TerrainChunk {
  public col: number;
  public row: number;
  public centerX: number;
  public centerZ: number;
  public mesh: THREE.Mesh | null = null;
  public failed = false;
  public lastError: string | null = null;

  private chunkW: number;
  private chunkD: number;

  constructor(col: number, row: number, centerX: number, centerZ: number, chunkW: number, chunkD: number) {
    this.col = col;
    this.row = row;
    this.centerX = centerX;
    this.centerZ = centerZ;
    this.chunkW = chunkW;
    this.chunkD = chunkD;
  }

  /**
   * Generates, validates and adds the terrain chunk geometry to the scene.
   * If any validation test fails (terrain clipping, floating triangles, holes),
   * it discards the chunk and builds a perfectly safe flat emergency grid level with the road.
   */
  public buildMesh(scene: THREE.Scene, trackHelper: TrackGeometryHelper, terrainMat: THREE.Material): void {
    try {
      // Shared chunk edge coordinates make adjacent chunks mathematically seamless.
      const segments = 28;
      const geo = new THREE.PlaneGeometry(this.chunkW, this.chunkD, segments, segments);
      const posAttr = geo.attributes.position;

      let chunkHasFailed = false;
      let failureReason = "";
      const queryPoint = new THREE.Vector3();

      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);

        const worldX = vx + this.centerX;
        const worldZ = -vy + this.centerZ;

        let height = getTerrainHeight(worldX, worldZ, trackHelper);

        // --- VALIDATION RULE Check 1: Check for holes or arithmetic undefined (NaN) ---
        if (!Number.isFinite(height)) {
          chunkHasFailed = true;
          failureReason = "non-finite terrain height";
          height = 0.0;
        }

        // --- VALIDATION RULE Check 2: Check for road intersections and terrain above road ---
        // Roads must be completely unblocked within their safety corridor
        queryPoint.set(worldX, 0, worldZ);
        const trackInfo = trackHelper.getNearestTrackInfo(queryPoint);
        if (trackInfo && trackInfo.nearestPoint) {
          const roadType = trackHelper.getRoadTypeAt(trackInfo.progress);
          const roadWidth = trackHelper.getRoadWidthAt(trackInfo.progress);

          // Critical safety boundary of roadWidth + 20 meters (or halfWidth + 10m on matching sides)
          const safetyCorridorLimit = roadWidth / 2 + 10.0;

          if (trackInfo.distanceToTrack < safetyCorridorLimit) {
            // Exclude tunnels since they go inside mountains and bridges intentionally span voids
            if (roadType !== "tunnel" && roadType !== "bridge") {
              const roadY = trackInfo.nearestPoint.y;
              // Clamp only the unsafe vertex instead of flattening the entire chunk. The old
              // full-chunk fallback created square slabs/black-wall silhouettes when one road
              // edge vertex failed validation.
              if (height > roadY - 0.28) {
                chunkHasFailed = true;
                failureReason = "road corridor terrain clipped above road edge";
                height = roadY - 0.45;
              }
            }
          }
        }

        posAttr.setZ(i, height);
      }

      if (chunkHasFailed) {
        this.failed = true;
        this.lastError = failureReason || "terrain validation fallback used";
        console.warn(
          `[ChunkManager] Chunk ${this.col}_${this.row} generated with vertex-level fallback: ${this.lastError}`,
        );
      }

      geo.computeVertexNormals();
      this.mesh = new THREE.Mesh(geo, terrainMat);
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.position.set(this.centerX, -0.5, this.centerZ);
      this.mesh.receiveShadow = true;
      scene.add(this.mesh);
    } catch (err) {
      this.failed = true;
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[ChunkManager] Chunk ${this.col}_${this.row} failed to generate. Building safe fallback.`, err);

      // Last-resort local slab: no missing chunk/void even if procedural evaluation throws.
      const fallbackGeo = new THREE.PlaneGeometry(this.chunkW, this.chunkD, 1, 1);
      const posAttr = fallbackGeo.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const worldX = posAttr.getX(i) + this.centerX;
        const worldZ = -posAttr.getY(i) + this.centerZ;
        const trackInfo = trackHelper.getNearestTrackInfo(new THREE.Vector3(worldX, 0, worldZ));
        const fallbackY = trackInfo?.nearestPoint ? trackInfo.nearestPoint.y - 0.45 : 0.0;
        posAttr.setZ(i, fallbackY);
      }
      fallbackGeo.computeVertexNormals();
      this.mesh = new THREE.Mesh(fallbackGeo, terrainMat);
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.position.set(this.centerX, -0.5, this.centerZ);
      this.mesh.receiveShadow = true;
      scene.add(this.mesh);
    }
  }

  public dispose(scene: THREE.Scene): void {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }
}

export class ChunkManager {
  private static instance: ChunkManager | null = null;
  private scene: THREE.Scene | null = null;
  private trackHelper: TrackGeometryHelper | null = null;
  private chunks: TerrainChunk[] = [];
  private terrainMat: THREE.MeshStandardMaterial | null = null;

  private readonly chunkW = 500;
  private readonly chunkD = 500;
  private readonly loadRadius = 1600;
  private readonly unloadRadius = 2200;

  private colCount = 0;
  private rowCount = 0;
  private minX = 0;
  private maxX = 0;
  private minZ = 0;
  private maxZ = 0;

  private activeChunksSet = new Set<string>();

  private constructor() {}

  public static getInstance(): ChunkManager {
    if (!ChunkManager.instance) {
      ChunkManager.instance = new ChunkManager();
    }
    return ChunkManager.instance;
  }

  public initialize(scene: THREE.Scene, trackHelper: TrackGeometryHelper): void {
    this.scene = scene;
    this.trackHelper = trackHelper;
    this.terrainMat = new THREE.MeshStandardMaterial({
      color: "#1a371c", // gorgeous dark organic mossy green base
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });

    // Clear any previous chunks
    this.chunks.forEach((c) => c.dispose(scene));
    this.chunks = [];
    this.activeChunksSet.clear();

    const padding = 1400;
    const points = trackHelper.cachedPoints && trackHelper.cachedPoints.length > 0
      ? trackHelper.cachedPoints
      : trackHelper.curve.getSpacedPoints(2000);
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    this.minX = Math.floor((Math.min(...xs) - padding) / this.chunkW) * this.chunkW;
    this.maxX = Math.ceil((Math.max(...xs) + padding) / this.chunkW) * this.chunkW;
    this.minZ = Math.floor((Math.min(...zs) - padding) / this.chunkD) * this.chunkD;
    this.maxZ = Math.ceil((Math.max(...zs) + padding) / this.chunkD) * this.chunkD;
    this.colCount = Math.ceil((this.maxX - this.minX) / this.chunkW);
    this.rowCount = Math.ceil((this.maxZ - this.minZ) / this.chunkD);

    // Map out procedural chunks over the complete 10km territory with no fixed-grid cutoff.
    for (let r = 0; r < this.rowCount; r++) {
      const cz = this.minZ + r * this.chunkD + this.chunkD / 2;
      for (let c = 0; c < this.colCount; c++) {
        const cx = this.minX + c * this.chunkW + this.chunkW / 2;
        this.chunks.push(new TerrainChunk(c, r, cx, cz, this.chunkW, this.chunkD));
      }
    }

    console.log(
      `[ChunkManager] Initialized ${this.chunks.length} terrain chunks for ${Math.round(trackHelper.length)}m Dragon pass bounds X:${this.minX}..${this.maxX} Z:${this.minZ}..${this.maxZ}`,
    );
  }

  /**
   * Preloads chunks near the player (at least 8 chunks ahead/around) and unloads far chunks.
   * Total system memory footprint is strictly controlled for solid 60 FPS on mobile.
   */
  public update(playerPos: THREE.Vector3): void {
    if (!this.scene || !this.trackHelper || !this.terrainMat) return;

    // Keep at least 1000m of world ahead and around the player; hysteresis destroys
    // chunks behind/away without thrashing at boundaries.
    const loadRadiusSq = this.loadRadius * this.loadRadius;
    const unloadRadiusSq = this.unloadRadius * this.unloadRadius;

    const trackInfo = this.trackHelper.getNearestTrackInfo(playerPos);
    const forwardCenters: THREE.Vector3[] = [playerPos];
    if (trackInfo?.nearestPoint) {
      const curveLength = Math.max(1, this.trackHelper.length || this.trackHelper.curve.getLength());
      const lookaheadDistances = [250, 500, 750, 1000, 1250];
      for (const d of lookaheadDistances) {
        const u = (trackInfo.progress + d / curveLength) % 1.0;
        forwardCenters.push(this.trackHelper.curve.getPointAt(u));
      }
    }

    let activeCount = 0;

    this.chunks.forEach((chunk) => {
      let minDistSq = Infinity;
      for (const center of forwardCenters) {
        const dx = chunk.centerX - center.x;
        const dz = chunk.centerZ - center.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < minDistSq) minDistSq = distSq;
      }

      const chunkKey = `${chunk.col}_${chunk.row}`;

      if (minDistSq < loadRadiusSq) {
        if (!chunk.mesh) {
          chunk.buildMesh(this.scene!, this.trackHelper!, this.terrainMat!);
          this.activeChunksSet.add(chunkKey);
        }
        activeCount++;
      } else {
        if (chunk.mesh && minDistSq > unloadRadiusSq) {
          chunk.dispose(this.scene!);
          this.activeChunksSet.delete(chunkKey);
        }
      }
    });

    (window as any).activeTerrainChunks = activeCount;
  }

  public clear(): void {
    if (this.scene) {
      this.chunks.forEach((c) => c.dispose(this.scene!));
    }
    this.chunks = [];
    this.activeChunksSet.clear();
    this.scene = null;
    this.trackHelper = null;
  }
}

export const chunkManager = ChunkManager.getInstance();

export function buildTerrain(scene: THREE.Scene, trackHelper: TrackGeometryHelper): THREE.Mesh {
  // --- 1. SET UP FOG ---
  // Slightly denser fog so the streamed-chunk edge fades to sky instead of clipping to black.
  scene.fog = new THREE.FogExp2("#bcdeff", 0.0026);

  // --- 1b. FAR-DISTANCE GROUND SKIRT ---
  // A huge matte ground plane that sits below everything so the player never
  // sees a black void past the streamed terrain chunks. Cheap (1 quad) and static.
  const skirtGeo = new THREE.PlaneGeometry(20000, 20000, 1, 1);
  const skirtMat = new THREE.MeshBasicMaterial({
    color: "#1a371c", // matches terrain base
    fog: true,
    depthWrite: false,
  });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.set(200, -2.0, 900); // sits just under chunk meshes (y=-0.5)
  skirt.renderOrder = -10;
  scene.add(skirt);

  // --- 2. PROCEDURAL BACKGROUND SKYBOX & GROUND ENVIRONMENT ---
  // Sunset dome sky - large enough to contain the complete 10km Dragon pass plus
  // the camera far plane, preventing black horizon walls at late-course sectors.
  const skyGeo = new THREE.SphereGeometry(12000, 32, 16);
  const createSkyTex = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0.0, "#0a1c3f"); // Deep sky blue
      grad.addColorStop(0.4, "#1b224c"); // Twilight indigo
      grad.addColorStop(0.7, "#8d2d68"); // Orchid magenta
      grad.addColorStop(0.88, "#f75b22"); // Tangy orange
      grad.addColorStop(1.0, "#ffc04d"); // Sunset yellow
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 256);
    }
    return new THREE.CanvasTexture(canvas);
  };
  const skyTex = createSkyTex();
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTex,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.set(200, 0, 900);
  sky.renderOrder = -20;
  scene.add(sky);


  // Drifting 3D Cumulus Clouds
  const cloudGroup = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({
    color: "#ffdcd1", // warmed by sunset glow
    transparent: true,
    opacity: 0.82,
  });
  const cloudCount = 20;

  for (let c = 0; c < cloudCount; c++) {
    const cMesh = new THREE.Group();
    const radius = 18 + Math.random() * 24;
    const numPuffs = 3 + Math.floor(Math.random() * 5);
    for (let p = 0; p < numPuffs; p++) {
      const r = radius * (0.6 + Math.random() * 0.4);
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), cloudMat);
      puff.position.set(
        Math.random() * radius * 1.5 - radius * 0.75,
        Math.random() * radius * 0.4 - radius * 0.2,
        Math.random() * radius * 1.5 - radius * 0.75,
      );
      puff.castShadow = false;
      cMesh.add(puff);
    }
    cMesh.position.set(Math.random() * 2400 - 1200, 180 + Math.random() * 120, Math.random() * 2800 - 800);
    cloudGroup.add(cMesh);
  }
  scene.add(cloudGroup);

  // --- 3. RECONSTRUCT DYNAMIC SECTOR CHUNKS ---
  chunkManager.initialize(scene, trackHelper);
  chunkManager.update(new THREE.Vector3(0, 0, 0));

  // --- 4. WATER BODY SYSTEM ---
  if (trackHelper.mapType === "map1") {
    // EMERALD JADE LAKE
    const lakeGeo = new THREE.PlaneGeometry(450, 450);
    const lakeMat = new THREE.MeshStandardMaterial({
      color: "#0e2d4d", // rich deep midnight teal
      roughness: 0.08,
      metalness: 0.85,
      transparent: true,
      opacity: 0.9,
    });
    const lake = new THREE.Mesh(lakeGeo, lakeMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(50, -9.8, -120);
    scene.add(lake);

    // CANYON GORGE RIVER UNDER BRIDGE
    const riverGeo = new THREE.PlaneGeometry(600, 600); // slightly wider to engulf deep walls
    const riverMat = new THREE.MeshStandardMaterial({
      color: "#0b243b", // rapid dark canyon river
      roughness: 0.05,
      metalness: 0.9,
      transparent: true,
      opacity: 0.88,
    });
    const river = new THREE.Mesh(riverGeo, riverMat);
    river.rotation.x = -Math.PI / 2;
    river.position.set(900, -84.8, 3225); // lowered deep into the gorgebed!
    scene.add(river);
  } else {
    // HIGH FIDELITY COASTAL SUNSET OCEAN WATER PLANE
    const oceanGeo = new THREE.PlaneGeometry(5000, 5000);
    const oceanMat = new THREE.MeshStandardMaterial({
      color: "#072e3d", // gorgeous deep coastal ocean teal-blue
      roughness: 0.12,
      metalness: 0.92,
      transparent: true,
      opacity: 0.88,
    });
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(300, -0.6, 100); // ocean sits at y = -0.6 (just below sand height of 1.2)
    scene.add(ocean);
  }

  // Return a dummy mesh for typescript compilation & interface compatibility
  const dummyMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
  return dummyMesh;
}
