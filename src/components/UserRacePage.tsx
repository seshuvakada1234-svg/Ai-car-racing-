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
import { setPlayerSelectedModelKey } from "../world/procedural";
import { SyncManager } from "../multiplayer/SyncManager";
import { db } from "../lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { Loader2, Compass, CheckCircle2 } from "lucide-react";
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

  // Map downloading and cache states
  const [mapReadyLocal, setMapReadyLocal] = useState(false);
  const [isCheckingCache, setIsCheckingCache] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadedMB, setDownloadedMB] = useState<number>(0);
  const [totalMB, setTotalMB] = useState<number>(0);

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
  }, [normalizedCode]);

  // Check map cache and trigger download if needed
  useEffect(() => {
    if (!mp.room) return;

    const checkAndDownloadMap = async () => {
      const activeMapId = mp.room.map || mp.room.selectedMap || "map1";
      const isCustomMap = activeMapId === "race2map" || activeMapId === "racing2";

      if (!isCustomMap) {
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
        const cachedResponse = await cache.match(mapUrl);

        if (cachedResponse) {
          console.log("Map exists in browser cache!");
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
        setMapReadyLocal(true);
        setDownloadProgress(100);
      } catch (err) {
        console.error("Map downloading/caching failed:", err);
        // Graceful fallback to avoid locking users out in case of network issues
        setMapReadyLocal(true);
        setDownloadProgress(100);
        setIsCheckingCache(false);
      }
    };

    checkAndDownloadMap();
  }, [mp.room?.map, mp.room?.selectedMap, mp.room?.id]);

  // Load track helper, physics service, and spawn racers
  useEffect(() => {
    if (!mp.room || !mapReadyLocal) return;

    const activeMap = mp.room.map || mp.room.selectedMap || "map1";
    const helper = new TrackGeometryHelper(activeMap);
    const physics = new GamePhysicsService(helper);

    setTrackHelper(helper);
    setPhysicsService(physics);

    const activePlayerId = mp.playerId || RoomManager.getCurrentPlayerId();
    const localRacer = mp.room.players.find((p: any) => p.uid === activePlayerId || p.id === activePlayerId);

    const selectedCarId = localRacer?.carId || "ferrari";
    const modelKey =
      selectedCarId === "ferrari"
        ? "ferrari_purosangue"
        : selectedCarId === "bugatti"
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

      lineup.push({
        id: carId,
        name: p.playerName || p.name || "Driver",
        isAI: isAI && amIHost,
        color: p.carColor || "#0062ff",
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
    setPhase("countdown");
    setCountdown(3);
    setElapsedTime(0);
    setIsPaused(false);
  }, [mp.room?.id, mapReadyLocal]);

  // Handle countdown sequences
  useEffect(() => {
    if (phase !== "countdown") return;

    const tickCountdown = () => {
      const isRacing2 = mp.room?.map === "racing2" || mp.room?.map === "race2map" || mp.room?.selectedMap === "racing2" || mp.room?.selectedMap === "race2map";
      const carLoaded = !!(window as any).carLoaded || !!(window as any).playerCarAddedToScene;
      const mapLoaded = !isRacing2 || !!(window as any).mapLoaded;
      const shadersCompiled = !!(window as any).shadersCompiled;
      const worldReady = !!(window as any).worldReady;

      if (!carLoaded || !mapLoaded || !shadersCompiled || !worldReady) {
        setCountdownLabel(isRacing2 ? "Synchronizing 3D road assets" : "Warming engine core");
        setCountdownMsg("...");
        return;
      }

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
      if (car.id === "player") return car;

      const netId = car.id.startsWith("remote_") ? car.id.replace("remote_", "") : car.id;
      const netPlayer = mp.room.players.find((p: any) => p.id === netId || p.uid === netId);
      if (netPlayer && netPlayer.position) {
        SyncManager.unpackCarState(car, netPlayer);
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

  if (!mp.room) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-50">
        <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mb-4" />
        <p className="text-slate-400 font-mono tracking-wider text-xs uppercase animate-pulse">
          Connecting to Arena Feed...
        </p>
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

  // Render download and check progress UI before loading physics/3D
  if (isCheckingCache || !mapReadyLocal || !trackHelper || !physicsService || cars.length === 0) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-50 select-none p-6">
        <div className="relative w-24 h-24 mb-8">
          <div className="absolute inset-0 rounded-full border-4 border-cyan-500/10" />
          <div className="absolute inset-0 rounded-full border-4 border-t-cyan-400 animate-spin" />
          <Compass className="absolute inset-0 m-auto w-10 h-10 text-cyan-400/50 rotate-45" />
        </div>

        <div className="max-w-md w-full space-y-5 text-center">
          <div className="space-y-1">
            <h2 className="text-lg font-black uppercase tracking-wider text-white">
              {isCheckingCache ? "VERIFYING TRACK..." : "DOWNLOADING GRID MAP..."}
            </h2>
            <p className="text-xs text-slate-400 font-mono">
              {isCheckingCache
                ? "Locating offline cache partitions"
                : `Downloading ${mp.room.map || mp.room.selectedMap || "custom"} environment assets`}
            </p>
          </div>

          {!isCheckingCache && downloadProgress !== null && (
            <div className="space-y-2">
              <div className="h-2 w-full bg-slate-900 border border-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 shadow-[0_0_12px_#22d3ee] rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono font-bold uppercase">
                <span>PROGRESS</span>
                <span>
                  {downloadedMB}MB / {totalMB}MB ({downloadProgress}%)
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

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
    </div>
  );
};

export const UserRacePage: React.FC = () => {
  return <RaceScene />;
};

export default UserRacePage;
