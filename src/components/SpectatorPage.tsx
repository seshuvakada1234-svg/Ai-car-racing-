// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { LiveRoomService, LiveCurrentState } from "../services/EsportsStudioServices";
import { NormalRoomService, NormalPlayer } from "../multiplayer/NormalRoomService";
import { TrackGeometryHelper } from "../utils/track";
import { GamePhysicsService } from "../physics/GamePhysics";
import { GameCanvas } from "./GameCanvas";
import { terrainManager } from "../world/TerrainManager";
import { CarState } from "../types";
import * as THREE from "three";
import {
  Tv,
  Radio,
  Wifi,
  Volume2,
  VolumeX,
  Maximize2,
  ShieldAlert,
  Loader2,
  Cpu,
  Activity,
  Clock,
  Layers,
  Flame,
  Award,
  Compass,
  RefreshCw,
} from "lucide-react";

export const SpectatorPage: React.FC = () => {
  const navigate = useNavigate();
  const { profile, logout } = useAuth();

  // Firestore & Room States
  const [liveCurrent, setLiveCurrent] = useState<LiveCurrentState | null>(null);
  const [players, setPlayers] = useState<NormalPlayer[]>([]);
  const [racePhase, setRacePhase] = useState<"standby" | "loading" | "racing">("standby");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [cars, setCars] = useState<CarState[]>([]);

  // Sound and Video states
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [interactionUnlocked, setInteractionUnlocked] = useState(false);
  const [mouseActive, setMouseActive] = useState(true);

  // References for WebGL systems
  const trackHelperRef = useRef<TrackGeometryHelper | null>(null);
  const physicsServiceRef = useRef<GamePhysicsService | null>(null);
  const isInitRef = useRef<string | null>(null); // Track room code initialized
  const playersRef = useRef<NormalPlayer[]>([]);
  const lastWriteRef = useRef(0);
  const mouseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  // 1. Subscribe to Live/Current document in real time (Continuous tracking & auto-reconnect)
  useEffect(() => {
    console.log("Spectator: Starting live/current listener...");
    const unsubLive = LiveRoomService.subscribeToLiveCurrent((liveState) => {
      setLiveCurrent(liveState);
    });

    return () => {
      unsubLive();
    };
  }, []);

  // 2. Manage room state changes, subscriptions, and re-initializations
  useEffect(() => {
    if (!liveCurrent || !liveCurrent.roomCode || liveCurrent.status === "archived" || liveCurrent.status === "closed") {
      setRacePhase("standby");
      isInitRef.current = null;
      setPlayers([]);
      setCars([]);
      return;
    }

    const currentRoomCode = liveCurrent.roomCode;

    // If room code has changed, re-initialize subscriptions
    if (isInitRef.current !== currentRoomCode) {
      console.log(`Spectator: Detected new official room: ${currentRoomCode}. Reconnecting subscriptions...`);
      isInitRef.current = currentRoomCode;
      setRacePhase("loading");

      // Unsubscribe triggers are handled by the callback unsubscribing on cleanup
      const unsubPlayers = NormalRoomService.listenToPlayers(currentRoomCode, (updatedPlayers) => {
        setPlayers(updatedPlayers);
      });

      return () => {
        unsubPlayers();
      };
    }
  }, [liveCurrent]);

  // 3. 3D WebGL Canvas Initialization once players and room are active
  useEffect(() => {
    if (!liveCurrent || players.length === 0 || isInitRef.current !== liveCurrent.roomCode) return;

    // Build the 3D tracks and models once
    if (racePhase === "loading") {
      console.log(`Spectator: Initializing 3D graphics for map: ${liveCurrent.map}`);

      const mapId =
        liveCurrent.map === "Dragon Mountain" ? "map1" : liveCurrent.map === "Neon Gridway" ? "map2" : "map1";

      const helper = new TrackGeometryHelper(mapId);
      trackHelperRef.current = helper;
      physicsServiceRef.current = new GamePhysicsService(helper);

      // Build initial lineup
      const curveLength = helper.curve.getLength();
      const wheelRadius = 0.38;
      const lineup: CarState[] = [];

      players.forEach((p, idx) => {
        const side = idx % 2 === 0 ? -1 : 1;
        const spacingDistance = 15.0 + idx * 8.0;
        const progress = (((1.0 - spacingDistance / curveLength) % 1.0) + 1.0) % 1.0;

        const pt = helper.curve.getPointAt(progress);
        const tangent = helper.curve.getTangentAt(progress).normalize();
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const spawnPos = pt.clone().addScaledVector(normal, side * 2.5);

        const roadHeight = terrainManager.getRoadHeight(spawnPos);
        const spawnY = roadHeight + wheelRadius;
        const startAngle = Math.atan2(tangent.x, tangent.z);

        // Spectator doesn't have a local car, so we mark the leading/first player as focus ('player')
        const carId = idx === 0 ? "player" : `remote_${p.uid}`;

        lineup.push({
          id: carId,
          name: p.playerName,
          isAI: p.uid.startsWith("bot_"),
          color: p.carColor || (idx === 0 ? "#ff0055" : idx === 1 ? "#00ccff" : "#ffcc00"),
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
          nitroCharged: 100,
          isNitroActive: false,
          stuckTimer: 0,
          aiTargetNode: 0,
          aiSpeedFactor: 1,
          aiAggression: 0.72,
        });
      });

      setCars(lineup);
      setElapsedTime(0);
      setRacePhase("racing");
    }
  }, [liveCurrent, players, racePhase]);

  // 4. Live Timer ticking
  useEffect(() => {
    if (racePhase !== "racing") return;

    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 10);
    }, 10);

    return () => clearInterval(interval);
  }, [racePhase]);

  // 5. Mouse inactivity cursor hiding (OBS overlay friendly)
  useEffect(() => {
    const handleMouseMove = () => {
      setMouseActive(true);
      if (mouseTimeoutRef.current) clearTimeout(mouseTimeoutRef.current);

      mouseTimeoutRef.current = setTimeout(() => {
        setMouseActive(false);
      }, 2000);
    };

    window.addEventListener("mousemove", handleMouseMove);
    handleMouseMove(); // start initial timer

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (mouseTimeoutRef.current) clearTimeout(mouseTimeoutRef.current);
    };
  }, []);

  // Fullscreen trigger and interaction unlock
  const handleStartTransmission = () => {
    setInteractionUnlocked(true);

    // Unlock Fullscreen
    try {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        elem
          .requestFullscreen()
          .then(() => {
            setIsFullscreen(true);
          })
          .catch(() => {});
      }
    } catch (e) {}
  };

  // 3D tick update coordinates mapper
  const handleTickUpdate = (updatedCars: CarState[]) => {
    const nextCars = updatedCars.map((car) => {
      // Find the correct remote player in Firestore list
      const uid = car.id === "player" ? playersRef.current[0]?.uid || "" : car.id.replace("remote_", "");
      const remote = playersRef.current.find((p) => p.uid === uid);

      if (remote && remote.position) {
        car.position.x = remote.position.x;
        car.position.y = remote.position.y;
        car.position.z = remote.position.z;
        car.velocity.x = remote.velocity?.x || 0;
        car.velocity.y = remote.velocity?.y || 0;
        car.velocity.z = remote.velocity?.z || 0;
        car.angle = remote.angle || 0;
        car.speed = remote.speed || 0;
        car.isDrifting = remote.isDrifting || false;
        car.currentLap = remote.currentLap || 1;
        car.isFinished = remote.isFinished || false;
        car.totalDistanceTraveled = remote.totalDistanceTraveled || 0;
      }
      return car;
    });

    // Re-rank cars dynamically based on distance traveled
    const sorted = [...nextCars].sort((a, b) => {
      const distA = a.totalDistanceTraveled || 0;
      const distB = b.totalDistanceTraveled || 0;
      return distB - distA;
    });

    // Assign rank positions
    const ranked = nextCars.map((c) => {
      const idx = sorted.findIndex((s) => s.id === c.id);
      c.racePosition = idx + 1;
      return c;
    });

    setCars(ranked);
  };

  // Convert milliseconds into highly readable standard stopwatch race timer (MM:SS.CC)
  const formatStopwatch = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
  };

  // ----------------------------------------------------
  // SCREEN 1: PRE-STREAM USER INTERACTION UNLOCK SCREEN
  // ----------------------------------------------------
  if (!interactionUnlocked) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-50 p-6">
        <div className="max-w-md text-center space-y-6 bg-slate-900/60 p-8 rounded-3xl border border-slate-800 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          {/* Decorative neon borders */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-pink-500 to-amber-500" />

          <div className="mx-auto w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center animate-pulse">
            <Tv className="w-8 h-8 text-cyan-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-black uppercase tracking-wider text-slate-100">Live TV Stream Client</h1>
            <p className="text-xs text-slate-400 leading-relaxed font-mono">
              Role: <span className="text-cyan-400 font-bold uppercase">{profile?.role || "SPECTATOR"}</span>
            </p>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Ready to broadcast 3D live racing telemetry. Click the button to launch fullscreen and enable 3D spatial
              esports sound.
            </p>
          </div>

          <button
            onClick={handleStartTransmission}
            className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-black uppercase text-xs tracking-widest rounded-2xl transition duration-150 shadow-[0_4px_25px_rgba(6,182,212,0.3)] cursor-pointer"
          >
            START TRANSMISSION
          </button>

          {profile && (
            <button
              onClick={() => logout()}
              className="text-xs text-slate-500 hover:text-slate-300 transition underline pt-2 block mx-auto cursor-pointer"
            >
              Logout Account
            </button>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // SCREEN 2: STANDBY SCREEN (DURING OFF-RACE INTERVALS)
  // ----------------------------------------------------
  if (racePhase === "standby" || !liveCurrent) {
    return (
      <div className="fixed inset-0 bg-slate-950 overflow-hidden font-sans text-white z-50 flex flex-col items-center justify-center p-6 relative">
        {/* Animated background ambient grids */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-40" />

        <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
          {/* Main Status Panel */}
          <div className="md:col-span-2 bg-slate-900/60 border border-slate-800/80 p-8 rounded-3xl backdrop-blur-md flex flex-col justify-between space-y-8">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <span className="text-[10px] font-black tracking-widest text-emerald-400 uppercase font-mono">
                  STREAM CLIENT ONLINE
                </span>
              </div>

              <div className="space-y-1">
                <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-100">STANDBY MODE</h1>
                <p className="text-xs text-slate-400 max-w-md">
                  Waiting for Broadcaster to initiate the next official live event. The 3D render pipeline is idling to
                  preserve system resources.
                </p>
              </div>
            </div>

            {/* Quick status cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-900 flex items-center space-x-3.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">RTMP STATUS</p>
                  <p className="text-xs font-black text-slate-200">ACTIVE FEED</p>
                </div>
              </div>

              <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-900 flex items-center space-x-3.5">
                <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
                  <Layers className="w-4 h-4 text-pink-400" />
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">LATENCY RATE</p>
                  <p className="text-xs font-black text-slate-200">~18ms ultra-low</p>
                </div>
              </div>
            </div>
          </div>

          {/* Telemetry sidebar card */}
          <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl backdrop-blur-md flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <h3 className="text-[11px] font-black tracking-widest uppercase text-slate-400 border-b border-slate-800 pb-2 flex items-center justify-between">
                <span>SYSTEM DIAGNOSTICS</span>
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              </h3>

              <div className="space-y-3 font-mono text-[11px]">
                <div className="flex justify-between py-1 border-b border-slate-900/40">
                  <span className="text-slate-500 uppercase">OBS ENCODER</span>
                  <span className="text-emerald-400 font-bold">CONNECTED</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/40">
                  <span className="text-slate-500 uppercase">FFMPEG INGRESS</span>
                  <span className="text-emerald-400 font-bold">CONNECTED</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/40">
                  <span className="text-slate-500 uppercase">RESOLUTION</span>
                  <span className="text-slate-300">1920x1080 60FPS</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/40">
                  <span className="text-slate-500 uppercase">FPS CAP</span>
                  <span className="text-slate-300">60 FPS</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500 uppercase">ACTIVE ROLE</span>
                  <span className="text-cyan-400 font-bold uppercase">{profile?.role || "STREAM_CLIENT"}</span>
                </div>
              </div>
            </div>

            {/* Quiet Logout */}
            <div className="pt-2 border-t border-slate-800/40 flex justify-between items-center">
              <span className="text-[9px] text-slate-600 font-mono">ID: {profile?.uid.substring(0, 8)}...</span>
              <button
                onClick={() => logout()}
                className="text-[10px] text-slate-500 hover:text-slate-300 transition underline cursor-pointer"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // SCREEN 3: LOADING ENGINE SCREEN
  // ----------------------------------------------------
  if (racePhase === "loading" || cars.length === 0) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-50">
        <div className="max-w-xs text-center space-y-4">
          <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto" />
          <div className="space-y-1">
            <p className="text-xs font-black uppercase tracking-widest text-slate-200">
              Spawning TV Broadcast Camera...
            </p>
            <p className="text-[10px] text-slate-500 font-mono uppercase">Preloading materials & vehicle textures</p>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // SCREEN 4: THE CINEMATIC RACING BROADCAST (ACTIVE VIEW)
  // ----------------------------------------------------
  const focusedCar = cars.find((c) => c.id === "player") || cars[0];
  const opponentsList = cars.filter((c) => c.id !== focusedCar.id);
  const activeCameraMode = liveCurrent.currentCamera || "third-person";

  return (
    <div
      id="esports-spectator-root"
      className={`fixed inset-0 bg-black overflow-hidden font-sans text-white z-40 m-0 p-0 rounded-none max-w-none select-none ${!mouseActive ? "cursor-none" : ""}`}
      style={{
        width: "100vw",
        height: "100vh",
        position: "fixed",
        margin: 0,
        padding: 0,
        borderRadius: 0,
        maxWidth: "none",
      }}
    >
      {/* 1. THE 3D WEBGL GRAPHICS ENVIRONMENT */}
      {trackHelperRef.current && physicsServiceRef.current && (
        <GameCanvas
          cars={cars}
          playerControls={{
            forward: false,
            backward: false,
            left: false,
            right: false,
            nitro: false,
            gear: "D",
          }}
          physicsService={physicsServiceRef.current}
          trackHelper={trackHelperRef.current}
          isPaused={false}
          gameState="racing"
          onFinishRace={() => {}}
          onTick={handleTickUpdate}
          soundEnabled={soundEnabled}
          timeOfDay={liveCurrent.weather === "Sunset" ? "sunset" : liveCurrent.weather === "Night" ? "night" : "noon"}
          weather={liveCurrent.weather === "Rain" ? "rain" : liveCurrent.weather === "Fog" ? "foggy" : "sunny"}
          cameraMode={activeCameraMode}
        />
      )}

      {/* 2. THE TOP BROADCASTER OVERLAYS BANNER */}
      <div className="absolute top-4 left-4 right-4 z-50 pointer-events-none flex justify-between items-start">
        {/* Left Side: Broadcast Feed Badge */}
        <div className="bg-slate-950/80 border border-slate-900/60 backdrop-blur-md px-4 py-2.5 rounded-2xl flex items-center space-x-3 text-white shadow-2xl">
          <span className="flex h-2.5 w-2.5 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
          </span>
          <div className="flex flex-col">
            <span className="font-sans font-black text-[11px] tracking-wider uppercase leading-none">LIVE STREAM</span>
            <span className="font-mono text-[8px] text-slate-500 uppercase tracking-widest leading-none mt-1">
              AI Esports Arena
            </span>
          </div>
        </div>

        {/* Middle: Map and Weather Header info */}
        <div className="bg-slate-950/80 border border-slate-900/60 backdrop-blur-md px-5 py-2.5 rounded-2xl text-center space-y-0.5 shadow-2xl">
          <p className="text-[8px] font-mono font-black text-slate-500 tracking-widest uppercase">TRACK ENVIRONMENT</p>
          <p className="text-xs font-sans font-black uppercase text-slate-200 tracking-wide">
            {liveCurrent.map || "Dragon Mountain"}
          </p>
        </div>

        {/* Right Side: Active Camera Info & Room Code */}
        <div className="bg-slate-950/80 border border-slate-900/60 backdrop-blur-md px-4 py-2.5 rounded-2xl flex items-center space-x-4 shadow-2xl">
          <div className="text-right">
            <p className="text-[8px] font-mono font-black text-slate-500 tracking-widest uppercase">DIRECTOR CAM</p>
            <p className="text-[10px] font-mono font-black text-cyan-400 uppercase tracking-wide mt-0.5">
              {activeCameraMode === "third-person"
                ? "CHASE CAM"
                : activeCameraMode === "drone"
                  ? "CINEMATIC DRONE"
                  : activeCameraMode === "helicopter"
                    ? "HELI SWEEP"
                    : activeCameraMode === "replay"
                      ? "SPEED ANALYSIS"
                      : "DIRECTOR SELECT"}
            </p>
          </div>
          <div className="h-6 w-px bg-slate-800" />
          <div>
            <p className="text-[8px] font-mono font-black text-slate-500 tracking-widest uppercase">EVENT ID</p>
            <p className="text-xs font-mono font-black text-amber-400 tracking-wide mt-0.5">{liveCurrent.roomCode}</p>
          </div>
        </div>
      </div>

      {/* 3. BROADCAST LEADERBOARD GRID (BOTTOM LEFT) */}
      <div className="absolute bottom-6 left-6 z-50 pointer-events-none max-w-sm w-full space-y-3">
        <div className="bg-slate-950/80 border border-slate-900/60 backdrop-blur-md p-4 rounded-3xl shadow-2xl space-y-3">
          <h3 className="text-[9px] font-mono font-black tracking-widest uppercase text-slate-500 border-b border-slate-900 pb-2 flex items-center space-x-1.5">
            <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>Leaderboard Standings</span>
          </h3>

          <div className="space-y-2">
            {cars.map((car) => {
              const isFirst = car.racePosition === 1;
              const isFocused = car.id === focusedCar.id;

              return (
                <div
                  key={car.id}
                  className={`flex items-center justify-between p-2 rounded-xl transition-all duration-150 ${
                    isFocused
                      ? "bg-cyan-500/10 border border-cyan-500/20"
                      : "bg-slate-900/30 border border-slate-900/50"
                  }`}
                >
                  <div className="flex items-center space-x-3.5">
                    {/* Rank Number Tag */}
                    <span
                      className={`w-5 h-5 rounded-lg flex items-center justify-center font-mono font-black text-[10px] ${
                        isFirst
                          ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                          : "bg-slate-800/40 text-slate-400"
                      }`}
                    >
                      {car.racePosition}
                    </span>
                    <span className="text-[11px] font-black tracking-wide uppercase text-slate-200">
                      {car.name} {car.isAI ? "🤖" : ""}
                    </span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <span className="text-[9px] font-mono text-slate-500 uppercase">Lap {car.currentLap || 1}</span>
                    <span className="text-[10px] font-mono font-bold text-slate-300">
                      {Math.floor(Math.abs(car.speed) * 3.6)} <span className="text-[8px] text-slate-500">KM/H</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. DRIVER TELEMETRY OVERLAY GRID (BOTTOM RIGHT) */}
      <div className="absolute bottom-6 right-6 z-50 pointer-events-none max-w-xs w-full space-y-3">
        <div className="bg-slate-950/80 border border-slate-900/60 backdrop-blur-md p-4 rounded-3xl shadow-2xl space-y-4">
          <div className="border-b border-slate-900 pb-2.5 flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <p className="text-[9px] font-mono font-black text-slate-500 uppercase tracking-widest">FOCAL CAR DATA</p>
            </div>
            <p className="text-xs font-mono font-black text-slate-300">{formatStopwatch(elapsedTime)}</p>
          </div>

          {/* Core Speed Gauges */}
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <span className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-wider">
                {focusedCar.name}
              </span>
              <p className="text-3xl font-mono font-black tracking-tighter text-slate-100 leading-none">
                {Math.floor(Math.abs(focusedCar.speed) * 3.6)}
                <span className="text-xs text-slate-500 tracking-normal ml-1">KMH</span>
              </p>
            </div>

            {/* Simulated Nitro Boost Meter */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[8px] font-mono font-bold text-slate-500">
                <span>NITRO RESERVE</span>
                <span className="text-cyan-400">{(focusedCar.nitroCharged ?? 100).toFixed(0)}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 rounded-full transition-all duration-150 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                  style={{ width: `${focusedCar.nitroCharged ?? 100}%` }}
                />
              </div>
            </div>

            {/* LAP PROGRESSION TAGS */}
            <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[10px]">
              <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-900/60 flex flex-col">
                <span className="text-[7px] text-slate-500 uppercase">CURRENT LAP</span>
                <span className="text-xs font-black text-slate-200 mt-0.5">LAP {focusedCar.currentLap || 1} / 3</span>
              </div>
              <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-900/60 flex flex-col">
                <span className="text-[7px] text-slate-500 uppercase">CURRENT RANK</span>
                <span className="text-xs font-black text-amber-400 mt-0.5">
                  P{focusedCar.racePosition || 1} / {cars.length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5. USER CONTROLS FLOATING PANEL (ONLY SHOWN IF MOUSE IS ACTIVE TO PRESERVE OBS CAPTURE) */}
      <div
        className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-50 transition-opacity duration-300 pointer-events-auto ${mouseActive ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <div className="bg-slate-950/90 border border-slate-800/60 backdrop-blur-lg px-6 py-3 rounded-full flex items-center space-x-4 shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
          {/* Sound Toggle */}
          <button
            onClick={() => setSoundEnabled((prev) => !prev)}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-full transition cursor-pointer text-slate-400 hover:text-white"
            title="Toggle Sound"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <div className="h-4 w-px bg-slate-800" />

          {/* Fullscreen Trigger */}
          <button
            onClick={() => {
              if (document.fullscreenElement) {
                document.exitFullscreen().then(() => setIsFullscreen(false));
              } else {
                document.documentElement.requestFullscreen().then(() => setIsFullscreen(true));
              }
            }}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-full transition cursor-pointer text-slate-400 hover:text-white"
            title="Toggle Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};