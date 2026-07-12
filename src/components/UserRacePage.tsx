// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
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

  // Core Game State
  const [trackHelper, setTrackHelper] = useState<TrackGeometryHelper | null>(null);
  const [physicsService, setPhysicsService] = useState<GamePhysicsService | null>(null);
  const [cars, setCars] = useState<CarState[]>([]);
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

  const lastTimeRef = useRef<number>(Date.now());
  const countdownTimerRef = useRef<number | null>(null);

  // Clean initialization values on mount or room change
  useEffect(() => {
    (window as any).playerCarAddedToScene = false;
    (window as any).mapLoaded = false;
    (window as any).worldReady = false;
    (window as any).shadersCompiled = false;
    (window as any).countdownStuckSecs = 0;
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

      if (!isCustomMap) {
        logStep("mapCacheChecked", "success");
        logStep("mapLoaded", "success");
        setMapReadyLocal(true);
        setDownloadProgress(100);
        setIsCheckingCache(false);
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
          setIsCheckingCache(false);
          return;
        }

        // Trigger map download with progress reporting
        setIsCheckingCache(false);
        setDownloadProgress(0);

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
          setDownloadedMB(parseFloat((receivedBytes / (1024 * 1024)).toFixed(1)));
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
      } catch (err) {
        console.error("Map downloading/caching failed:", err);
        logStep("mapLoaded", "failed");
        // Graceful fallback to avoid locking users out in case of network issues
        setMapReadyLocal(true);
        setDownloadProgress(100);
        setIsCheckingCache(false);
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
        const uniqueCarIds = Array.from(
          new Set(
            mp.room.players.map((p: any) => {
              const cid = p.carId || "ferrari";
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
          const carMapKey = carId === "porsche"
            ? "porsche_911_gt3"
            : carId === "bugatti"
              ? "bugatti_chiron_top_edition"
              : "ferrari_purosangue";

          console.log(`[Race Init] Starting load for: ${carMapKey}`);
          setCarLoadingLabel(`Loading vehicle: ${carId.toUpperCase()}`);

          // Check if already loaded in gltfModelCache
          if (gltfModelCache[carMapKey as keyof typeof gltfModelCache]) {
            console.log(`[Race Init] GLB already loaded in cache for: ${carMapKey}`);
            setDownloadProgress(100);
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

      const rawCarId = localRacer?.carId || "ferrari";
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

        const pRawCarId = p.carId || "ferrari";
        const pBaseCarId = pRawCarId.toLowerCase().includes("porsche")
          ? "porsche"
          : pRawCarId.toLowerCase().includes("bugatti")
            ? "bugatti"
            : "ferrari";

        lineup.push({
          id: carId,
          name: p.playerName || p.name || "Driver",
          isAI: isAI && amIHost,
          color: p.carColor || "#0062ff",
          carId: pBaseCarId,
          position: { x: spawnPos.x, y: spawnY, z: spawnPos.z },
          velocity: { x: 0, y: 0, z: 0 },
          speed: 0,
          angle: startAngle,
          angularVelocity: 0,
          driftFactor: 0,
          isDrifting: false,
          currentLap: 1,
          currentCheckpointIndex: 0,
          distanceToNextCheckpoint: 999,
          racePosition: idx + 1,
          totalDistanceTraveled: -idx * 8.5,
          isFinished: false,
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
      setPhase("countdown");
      setCountdown(3);
      setElapsedTime(0);
      setIsPaused(false);
    } catch (e) {
      console.error("Physics or lineup initialization failed:", e);
      logStep("physicsInitialized", "failed");
      logStep("spawnPointsAssigned", "failed");
    }
  }, [mp.room?.id, mapReadyLocal, carsLoadedMap]);

  // Handle countdown sequences
  useEffect(() => {
    if (phase !== "countdown") return;

    const tickCountdown = () => {
      const isRacing2 = mp.room?.map === "racing2" || mp.room?.map === "race2map" || mp.room?.selectedMap === "racing2" || mp.room?.selectedMap === "race2map";
      
      if (!(window as any).countdownStuckSecs) {
        (window as any).countdownStuckSecs = 0;
      }

      let carLoaded = !!(window as any).carLoaded || !!(window as any).playerCarAddedToScene;
      let mapLoaded = !isRacing2 || !!(window as any).mapLoaded;
      let shadersCompiled = !!(window as any).shadersCompiled;
      let worldReady = !!(window as any).worldReady;

      if (!carLoaded) console.log("[Race Init] Waiting for playerCarAddedToScene / carLoaded...");
      else logStep("playerCarSpawned", "success");

      if (!mapLoaded) console.log("[Race Init] Waiting for mapLoaded...");
      else logStep("mapLoaded", "success");

      if (!worldReady) console.log("[Race Init] Waiting for worldReady...");
      else logStep("raceSceneMounted", "success");

      if (!carLoaded || !mapLoaded || !shadersCompiled || !worldReady) {
        (window as any).countdownStuckSecs += 1;
        
        // If stuck for more than 8 seconds, force-bypass constraints to ensure race start!
        if ((window as any).countdownStuckSecs > 8) {
          console.warn("[Race Init] 3D assets taking too long. Activating safety bypass.");
          (window as any).carLoaded = true;
          (window as any).playerCarAddedToScene = true;
          (window as any).mapLoaded = true;
          (window as any).shadersCompiled = true;
          (window as any).worldReady = true;

          carLoaded = true;
          mapLoaded = true;
          shadersCompiled = true;
          worldReady = true;

          logStep("playerCarSpawned", "success");
          logStep("mapLoaded", "success");
          logStep("raceSceneMounted", "success");
        } else {
          setCountdownLabel(isRacing2 ? "Synchronizing 3D road assets" : "Warming engine core");
          setCountdownMsg("...");
          return;
        }
      }

      logStep("playerCarSpawned", "success");
      logStep("raceSceneMounted", "success");

      setCountdown((prev) => {
        const next = prev - 1;
        if (next > 0) {
          setCountdownLabel("Match begins in");
          setCountdownMsg(String(next));
        } else if (next === 0) {
          setCountdownLabel("Green light");
          setCountdownMsg("GO!");
        } else if (next < 0) {
          setPhase("racing");
          lastTimeRef.current = Date.now();
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
        }
        return next;
      });
    };

    countdownTimerRef.current = window.setInterval(tickCountdown, 1000);

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [phase, mp.room?.map, mp.room?.selectedMap]);

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

  // Callback triggered inside the canvas animation frames
  const handleTickUpdate = (updatedCars: CarState[]) => {
    if (!mp.room) return;

    const playerCar = updatedCars.find((c) => c.id === "player");
    if (playerCar) {
      mp.sendLocalCar(playerCar);
    }

    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    const isHost = mp.room.hostId === activePlayerId;
    if (isHost) {
      const aiCars = updatedCars.filter((c) => c.isAI);
      if (aiCars.length > 0) {
        mp.sendAICars(aiCars);
      }
    }

    // Unpack remote cars
    const nextCars = updatedCars.map((car) => {
      if (car.id === "player") {
        const myPl = mp.room?.players?.find((p: any) => p.uid === activePlayerId || p.id === activePlayerId);
        const rawCid = myPl?.carId || car.carId || "ferrari";
        car.carId = rawCid.toLowerCase().includes("porsche")
          ? "porsche"
          : rawCid.toLowerCase().includes("bugatti")
            ? "bugatti"
            : "ferrari";
        return car;
      }

      const netId = car.id.startsWith("remote_") ? car.id.replace("remote_", "") : car.id;
      const netPlayer = mp.room?.players?.find((p: any) => p.id === netId || p.uid === netId);
      if (netPlayer) {
        const rawCid = netPlayer.carId || "ferrari";
        car.carId = rawCid.toLowerCase().includes("porsche")
          ? "porsche"
          : rawCid.toLowerCase().includes("bugatti")
            ? "bugatti"
            : "ferrari";
        if (netPlayer.position) {
          SyncManager.unpackCarState(car, netPlayer);
        }
      }
      return car;
    });

    setCars(nextCars);
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
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-50 select-none p-6">
        {initTimeoutTriggered ? (
          <div className="relative w-24 h-24 mb-8 flex items-center justify-center bg-rose-500/10 border-4 border-rose-500 rounded-full animate-bounce">
            <AlertTriangle className="w-10 h-10 text-rose-500" />
          </div>
        ) : (
          <div className="relative w-24 h-24 mb-8">
            <div className="absolute inset-0 rounded-full border-4 border-cyan-500/10" />
            <div className="absolute inset-0 rounded-full border-4 border-t-cyan-400 animate-spin" />
            <Compass className="absolute inset-0 m-auto w-10 h-10 text-cyan-400/50 rotate-45 animate-pulse" />
          </div>
        )}

        <div className="max-w-md w-full space-y-6 text-center">
          <div className="space-y-1">
            <h2 className="text-lg font-black uppercase tracking-wider text-white">
              {initTimeoutTriggered ? "INITIALIZATION FAILED" : "CONNECTING TO ARENA FEED..."}
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

          {initTimeoutTriggered && (
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
          )}

          {!isCheckingCache && downloadProgress !== null && !initTimeoutTriggered && (
            <div className="space-y-2">
              <div className="h-2 w-full bg-slate-900 border border-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 shadow-[0_0_12px_#22d3ee] rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono font-bold uppercase">
                <span>{carLoadingLabel || "PROGRESS"}</span>
                <span>
                  {downloadedMB > 0 ? `${downloadedMB}MB / ${totalMB}MB ` : ""}({downloadProgress}%)
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
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

      {/* Countdown overlay */}
      {phase === "countdown" && (
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
      {(phase === "racing" || phase === "countdown") && currentPl && (
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
      {(phase === "racing" || phase === "countdown") && (
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
