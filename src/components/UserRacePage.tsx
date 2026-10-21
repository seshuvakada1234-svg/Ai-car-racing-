// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { setPlayerSelectedModelKey } from "../world/procedural";
import { SyncManager } from "../multiplayer/SyncManager";
import { Loader2, Compass, CheckCircle2, AlertTriangle, LogOut } from "lucide-react";
import * as THREE from "three";
import { GameSettings, CarState, ControlsState, GamePhase } from "../types";
import { MultiplayerRaceLoadingScreen } from "./MultiplayerRaceLoadingScreen";
import { NormalRoomService } from "../multiplayer/NormalRoomService";
import { loadRacingMap } from "../services/racingMapAsset";
import { verifyCar, getNormalizedCarKey } from "../services/assetLoadingManager";
import { Racing2World } from "../world/Racing2World";
import { buildMultiplayerLineup } from "../multiplayer/raceInitialization";
import { connectVehicleSocket, sendVehicleUpdate, triggerWsStartRace } from "../network/vehicleSocket";
import {
  startCountdown,
  beginRace,
  getSynchronizedServerTime,
  measureServerTimeOffset,
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

const WS_START_DELAY_MS = 5000;
const GO_HOLD_MS = 1000;

const getMillisFromServerTime = (value: any): number | null => {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toDate === "function") {
    const dateValue = value.toDate();
    if (dateValue instanceof Date) {
      const ms = dateValue.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
  }
  if (typeof value.seconds === "number") {
    const nanos = typeof value.nanoseconds === "number" ? value.nanoseconds : 0;
    const ms = value.seconds * 1000 + Math.floor(nanos / 1000000);
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

export const RaceScene: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const normalizedCode = (roomCode || "").trim().toUpperCase();

  const mp = useMultiplayer(undefined, normalizedCode);
  const roomRef = useRef(mp.room);
  roomRef.current = mp.room;
  const activePlayerId = mp.playerId || "";
  const isMember = !!mp.room?.players.some((p) => (p.uid || p.id) === activePlayerId);
  const activeMapId = mp.room?.map || "map1";
  const [loadingStatusReset, setLoadingStatusReset] = useState(false);
  const [preparedWorld, setPreparedWorld] = useState<Racing2World | null>(null);
  const latestPlayerStates = useRef(new Map<string, any>());
  const resetLoadingRef = useRef<Promise<void> | null>(null);

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

  const logStep = useCallback((step: keyof typeof initLogs, status: "success" | "failed" | "pending") => {
    console.log(`[Race Init Log] ${step.toUpperCase()}: ${status}`);
    setInitLogs((prev) => ({
      ...prev,
      [step]: status,
    }));
  }, []);

  const reportInitError = useCallback((step: keyof typeof initLogs, error: unknown) => {
    // Preserve the original exception/stack and identify the exact failing stage.
    console.error(`[Race Init] ${step} failed`, { roomCode: normalizedCode, playerId: activePlayerId, map: roomRef.current?.map }, error);
    logStep(step, "failed");
    setErrorMessage(error instanceof Error ? error.message : String(error));
    setInitTimeoutTriggered(true);
    if (roomRef.current?.players.some((player) => (player.uid || player.id) === activePlayerId)) {
      void NormalRoomService.updatePlayerLoadingStatus(normalizedCode, activePlayerId, {
        ready: false, sceneReady: false, vehicleInitialized: false,
      }).catch((statusError) => console.error("[Race Init] Could not publish failed readiness:", statusError));
    }
  }, [normalizedCode, activePlayerId, logStep]);

  useEffect(() => {
    const onVehicleError = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string }>).detail;
      reportInitError("playerCarSpawned", new Error(detail?.message || "Vehicle model initialization failed"));
    };
    window.addEventListener("race:vehicleLoadError", onVehicleError);
    return () => window.removeEventListener("race:vehicleLoadError", onVehicleError);
  }, [reportInitError]);

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

  const allPlayersReadyTriggered = !!mp.room?.players.length && mp.room.players.filter((p) => !p.isAI)
    .every((p) => p.mapReady && p.carReady && p.sceneReady && p.ready);
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
      
      await mp.leaveRoom();
      navigate("/rooms");
    } catch (err) {
      console.error("[Exit Race] Failed to exit cleanly:", err);
      toast.error(err instanceof Error ? err.message : "Could not leave the room. Please retry.");
      setIsExiting(false);
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
    if (mp.roomMissing && !mp.error) {
      if (isExiting) {
        // Voluntarily leaving, do not show opponents remaining toast
      } else {
        console.log("Room deleted or canceled during active race. Returning to garage.");
        sessionStorage.setItem("room_closed_no_opponents", "true");
        RoomManager.clearSession(normalizedCode);
        navigate("/garage");
      }
    }
  }, [mp.roomMissing, mp.error, isExiting, navigate, normalizedCode]);

  useEffect(() => {
    if (isExiting) return;
    if (mp.error) reportInitError("firestoreRoomLoaded", new Error(mp.error));
    else if (mp.room && activePlayerId && !isMember) {
      reportInitError("connectedToRoom", new Error("The signed-in player is not a member of this room. Join through the lobby first."));
    } else if (isMember && mp.room?.status === "waiting") {
      navigate(`/room/${normalizedCode}`, { replace: true });
    }
  }, [mp.error, mp.room?.roomCode, mp.room?.status, isMember, activePlayerId, isExiting, normalizedCode, navigate, reportInitError]);

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
  const countdownRequestedRef = useRef(false);
  const raceStartSignalSentRef = useRef(false);
  const raceStartTransitionedRef = useRef(false);

  // Clean initialization values on mount or room change
  useEffect(() => {
    (window as any).playerCarAddedToScene = false;
    (window as any).carLoaded = false;
    (window as any).remoteVehicles = {};
    (window as any).mapLoaded = false;
    (window as any).worldReady = false;
    (window as any).shadersCompiled = false;
    (window as any).countdownStuckSecs = 0;
    setWsRaceStartTime(null);
    countdownRequestedRef.current = false;
    raceStartSignalSentRef.current = false;
    raceStartTransitionedRef.current = false;
  }, [normalizedCode]);

  useEffect(() => {
    if (!mp.room) return;

    if (mp.room.status !== "countdown") {
      raceStartSignalSentRef.current = false;
    }

    if (!(mp.room.status === "racing" && !mp.room.raceStarted)) {
      countdownRequestedRef.current = false;
    }

    if (mp.room.status !== "countdown" && !(mp.room.status === "racing" && mp.room.raceStarted)) {
      raceStartTransitionedRef.current = false;
    }
  }, [mp.room?.status, mp.room?.raceStarted]);

  // 1. Room Connection & Firestore state logging
  useEffect(() => {
    if (normalizedCode) {
      logStep("connectedToRoom", isMember ? "success" : "pending");
    } else {
      logStep("connectedToRoom", "failed");
    }
  }, [normalizedCode, isMember, logStep]);

  useEffect(() => {
    if (mp.room) {
      logStep("firestoreRoomLoaded", "success");
      logStep("websocketConnected", "success"); // Bypassed with Firestore
    }
  }, [mp.room, logStep]);

  // 2. Retry handler
  const handleRetry = () => {
    mp.retryRoom();
    onRetry();
  };

  // Firestore may be offline without an error callback. Offer retry, never a
  // deletion notice. Downloads have their own inactivity timeout per source.
  useEffect(() => {
    if (mp.room || mp.error || mp.roomMissing) return;
    const timer = setTimeout(() => {
      reportInitError("firestoreRoomLoaded", new Error("Timed out waiting for room data. Check your connection and retry."));
    }, 30000);
    return () => clearTimeout(timer);
  }, [mp.room, mp.error, mp.roomMissing, reportInitError]);

  // Check map cache and trigger download if needed
  useEffect(() => {
    if (!loadingStatusReset || !isMember) return;
    let active = true;
    let lastWrite = 0;
    let writes = Promise.resolve();
    const run = async () => {
      try {
        setIsCheckingCache(true);
        if (activeMapId === "race2map" || activeMapId === "racing2") {
          await loadRacingMap((progress) => {
            if (!active) return;
            setIsCheckingCache(false);
            setMapDownloadProgress(progress.percentage);
            setDownloadedMB(progress.bytesLoaded / 1024 / 1024);
            setTotalMB((progress.bytesTotal || 0) / 1024 / 1024);
            if (Date.now() - lastWrite >= 1000 && progress.percentage < 100) {
              lastWrite = Date.now();
              writes = writes.then(async () => {
                if (active) await NormalRoomService.updatePlayerLoadingStatus(normalizedCode, activePlayerId, { mapProgress: progress.percentage });
              }).catch((error) => console.error("[Race Init] Map progress write failed:", error));
            }
          });
        }
        await writes;
        if (!active) return;
        await NormalRoomService.updatePlayerLoadingStatus(normalizedCode, activePlayerId, { mapReady: true, mapProgress: 100 });
        if (!active) return;
        logStep("mapCacheChecked", "success");
        logStep("mapLoaded", "success");
        setMapVerified(true);
        setMapReadyLocal(true);
        setMapDownloadReady(true);
        setMapDownloadProgress(100);
        setIsCheckingCache(false);
      } catch (error) {
        if (active) reportInitError("mapLoaded", error);
      }
    };
    void run();
    return () => { active = false; };
  }, [activeMapId, normalizedCode, activePlayerId, loadingStatusReset, isMember, logStep, reportInitError]);

  // Load selected vehicles for all players in the room
  useEffect(() => {
    if (!mapReadyLocal || !isMember) return;
    let active = true;
    let lastWrite = 0;
    let writes = Promise.resolve();

    const loadAllPlayerCars = async () => {
      try {
        const room = roomRef.current;
        const localRacer = room.players.find((p) => (p.uid || p.id) === activePlayerId);
        const myKey = getNormalizedCarKey(getCarIdString(localRacer.carId));
        const keys = [...new Set(room.players.map((p) => getNormalizedCarKey(getCarIdString(p.carId))))];
        for (const key of keys) {
          if (!active) return;
          setCarLoadingLabel(`Loading vehicle: ${key}`);
          await verifyCar(key, (percentage) => {
            if (!active || key !== myKey) return;
            setCarDownloadProgress(percentage);
            setGlbParsing(percentage >= 99 && percentage < 100);
            if (Date.now() - lastWrite >= 1000 && percentage < 100) {
              lastWrite = Date.now();
              writes = writes.then(async () => {
                if (active) await NormalRoomService.updatePlayerLoadingStatus(normalizedCode, activePlayerId, { carProgress: percentage });
              }).catch((error) => console.error("[Race Init] Car progress write failed:", error));
            }
          });
        }
        await writes;
        if (!active) return;
        await NormalRoomService.updatePlayerLoadingStatus(normalizedCode, activePlayerId, { carReady: true, carProgress: 100, glbParsing: false });
        if (!active) return;
        setCarVerified(true);
        setCarDownloadProgress(100);
        setCarDownloadReady(true);
        setGlbParsing(false);
        setGlbParsed(true);
        setCarsLoadedMap(true);
      } catch (error) {
        if (active) reportInitError("playerCarSpawned", error);
      }
    };

    loadAllPlayerCars();

    return () => {
      active = false;
    };
  }, [normalizedCode, activePlayerId, mapReadyLocal, isMember, reportInitError]);

  // Load track helper, physics service, and spawn racers
  useEffect(() => {
    if (!mapReadyLocal || !carsLoadedMap || !isMember) return;
    let active = true;
    let world: Racing2World | null = null;
    const initialize = async () => {
      let stage: keyof typeof initLogs = "mapLoaded";
      try {
        const helper = new TrackGeometryHelper(activeMapId);
        if (helper.mapType === "racing2") {
          // Parse and bake the actual GLB before computing any player transform.
          world = new Racing2World(new THREE.Scene(), helper, false);
          await world.readyPromise;
        }
        if (!active) return;
        stage = "physicsInitialized";
        const physics = new GamePhysicsService(helper);
        logStep("physicsInitialized", "success");
        stage = "spawnPointsAssigned";
        const room = roomRef.current;
        const lineup = buildMultiplayerLineup(room, activePlayerId, helper, world?.gridSpawns, latestPlayerStates.current);
        const localRacer = room.players.find((p) => (p.uid || p.id) === activePlayerId);
        setPlayerSelectedModelKey(getNormalizedCarKey(getCarIdString(localRacer.carId)));
        setPreparedWorld(world);
        setTrackHelper(helper);
        setPhysicsService(physics);
        setCars(lineup);
        logStep("spawnPointsAssigned", "success");
        setVehicleInitProgress(30);
        setPhase("menu");
        setElapsedTime(0);
        setIsPaused(false);
      } catch (error) {
        if (active) reportInitError(stage, error);
      }
    };
    void initialize();
    return () => { active = false; world?.dispose(); };
  }, [activeMapId, normalizedCode, activePlayerId, mapReadyLocal, carsLoadedMap, isMember, logStep, reportInitError]);

  // Reset player's loading status on mount/entry to the race scene
  useEffect(() => {
    if (!isMember) return;
    let active = true;

    console.log("[Race Init] Resetting player loading status for a fresh race session...");
    resetLoadingRef.current ??= NormalRoomService.updatePlayerLoadingStatus(normalizedCode, activePlayerId, {
      mapReady: false,
      mapProgress: 0,
      carReady: false,
      carProgress: 0,
      glbParsing: false,
      vehicleInitialized: false,
      sceneReady: false,
      connected: true,
      ready: false
    });
    resetLoadingRef.current.then(() => {
      if (active) setLoadingStatusReset(true);
    }).catch((err) => {
      if (active) reportInitError("firestoreRoomLoaded", err);
    });
    void measureServerTimeOffset(normalizedCode, activePlayerId);
    return () => { active = false; };
  }, [normalizedCode, activePlayerId, isMember, reportInitError]);

  // Reactive vehicle initialization tracker
  useEffect(() => {
    if (initTimeoutTriggered || !isMember || !mapReadyLocal || !carsLoadedMap || !trackHelper || !physicsService || cars.length === 0) return;

    let active = true;
    const timeout = setTimeout(() => {
      reportInitError("raceSceneMounted", new Error("The verified map and vehicles loaded, but the renderer did not finish mounting the player's car within 60 seconds."));
    }, 60000);
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
        clearTimeout(timeout);
        logStep("playerCarSpawned", "success");
        logStep("raceSceneMounted", "success");

        if (activePlayerId) {
          console.log("[Race Init] Local Vehicle Ready! Updating Firestore status to ready.");
          try {
            await NormalRoomService.updatePlayerLoadingStatus(normalizedCode, activePlayerId, {
              mapReady: true,
              carReady: true,
              vehicleInitialized: true,
              sceneReady: true,
              connected: true,
              ready: true
            });
          } catch (e) {
            if (active) reportInitError("firestoreRoomLoaded", e);
          }
        }
      }
    }, 200);

    return () => {
      active = false;
      clearInterval(checkInterval);
      clearTimeout(timeout);
    };
  }, [normalizedCode, activePlayerId, mapReadyLocal, carsLoadedMap, trackHelper, physicsService, cars.length, initTimeoutTriggered, isMember, logStep, reportInitError]);

  // Host continuously watches all players
  useEffect(() => {
    if (initTimeoutTriggered) return;
    if (!mp.room || !mp.room.players || !mp.room.roomCode) return;

    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    const isHost = mp.room.hostId === activePlayerId;
    if (!isHost) return;

    const humans = mp.room.players.filter((p: any) => !p.isAI);
    const everyoneReady = humans.length > 0 && humans.every(
      (p: any) => p.mapReady === true && p.carReady === true && p.sceneReady === true
    );

    if (mp.room.status !== "racing" || mp.room.raceStarted) {
      countdownRequestedRef.current = false;
      return;
    }

    if (!everyoneReady) return;
    if (countdownRequestedRef.current) return;
    countdownRequestedRef.current = true;

    if (mp.room.status === "racing" && !mp.room.raceStarted && everyoneReady) {
      console.log("[Host Action] All players ready! Updating room status to countdown with server timestamp.");
      startCountdown(mp.room.roomCode).catch((err) => {
        countdownRequestedRef.current = false;
        console.error("Failed to update room status to countdown:", err);
      });
    }
  }, [mp.room, mp.playerId, initTimeoutTriggered]);

  // Listen for room status and local loading readiness to manage game phase and loading screen
  useEffect(() => {
    if (!mp.room || !mp.room.roomCode) return;

    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    const isHost = mp.room.hostId === activePlayerId;
    const countdownStartMillis = getMillisFromServerTime(mp.room.countdownStartTime);
    const firestoreRaceStartTime = countdownStartMillis !== null ? countdownStartMillis + WS_START_DELAY_MS : null;
    const authoritativeRaceStartTime = firestoreRaceStartTime ?? wsRaceStartTime;

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

      // Host triggers server-authoritative start signal once per countdown phase.
      if (isHost && !raceStartSignalSentRef.current) {
        raceStartSignalSentRef.current = true;
        triggerWsStartRace();
      }

      // All clients render countdown from one shared authoritative future start timestamp.
      // Firestore is shared by relay-connected and relay-fallback clients alike.
      if (authoritativeRaceStartTime) {
        const tick = () => {
          const now = getSynchronizedServerTime();
          const msLeft = authoritativeRaceStartTime - now;
          const remaining = Math.ceil(msLeft / 1000);

          if (remaining > 0) {
            setCountdown(remaining);
            setCountdownMsg(String(remaining));
            setCountdownLabel("Get Ready!");
          } else if (msLeft > -GO_HOLD_MS) {
            // Show GO! for 1 second
            setCountdown(0);
            setCountdownMsg("GO!");
            setCountdownLabel("Green light");
          } else {
            if (!vehicleInitReady) {
              setLoadingMultiplayer(true);
              setCountdownStarted(false);
              setPhase("menu");
              return;
            }

            if (!raceStartTransitionedRef.current) {
              raceStartTransitionedRef.current = true;
              setLoadingMultiplayer(false);
              setPhase("racing");
              setCountdownStarted(false);
              lastTimeRef.current = Date.now();

              // Host only: update room status to racing in Firestore so spectators/broadcasters can follow
              if (isHost && !mp.room.raceStarted) {
                beginRace(mp.room.roomCode).catch((err) => {
                  console.error("Host failed to transition room to racing:", err);
                });
              }
            }
          }
        };

        tick();
        const intervalId = setInterval(tick, 100);
        return () => clearInterval(intervalId);
      } else {
        // Safe synchronization hold: never start from a local unsynchronized timer.
        setCountdown(5);
        setCountdownMsg("SYNC");
        setCountdownLabel("Awaiting start signal");
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
        if (!raceStartTransitionedRef.current) {
          raceStartTransitionedRef.current = true;
          lastTimeRef.current = Date.now();
        }
      }
    }
  }, [
    mp.room?.status,
    mp.room?.raceStarted,
    mp.room?.roomCode,
    mp.room?.hostId,
    mp.room?.countdownStartTime,
    mp.playerId,
    vehicleInitReady,
    wsRaceStartTime,
  ]);

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
      latestPlayerStates.current = new Map(playersList.map((p) => [p.uid, p]));
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
    }, (error) => reportInitError("firestoreRoomLoaded", error));

    return () => {
      unsub();
      remotePlayersMapRef.current.clear();
      latestPlayerStates.current.clear();
    };
  }, [mp.room?.roomCode, mp.playerId, reportInitError]);

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
        if (roomRef.current?.players.some((p) => (p.uid || p.id) === leftPid)) {
          console.info(`[Race] ${leftPid} lost the relay connection; retaining Firestore membership.`);
          return;
        }
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
        if (typeof startTime !== "number" || !Number.isFinite(startTime)) return;
        setWsRaceStartTime((prev) => (typeof prev === "number" ? Math.min(prev, startTime) : startTime));
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
        const pInfo = roomRef.current?.players?.find((p: any) => (p.uid || p.id) === remotePid);
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
          const pInfo = roomRef.current?.players?.find((p: any) => (p.uid || p.id) === remotePid);
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
        console.log("[CLIENT B] setCars completed", next);
        return next;
      });
      console.log("after setCars call in handleSinglePlayerUpdate (async completed)");
    }

    return () => {
      disconnectSocket();
    };
  }, [mp.room?.roomCode, mp.playerId]);

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
    void handleExitConfirm();
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
              <p className="text-xs text-slate-400 font-mono break-words max-h-40 overflow-y-auto">
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
                onClick={handleExitConfirm}
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
    selectedCar: currentPl?.carId || "ferrari",
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
      <ErrorBoundary fallback={null} onError={(error) => reportInitError("raceSceneMounted", error)}>
      <GameCanvas
        cars={cars}
        playerControls={controls}
        physicsService={physicsService}
        trackHelper={trackHelper}
        preparedWorld={preparedWorld}
        onInitializationError={(error) => reportInitError("raceSceneMounted", error)}
        isPaused={isPaused}
        gameState={phase}
        onFinishRace={handleRaceFinish}
        onTick={handleTickUpdate}
        soundEnabled={true}
        timeOfDay="noon"
        weather={weatherValue}
        raceSettings={gameSettings}
      />
      </ErrorBoundary>

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
  const { roomCode } = useParams<{ roomCode: string }>();
  const [attempt, setAttempt] = useState(0);
  return <RaceScene key={`${roomCode?.trim().toUpperCase()}:${attempt}`} onRetry={() => setAttempt((value) => value + 1)} />;
};

export default UserRacePage;
