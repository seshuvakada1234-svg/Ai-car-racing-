import * as THREE from "three";
import { TrackGeometryHelper, getTerrainHeight } from "../utils/track";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MemoryPool } from "../utils/memoryPool";

// Inject robust self-healing accelerated raycast into Three.js Mesh prototype
const originalMeshRaycast = THREE.Mesh.prototype.raycast;
THREE.Mesh.prototype.raycast = function (this: THREE.Mesh, raycaster, intersects) {
  try {
    return acceleratedRaycast.call(this, raycaster, intersects);
  } catch (err) {
    try {
      if (originalMeshRaycast) {
        return originalMeshRaycast.call(this, raycaster, intersects);
      }
    } catch (fallbackErr) {}
  }
};

export class TerrainManager {
  private static instance: TerrainManager | null = null;
  public static initialized = false;

  private heightCache: Float32Array;
  private minX = -3000;
  private maxX = 3000;
  private minZ = -3200;
  private maxZ = 5000;
  private resolution = 8; // 8 meters grid step
  private cols: number;
  private rows: number;
  private trackHelper: TrackGeometryHelper | null = null;
  private roadHeightCache = new Map<number, { height: number | null; normal: THREE.Vector3 | null }>();

  public playerPos = new THREE.Vector3();

  // Async Chunked Generation Properties
  private generatedChunks = new Set<string>();
  private chunkQueue: { r: number; c: number; dist: number }[] = [];
  private isProcessingQueue = false;

  // BVH-accelerated road physics mesh
  private roadBVHMesh: THREE.Mesh | null = null;
  private roadMeshesCache: THREE.Object3D[] = [];
  private roadBounds = new THREE.Box3();
  private roadSurfaceSamples: THREE.Vector3[] = [];
  private externalRoadOnly = false;
  private staticColliderBoxes: THREE.Box3[] = [];

  private constructor() {
    this.cols = Math.ceil((this.maxX - this.minX) / this.resolution);
    this.rows = Math.ceil((this.maxZ - this.minZ) / this.resolution);
    this.heightCache = new Float32Array(this.cols * this.rows);
  }

  public static getInstance(): TerrainManager {
    if (!TerrainManager.instance) {
      TerrainManager.instance = new TerrainManager();
    }
    return TerrainManager.instance;
  }

  /**
   * Generates a single 64x64 terrain chunk.
   */
  public generateChunk(chunkRow: number, chunkCol: number): void {
    const key = `${chunkRow}_${chunkCol}`;
    if (this.generatedChunks.has(key)) return;
    this.generatedChunks.add(key);

    const startTime = performance.now();

    const chunkSize = 64;
    const startRow = chunkRow * chunkSize;
    const endRow = Math.min(this.rows, startRow + chunkSize);
    const startCol = chunkCol * chunkSize;
    const endCol = Math.min(this.cols, startCol + chunkSize);

    if (!this.trackHelper) return;

    for (let r = startRow; r < endRow; r++) {
      const z = this.minZ + r * this.resolution;
      const rowOffset = r * this.cols;
      for (let c = startCol; c < endCol; c++) {
        const x = this.minX + c * this.resolution;
        const height = getTerrainHeight(x, z, this.trackHelper);
        this.heightCache[rowOffset + c] = height;
      }
    }

    const duration = performance.now() - startTime;
    const streamingRadius = 1500; // 1.5km active streaming boundary radius
    console.log(
      `[TerrainManager] Generated Chunk ${key} in ${duration.toFixed(1)}ms. Active chunks: ${this.generatedChunks.size} | Queue remaining: ${this.chunkQueue.length} | Streaming Radius: ${streamingRadius}m`,
    );
  }

  /**
   * Ensures the specified chunk is generated immediately (on-demand fallback).
   */
  private ensureChunkGenerated(chunkRow: number, chunkCol: number): void {
    const key = `${chunkRow}_${chunkCol}`;
    if (!this.generatedChunks.has(key)) {
      // Remove from background queue if present to avoid redundant work
      const qIndex = this.chunkQueue.findIndex((item) => item.r === chunkRow && item.c === chunkCol);
      if (qIndex > -1) {
        this.chunkQueue.splice(qIndex, 1);
      }
      this.generateChunk(chunkRow, chunkCol);
    }
  }

  /**
   * Generates and freezes the heightmap cache once, completely removing runtime noise evaluation.
   */
  public initialize(trackHelper: TrackGeometryHelper): void {
    if (TerrainManager.initialized) {
      console.log("TerrainManager: Already initialized. Skipping heightbaking.");
      return;
    }
    TerrainManager.initialized = true;
    this.trackHelper = trackHelper;

    // Size the height cache from the actual active spline instead of the old fixed
    // rectangle. This keeps physics/road-height fallback valid across the complete
    // 10km Dragon pass and its streamed lookahead chunks.
    const padding = 1600;
    const points = trackHelper.cachedPoints && trackHelper.cachedPoints.length > 0
      ? trackHelper.cachedPoints
      : trackHelper.curve.getSpacedPoints(2000);
    if (points.length > 0) {
      const xs = points.map((p) => p.x);
      const zs = points.map((p) => p.z);
      this.minX = Math.floor((Math.min(...xs) - padding) / this.resolution) * this.resolution;
      this.maxX = Math.ceil((Math.max(...xs) + padding) / this.resolution) * this.resolution;
      this.minZ = Math.floor((Math.min(...zs) - padding) / this.resolution) * this.resolution;
      this.maxZ = Math.ceil((Math.max(...zs) + padding) / this.resolution) * this.resolution;
      this.cols = Math.ceil((this.maxX - this.minX) / this.resolution);
      this.rows = Math.ceil((this.maxZ - this.minZ) / this.resolution);
      this.heightCache = new Float32Array(this.cols * this.rows);
      this.generatedChunks.clear();
      this.chunkQueue = [];
      this.roadHeightCache.clear();
    }

    console.log("[TerrainManager] Initiating asynchronous chunked heightmap generation...");

    // 1. Determine player/start position
    let startX = 0;
    let startZ = 0;
    if (trackHelper.checkpoints && trackHelper.checkpoints.length > 0) {
      startX = trackHelper.checkpoints[0].position.x;
      startZ = trackHelper.checkpoints[0].position.z;
    }

    // 2. Build sorted queue of all chunks based on distance to player starting position
    const chunkSize = 64;
    const numChunkCols = Math.ceil(this.cols / chunkSize);
    const numChunkRows = Math.ceil(this.rows / chunkSize);

    const chunksList: { r: number; c: number; dist: number }[] = [];
    for (let r = 0; r < numChunkRows; r++) {
      const chunkZ = this.minZ + (r * chunkSize + chunkSize / 2) * this.resolution;
      for (let c = 0; c < numChunkCols; c++) {
        const chunkX = this.minX + (c * chunkSize + chunkSize / 2) * this.resolution;
        const dx = chunkX - startX;
        const dz = chunkZ - startZ;
        const dist = dx * dx + dz * dz;
        chunksList.push({ r, c, dist });
      }
    }

    // Sort: nearest chunks first
    chunksList.sort((a, b) => a.dist - b.dist);

    // 3. Immediately generate nearest chunks synchronously so player is spawned on correct ground instantly
    const immediateChunksCount = Math.min(12, chunksList.length);
    console.log(
      `[TerrainManager] Generating first ${immediateChunksCount} nearby chunks synchronously (< 15ms total)...`,
    );
    for (let i = 0; i < immediateChunksCount; i++) {
      const chunk = chunksList[i];
      this.generateChunk(chunk.r, chunk.c);
    }

    // 4. Queue remaining chunks for background loading
    this.chunkQueue = chunksList.slice(immediateChunksCount);
    this.startQueueProcessing();
  }

  /**
   * Racing 2 / GLB maps supply their own road mesh. In this mode the physics
   * system must never fall back to the procedural white/flat terrain plane.
   */
  public prepareExternalRoad(trackHelper: TrackGeometryHelper): void {
    TerrainManager.initialized = true;
    this.trackHelper = trackHelper;
    this.externalRoadOnly = true;
    this.roadHeightCache.clear();
    this.generatedChunks.clear();
    this.chunkQueue = [];
    this.isProcessingQueue = false;
    this.clearRoadBVH();
  }

  public hasRoadFor(trackHelper: TrackGeometryHelper): boolean {
    return this.trackHelper === trackHelper && this.roadMeshesCache.length > 0;
  }

  private clearRoadBVH(): void {
    if (this.roadBVHMesh) {
      this.roadBVHMesh.geometry.dispose();
      if (Array.isArray(this.roadBVHMesh.material)) {
        this.roadBVHMesh.material.forEach((m: any) => m.dispose());
      } else {
        this.roadBVHMesh.material.dispose();
      }
      this.roadBVHMesh = null;
    }
    this.roadMeshesCache = [];
    this.roadSurfaceSamples = [];
    this.roadBounds.makeEmpty();
    this.roadHeightCache.clear();
    this.staticColliderBoxes = [];
  }

  public bakeStaticColliderBounds(meshes: THREE.Object3D[], excluded: THREE.Object3D[] = []): void {
    const excludedSet = new Set(excluded);
    this.staticColliderBoxes = [];
    meshes.forEach((obj: any) => {
      if (!obj || excludedSet.has(obj) || !obj.isMesh) return;
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      const size = new THREE.Vector3();
      box.getSize(size);
      // Ignore enormous terrain/sky/decor planes and tiny props. This keeps the
      // GLB collider set limited to guard rails/walls/buildings/bridge solids.
      if (size.x * size.z > 12000 || size.x < 0.4 || size.z < 0.4 || size.y < 0.25) return;
      this.staticColliderBoxes.push(box.clone());
    });
    if (this.staticColliderBoxes.length > 400) {
      this.staticColliderBoxes.sort((a, b) => {
        const as = new THREE.Vector3();
        const bs = new THREE.Vector3();
        a.getSize(as);
        b.getSize(bs);
        return bs.x * bs.y * bs.z - as.x * as.y * as.z;
      });
      this.staticColliderBoxes.length = 400;
    }
  }

  public resolveStaticCollisions(car: any, radius = 1.65): boolean {
    if (!car?.position || this.staticColliderBoxes.length === 0) return false;
    let hit = false;
    for (let i = 0; i < this.staticColliderBoxes.length; i++) {
      const box = this.staticColliderBoxes[i];
      if (car.position.y < box.min.y - 1.0 || car.position.y > box.max.y + 3.0) continue;
      const closestX = THREE.MathUtils.clamp(car.position.x, box.min.x, box.max.x);
      const closestZ = THREE.MathUtils.clamp(car.position.z, box.min.z, box.max.z);
      const dx = car.position.x - closestX;
      const dz = car.position.z - closestZ;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;

      const d = Math.sqrt(Math.max(d2, 0.0001));
      let nx = dx / d;
      let nz = dz / d;
      if (!Number.isFinite(nx) || !Number.isFinite(nz)) {
        const cx = (box.min.x + box.max.x) * 0.5;
        const cz = (box.min.z + box.max.z) * 0.5;
        nx = car.position.x >= cx ? 1 : -1;
        nz = car.position.z >= cz ? 1 : -1;
      }
      const push = radius - d + 0.04;
      car.position.x += nx * push;
      car.position.z += nz * push;
      if (car.velocity) {
        const vn = car.velocity.x * nx + car.velocity.z * nz;
        if (vn < 0) {
          car.velocity.x -= (1.15 * vn) * nx;
          car.velocity.z -= (1.15 * vn) * nz;
        }
      }
      if (Number.isFinite(car.speed)) car.speed *= 0.72;
      hit = true;
    }
    return hit;
  }

  private startQueueProcessing(): void {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    const processNext = () => {
      if (this.chunkQueue.length === 0) {
        this.isProcessingQueue = false;
        console.log("[TerrainManager] All background terrain chunks successfully streamed!");
        return;
      }

      const nextChunk = this.chunkQueue.shift();
      if (nextChunk) {
        this.generateChunk(nextChunk.r, nextChunk.c);
      }

      // Yield frame computation to browser to maintain flawless 60/120 FPS
      requestAnimationFrame(() => {
        setTimeout(processNext, 16);
      });
    };

    requestAnimationFrame(processNext);
  }

  /**
   * Fast bilinear interpolation height querying in O(1) time
   */
  public getHeight(x: number, z: number): number {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) {
      // Never expose an artificial bedrock cliff/black wall at cache bounds. If a
      // streamed chunk asks beyond the baked cache, evaluate procedural terrain on
      // demand so the world remains continuous.
      if (this.trackHelper) {
        const fallback = getTerrainHeight(x, z, this.trackHelper);
        return Number.isFinite(fallback) ? fallback : 0.0;
      }
      return 0.0;
    }

    const cf = (x - this.minX) / this.resolution;
    const rf = (z - this.minZ) / this.resolution;

    const c0 = Math.floor(cf);
    const r0 = Math.floor(rf);

    // Dynamic stream fallback: ensure chunk is baked on demand
    const chunkSize = 64;
    const chunkRow0 = Math.floor(r0 / chunkSize);
    const chunkCol0 = Math.floor(c0 / chunkSize);
    this.ensureChunkGenerated(chunkRow0, chunkCol0);

    const c1 = Math.min(this.cols - 1, c0 + 1);
    const r1 = Math.min(this.rows - 1, r0 + 1);

    const chunkRow1 = Math.floor(r1 / chunkSize);
    const chunkCol1 = Math.floor(c1 / chunkSize);
    this.ensureChunkGenerated(chunkRow1, chunkCol1);

    const tx = cf - c0;
    const tz = rf - r0;

    const h00 = this.heightCache[r0 * this.cols + c0];
    const h10 = this.heightCache[r0 * this.cols + c1];
    const h01 = this.heightCache[r1 * this.cols + c0];
    const h11 = this.heightCache[r1 * this.cols + c1];

    // Bilinear interpolation
    const h0 = h00 * (1 - tx) + h10 * tx;
    const h1 = h01 * (1 - tx) + h11 * tx;

    return h0 * (1 - tz) + h1 * tz;
  }

  /**
   * Caches track road meshes and creates boundsTree BVH hierarchies on them
   */
  public bakeRoadMeshBVH(meshes: THREE.Object3D[], forceRebuild = false): void {
    if (forceRebuild) {
      this.clearRoadBVH();
    }
    if (this.roadBVHMesh) {
      return;
    }
    this.roadMeshesCache = [...meshes];

    const geometriesToMerge: THREE.BufferGeometry[] = [];
    const totalVerts = meshes.reduce((sum, m: any) => {
      const attr = m instanceof THREE.Mesh ? m.geometry?.attributes?.position : null;
      return sum + (attr ? attr.count : 0);
    }, 0);
    const sampleStride = Math.max(1, Math.floor(totalVerts / 12000));

    meshes.forEach((m) => {
      if (m instanceof THREE.Mesh) {
        m.updateMatrixWorld(true);
        const meshBounds = new THREE.Box3().setFromObject(m);
        if (!meshBounds.isEmpty()) this.roadBounds.union(meshBounds);

        const posAttr: any = m.geometry?.attributes?.position;
        if (posAttr) {
          const sample = new THREE.Vector3();
          for (let i = 0; i < posAttr.count; i += sampleStride) {
            sample.fromBufferAttribute(posAttr, i).applyMatrix4(m.matrixWorld);
            this.roadSurfaceSamples.push(sample.clone());
          }
        }

        const geom = m.geometry.clone();
        if (!geom.attributes.normal) {
          try {
            geom.computeVertexNormals();
          } catch (e) {}
        }
        // Keep only 'position' and 'normal' attributes to prevent mergeGeometries failing with differing attributes
        const attrKeys = Object.keys(geom.attributes);
        for (const key of attrKeys) {
          if (key !== "position" && key !== "normal") {
            geom.deleteAttribute(key);
          }
        }
        geom.applyMatrix4(m.matrixWorld);
        geometriesToMerge.push(geom);
      }
    });

    if (geometriesToMerge.length > 0) {
      try {
        let mergedGeom: THREE.BufferGeometry | null = null;
        if (geometriesToMerge.length === 1) {
          mergedGeom = geometriesToMerge[0];
        } else {
          mergedGeom = mergeGeometries(geometriesToMerge, false);
        }
        if (mergedGeom) {
          (mergedGeom as any).boundsTree = new MeshBVH(mergedGeom);
          this.roadBVHMesh = new THREE.Mesh(mergedGeom, new THREE.MeshBasicMaterial());
        }
      } catch (err) {
        console.warn("[TerrainManager] Combined road BVH failed; trying individual road meshes:", err);
        meshes.forEach((m) => {
          if (m instanceof THREE.Mesh && m.geometry) {
            try {
              (m.geometry as any).boundsTree = new MeshBVH(m.geometry);
            } catch (bvhErr) {
              console.error(`[TerrainManager] Road BVH failed for ${m.name}:`, bvhErr);
            }
          }
        });
      }
    }
  }

  /**
   * Executes accelerated raycast query
   */
  public queryRoadHeight(pos: any, outNormal?: THREE.Vector3): number | null {
    if (
      !pos ||
      typeof pos.x !== "number" ||
      typeof pos.y !== "number" ||
      typeof pos.z !== "number" ||
      isNaN(pos.x) ||
      isNaN(pos.y) ||
      isNaN(pos.z)
    ) {
      return null;
    }

    const qx = Math.round(pos.x * 5);
    const qy = Math.round((pos.y || 0) * 2);
    const qz = Math.round(pos.z * 5);
    // Include Y in the cache key. Racing 2 has bridges/tunnels and overlapping
    // road layers in X/Z; caching by X/Z alone can reuse a bridge height while
    // the car is in a tunnel (or vice versa), causing the suspension/contact
    // solver to pin the car and leave velocity at zero.
    const key = (qx * 73856093) ^ (qy * 83492791) ^ (qz * 19349663);

    if (this.roadHeightCache.has(key)) {
      const cached = this.roadHeightCache.get(key)!;
      if (outNormal && cached.normal) {
        outNormal.copy(cached.normal);
      }
      return cached.height;
    }

    try {
      // GLB tracks are often authored far above Y=0. Cast from above the full
      // road bounds so we always hit the highest drivable surface instead of
      // starting the ray underneath an elevated bridge/track section.
      const boundsMaxY = this.roadBounds && !this.roadBounds.isEmpty() ? this.roadBounds.max.y : pos.y + 20.0;
      const boundsMinY = this.roadBounds && !this.roadBounds.isEmpty() ? this.roadBounds.min.y : pos.y - 120.0;
      const originY = Math.max(pos.y + 20.0, boundsMaxY + 60.0);
      const rayOrigin = MemoryPool.getVector().set(pos.x, originY, pos.z);
      const rayDir = MemoryPool.getVector().set(0, -1, 0);
      const raycaster = MemoryPool.tempRay;
      raycaster.set(rayOrigin, rayDir);
      raycaster.near = 0.0;
      raycaster.far = Math.max(180.0, originY - boundsMinY + 80.0);
      // Do not use firstHitOnly on GLB tracks. Bridges/tunnels can overlap in XZ;
      // the highest hit may be a bridge deck while the car is inside a tunnel.
      // Gather all road hits and pick the drivable surface closest to the query Y.
      raycaster.firstHitOnly = false;

      let resultHeight: number | null = null;
      let resultNormal: THREE.Vector3 | null = null;

      const pickBestRoadHit = (intersections: any[]) => {
        if (!intersections || intersections.length === 0) return null;
        let best = intersections[0];
        let bestScore = Infinity;
        const queryY = Number.isFinite(pos.y) ? pos.y : intersections[0].point.y;
        
        // On Racing2 (external road), the query position is at chassis level,
        // so the actual road is expected around queryY - 0.38 (wheel radius).
        // Any hit above queryY - 0.1 is likely a wall, curb, or overhead bridge.
        const expectedRoadY = this.externalRoadOnly ? queryY - 0.38 : queryY;
        const aboveThreshold = this.externalRoadOnly ? queryY - 0.1 : queryY + 1.5;

        for (const hit of intersections) {
          if (!hit?.point) continue;
          const faceNormalY = Math.abs(hit.face?.normal?.y ?? 1);
          if (faceNormalY < 0.35) continue;
          
          const vertical = Math.abs(hit.point.y - expectedRoadY);
          const abovePenalty = hit.point.y > aboveThreshold ? 100.0 : 0.0;
          const score = vertical + abovePenalty;
          
          if (score < bestScore) {
            bestScore = score;
            best = hit;
          }
        }
        return best;
      };

      if (this.roadBVHMesh) {
        const best = pickBestRoadHit(raycaster.intersectObject(this.roadBVHMesh));
        if (best) {
          resultHeight = best.point.y;
          if (best.face) resultNormal = best.face.normal;
        }
      } else if (this.roadMeshesCache && this.roadMeshesCache.length > 0) {
        const best = pickBestRoadHit(raycaster.intersectObjects(this.roadMeshesCache, true));
        if (best) {
          resultHeight = best.point.y;
          if (best.face) resultNormal = best.face.normal;
        }
      }

      if (this.roadHeightCache.size > 8000) {
        this.roadHeightCache.clear();
      }
      this.roadHeightCache.set(key, {
        height: resultHeight,
        normal: resultNormal ? resultNormal.clone() : null,
      });

      if (outNormal && resultNormal) {
        outNormal.copy(resultNormal);
      }
      return resultHeight;
    } catch (e) {}
    return null;
  }

  /**
   * Safe wrapper that guarantees a valid, non-NaN, non-Infinity road height.
   * If road height query returns null/invalid, it falls back to lastValidY,
   * then to the nearest track spline point, then to terrain, then to bedrock.
   */
  public getRoadHeight(pos: any, lastValidY?: number): number {
    if (!pos || typeof pos.x !== "number" || typeof pos.z !== "number" || isNaN(pos.x) || isNaN(pos.z)) {
      if (lastValidY !== undefined && Number.isFinite(lastValidY) && !isNaN(lastValidY)) {
        return lastValidY;
      }
      return 0.0;
    }

    const queried = this.queryRoadHeight(pos);
    if (queried !== null && Number.isFinite(queried) && !isNaN(queried)) {
      return queried;
    }

    // External GLB maps must never use the procedural terrain/white plane as a
    // collision fallback. Prefer previous valid road height, then the extracted
    // spline/checkpoint height, and only finally a nearby road sample.
    if (this.externalRoadOnly) {
      if (lastValidY !== undefined && Number.isFinite(lastValidY) && !isNaN(lastValidY)) {
        return lastValidY;
      }
      if (this.trackHelper && typeof this.trackHelper.getNearestTrackInfo === "function") {
        try {
          const queryPos = MemoryPool.getVector().set(pos.x, pos.y || 0, pos.z);
          const nearestInfo = this.trackHelper.getNearestTrackInfo(queryPos);
          if (nearestInfo?.nearestPoint && Number.isFinite(nearestInfo.nearestPoint.y)) {
            return nearestInfo.nearestPoint.y;
          }
        } catch (e) {}
      }
      const nearestRoad = this.findNearestRoadSurface(pos, 120.0);
      if (nearestRoad) return nearestRoad.y;
      return Number.isFinite(this.roadBounds?.max?.y) ? this.roadBounds.max.y : 0.0;
    }

    // Fallback 1: Spline-based nearest track point height
    if (this.trackHelper && typeof this.trackHelper.getNearestTrackInfo === "function") {
      try {
        const queryPos = MemoryPool.getVector().set(pos.x, pos.y || 0, pos.z);
        const nearestInfo = this.trackHelper.getNearestTrackInfo(queryPos);
        if (
          nearestInfo &&
          nearestInfo.nearestPoint &&
          Number.isFinite(nearestInfo.nearestPoint.y) &&
          !isNaN(nearestInfo.nearestPoint.y)
        ) {
          return nearestInfo.nearestPoint.y;
        }
      } catch (e) {}
    }

    // Fallback 2: Terrain height
    const tHeight = this.getHeight(pos.x, pos.z);
    if (Number.isFinite(tHeight) && !isNaN(tHeight)) {
      return tHeight;
    }

    // Fallback 3: lastValidY
    if (lastValidY !== undefined && Number.isFinite(lastValidY) && !isNaN(lastValidY)) {
      return lastValidY;
    }

    // Ultimate fallback
    return 0.0;
  }

  public findNearestRoadSurface(pos: any, maxRadius = 120.0): THREE.Vector3 | null {
    if (!pos || this.roadSurfaceSamples.length === 0) return null;
    let best: THREE.Vector3 | null = null;
    let bestD = maxRadius * maxRadius;
    for (let i = 0; i < this.roadSurfaceSamples.length; i++) {
      const p = this.roadSurfaceSamples[i];
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? best.clone() : null;
  }

  public resolveRoadSurfacePosition(pos: any, maxRadius = 160.0): THREE.Vector3 | null {
    if (!pos) return null;
    const base = new THREE.Vector3(pos.x || 0, pos.y || 0, pos.z || 0);
    const hit = this.queryRoadHeight(base);
    if (hit !== null && Number.isFinite(hit)) {
      base.y = hit;
      return base;
    }
    return this.findNearestRoadSurface(base, maxRadius);
  }

  /**
   * Gets the surface normal at the road. Falls back to track helper spline normals.
   */
  public getRoadNormal(pos: any, outNormal?: THREE.Vector3): THREE.Vector3 {
    const normal = outNormal || new THREE.Vector3(0, 1, 0);
    if (!pos) return normal;

    const tempNormal = new THREE.Vector3();
    this.queryRoadHeight(pos, tempNormal);
    if (tempNormal.lengthSq() > 0.1) {
      normal.copy(tempNormal);
    } else if (this.trackHelper) {
      try {
        const queryPos = MemoryPool.getVector().set(pos.x, pos.y || 0, pos.z);
        const nearestInfo = this.trackHelper.getNearestTrackInfo(queryPos);
        if (nearestInfo && nearestInfo.normal) {
          normal.copy(nearestInfo.normal);
        }
      } catch (e) {}
    }
    return normal;
  }

  /**
   * Evaluates how far off-road a position is (0.0 means on-road, 1.0 means fully off-road).
   */
  public getOffRoadFactor(pos: any): number {
    if (!pos || !this.trackHelper) return 0.0;
    try {
      const queryPos = MemoryPool.getVector().set(pos.x, pos.y || 0, pos.z);
      const nearestInfo = this.trackHelper.getNearestTrackInfo(queryPos);
      const shoulderStart = nearestInfo.width / 2 - 1.8;
      if (Math.abs(nearestInfo.sideOffset) > shoulderStart) {
        return Math.min(1.0, (Math.abs(nearestInfo.sideOffset) - shoulderStart) / 1.35);
      }
    } catch (e) {}
    return 0.0;
  }

  /**
   * Checks if a position is considered off-road.
   */
  public isOffRoad(pos: any): boolean {
    return this.getOffRoadFactor(pos) > 0.0;
  }

  public clear(): void {
    TerrainManager.initialized = false;
    this.clearRoadBVH();
    this.trackHelper = null;
    this.externalRoadOnly = false;
  }
}

export const terrainManager = TerrainManager.getInstance();
