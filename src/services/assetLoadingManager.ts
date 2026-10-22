/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { db, auth } from "../lib/firebase";
import { doc, updateDoc, runTransaction, serverTimestamp, getDoc } from "firebase/firestore";
import { AssetManager } from "./AssetManager";
import { gltfModelCache, GLTFMaterialsPBRSpecularGlossinessExtension } from "../world/procedural";
import { applyGltfMaterialFix } from "../utils/gltfMaterialFix";
import { RoomManager } from "../multiplayer/RoomManager";
import { NormalRoomService } from "../multiplayer/NormalRoomService";
import { RoomState } from "../multiplayer/RoomState";
import { loadRacingMap } from "./racingMapAsset";

/**
 * Validates and checks if a specific map GLB asset is ready, downloading and caching it in parallel if missing.
 */
export async function verifyMap(selectedMap: string, onProgress?: (percent: number) => void): Promise<boolean> {
  const activeMapId = selectedMap || "map1";
  const isCustomMap = activeMapId === "race2map" || activeMapId === "racing2";

  if (!isCustomMap) {
    if (onProgress) onProgress(100);
    return true;
  }

  await loadRacingMap((progress) => onProgress?.(progress.percentage));
  onProgress?.(100);
  return true;
}

/**
 * Normalizes car identifier string.
 */
export function getNormalizedCarKey(carId: string): string {
  const cid = carId || "ferrari";
  if (cid.toLowerCase().includes("porsche")) return "porsche_911_gt3";
  if (cid.toLowerCase().includes("bugatti")) return "bugatti_chiron_top_edition";
  return "ferrari_purosangue";
}

/**
 * Validates and checks if a specific vehicle GLB is ready, downloading and caching it in parallel if missing.
 */
export async function verifyCar(selectedCar: string, onProgress?: (percent: number) => void): Promise<boolean> {
  const carMapKey = getNormalizedCarKey(selectedCar);
  console.log(`[AssetLoadingManager] Verifying vehicle model for key: ${carMapKey}`);

  // Check if already loaded in Three.js gltfModelCache
  if (gltfModelCache[carMapKey as keyof typeof gltfModelCache]) {
    console.log(`[AssetLoadingManager] Vehicle ${carMapKey} already in Three.js gltfModelCache.`);
    if (onProgress) onProgress(100);
    return true;
  }

  try {
    let blob = await AssetManager.getVerifiedBlob(carMapKey);

    if (!blob) {
      console.log(`[AssetLoadingManager] ${carMapKey} not cached locally, streaming from CDN...`);
      const asset = AssetManager.getAssets().find((a) => a.id === carMapKey);
      if (!asset) {
        throw new Error(`Car asset mapping missing for ${carMapKey}`);
      }

      blob = await AssetManager.downloadAsset(carMapKey, (prog) => {
        if (onProgress) {
          onProgress(Math.min(99, prog.percentage));
        }
      });
    } else {
      if (onProgress) onProgress(99);
    }

    if (blob) {
      const buffer = await blob.arrayBuffer();
      const loader = new GLTFLoader();
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
      loader.setDRACOLoader(dracoLoader);
      loader.register((parser) => new GLTFMaterialsPBRSpecularGlossinessExtension(parser));

      await new Promise<void>((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          try { dracoLoader.dispose(); } catch {}
          reject(new Error(`Vehicle GLB parsing timed out for ${carMapKey}`));
        }, 30000);

        loader.parse(
          buffer,
          "",
          (gltf) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
              applyGltfMaterialFix(gltf.scene);
              (gltfModelCache as any)[carMapKey] = gltf.scene;
              gltfModelCache.isLoaded = true;
              dracoLoader.dispose();
              console.log(`[AssetLoadingManager] Successfully parsed and cached GLB model: ${carMapKey}`);
              resolve();
            } catch (err) {
              dracoLoader.dispose();
              reject(err);
            }
          },
          (err) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            dracoLoader.dispose();
            reject(err);
          }
        );
      });
      onProgress?.(100);
      return true;
    } else {
      throw new Error(`Failed to download or load GLB for ${carMapKey}`);
    }
  } catch (err) {
    console.error(`[AssetLoadingManager] Vehicle GLB initialization failed for ${carMapKey}:`, err);
    throw err;
  }
}

/**
 * Updates player precise multi-stage loading progress and status in Firestore.
 */
export async function updateLoadingProgress(
  roomCode: string,
  playerId: string,
  progress: number,
  stage: string,
  extraStatus?: any
): Promise<void> {
  const cleanCode = roomCode.toUpperCase().trim();
  console.log(`[AssetLoadingManager] Updating loading progress for player ${playerId} in room ${cleanCode} to ${progress}%`);

  const status = {
    loadingProgress: progress,
    loadingStage: stage,
    ...extraStatus
  };

  await NormalRoomService.updatePlayerLoadingStatus(cleanCode, playerId, status);
}

/**
 * Updates player ready status in Firestore.
 */
export async function updatePlayerReady(roomCode: string, playerId: string, ready: boolean): Promise<void> {
  const cleanCode = roomCode.toUpperCase().trim();
  console.log(`[AssetLoadingManager] Setting ready status for ${playerId} in room ${cleanCode} to ${ready}`);
  await NormalRoomService.updatePlayerLoadingStatus(cleanCode, playerId, {
    ready: ready,
    sceneReady: ready,
    connected: true
  });
}

/**
 * Waits for all human players in the room to finish loading.
 */
export async function waitForAllPlayersReady(roomCode: string): Promise<boolean> {
  try {
    const players = NormalRoomService.getCachedPlayers();
    const humans = players.filter((p) => !p.isAI);

    if (humans.length === 0) return false;

    return humans.every((p) => p.mapDownloaded && p.carReady && p.sceneReady && p.ready);
  } catch (err) {
    console.error("[AssetLoadingManager] Error waiting for players:", err);
    return false;
  }
}

/**
 * Transitions room status to countdown.
 */
export async function startCountdown(roomCode: string): Promise<void> {
  const cleanCode = roomCode.toUpperCase().trim();
  console.log(`[AssetLoadingManager] Initiating countdown for room: ${cleanCode}`);
  await NormalRoomService.setRoomStatus(cleanCode, "countdown");
}

/**
 * Synchronize multiplayer asset loading so every player enters the race
 * only after BOTH the selected map and selected GLB car are fully ready.
 */
export async function initializeAssetLoading(
  roomCode: string,
  playerId?: string,
  selectedMap?: string,
  selectedCar?: string,
  onProgress?: (stage: string, percent: number) => void
): Promise<void> {
  const activeRoomCode = roomCode.toUpperCase().trim();
  const activePlayerId = playerId || auth.currentUser?.uid || RoomManager.getCurrentPlayerId();

  if (!activePlayerId) {
    console.error("[AssetLoadingManager] Active Player ID is required but undefined!");
    return;
  }

  // If map and car IDs are not passed, fetch them from the cached room state
  let mapId = selectedMap;
  let carId = selectedCar;

  if (!mapId || !carId) {
    const room = NormalRoomService.getCachedRoom();
    if (room) {
      mapId = mapId || room.mapId || "map1";
      carId = carId || room.selectedCar || "ferrari";

      const playersList = NormalRoomService.getCachedPlayers();
      const localP = playersList.find((p: any) => p.uid === activePlayerId || p.id === activePlayerId);
      if (localP && localP.carId) {
        carId = localP.carId;
      }
    }
  }

  // Default fallbacks if still missing
  mapId = mapId || "map1";
  carId = carId || "ferrari";

  console.log(`[AssetLoadingManager] Starting parallel assets load for Room ${activeRoomCode}, Player ${activePlayerId}: Map: ${mapId}, Car: ${carId}`);

  let mapProgress = 0;
  let carProgress = 0;

  const updateOverall = async () => {
    const overallPct = Math.round((mapProgress + carProgress) / 2);
    const stage = `Map: ${mapProgress}% | Car: ${carProgress}%`;
    if (onProgress) {
      onProgress(stage, overallPct);
    }

    try {
      await updateLoadingProgress(activeRoomCode, activePlayerId, overallPct, stage, {
        mapProgress,
        carProgress,
        mapReady: mapProgress >= 100,
        carReady: carProgress >= 100,
      });
    } catch (e) {
      console.error("[AssetLoadingManager] Failed to update overall progress:", e);
    }
  };

  // Run BOTH verify tasks in parallel
  await Promise.all([
    verifyMap(mapId, async (pct) => {
      mapProgress = pct;
      await updateOverall();
    }),
    verifyCar(carId, async (pct) => {
      carProgress = pct;
      await updateOverall();
    })
  ]);

  console.log(`[AssetLoadingManager] Parallel tasks finished. Map verified: ${mapProgress >= 100}, Car verified: ${carProgress >= 100}`);

  // The renderer must confirm sceneReady/ready after road physics and cars exist.
  await NormalRoomService.updatePlayerLoadingStatus(activeRoomCode, activePlayerId, {
    mapReady: true, mapProgress: 100, carReady: true, carProgress: 100,
  });
}
