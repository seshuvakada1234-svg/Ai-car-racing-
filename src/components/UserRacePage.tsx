// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useMultiplayer } from "../hooks/useMultiplayer";
import { RoomManager } from "../multiplayer/RoomManager";
import { TrackGeometryHelper } from "../utils/track";
import { GamePhysicsService } from "../physics/GamePhysics";
import { GameCanvas } from "./GameCanvas";
import { HUD } from "./HUD";
import { RoomCodeHUD } from "./RoomCodeHUD";
import { GameOver } from "./GameOver";
import { ErrorBoundary } from "./ErrorBoundary";
import { terrainManager } from "../world/TerrainManager";
import { setPlayerSelectedModelKey, loadSpecificCarModel, gltfModelCache, GLTFMaterialsPBRSpecularGlossinessExtension } from "../world/procedural";
import { AssetManager } from "../services/AssetManager";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { applyGltfMaterialFix } from "../utils/gltfMaterialFix";
import { SyncManager } from "../multiplayer/SyncManager";
import { db } from "../lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { Loader2, Compass, CheckCircle2, AlertTriangle, LogOut } from "lucide-react";
import * as THREE from "three";
import { GameSettings, CarState, ControlsState, GamePhase } from "../types";
import { MultiplayerRaceLoadingScreen } from "./MultiplayerRaceLoadingScreen";
import { NormalRoomService } from "../multiplayer/NormalRoomService";
import { connectVehicleSocket, sendVehicleUpdate, triggerWsStartRace } from "../network/vehicleSocket";
import {
  initializeRaceStartSync,
  updatePlayerReady,
  startCountdown,
  waitForCountdown,
  beginRace,
  getSynchronizedServerTime,
} from "../multiplayer/multiplayerRaceStartSync";

const getCarIdString = (carValue: any): string => {
  if (!carValue) return "ferrari";
  if (typeof carValue === "string") return carValue;
  if (typeof carValue === "object") {
    if (carValue.id && typeof carValue.id === "string") return carValue.id;
    if (carValue.carId && typeof carValue.carId === "string") return carValue.carId;
  }
  return "ferrari";
};

export const RaceScene: React.FC = () => {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const normalizedCode = (roomCode || "").trim().toUpperCase();

  // Ensure RoomManager and storage are synchronized on page load/mount
  useEffect(() => {
    if (normalizedCode) {
      RoomManager.currentRoomCode = normalizedCode;
      try {
        localStorage.setItem("activeRoomCode", normalizedCode);
        sessionStorage.setItem("last_room_code", normalizedCode);
      } catch (e) {
        console.warn("Storage write failed", e);
      }
    }
  }, [normalizedCode]);

  const mp = useMultiplayer();

  // Logging and timeout state for initialization
  const [initLogs, setInitLogs] = useState({
    connectedToRoom: "pending",
    firestoreRoomLoaded: "pending",
    websocketConnected: "success", // Not used, fallback to Firestore sync
    mapCacheChecked: "pending",
    mapLoaded: "pending",
    physicsInitialized: "pending",
    spawnPointsAssigned: "pending",
    playerCarSpawned: "pending",
    raceSceneMounted: "pending",
  });

  const [initTimeoutTriggered, setInitTimeoutTriggered] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const logStep = (step: keyof typeof initLogs, status: "success" | "failed" | "pending") => {
    console.log(`[Race Init Log] ${step.toUpperCase()}: ${status}`);
    setInitLogs((prev) => ({
      ...prev,
      [step]: status,
    }));
  };

  // Map downloading and cache states
  const [mapReadyLocal, setMapReadyLocal] = useState(false);
  const [isCheckingCache, setIsCheckingCache] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadedMB, setDownloadedMB] = useState<number>(0);
  const [totalMB, setTotalMB] = useState<number>(0);
  const [carsLoadedMap, setCarsLoadedMap] = useState<boolean>(false);
  const [carLoadingLabel, setCarLoadingLabel] = useState<string>("");

  // New multiplayer loading states
  const [loadingMultiplayer, setLoadingMultiplayer] = useState(true);
  const [mapVerified, setMapVerified] = useState(false);
  const [mapDownloadProgress, setMapDownloadProgress] = useState(0);
  const [mapDownloadReady, setMapDownloadReady] = useState(false);

  const [carVerified, setCarVerified] = useState(false);
  const [carDownloadProgress, setCarDownloadProgress] = useState(0);
  const [carDownloadReady, setCarDownloadReady] = useState(false);

  const [glbParsing, setGlbParsing] = useState(false);
  const [glbParsed, setGlbParsed] = useState(false);

  const [vehicleInitProgress, setVehicleInitProgress] = useState(0);
  const [vehicleInitReady, setVehicleInitReady] = useState(false);

  const [allPlayersReadyTriggered, setAllPlayersReadyTriggered] = useState(false);
  const [countdownStarted, setCountdownStarted] = useState(false);

  const [showExitDialog, setShowExitDialog] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const handleExitConfirm = async () => {
    setIsExiting(true);
    setShowExitDialog(false);
    
    try {
      const code = normalizedCode || RoomManager.getCurrentCode();
      const playerId = RoomManager.getCurrentPlayerId();
      
      console.log(`[Exit Race] Player ${playerId} is leaving room ${code}`);
      
      // 1. Unsubscribe from the room listener
      mp.leaveRoom();
      
      // 2. Call RoomService.leaveRoom directly to ensure Firestore transaction completes
      if (code && playerId) {
        const { RoomService } = await import("../multiplayer/RoomService");
        await RoomService.leaveRoom(code, playerId);
      }
    } catch (err) {
      console.error("[Exit Race] Failed to exit cleanly:", err);
    } finally {
      // 3. Clear local storage records
      try {
        localStorage.removeItem("activeRoomCode");
        sessionStorage.removeItem("last_room_code");
      } catch (e) {}
      
      // 4. Navigate back to rooms / lobby dashboard
      navigate("/rooms");
    }
  };

  // Track if local player became the Host during the active race
  const prevHostIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mp.room) return;
    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    if (!activePlayerId) return;

    if (prevHostIdRef.current !== null && prevHostIdRef.current !== mp.room.hostId) {
      if (mp.room.hostId === activePlayerId) {
        toast.success("You are now the Room Host.", {
          position: "top-center"
        });
      }
    }
    prevHostIdRef.current = mp.room.hostId;
  }, [mp.room?.hostId, mp.playerId]);

  // Automatically return to Garage if the room is canceled/deleted during the active race
  useEffect(() => {
    if (!mp.isConnecting && !mp.room) {
      if (isExiting) {
        // Voluntarily leaving, do not show opponents remaining toast
      } else {
        console.log("Room deleted or canceled during active race. Returning to garage.");
        sessionStorage.setItem("room_closed_no_opponents", "true");
        navigate("/garage");
      }
    }
  }, [mp.room, mp.isConnecting, isExiting, navigate]);

  // Core Game State
  const [trackHelper, setTrackHelper] = useState<TrackGeometryHelper | null>(null);
  const [physicsService, setPhysicsService] = useState<GamePhysicsService | null>(null);
  const [cars, setCars] = useState<CarState[]>([]);

  useEffect(() => {
    const remotePlayerIds = Array.from(remotePlayersMapRef.current.keys());
    console.log("[CARS STATE LOG] cars.length:", cars.length, "cars ids:", cars.map(c => c.id), "remote player ids:", remotePlayerIds);
  }, [cars]);
  const [controls, setControls] = useState<ControlsState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    handbrake: false,
    nitro: false,
  });
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [phase, setPhase] = useState<GamePhase>("menu");

  const [countdown, setCountdown] = useState(3);
  const [countdownMsg, setCountdownMsg] = useState("...");
  const [countdownLabel, setCountdownLabel] = useState("Engine Warming");
  const [wsRaceStartTime, setWsRaceStartTime] = useState<number | null>(null);

  const lastTimeRef = useRef<number>(Date.now());
  const countdownTimerRef = useRef<number | null>(null);
  const remotePlayersMapRef = useRef<Map<string, any>>(new Map());

  // Clean initialization values on mount or room change
  useEffect(() => {
    (window as any).playerCarAddedToScene = false;
    (window as any).mapLoaded = false;
    (window as any).worldReady = false;
    (window as any).shadersCompiled = false;
    (window as any).countdownStuckSecs = 0;
    setWsRaceStartTime(null);
  }, [normalizedCode]);

  // 1. Room Connection & Firestore state logging
  useEffect(() => {
    if (normalizedCode) {
      logStep("connectedToRoom", "success");
    } else {
      logStep("connectedToRoom", "failed");
    }
  }, [normalizedCode]);

  useEffect(() => {
    if (mp.room) {
      logStep("firestoreRoomLoaded", "success");
      logStep("websocketConnected", "success"); // Bypassed with Firestore
    }
  }, [mp.room]);

  // 2. Retry handler
  const handleRetry = async () => {
    console.log("[Race Init] Retrying initialization...");
    setInitTimeoutTriggered(false);
    setErrorMessage(null);
    setInitLogs({
      connectedToRoom: "pending",
      firestoreRoomLoaded: "pending",
      websocketConnected: "success",
      mapCacheChecked: "pending",
      mapLoaded: "pending",
      physicsInitialized: "pending",
      spawnPointsAssigned: "pending",
      playerCarSpawned: "pending",
      raceSceneMounted: "pending",
    });

    // Clear stuck counters
    (window as any).countdownStuckSecs = 0;

    const code = normalizedCode || RoomManager.getCurrentCode();
    if (code) {
      logStep("connectedToRoom", "success");
      try {
        const room = await RoomManager.attemptReconnect();
        if (room) {
          logStep("firestoreRoomLoaded", "success");
        }
      } catch (err) {
        console.warn("Retry reconnect failed, subscription should still pick it up", err);
      }
    }
  };

  // 3. Global 15-second timeout for Phase 1 loading (React & Assets loading)
  useEffect(() => {
    const isComplete = 
      mapReadyLocal && 
      trackHelper && 
      physicsService && 
      cars.length > 0;

    if (isComplete) return;

    const timer = setTimeout(() => {
      setInitTimeoutTriggered(true);
      setErrorMessage("Asset initialization timed out. Please check network and retry.");
      
      // Mark pending items as failed
      setInitLogs((prev) => {
        const next = { ...prev };
        (Object.keys(next) as Array<keyof typeof next>).forEach((key) => {
          if (next[key] === "pending") {
            next[key] = "failed";
          }
        });
        return next;
      });
    }, 15000); // 15 seconds

    return () => clearTimeout(timer);
  }, [mapReadyLocal, trackHelper, physicsService, cars.length]);

  // Check map cache and trigger download if needed
  useEffect(() => {
    if (!mp.room) return;

    const checkAndDownloadMap = async () => {
      const activeMapId = mp.room.map || mp.room.selectedMap || "map1";
      const isCustomMap = activeMapId === "race2map" || activeMapId === "racing2";
      const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();

      setMapVerified(true);

      if (!isCustomMap) {
        logStep("mapCacheChecked", "success");
        logStep("mapLoaded", "success");
        setMapReadyLocal(true);
        setDownloadProgress(100);
        setMapDownloadProgress(100);
        setMapDownloadReady(true);
        setIsCheckingCache(false);
        
        if (activePlayerId && mp.room?.roomCode) {
          try {
            await NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
              mapReady: true,
              mapProgress: 100
            });
          } catch (e) {
            console.error("Failed to update map status:", e);
          }
        }
        return;
      }

      const mapUrl = "https://pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/map/Untitled12.glb";
      const cacheName = "map-assets-cache";

      setIsCheckingCache(true);
      try {
        const cache = await caches.open(cacheName);
        logStep("mapCacheChecked", "success");
        const cachedResponse = await cache.match(mapUrl);

        if (cachedResponse) {
          console.log("Map exists in browser cache!");
          logStep("mapLoaded", "success");
          setMapReadyLocal(true);
          setDownloadProgress(100);
          setMapDownloadProgress(100);
          setMapDownloadReady(true);
          setIsCheckingCache(false);
          
          if (activePlayerId && mp.room?.roomCode) {
            try {
              await NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
                mapReady: true,
                mapProgress: 100
              });
            } catch (e) {
              console.error("Failed to update map status:", e);
            }
          }
          return;
        }

        // Trigger map download with progress reporting
        setIsCheckingCache(false);
        setDownloadProgress(0);
        setMapDownloadProgress(0);

        const targetUrl = `/api/proxy?url=${encodeURIComponent(mapUrl)}`;
        let response: Response;
        try {
          response = await fetch(targetUrl);
          if (!response.ok) throw new Error("Proxy fetch failed");
        } catch (err) {
          console.warn("Proxy fetch failed, trying direct URL fetch", err);
          response = await fetch(mapUrl);
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch map: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        const contentLengthHeader = response.headers.get("Content-Length");
        const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 47139152;
        setTotalMB(parseFloat((totalBytes / (1024 * 1024)).toFixed(1)));

        if (!reader) {
          throw new Error("Reader not available on response body");
        }

        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            chunks.push(value);
            receivedBytes += value.length;
          }

          const percent = Math.min(Math.round((receivedBytes / totalBytes) * 100), 99);
          setDownloadProgress(percent);
          setMapDownloadProgress(percent);
          setDownloadedMB(parseFloat((receivedBytes / (1024 * 1024)).toFixed(1)));
          
          // Throttled Firestore progress update
          if (percent % 10 === 0 && activePlayerId && mp.room?.roomCode) {
            NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
              mapProgress: percent,
              mapReady: false,
              ready: false
            }).catch(console.error);
          }
        }

        const combinedBlob = new Blob(chunks);
        if (combinedBlob.size < 1000) {
          throw new Error("Downloaded glb is invalid or too small");
        }

        await cache.put(mapUrl, new Response(combinedBlob, {
          headers: {
            "Content-Type": "model/gltf-binary",
            "Content-Length": combinedBlob.size.toString(),
          }
        }));

        console.log("Saved map asset to browser cache!");
        logStep("mapLoaded", "success");
        setMapReadyLocal(true);
        setDownloadProgress(100);
        setMapDownloadProgress(100);
        setMapDownloadReady(true);
        
        if (activePlayerId && mp.room?.roomCode) {
          try {
            await NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
              mapReady: true,
              mapProgress: 100
            });
          } catch (e) {
            console.error("Failed to update map status:", e);
          }
        }
      } catch (err) {
        console.error("Map downloading/caching failed:", err);
        logStep("mapLoaded", "failed");
        // Graceful fallback to avoid locking users out in case of network issues
        setMapReadyLocal(true);
        setDownloadProgress(100);
        setMapDownloadProgress(100);
        setMapDownloadReady(true);
        setIsCheckingCache(false);
        
        if (activePlayerId && mp.room?.roomCode) {
          try {
            await NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
              mapReady: true,
              mapProgress: 100
            });
          } catch (e) {
            console.error("Failed to update map status fallback:", e);
          }
        }
      }
    };

    checkAndDownloadMap();
  }, [mp.room?.map, mp.room?.selectedMap, mp.room?.id]);

  // Load selected vehicles for all players in the room
  useEffect(() => {
    if (!mp.room || !mapReadyLocal) return;

    let active = true;

    const loadAllPlayerCars = async () => {
      try {
        const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
        const localRacer = mp.room.players.find((p: any) => p.uid === activePlayerId || p.id === activePlayerId);
        const myNormalizedCarId = getCarIdString(localRacer?.carId);

        setCarVerified(true);

        const uniqueCarIds = Array.from(
          new Set(
            mp.room.players.map((p: any) => {
              const cid = getCarIdString(p.carId);
              if (cid.toLowerCase().includes("porsche")) return "porsche";
              if (cid.toLowerCase().includes("bugatti")) return "bugatti";
              return "ferrari";
            })
          )
        ) as string[];

        console.log("[Race Init] Unique car IDs to load (normalized):", uniqueCarIds);

        for (let i = 0; i < uniqueCarIds.length; i++) {
          if (!active) return;
          const carId = uniqueCarIds[i];
          const isMyCar = carId === myNormalizedCarId || (carId === "ferrari" && !["porsche", "bugatti"].includes(myNormalizedCarId));
          const carMapKey = carId === "porsche"
            ? "porsche_911_gt3"
            : carId === "bugatti"
              ? "bugatti_chiron_top_edition"
              : "ferrari_purosangue";

          console.log(`[Race Init] Starting load for: ${carMapKey}, isMyCar: ${isMyCar}`);
          setCarLoadingLabel(`Loading vehicle: ${carId.toUpperCase()}`);

          if (isMyCar) {
            setCarDownloadReady(false);
            setCarDownloadProgress(0);
          }

          // Check if already loaded in gltfModelCache
          if (gltfModelCache[carMapKey as keyof typeof gltfModelCache]) {
            console.log(`[Race Init] GLB already loaded in cache for: ${carMapKey}`);
            if (isMyCar) {
              setDownloadProgress(100);
              setCarDownloadProgress(100);
              setCarDownloadReady(true);
              setGlbParsing(true);
              
              if (activePlayerId && mp.room?.roomCode) {
                try {
                  await NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
                    carReady: true,
                    carProgress: 100,
                    glbParsing: true
                  });
                } catch (e) {
                  console.error("Failed to update car status cached:", e);
                }
              }
            }
            continue;
          }

          // Initialize AssetManager if needed
          await AssetManager.init();

          // 1. Try to load from AssetManager (IndexedDB)
          let blob = await AssetManager.getVerifiedBlob(carMapKey);
          if (!blob) {
            console.log(`[Race Init] ${carMapKey} not in local store, streaming...`);
            const asset = AssetManager.getAssets().find((a) => a.id === carMapKey);
            if (asset?.url) {
              try {
                // Download with progress
                blob = await AssetManager.downloadAsset(carMapKey, (prog) => {
                  if (active) {
                    setDownloadProgress(prog.percent);
                    if (isMyCar) {
                      setCarDownloadProgress(prog.percent);
                      if (prog.percent % 10 === 0 && activePlayerId && mp.room?.roomCode) {
                        NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
                          carProgress: prog.percent,
                          carReady: false,
                          ready: false
                        }).catch(console.error);
                      }
                    }
                  }
                });
              } catch (downloadErr) {
                console.warn(`[Race Init] Failed to download asset ${carMapKey}, trying direct fetch fallback...`, downloadErr);
                const res = await fetch(asset.url);
                if (res.ok) {
                  blob = await res.blob();
                }
              }
            }
          } else {
            setDownloadProgress(100);
            if (isMyCar) {
              setCarDownloadProgress(100);
              setCarDownloadReady(true);
            }
          }

          if (isMyCar) {
            setCarDownloadProgress(100);
            setCarDownloadReady(true);
            setGlbParsing(true);
            
            if (activePlayerId && mp.room?.roomCode) {
              try {
                await NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
                  carReady: true,
                  carProgress: 100,
                  glbParsing: true
                });
              } catch (e) {
                console.error("Failed to update car status downloaded:", e);
              }
            }
          }

          if (blob) {
            const buffer = await blob.arrayBuffer();
            const loader = new GLTFLoader();
            const dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
            loader.setDRACOLoader(dracoLoader);
            loader.register((parser) => new GLTFMaterialsPBRSpecularGlossinessExtension(parser));

            await new Promise<void>((resolvePromise, rejectPromise) => {
              loader.parse(
                buffer,
                "",
                (gltf) => {
                  try {
                    applyGltfMaterialFix(gltf.scene);
                    (gltfModelCache as any)[carMapKey] = gltf.scene;
                    gltfModelCache.isLoaded = true;
                    dracoLoader.dispose();
                    console.log(`[Race Init] ${carMapKey} successfully parsed and cached.`);
                    if (isMyCar) {
                      setGlbParsed(true);
                    }
                    resolvePromise();
                  } catch (err) {
                    dracoLoader.dispose();
                    rejectPromise(err);
                  }
                },
                (err) => {
                  dracoLoader.dispose();
                  rejectPromise(err);
                }
              );
            });
          } else {
            throw new Error(`Failed to retrieve GLB blob for ${carMapKey}`);
          }
        }

        if (active) {
          setCarsLoadedMap(true);
        }
      } catch (err) {
        console.error("[Race Init] Failed to load player cars", err);
        // Fallback: set to true so users don't get stuck
        if (active) {
          setCarsLoadedMap(true);
        }
      }
    };

    loadAllPlayerCars();

    return () => {
      active = false;
    };
  }, [mp.room?.id, mapReadyLocal]);

  // Load track helper, physics service, and spawn racers
  useEffect(() => {
    if (!mp.room || !mapReadyLocal || !carsLoadedMap) return;

    try {
      const activeMap = mp.room.map || mp.room.selectedMap || "map1";
      const helper = new TrackGeometryHelper(activeMap);
      const physics = new GamePhysicsService(helper);

      setTrackHelper(helper);
      setPhysicsService(physics);
      logStep("physicsInitialized", "success");

      const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
      const localRacer = mp.room.players.find((p: any) => p.uid === activePlayerId || p.id === activePlayerId);

      const rawCarId = getCarIdString(localRacer?.carId);
      const baseCarId = rawCarId.toLowerCase().includes("porsche")
        ? "porsche"
        : rawCarId.toLowerCase().includes("bugatti")
          ? "bugatti"
          : "ferrari";

      const modelKey =
        baseCarId === "ferrari"
          ? "ferrari_purosangue"
          : baseCarId === "bugatti"
            ? "bugatti_chiron_top_edition"
            : "porsche_911_gt3";

      setPlayerSelectedModelKey(modelKey);

      // Build starter lineup of remote + human players on spawn grid
      const lineup: CarState[] = [];
      const curveLength = helper.curve.getLength();
      const wheelRadius = 0.38;

      // Deterministically sort the players list such that:
      // - The host is always first (index 0, Grid 1)
      // - The remaining players are sorted consistently to ensure all clients agree on the order
      const sortedPlayers = [...mp.room.players].sort((a, b) => {
        const aIsHost = a.uid === mp.room.hostId || a.id === mp.room.hostId || a.isHost;
        const bIsHost = b.uid === mp.room.hostId || b.id === mp.room.hostId || b.isHost;
        if (aIsHost && !bIsHost) return -1;
        if (!aIsHost && bIsHost) return 1;
        const idA = a.uid || a.id || "";
        const idB = b.uid || b.id || "";
        return idA.localeCompare(idB);
      });

      sortedPlayers.forEach((p: any, idx: number) => {
        const isMe = p.uid === activePlayerId || p.id === activePlayerId;
        const isAI = p.isAI;

        const side = idx % 2 === 0 ? -1 : 1;
        const spacingDistance = 15.0 + idx * 8.0;
        const progress = (((1.0 - spacingDistance / curveLength) % 1.0) + 1.0) % 1.0;

        const pt = helper.curve.getPointAt(progress);
        const tangent = helper.curve.getTangentAt(progress).normalize();
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const spawnPos = pt.clone().addScaledVector(normal, side * 2.5);

        const roadHeightTest = terrainManager.getRoadHeight(spawnPos);
        const spawnY = roadHeightTest + wheelRadius;
        const startAngle = Math.atan2(tangent.x, tangent.z);

        const carId = isMe ? "player" : isAI ? p.id : `remote_${p.id || p.uid}`;
        const amIHost = mp.room.hostId === activePlayerId;

        const pRawCarId = getCarIdString(p.carId);
        const pBaseCarId = pRawCarId.toLowerCase().includes("porsche")
          ? "porsche"
          : pRawCarId.toLowerCase().includes("bugatti")
            ? "bugatti"
            : "ferrari";

        const hasSavedState = p.position && typeof p.position.x === 'number' && typeof p.position.z === 'number';
        const finalPosition = hasSavedState ? { x: p.position.x, y: p.position.y ?? spawnY, z: p.position.z } : { x: spawnPos.x, y: spawnY, z: spawnPos.z };
        const finalVelocity = hasSavedState && p.velocity ? { x: p.velocity.x ?? 0, y: p.velocity.y ?? 0, z: p.velocity.z ?? 0 } : { x: 0, y: 0, z: 0 };
        const finalAngle = hasSavedState && typeof p.angle === 'number' ? p.angle : startAngle;
        const finalSpeed = hasSavedState && typeof p.speed === 'number' ? p.speed : 0;
        const finalLap = hasSavedState && typeof p.currentLap === 'number' ? p.currentLap : 1;
        const finalCheckpoint = hasSavedState && typeof p.currentCheckpointIndex === 'number' ? p.currentCheckpointIndex : 0;
        const finalTotalDistance = hasSavedState && typeof p.totalDistanceTraveled === 'number' ? p.totalDistanceTraveled : -idx * 8.5;
        const finalFinished = hasSavedState && typeof p.isFinished === 'boolean' ? p.isFinished : false;

        lineup.push({
          id: carId,
          name: p.playerName || p.name || "Driver",
          isAI: isAI && amIHost,
          color: p.carColor || "#0062ff",
          carId: pBaseCarId,
          position: finalPosition,
          velocity: finalVelocity,
          speed: finalSpeed,
          angle: finalAngle,
          angularVelocity: 0,
          driftFactor: 0,
          isDrifting: hasSavedState && typeof p.isDrifting === 'boolean' ? p.isDrifting : false,
          currentLap: finalLap,
          currentCheckpointIndex: finalCheckpoint,
          distanceToNextCheckpoint: 999,
          racePosition: idx + 1,
          totalDistanceTraveled: finalTotalDistance,
          isFinished: finalFinished,
          lastActiveTime: Date.now(),
          nitroCharged: 60,
          isNitroActive: false,
          stuckTimer: 0,
          aiTargetNode: 0,
          aiSpeedFactor: 1,
          aiAggression: mp.room.difficulty === "easy" ? 0.45 : mp.room.difficulty === "medium" ? 0.72 : 0.95,
        });
      });

      setCars(lineup);
      logStep("spawnPointsAssigned", "success");
      setVehicleInitProgress(30);
      setPhase("menu");
      setCountdown(60);
      setElapsedTime(0);
      setIsPaused(false);
    } catch (e) {
      console.error("Physics or lineup initialization failed:", e);
      logStep("physicsInitialized", "failed");
      logStep("spawnPointsAssigned", "failed");
    }
  }, [mp.room?.id, mapReadyLocal, carsLoadedMap]);

  // Reset player's loading status on mount/entry to the race scene
  useEffect(() => {
    if (!mp.room?.roomCode) return;
    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    if (!activePlayerId) return;

    console.log("[Race Init] Resetting player loading status for a fresh race session...");
    NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
      mapReady: false,
      mapProgress: 0,
      carReady: false,
      carProgress: 0,
      glbParsing: false,
      vehicleInitialized: false,
      sceneReady: false,
      connected: false,
      ready: false
    }).catch((err) => {
      console.error("Failed to reset player loading status on mount:", err);
    });
  }, [mp.room?.roomCode, mp.playerId]);

  // Reactive vehicle initialization tracker
  useEffect(() => {
    if (!mp.room || !mapReadyLocal || !carsLoadedMap || !trackHelper || !physicsService || cars.length === 0) return;

    let active = true;
    const checkInterval = setInterval(async () => {
      if (!active) return;

      const carLoaded = !!(window as any).carLoaded || !!(window as any).playerCarAddedToScene;
      const worldReady = !!(window as any).worldReady;

      if (carLoaded && !worldReady) {
        setVehicleInitProgress(70);
      } else if (carLoaded && worldReady) {
        setVehicleInitProgress(100);
        setVehicleInitReady(true);
        clearInterval(checkInterval);

        const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
        if (activePlayerId && mp.room?.roomCode) {
          console.log("[Race Init] Local Vehicle Ready! Updating Firestore status to ready.");
          try {
            await NormalRoomService.updatePlayerLoadingStatus(mp.room.roomCode, activePlayerId, {
              mapReady: true,
              carReady: true,
              vehicleInitialized: true,
              sceneReady: true,
              connected: true,
              ready: true
            });
          } catch (e) {
            console.error("Failed to update ready status:", e);
          }
        }
      }
    }, 200);

    return () => {
      active = false;
      clearInterval(checkInterval);
    };
  }, [mp.room?.id, mapReadyLocal, carsLoadedMap, trackHelper, physicsService, cars.length]);

  // Host continuously watches all players
  useEffect(() => {
    if (!mp.room || !mp.room.players || !mp.room.roomCode) return;

    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    const isHost = mp.room.hostId === activePlayerId;
    if (!isHost) return;

    const humans = mp.room.players.filter((p: any) => !p.isAI);
    const everyoneReady = humans.length > 0 && humans.every(
      (p: any) => p.mapReady === true && p.carReady === true && p.sceneReady === true
    );

    if (mp.room.status === "racing" && !mp.room.raceStarted && everyoneReady) {
      console.log("[Host Action] All players ready! Updating room status to countdown with server timestamp.");
      startCountdown(mp.room.roomCode).catch((err) => {
        console.error("Failed to update room status to countdown:", err);
      });
    }
  }, [mp.room?.players, mp.room?.status, mp.room?.raceStarted, mp.room?.roomCode, mp.room?.hostId, mp.playerId]);

  // Listen for room status and local loading readiness to manage game phase and loading screen
  useEffect(() => {
    if (!mp.room || !mp.room.roomCode) return;

    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    const isHost = mp.room.hostId === activePlayerId;

    if (mp.room.status === "racing" && !mp.room.raceStarted) {
      // 1. Loading/waiting phase
      setLoadingMultiplayer(true);
      setCountdownStarted(false);
      setPhase("menu");
    } else if (mp.room.status === "countdown") {
      // 2. Countdown phase
      if (!vehicleInitReady) {
        setLoadingMultiplayer(true);
        setCountdownStarted(false);
        setPhase("menu");
      } else {
        setLoadingMultiplayer(false);
        setCountdownStarted(true);
        setPhase("countdown");
      }

      // If we are the host, trigger the WebSocket race start immediately if we haven't yet
      if (isHost && !wsRaceStartTime) {
        triggerWsStartRace();
      }

      // If we have a WebSocket race start time, use it!
      if (wsRaceStartTime) {
        const tick = () => {
          const now = Date.now();
          const msLeft = wsRaceStartTime - now;
          const remaining = Math.ceil(msLeft / 1000);

          if (remaining > 0) {
            setCountdown(remaining);
            setCountdownMsg(String(remaining));
            setCountdownLabel("Get Ready!");
          } else if (msLeft > -1000) {
            // Show GO! for 1 second
            setCountdown(0);
            setCountdownMsg("GO!");
            setCountdownLabel("Green light");
          } else {
            if (vehicleInitReady) {
              setPhase("racing");
              setCountdownStarted(false);
              lastTimeRef.current = Date.now();
            }

            // Host only: update room status to racing in Firestore so spectators/broadcasters can follow
            if (isHost) {
              beginRace(mp.room.roomCode).catch((err) => {
                console.error("Host failed to transition room to racing:", err);
              });
            }
          }
        };

        tick();
        const intervalId = setInterval(tick, 100);
        return () => clearInterval(intervalId);
      } else {
        // Fallback/loading until WebSocket start time is received
        setCountdown(5);
        setCountdownMsg("...");
        setCountdownLabel("Warming Engine");
      }
    } else if (mp.room.status === "racing" && mp.room.raceStarted) {
      // 3. Active racing phase (reconnect/join mid-race)
      if (!vehicleInitReady) {
        setLoadingMultiplayer(true);
        setCountdownStarted(false);
        setPhase("menu");
      } else {
        setLoadingMultiplayer(false);
        setCountdownStarted(false);
        setPhase("racing");
        lastTimeRef.current = Date.now();
      }
    }
  }, [mp.room?.status, mp.room?.raceStarted, mp.room?.roomCode, mp.room?.hostId, mp.playerId, vehicleInitReady, wsRaceStartTime]);

  const handleRemovePlayer = async (pid: string) => {
    if (!mp.room?.roomCode) return;
    try {
      const { RoomService } = await import("../multiplayer/RoomService");
      await RoomService.leaveRoom(mp.room.roomCode, pid);
      console.log(`[Host Action] Successfully removed player: ${pid}`);
    } catch (err) {
      console.error("Failed to remove player:", err);
    }
  };

  // Overall timing clock elapsed increments helper
  useEffect(() => {
    let frameId = 0;

    const updateTime = () => {
      if (phase === "racing" && !isPaused) {
        const now = Date.now();
        const delta = (now - lastTimeRef.current) / 1000;
        setElapsedTime((prev) => {
          const next = prev + delta;
          (window as any).raceElapsedTime = next;
          return next;
        });
        lastTimeRef.current = now;
      } else {
        lastTimeRef.current = Date.now();
        if (phase !== "racing") (window as any).raceElapsedTime = 0;
      }
      frameId = requestAnimationFrame(updateTime);
    };

    frameId = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(frameId);
  }, [phase, isPaused]);

  // Subscribe to real-time player subcollection coordinates for synchronization
  useEffect(() => {
    if (!mp.room?.roomCode) return;
    const unsub = NormalRoomService.listenToPlayers(mp.room.roomCode, (playersList) => {
      const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
      playersList.forEach((p) => {
        // Only track remote players in this map
        if (p.uid === activePlayerId) return;
        remotePlayersMapRef.current.set(p.uid, p);
      });

      // Clean up any players no longer present in the room
      const activeUids = new Set(playersList.map((p) => p.uid));
      for (const [uid] of remotePlayersMapRef.current) {
        if (!activeUids.has(uid)) {
          remotePlayersMapRef.current.delete(uid);
        }
      }
    });

    return () => {
      unsub();
      remotePlayersMapRef.current.clear();
    };
  }, [mp.room?.roomCode, mp.playerId]);

  // Connect to vehicle WebSocket relay alongside Firestore subscription
  useEffect(() => {
    if (!mp.room?.roomCode) return;
    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    if (!activePlayerId) return;

    // Ensure remoteVehicles is initialized on window
    (window as any).remoteVehicles = (window as any).remoteVehicles || {};

    // WebSocket updates bypass Firestore for live position/rotation
    const disconnectSocket = connectVehicleSocket(
      mp.room.roomCode,
      activePlayerId,
      (remotePid, wsData) => {
        console.log("onRemoteUpdate called", "remotePid:", remotePid, "type:", wsData?.type);
        // Support player_list / playerList messages
        if (!remotePid && (wsData.type === "player_list" || wsData.type === "playerList")) {
          console.log("[WS] player_list received", wsData);
          const latestStates = wsData.latestStates || {};
          Object.keys(latestStates).forEach((playerId) => {
            if (playerId === activePlayerId) return; // ignore self
            const state = latestStates[playerId];
            if (!state) return;
            console.log("[REMOTE] Creating remote vehicle", playerId);
            handleSinglePlayerUpdate(playerId, state);
          });
          return;
        }

        if (remotePid) {
          handleSinglePlayerUpdate(remotePid, wsData);
          console.log("Remote state updated", "playerId:", remotePid);
        }
      },
      (leftPid) => {
        // Remove left player's car from the cars list
        setCars((prevCars) => {
          return prevCars.filter((car) => {
            const netId = car.id.startsWith("remote_") ? car.id.replace("remote_", "") : car.id;
            return netId !== leftPid;
          });
        });
        remotePlayersMapRef.current.delete(leftPid);
      },
      (startTime) => {
        setWsRaceStartTime(startTime);
      }
    );

    // Inner helper function to process updates per remote player
    function handleSinglePlayerUpdate(remotePid: string, wsData: any) {
      console.log("onRemoteUpdate called", "remotePid:", remotePid, "wsData:", wsData);
      // Task 1: Verify every incoming vehicle_update message is received
      console.log("REMOTE UPDATE", wsData);

      // Task 6: Verify playerId comparison
      if (wsData.playerId === activePlayerId || remotePid === activePlayerId) return;

      const vehicleRenderer = (window as any).__vehicleRenderer;
      let remoteVehicle = (window as any).remoteVehicles[remotePid] || (vehicleRenderer?.carGroupMap?.get(`remote_${remotePid}`));

      // Convert the incoming rotation quaternion back to a Y-axis angle
      let angle = 0;
      if (wsData.rotation && typeof wsData.rotation.y === "number" && typeof wsData.rotation.w === "number") {
        angle = 2 * Math.atan2(wsData.rotation.y, wsData.rotation.w);
      }

      // Shape the data like NetPlayer (the firestore player data format expected by SyncManager.unpackCarState)
      const netPlayerShape = {
        position: wsData.position,
        velocity: wsData.velocity || { x: 0, y: 0, z: 0 },
        angle: angle,
        quaternion: wsData.rotation || { x: 0, y: 0, z: 0, w: 1 },
        speed: wsData.speed ?? 0,
        isDrifting: !!wsData.drift,
        isNitroActive: !!wsData.nitro,
        currentLap: wsData.lap,
        currentCheckpointIndex: wsData.checkpoint,
        totalDistanceTraveled: wsData.totalDistanceTraveled,
        isFinished: !!wsData.isFinished,
        steerValue: wsData.steering ?? 0,
        wheelRotation: wsData.wheelRotation ?? 0,
        carId: wsData.carId,
        playerName: wsData.playerName || wsData.name
      };

      // Put this data in remotePlayersMapRef so our standard loop can read it as fallback,
      // but also update the active car object immediately!
      remotePlayersMapRef.current.set(remotePid, netPlayerShape);

      // Task 2 & 3: Verify the remote player's object exists. If it doesn't exist, create/spawn it immediately.
      if (!remoteVehicle && vehicleRenderer) {
        console.log("[REMOTE] Creating remote vehicle", remotePid);
        const carIdKey = `remote_${remotePid}`;
        const pInfo = mp.room?.players?.find((p: any) => (p.uid || p.id) === remotePid);
        const rawCid = getCarIdString(wsData.carId || pInfo?.carId || "ferrari");
        const baseCarId = rawCid.toLowerCase().includes("porsche")
          ? "porsche"
          : rawCid.toLowerCase().includes("bugatti")
            ? "bugatti"
            : "ferrari";

        const carState: CarState = {
          id: carIdKey,
          name: wsData.playerName || wsData.name || pInfo?.playerName || pInfo?.name || "Driver",
          isAI: false,
          color: wsData.carColor || pInfo?.carColor || "#0062ff",
          carId: baseCarId,
          position: { x: wsData.position?.x ?? 0, y: wsData.position?.y ?? 0, z: wsData.position?.z ?? 0 },
          velocity: { x: wsData.velocity?.x ?? 0, y: wsData.velocity?.y ?? 0, z: wsData.velocity?.z ?? 0 },
          speed: wsData.speed ?? 0,
          angle: angle,
          angularVelocity: 0,
          driftFactor: 0,
          isDrifting: !!wsData.drift,
          currentLap: wsData.lap ?? 1,
          currentCheckpointIndex: wsData.checkpoint ?? 0,
          distanceToNextCheckpoint: 999,
          racePosition: 2,
          totalDistanceTraveled: wsData.totalDistanceTraveled ?? 0,
          isFinished: !!wsData.isFinished,
          lastActiveTime: Date.now(),
          nitroCharged: 60,
          isNitroActive: !!wsData.nitro,
          stuckTimer: 0,
          aiTargetNode: 0,
          aiSpeedFactor: 1,
          aiAggression: 0.72,
        };
        vehicleRenderer.spawnVehicle(carState);
        const carGroup = vehicleRenderer.carGroupMap.get(carIdKey);
        if (carGroup) {
          (window as any).remoteVehicles[remotePid] = carGroup;
          remoteVehicle = carGroup;
        }
      }

      // Task 5: Verify Remote Transform Application
      console.log("[REMOTE] Update received", remotePid);
      console.log("[REMOTE] Vehicle exists", !!remoteVehicle);
      console.log("[REMOTE] Applying position", wsData.position);
      console.log("[REMOTE] Applying rotation", wsData.rotation);

      // Task 8: Add logs
      console.log("Vehicle update received", remotePid);
      console.log("Applying transform", wsData.position);
      console.log("Remote vehicle found", remoteVehicle);

      // Task 3 & 7: Every vehicle_update must execute set on position and quaternion
      if (remoteVehicle && wsData.position) {
        remoteVehicle.position.set(
          wsData.position.x,
          wsData.position.y,
          wsData.position.z
        );
        if (wsData.rotation) {
          remoteVehicle.quaternion.set(
            wsData.rotation.x,
            wsData.rotation.y,
            wsData.rotation.z,
            wsData.rotation.w
          );
        }
      }

      console.log("before setCars in handleSinglePlayerUpdate (async)", "remotePid:", remotePid);
      setCars((prevCars) => {
        console.log("before setCars updater execution inside handleSinglePlayerUpdate", "prevCars ids:", prevCars.map(c => c.id));
        const hasCar = prevCars.some((car) => {
          const netId = car.id.startsWith("remote_") ? car.id.replace("remote_", "") : car.id;
          return netId === remotePid;
        });

        let next;
        if (!hasCar) {
          const pInfo = mp.room?.players?.find((p: any) => (p.uid || p.id) === remotePid);
          const rawCid = getCarIdString(wsData.carId || pInfo?.carId || "ferrari");
          const baseCarId = rawCid.toLowerCase().includes("porsche")
            ? "porsche"
            : rawCid.toLowerCase().includes("bugatti")
              ? "bugatti"
              : "ferrari";

          const newCar: CarState = {
            id: `remote_${remotePid}`,
            name: wsData.playerName || wsData.name || pInfo?.playerName || pInfo?.name || "Driver",
            isAI: false,
            color: wsData.carColor || pInfo?.carColor || "#0062ff",
            carId: baseCarId,
            position: { x: wsData.position?.x ?? 0, y: wsData.position?.y ?? 0, z: wsData.position?.z ?? 0 },
            velocity: { x: wsData.velocity?.x ?? 0, y: wsData.velocity?.y ?? 0, z: wsData.velocity?.z ?? 0 },
            speed: wsData.speed ?? 0,
            angle: angle,
            angularVelocity: 0,
            driftFactor: 0,
            isDrifting: !!wsData.drift,
            currentLap: wsData.lap ?? 1,
            currentCheckpointIndex: wsData.checkpoint ?? 0,
            distanceToNextCheckpoint: 999,
            racePosition: prevCars.length + 1,
            totalDistanceTraveled: wsData.totalDistanceTraveled ?? 0,
            isFinished: !!wsData.isFinished,
            lastActiveTime: Date.now(),
            nitroCharged: 60,
            isNitroActive: !!wsData.nitro,
            stuckTimer: 0,
            aiTargetNode: 0,
            aiSpeedFactor: 1,
            aiAggression: 0.72,
          };

          // Set targets for interpolation immediately
          newCar.targetPosition = { ...newCar.position };
          newCar.targetVelocity = { ...newCar.velocity };
          newCar.targetAngle = newCar.angle;
          newCar.targetSpeed = newCar.speed;
          newCar.targetIsDrifting = newCar.isDrifting;
          newCar.targetIsNitroActive = newCar.isNitroActive;

          console.log(`[WS CLIENT] Dynamically spawning remote car state for player ${remotePid}`);
          next = [...prevCars, newCar];
        } else {
          next = prevCars.map((car) => {
            const netId = car.id.startsWith("remote_") ? car.id.replace("remote_", "") : car.id;
            if (netId === remotePid) {
              const updatedCar = { ...car };
              const rawCid = getCarIdString(netPlayerShape.carId || updatedCar.carId);
              updatedCar.carId = rawCid.toLowerCase().includes("porsche")
                ? "porsche"
                : rawCid.toLowerCase().includes("bugatti")
                  ? "bugatti"
                  : "ferrari";
              SyncManager.unpackCarState(updatedCar, netPlayerShape);
              updatedCar.position = { ...netPlayerShape.position };
              updatedCar.quaternion = netPlayerShape.quaternion;
              return updatedCar;
            }
            return car;
          });
        }
        console.log("after setCars updater execution inside handleSinglePlayerUpdate", "nextCars ids:", next.map(c => c.id));
        return next;
      });
      console.log("after setCars call in handleSinglePlayerUpdate (async completed)");
    }

    return () => {
      disconnectSocket();
    };
  }, [mp.room?.roomCode, mp.playerId, mp.room?.players]);

  // Callback triggered inside the canvas animation frames
  const handleTickUpdate = (updatedCars: CarState[]) => {
    if (!mp.room) return;

    const playerCar = updatedCars.find((c) => c.id === "player");
    if (playerCar) {
      mp.sendLocalCar(playerCar);
      sendVehicleUpdate(playerCar);
    }

    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    const isHost = mp.room.hostId === activePlayerId;
    if (isHost) {
      const aiCars = updatedCars.filter((c) => c.isAI);
      if (aiCars.length > 0) {
        mp.sendAICars(aiCars);
      }
    }

    // Unpack remote cars using functional updater to avoid race conditions with WS state updates
    setCars((prevCars) => {
      const updatedCarsMap = new Map(updatedCars.map((c) => [c.id, c]));
      const activeUids = new Set(mp.room?.players?.map((p: any) => p.uid || p.id) || []);

      // Filter prevCars to only keep player, AI, or remote players who are still active
      const filteredCars = prevCars.filter((car) => {
        if (car.id === "player") return true;
        if (car.isAI) return true;
        const netId = car.id.startsWith("remote_") ? car.id.replace("remote_", "") : car.id;
        return activeUids.has(netId) || remotePlayersMapRef.current.has(netId);
      });

      const nextCars = filteredCars.map((car) => {
        // If this car was updated in the 3D physics loop, copy those properties
        const updatedCar = updatedCarsMap.get(car.id);
        const targetCar = updatedCar ? { ...car, ...updatedCar } : { ...car };

        if (targetCar.id === "player") {
          const myPl = mp.room?.players?.find((p: any) => p.uid === activePlayerId || p.id === activePlayerId);
          const rawCid = getCarIdString(myPl?.carId || targetCar.carId);
          targetCar.carId = rawCid.toLowerCase().includes("porsche")
            ? "porsche"
            : rawCid.toLowerCase().includes("bugatti")
              ? "bugatti"
              : "ferrari";
          return targetCar;
        }

        const netId = targetCar.id.startsWith("remote_") ? targetCar.id.replace("remote_", "") : targetCar.id;
        let netPlayer = remotePlayersMapRef.current.get(netId);
        if (!netPlayer) {
          netPlayer = mp.room?.players?.find((p: any) => p.id === netId || p.uid === netId);
        }

        if (netPlayer) {
          const rawCid = getCarIdString(netPlayer.carId);
          targetCar.carId = rawCid.toLowerCase().includes("porsche")
            ? "porsche"
            : rawCid.toLowerCase().includes("bugatti")
              ? "bugatti"
              : "ferrari";
          if (netPlayer.position) {
            SyncManager.unpackCarState(targetCar, netPlayer);
          }
        }

        // Apply smooth interpolation for remote player positions, velocities, angles, speed, etc.
        if (targetCar.id !== "player" && !targetCar.isAI) {
          targetCar.position = { ...targetCar.position };
          targetCar.velocity = { ...targetCar.velocity };

          if (targetCar.targetPosition) {
            targetCar.position.x += (targetCar.targetPosition.x - targetCar.position.x) * 0.15;
            targetCar.position.y += (targetCar.targetPosition.y - targetCar.position.y) * 0.15;
            targetCar.position.z += (targetCar.targetPosition.z - targetCar.position.z) * 0.15;
          }
          if (targetCar.targetVelocity) {
            targetCar.velocity.x += (targetCar.targetVelocity.x - targetCar.velocity.x) * 0.15;
            targetCar.velocity.y += (targetCar.targetVelocity.y - targetCar.velocity.y) * 0.15;
            targetCar.velocity.z += (targetCar.targetVelocity.z - targetCar.velocity.z) * 0.15;
          }
          if (typeof targetCar.targetAngle === "number") {
            let diff = targetCar.targetAngle - targetCar.angle;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            targetCar.angle += diff * 0.15;
          }
          if (typeof targetCar.targetSpeed === "number") {
            targetCar.speed += (targetCar.targetSpeed - targetCar.speed) * 0.15;
          }
          if (typeof targetCar.targetSteerValue === "number") {
            targetCar.steerValue = targetCar.targetSteerValue;
          }
          if (typeof targetCar.targetWheelRotation === "number") {
            targetCar.wheelspinAngle = targetCar.targetWheelRotation;
          }
          if (typeof targetCar.targetIsNitroActive === "boolean") {
            targetCar.isNitroActive = targetCar.targetIsNitroActive;
          }
          if (typeof targetCar.targetIsDrifting === "boolean") {
            targetCar.isDrifting = targetCar.targetIsDrifting;
          }
        }
        return targetCar;
      });

      // Spawn any missing remote cars from remotePlayersMapRef
      const existingIds = new Set(nextCars.map((c) => c.id));
      const addedCars: CarState[] = [];

      remotePlayersMapRef.current.forEach((netPlayer, remotePid) => {
        const carIdKey = `remote_${remotePid}`;
        if (!existingIds.has(carIdKey)) {
          const pInfo = mp.room?.players?.find((p: any) => (p.uid || p.id) === remotePid);
          const rawCid = getCarIdString(netPlayer.carId || pInfo?.carId || "ferrari");
          const baseCarId = rawCid.toLowerCase().includes("porsche")
            ? "porsche"
            : rawCid.toLowerCase().includes("bugatti")
              ? "bugatti"
              : "ferrari";

          const angle = netPlayer.angle ?? 0;

          const newCar: CarState = {
            id: carIdKey,
            name: netPlayer.playerName || netPlayer.name || pInfo?.playerName || pInfo?.name || "Driver",
            isAI: false,
            color: netPlayer.carColor || pInfo?.carColor || "#0062ff",
            carId: baseCarId,
            position: { x: netPlayer.position?.x ?? 0, y: netPlayer.position?.y ?? 0, z: netPlayer.position?.z ?? 0 },
            velocity: { x: netPlayer.velocity?.x ?? 0, y: netPlayer.velocity?.y ?? 0, z: netPlayer.velocity?.z ?? 0 },
            speed: netPlayer.speed ?? 0,
            angle: angle,
            angularVelocity: 0,
            driftFactor: 0,
            isDrifting: !!netPlayer.isDrifting,
            currentLap: netPlayer.currentLap ?? 1,
            currentCheckpointIndex: netPlayer.currentCheckpointIndex ?? 0,
            distanceToNextCheckpoint: 999,
            racePosition: nextCars.length + addedCars.length + 1,
            totalDistanceTraveled: netPlayer.totalDistanceTraveled ?? 0,
            isFinished: !!netPlayer.isFinished,
            lastActiveTime: Date.now(),
            nitroCharged: 60,
            isNitroActive: !!netPlayer.isNitroActive,
            stuckTimer: 0,
            aiTargetNode: 0,
            aiSpeedFactor: 1,
            aiAggression: 0.72,
          };

          newCar.targetPosition = { ...newCar.position };
          newCar.targetVelocity = { ...newCar.velocity };
          newCar.targetAngle = newCar.angle;
          newCar.targetSpeed = newCar.speed;
          newCar.targetIsDrifting = newCar.isDrifting;
          newCar.targetIsNitroActive = newCar.isNitroActive;

          addedCars.push(newCar);
        }
      });

      const finalCars = [...nextCars, ...addedCars];
      console.log("[TICK STATE UPDATE] finalCars ids:", finalCars.map((c) => c.id));
      return finalCars;
    });
  };

  const handleRaceFinish = () => {
    setPhase("completed");
  };

  const handleHomeMenu = () => {
    setPhase("menu");
    navigate("/rooms");
  };

  if (isExiting) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-[9999] select-none p-6">
        <div className="relative w-20 h-20 mb-6 flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-red-500 animate-spin" />
        </div>
        <div className="text-center space-y-1.5">
          <h2 className="text-md font-black uppercase tracking-widest text-red-500 font-mono">
            DISCONNECTING FROM ARENA FEED...
          </h2>
          <p className="text-xs text-slate-400 font-mono animate-pulse">
            Leaving race session cleanly and syncing with mainframe.
          </p>
        </div>
      </div>
    );
  }

  if (!mp.room || isCheckingCache || !mapReadyLocal || !carsLoadedMap || !trackHelper || !physicsService || cars.length === 0 || initTimeoutTriggered) {
    if (initTimeoutTriggered) {
      return (
        <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-50 select-none p-6">
          <div className="relative w-24 h-24 mb-8 flex items-center justify-center bg-rose-500/10 border-4 border-rose-500 rounded-full animate-bounce">
            <AlertTriangle className="w-10 h-10 text-rose-500" />
          </div>

          <div className="max-w-md w-full space-y-6 text-center">
            <div className="space-y-1">
              <h2 className="text-lg font-black uppercase tracking-wider text-white">
                INITIALIZATION FAILED
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                {errorMessage || "Preparing racing grids & assets"}
              </p>
            </div>

            {/* Status logs */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-left space-y-2 font-mono text-xs max-w-sm mx-auto">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">1. Connected to Room:</span>
                <span className={initLogs.connectedToRoom === "success" ? "text-emerald-400 font-bold" : initLogs.connectedToRoom === "failed" ? "text-rose-500 font-bold" : "text-amber-400 animate-pulse font-bold"}>
                  {initLogs.connectedToRoom.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">2. Firestore Loaded:</span>
                <span className={initLogs.firestoreRoomLoaded === "success" ? "text-emerald-400 font-bold" : initLogs.firestoreRoomLoaded === "failed" ? "text-rose-500 font-bold" : "text-amber-400 animate-pulse font-bold"}>
                  {initLogs.firestoreRoomLoaded.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">3. WebSocket Bypass (Firestore Sync):</span>
                <span className={initLogs.websocketConnected === "success" ? "text-emerald-400 font-bold" : "text-amber-400 animate-pulse font-bold"}>
                  {initLogs.websocketConnected === "success" ? "ACTIVE" : "PENDING"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">4. Map Cache Check:</span>
                <span className={initLogs.mapCacheChecked === "success" ? "text-emerald-400 font-bold" : initLogs.mapCacheChecked === "failed" ? "text-rose-500 font-bold" : "text-amber-400 animate-pulse font-bold"}>
                  {initLogs.mapCacheChecked.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">5. Map Downloaded:</span>
                <span className={initLogs.mapLoaded === "success" ? "text-emerald-400 font-bold" : initLogs.mapLoaded === "failed" ? "text-rose-500 font-bold" : "text-amber-400 animate-pulse font-bold"}>
                  {initLogs.mapLoaded.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">6. Physics Service:</span>
                <span className={initLogs.physicsInitialized === "success" ? "text-emerald-400 font-bold" : initLogs.physicsInitialized === "failed" ? "text-rose-500 font-bold" : "text-amber-400 animate-pulse font-bold"}>
                  {initLogs.physicsInitialized.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">7. Spawn Lineup:</span>
                <span className={initLogs.spawnPointsAssigned === "success" ? "text-emerald-400 font-bold" : initLogs.spawnPointsAssigned === "failed" ? "text-rose-500 font-bold" : "text-amber-400 animate-pulse font-bold"}>
                  {initLogs.spawnPointsAssigned.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="flex gap-4 justify-center pt-2">
              <button
                onClick={handleRetry}
                className="px-6 py-2.5 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 active:scale-95 text-slate-950 font-black font-mono text-xs rounded shadow-[0_0_12px_rgba(34,211,238,0.3)] transition-all duration-150 cursor-pointer"
              >
                RETRY INIT
              </button>
              <button
                onClick={() => navigate("/rooms")}
                className="px-6 py-2.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 font-black font-mono text-xs rounded transition-colors cursor-pointer"
              >
                EXIT LOBBY
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <MultiplayerRaceLoadingScreen
        roomCode={mp.room?.roomCode || mp.room?.code || ""}
        players={mp.room?.players || []}
        currentUserId={mp.playerId || RoomManager.getCurrentPlayerId() || ""}
        isHost={mp.room?.hostId === (mp.playerId || RoomManager.getCurrentPlayerId())}
        onRemovePlayer={handleRemovePlayer}
        mapVerified={mapVerified}
        mapDownloadProgress={mapDownloadProgress}
        mapDownloadReady={mapDownloadReady}
        carVerified={carVerified}
        carDownloadProgress={carDownloadProgress}
        carDownloadReady={carDownloadReady}
        glbParsing={glbParsing}
        glbParsed={glbParsed}
        vehicleInitProgress={vehicleInitProgress}
        vehicleInitReady={vehicleInitReady}
        allPlayersReadyTriggered={allPlayersReadyTriggered}
        onExit={handleExitConfirm}
        countdownRemaining={mp.room?.status === "countdown" ? countdown : undefined}
        countdownMsg={mp.room?.status === "countdown" ? countdownMsg : undefined}
        countdownStatus={mp.room?.status}
      />
    );
  }

  const currentPl = cars.find((c) => c.id === "player") || cars[0];
  const currentOpponents = cars.filter((c) => c.id !== "player" && !c.id.startsWith("traffic"));

  const gameSettings: GameSettings = {
    playerName: currentPl?.name || "Driver",
    difficulty: mp.room.difficulty || "medium",
    carColor: currentPl?.color || "#0062ff",
    selectedCar: mp.room.selectedCar || "ferrari",
    selectedMap: mp.room.map || mp.room.selectedMap || "map1",
  };

  const weatherValue = mp.room.weather ? mp.room.weather.toLowerCase() : "sunny";

  return (
    <div
      id="ai-race-root"
      className="fixed top-0 left-0 w-screen h-[100dvh] overflow-hidden bg-black flex flex-col m-0 p-0 rounded-none max-w-none select-none"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100dvh",
        zIndex: 40,
      }}
    >
      {/* Three.js interactive Canvas component */}
      <GameCanvas
        cars={cars}
        playerControls={controls}
        physicsService={physicsService}
        trackHelper={trackHelper}
        isPaused={isPaused}
        gameState={phase}
        onFinishRace={handleRaceFinish}
        onTick={handleTickUpdate}
        soundEnabled={true}
        timeOfDay="noon"
        weather={weatherValue}
        raceSettings={gameSettings}
      />

      {/* Multiplayer Loader Overlay */}
      {loadingMultiplayer && (
        <MultiplayerRaceLoadingScreen
          roomCode={mp.room?.roomCode || mp.room?.code || ""}
          players={mp.room?.players || []}
          currentUserId={mp.playerId || RoomManager.getCurrentPlayerId() || ""}
          isHost={mp.room?.hostId === (mp.playerId || RoomManager.getCurrentPlayerId())}
          onRemovePlayer={handleRemovePlayer}
          mapVerified={mapVerified}
          mapDownloadProgress={mapDownloadProgress}
          mapDownloadReady={mapDownloadReady}
          carVerified={carVerified}
          carDownloadProgress={carDownloadProgress}
          carDownloadReady={carDownloadReady}
          glbParsing={glbParsing}
          glbParsed={glbParsed}
          vehicleInitProgress={vehicleInitProgress}
          vehicleInitReady={vehicleInitReady}
          allPlayersReadyTriggered={allPlayersReadyTriggered}
          onExit={handleExitConfirm}
          countdownRemaining={mp.room?.status === "countdown" ? countdown : undefined}
          countdownMsg={mp.room?.status === "countdown" ? countdownMsg : undefined}
          countdownStatus={mp.room?.status}
        />
      )}

      {/* Countdown overlay */}
      {phase === "countdown" && !loadingMultiplayer && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none z-30 font-sans">
          <div className="p-8 max-w-sm text-center">
            <span className="text-[10px] uppercase font-black text-cyan-400 tracking-widest block mb-1">
              {countdownLabel}
            </span>
            <h1 className="text-8xl font-black font-mono tracking-tight text-white scale-up animate-pulse">
              {countdownMsg}
            </h1>
          </div>
        </div>
      )}

      {/* HUD and dashboard overlays */}
      {(phase === "racing" || phase === "countdown") && !loadingMultiplayer && currentPl && (
        <HUD
          player={currentPl}
          opponents={currentOpponents}
          controls={controls}
          setControls={setControls}
          elapsedTime={elapsedTime}
          trackHelper={trackHelper}
          onPauseToggle={() => phase === "racing" && setIsPaused((prev) => !prev)}
          isPaused={isPaused}
          onExitRace={() => {
            setShowExitDialog(true);
            setIsPaused(true);
          }}
        />
      )}

      {/* Room multiplayer headers */}
      {(phase === "racing" || phase === "countdown") && !loadingMultiplayer && (
        <RoomCodeHUD
          roomCode={mp.room.code}
          playersCount={mp.room.players.length}
          isLiveMode={mp.room.isLiveMode}
        />
      )}

      {/* GameOver celebration statistics */}
      {phase === "completed" && currentPl && (
        <ErrorBoundary
          fallback={null}
          onError={(error) => {
            console.error("GameOver rendering crashed! Automatically navigating back to Rooms.", error);
            setPhase("menu");
            navigate("/rooms");
          }}
        >
          <GameOver
            player={currentPl}
            opponents={currentOpponents}
            elapsedTime={elapsedTime}
            onRestart={async () => {
              if (mp.room && mp.room.hostId === mp.playerId) {
                mp.startRaceNow();
              }
            }}
            onHome={handleHomeMenu}
          />
        </ErrorBoundary>
      )}

      {/* Exit Confirmation Dialog */}
      {showExitDialog && (
        <div id="exit-confirmation-dialog" className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-md z-[999] p-4">
          <div className="relative max-w-sm w-full bg-slate-900/95 border-2 border-red-500/40 rounded-xl p-6 shadow-[0_0_30px_rgba(239,68,68,0.2)] animate-in fade-in zoom-in duration-200 text-center">
            {/* Cyberpunk corner bracket styling for modal */}
            <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-red-500" />
            <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-red-500" />
            <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-red-500" />
            <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-red-500" />

            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center text-red-500 animate-pulse">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-black tracking-wider text-red-500 uppercase font-sans">
                  LEAVE RAGE CORRIDOR?
                </h3>
                <p className="text-xs text-slate-400 font-mono leading-relaxed">
                  Are you sure you want to leave the race? Your current progression in this arena feed will be discarded.
                </p>
              </div>
              
              <div className="flex gap-3 w-full pt-2">
                <button
                  id="cancel-exit-btn"
                  onClick={() => {
                    setShowExitDialog(false);
                    setIsPaused(false);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 font-bold font-mono text-xs rounded border border-slate-700 transition-all cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  id="confirm-exit-btn"
                  onClick={handleExitConfirm}
                  className="flex-1 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 active:scale-95 text-white font-black font-mono text-xs rounded shadow-[0_0_15px_rgba(239,68,68,0.4)] transition-all cursor-pointer"
                >
                  EXIT RACE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const UserRacePage: React.FC = () => {
  return <RaceScene />;
};

export default UserRacePage;
