// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { GamePhase, GameSettings, CarState, ControlsState } from "./types";
import { TrackGeometryHelper } from "./utils/track";
import { GamePhysicsService } from "./physics/GamePhysics";
import { GameCanvas } from "./components/GameCanvas";
import { HUD } from "./components/HUD";
import { Menu } from "./components/Menu";
import { GameOver } from "./components/GameOver";
import { SplashScreen } from "./components/SplashScreen";
import { OrientationForceLandscape } from "./components/OrientationGuard";
import {
  Trophy,
  Compass,
  Sparkles,
  Volume2,
  VolumeX,
  AlertCircle,
  Sun,
  Cloud,
  CloudRain,
  CloudFog,
  Moon,
  Radio,
  RefreshCw,
} from "lucide-react";
import { selectRandomPlayerCar, setPlayerSelectedModelKey } from "./world/procedural";

// Multiplayer integrations
import { useMultiplayer } from "./hooks/useMultiplayer";
import { useRoom } from "./hooks/useRoom";
import { LobbyScreen } from "./components/LobbyScreen";
import { JoinRoomModal } from "./components/JoinRoomModal";
import { RoomCodeHUD } from "./components/RoomCodeHUD";
import { SyncManager } from "./multiplayer/SyncManager";
import { terrainManager } from "./world/TerrainManager";
import * as THREE from "three";

// RBAC & Routing Integrations
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute, PublicRoute } from "./components/RouteGuards";
import { LoginPage } from "./components/LoginPage";
import { DashboardLayout } from "./components/DashboardLayout";
import {
  AdminDashboard,
  ManageMaps,
  ManageCars,
  ManageRooms,
  ManageUsers,
  ManageAnalytics,
} from "./components/AdminPages";
import { BroadcasterDashboard, BroadcasterLiveDesk } from "./components/BroadcasterPages";
import { UserProfilePage } from "./components/UserProfilePage";
import { UserLeaderboardPage } from "./components/UserLeaderboardPage";
import { CreateRoomPage } from "./components/CreateRoomPage";
import { JoinRoomPage } from "./components/JoinRoomPage";
import { WaitingLobbyPage } from "./components/WaitingLobbyPage";
import { UserRacePage } from "./components/UserRacePage";
import { SpectatorPage } from "./components/SpectatorPage";

// Performance Offline Asset Stream System Imports
import { useAssetStatus } from "./hooks/useAssetStatus";
import { AssetInstallScreen } from "./components/AssetInstallScreen";
import { RaceLoadingScreen } from "./components/RaceLoadingScreen";

// Firebase Firestore functions to report player score highscores
import { db } from "./lib/firebase";
import { collection, addDoc, serverTimestamp, doc, getDoc } from "firebase/firestore";

interface RacingCanvasUnitProps {
  settings: GameSettings | null;
  phase: GamePhase;
  timeOfDay: "morning" | "noon" | "sunset" | "night";
  setTimeOfDay: React.Dispatch<React.SetStateAction<"morning" | "noon" | "sunset" | "night">>;
  weather: "sunny" | "cloudy" | "foggy" | "rain";
  setWeather: React.Dispatch<React.SetStateAction<"sunny" | "cloudy" | "foggy" | "rain">>;
  trackHelper: TrackGeometryHelper | null;
  physicsService: GamePhysicsService | null;
  cars: CarState[];
  controls: ControlsState;
  setControls: React.Dispatch<React.SetStateAction<ControlsState>>;
  isPaused: boolean;
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>;
  soundEnabled: boolean;
  countdownMsg: string;
  countdownLabel: string;
  elapsedTime: number;
  handleRaceFinish: () => void;
  handleTickUpdate: (updatedCars: CarState[]) => void;
  handleRestartRace: () => void;
  handleHomeMenu: () => void;
  handleNextRace: () => void;
  mp: any;
}

const RacingCanvasUnit: React.FC<RacingCanvasUnitProps> = ({
  settings,
  phase,
  timeOfDay,
  setTimeOfDay,
  weather,
  setWeather,
  trackHelper,
  physicsService,
  cars,
  controls,
  setControls,
  isPaused,
  setIsPaused,
  soundEnabled,
  countdownMsg,
  countdownLabel,
  elapsedTime,
  handleRaceFinish,
  handleTickUpdate,
  handleRestartRace,
  handleHomeMenu,
  handleNextRace,
  mp,
}) => {
  const navigate = useNavigate();
  const { checking, allReady, checkStatus } = useAssetStatus();

  useEffect(() => {
    // If we directly hit /race but haven't initialized settings, redirect back
    if (!settings) {
      navigate("/garage");
    }
  }, [settings, navigate]);

  if (checking) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-50">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full mb-4 animate-spin" />
        <p className="text-slate-400 font-mono tracking-wider text-xs uppercase animate-pulse">
          Verifying Live Racing Assets...
        </p>
      </div>
    );
  }

  if (!allReady) {
    return (
      <div className="fixed inset-0 bg-slate-950 z-50">
        <AssetInstallScreen
          onComplete={async () => {
            await checkStatus();
          }}
        />
      </div>
    );
  }

  const currentPl = cars.find((c) => c.id === "player") || cars[0];
  const currentOpponents = cars.filter((c) => c.id !== "player" && !c.id.startsWith("traffic"));

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
        overflow: "hidden",
        background: "black",
        margin: 0,
        padding: 0,
        borderRadius: 0,
        maxWidth: "none",
      }}
    >
      {/* Info panel */}
      <div className="absolute top-4 left-4 z-20 pointer-events-none flex items-center space-x-2 text-white bg-slate-950/40 backdrop-blur-sm px-3 py-1 rounded-full border border-slate-800/40 opacity-72">
        <Compass className="w-3.5 h-3.5 text-blue-400 rotate-45" />
        <span className="font-sans font-black text-[10px] tracking-wider uppercase">
          AI RACE ARENA <span className="text-[#00f2ffa5]">LIVE</span>
        </span>
      </div>



      {/* Three.js interactive Canvas component */}
      {trackHelper && physicsService && (cars.length > 0 || settings?.selectedMap === "racing2") && (
        <GameCanvas
          cars={cars}
          playerControls={controls}
          physicsService={physicsService}
          trackHelper={trackHelper}
          isPaused={isPaused}
          gameState={phase}
          onFinishRace={handleRaceFinish}
          onTick={handleTickUpdate}
          soundEnabled={soundEnabled}
          timeOfDay={timeOfDay}
          weather={weather}
          raceSettings={settings}
        />
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
      {mp.room && (phase === "racing" || phase === "countdown") && (
        <RoomCodeHUD roomCode={mp.room.code} playersCount={mp.room.players.length} isLiveMode={mp.room.isLiveMode} />
      )}

      {/* GameOver celebration statistics and leaderboards link */}
      {phase === "completed" && currentPl && (
        <GameOver
          player={currentPl}
          opponents={currentOpponents}
          elapsedTime={elapsedTime}
          onRestart={async () => {
            if (mp.room) {
              if (mp.room.hostId === mp.playerId) {
                mp.startRaceNow();
              }
            } else {
              handleRestartRace();
            }
          }}
          onHome={() => {
            if (mp.room) {
              mp.leaveRoom();
            }
            handleHomeMenu();
          }}
          onNextRace={mp.room ? undefined : handleNextRace}
        />
      )}

      {/* Cinematic countdown elements */}
      {phase === "countdown" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/40 pointer-events-none select-none">
          <div className="bg-slate-900/84 border border-slate-700/60 backdrop-blur-md px-10 py-8 rounded-3xl flex flex-col items-center min-w-[200px] animate-bounce">
            <span className="text-[12px] font-black text-slate-400 tracking-widest uppercase">{countdownLabel}</span>
            <span
              className={`text-6xl font-black font-sans mt-3 text-transparent bg-clip-text ${
                countdownMsg === "GO!"
                  ? "bg-gradient-to-r from-emerald-400 to-teal-300 scale-110"
                  : "bg-gradient-to-r from-amber-400 to-red-400"
              }`}
            >
              {countdownMsg}
            </span>
          </div>
        </div>
      )}

      {/* Pause Overlay banner */}
      {isPaused && phase === "racing" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/72 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl text-center shadow-2xl max-w-sm space-y-4">
            <h3 className="text-2xl font-black uppercase text-slate-200 tracking-wider">Race Suspended</h3>
            <p className="text-xs text-slate-400">
              Your engine is idling at the pits. Click to resume tracking racing line.
            </p>
            <button
              onClick={() => setIsPaused(false)}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-extrabold uppercase text-xs tracking-widest rounded-xl transition duration-150 cursor-pointer w-full"
            >
              Resume Race
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function AppBody() {
  // Navigation
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();

  // Game states orchestration
  const [showSplash, setShowSplash] = useState(true);
  const [phase, setPhase] = useState<GamePhase>("menu");
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Hook the multiplayer client context
  const mp = useMultiplayer();
  const room = mp.room;

  // Staging join model overlay
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [isJoiningLive, setIsJoiningLive] = useState(false);
  const [liveJoinError, setLiveJoinError] = useState<string | null>(null);
  const [multiplayerCachedSettings, setMultiplayerCachedSettings] = useState<GameSettings | null>(null);
  const [playerSelectedModelKey, setPlayerSelectedModelKeyLocal] = useState<string>("ferrari_purosangue");

  // Dynamic Environment Settings
  const [timeOfDay, setTimeOfDay] = useState<"morning" | "noon" | "sunset" | "night">("noon");
  const [weather, setWeather] = useState<"sunny" | "cloudy" | "foggy" | "rain">("sunny");

  // Synchronous car entities list
  const [cars, setCars] = useState<CarState[]>([]);

  // Controls key triggers tracking
  const [controls, setControls] = useState<ControlsState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    nitro: false,
    gear: "D",
  });

  // Sound preference state
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Instantiated engines
  const trackHelperRef = useRef<TrackGeometryHelper | null>(null);
  const physicsServiceRef = useRef<GamePhysicsService | null>(null);
  const lastTimeRef = useRef<number>(Date.now());

  // Pre-race countdown: starts at 60s. Cars remain frozen during the whole
  // countdown phase (GameCanvas gates controls + AI on gameState==="countdown").
  const COUNTDOWN_START = 60;
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [countdownMsg, setCountdownMsg] = useState("READY...");
  const [countdownLabel, setCountdownLabel] = useState<string>("Race starts in");

  // Initialize helpers on startup
  useEffect(() => {
    const helper = new TrackGeometryHelper();
    trackHelperRef.current = helper;
    physicsServiceRef.current = new GamePhysicsService(helper);
  }, []);

  // General countdown clock loop sequence
  useEffect(() => {
    let timerId = 0;
    if (phase === "countdown") {
      setCountdown(COUNTDOWN_START);
      setCountdownMsg("READY");
      setCountdownLabel("Race starts in");

      const tickCountdown = () => {
        const carLoaded = !!(window as any).carLoaded || !!(window as any).playerCarAddedToScene;
        const mapLoaded = !!(window as any).mapLoaded;
        const shadersCompiled = !!(window as any).shadersCompiled;
        const worldReady = !!(window as any).worldReady;
        const isRacing2 = settings?.selectedMap === "racing2";
        const racing2Ready = !isRacing2 || !!(window as any).racing2Ready;
        const racing2Error = isRacing2 ? (window as any).racing2Error : null;

        if (racing2Error) {
          setCountdownLabel("Map error");
          setCountdownMsg("FAILED");
          console.error("Racing 2 startup blocked:", racing2Error);
          return;
        }

        if (!carLoaded || !mapLoaded || !shadersCompiled || !worldReady || !racing2Ready) {
          // Hold countdown while assets stream in — cars stay frozen.
          setCountdownLabel(isRacing2 ? "Building road" : "Warming engine");
          setCountdownMsg("...");
          return;
        }

        setCountdown((prev) => {
          const next = prev - 1;
          setTimeout(() => {
            if (next > 0) {
              setCountdownLabel("Race starts in");
              setCountdownMsg(String(next));
            } else if (next === 0) {
              setCountdownLabel("Grid light");
              setCountdownMsg("GO!");
            } else if (next < 0) {
              setPhase("racing");
              lastTimeRef.current = Date.now();
            }
          }, 0);
          return next;
        });
      };

      timerId = window.setInterval(tickCountdown, 1000);
    }

    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [phase, settings?.selectedMap]);

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
        lastTimeRef.current = Date.now(); // reset anchor during pause
        if (phase !== "racing") (window as any).raceElapsedTime = 0;
      }

      frameId = requestAnimationFrame(updateTime);
    };

    frameId = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(frameId);
  }, [phase, isPaused]);

  // Start the actual game from configurations
  const handleStartGame = (cfg: GameSettings) => {
    // Reset vehicle added state
    (window as any).playerCarAddedToScene = false;

    // Apply exact player selected map
    const activeMap = cfg.selectedMap || "map1";
    const helper = new TrackGeometryHelper(activeMap);
    trackHelperRef.current = helper;
    physicsServiceRef.current = new GamePhysicsService(helper);

    setSettings(cfg);
    setElapsedTime(0);
    setIsPaused(false);

    // Apply exact player selected vehicle key
    const modelKey =
      cfg.selectedCar === "ferrari"
        ? "ferrari_purosangue"
        : cfg.selectedCar === "bugatti"
          ? "bugatti_chiron_top_edition"
          : "porsche_911_gt3";
    setPlayerSelectedModelKey(modelKey);

    // Try to rotate to horizontal landscape mode automatically
    try {
      const screenAny = window.screen as any;
      if (screenAny && screenAny.orientation && screenAny.orientation.lock) {
        screenAny.orientation.lock("landscape").catch(() => {});
      }
    } catch (err) {}

    // Automatically request true browser fullscreen experience
    try {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch (err) {}

    // Initialize racers state. Racing 2 waits for the GLB road collider before
    // creating cars, so no vehicle can spawn on the temporary/fallback plane.
    if (physicsServiceRef.current && activeMap !== "racing2") {
      const initialLineup = physicsServiceRef.current.initializeCars(cfg.playerName, cfg.difficulty, cfg.carColor);
      setCars(initialLineup);
    } else if (activeMap === "racing2") {
      setCars([]);
    }

    // Move to Countdown phase and route to race view
    setPhase("countdown");
  };

  const handleCreateRoom = async (cfg: GameSettings, isLiveMode?: boolean) => {
    setMultiplayerCachedSettings(cfg);
    const code = await mp.createRoom(
      cfg.playerName,
      cfg.selectedCar,
      cfg.carColor,
      isLiveMode || false,
      cfg.difficulty,
      cfg.selectedMap,
    );
    if (code) {
      setPhase("multiplayer_lobby");
    }
  };

  const handleJoinRoom = (cfg: GameSettings) => {
    setMultiplayerCachedSettings(cfg);
    setShowJoinModal(true);
  };

  const handleJoinSubmit = async (code: string) => {
    if (!multiplayerCachedSettings) return;
    const success = await mp.joinRoom(
      code,
      multiplayerCachedSettings.playerName,
      multiplayerCachedSettings.selectedCar,
      multiplayerCachedSettings.carColor,
    );
    if (success) {
      setShowJoinModal(false);
      setPhase("multiplayer_lobby");
    } else {
      throw new Error("Matchmaker: Joining room failed - Code not found or full");
    }
  };

  const handleJoinLiveRace = async () => {
    setIsJoiningLive(true);
    setLiveJoinError(null);
    try {
      const docRef = doc(db, "live", "current");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        throw new Error("No active live race found. Inform your broadcaster to start a live race staging room.");
      }
      const data = docSnap.data();
      const code = data?.roomCode || data?.code || data?.room || data?.id;
      if (!code) {
        throw new Error("The live race exists, but no valid lobby code has been published yet.");
      }

      const playerName = profile?.name || "Racer Handle";
      const selectedCar = "ferrari";
      const carColor = "#00ccff";

      setMultiplayerCachedSettings({
        playerName,
        difficulty: "medium",
        carColor,
        selectedCar,
        selectedMap: "map1",
      });

      const success = await mp.joinRoom(code, playerName, selectedCar, carColor);
      if (success) {
        setPhase("multiplayer_lobby");
      } else {
        throw new Error(`Failed to join room '${code}'. The room might be full or inactive.`);
      }
    } catch (err: any) {
      console.error("Live Join error:", err);
      setLiveJoinError(err.message || String(err));
    } finally {
      setIsJoiningLive(false);
    }
  };

  const handleStartMultiplayerGame = (activeRoom: any, activePlayerId: string) => {
    (window as any).playerCarAddedToScene = false;

    const activeMap = activeRoom.selectedMap || "map1";
    const helper = new TrackGeometryHelper(activeMap);
    trackHelperRef.current = helper;
    physicsServiceRef.current = new GamePhysicsService(helper);

    const localRacer = activeRoom.players.find((p: any) => p.id === activePlayerId);
    const cfg: GameSettings = {
      playerName: localRacer?.name || "Local Player",
      difficulty: activeRoom.difficulty || "medium",
      carColor: localRacer?.carColor || "#0062ff",
      selectedCar: (localRacer?.selectedCar || "ferrari") as any,
      selectedMap: activeMap,
    };
    setSettings(cfg);
    setElapsedTime(0);
    setIsPaused(false);

    const modelKey =
      cfg.selectedCar === "ferrari"
        ? "ferrari_purosangue"
        : cfg.selectedCar === "bugatti"
          ? "bugatti_chiron_top_edition"
          : "porsche_911_gt3";
    setPlayerSelectedModelKey(modelKey);

    // Build lineup containing room players + automatically spawned bots up to 6
    const lineup: CarState[] = [];
    const curveLength = helper.curve.getLength();
    const wheelRadius = 0.38;

    activeRoom.players.forEach((p: any, idx: number) => {
      const isMe = p.id === activePlayerId;
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

      const carId = isMe ? "player" : isAI ? p.id : `remote_${p.id}`;
      const amIHost = activeRoom.hostId === activePlayerId;

      lineup.push({
        id: carId,
        name: p.name,
        isAI: isAI && amIHost, // Only Host runs local calculations for AI
        color: p.carColor,
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
        aiAggression: activeRoom.difficulty === "easy" ? 0.45 : activeRoom.difficulty === "medium" ? 0.72 : 0.95,
      });
    });

    setCars(lineup);
    setPhase("countdown");
  };

  // Synchronize room triggers automatically
  useEffect(() => {
    if (mp.room && (phase === "multiplayer_lobby" || phase === "menu" || phase === "completed")) {
      if (mp.room.phase === "countdown" || mp.room.phase === "racing") {
        handleStartMultiplayerGame(mp.room, mp.playerId || "");
        navigate("/race");
      }
    }
  }, [mp.room?.phase, mp.room?.id]);

  useEffect(() => {
    if (mp.room && mp.room.isLiveMode) {
      if (mp.room.phase === "waiting" && phase === "completed") {
        setPhase("multiplayer_lobby");
        navigate("/rooms");
      }
    }
  }, [mp.room?.phase, mp.room?.isLiveMode, phase]);

  // Callback triggered inside the canvas animation frames
  const handleTickUpdate = (updatedCars: CarState[]) => {
    if (mp.room) {
      const playerCar = updatedCars.find((c) => c.id === "player");
      if (playerCar) {
        mp.sendLocalCar(playerCar);
      }

      const isHost = mp.room.hostId === mp.playerId;
      if (isHost) {
        // Host broadcasts its simulated AI bots
        const aiCars = updatedCars.filter((c) => c.isAI);
        if (aiCars.length > 0) {
          mp.sendAICars(aiCars);
        }
      }

      // Synchronize remote human and AI opponents from socket
      const nextCars = updatedCars.map((car) => {
        if (car.id === "player") return car;

        const netId = car.id.startsWith("remote_") ? car.id.replace("remote_", "") : car.id;
        const netPlayer = mp.room.players.find((p: any) => p.id === netId);
        if (netPlayer && netPlayer.position) {
          SyncManager.unpackCarState(car, netPlayer);
        }
        return car;
      });

      setCars(nextCars);
    } else {
      setCars(updatedCars);
    }
  };

  // Re-run track race with same configurations
  const handleRestartRace = () => {
    if (settings) {
      handleStartGame(settings);
    } else {
      setPhase("menu");
      navigate("/garage");
    }
  };

  // Automatically load the alternate track (Map 1 <-> Map 2) and boot it up
  const handleNextRace = () => {
    if (settings) {
      const nextMap = settings.selectedMap === "map2" ? "map1" : "map2";
      const updatedSettings = {
        ...settings,
        selectedMap: nextMap as "map1" | "map2",
      };
      handleStartGame(updatedSettings);
    } else {
      setPhase("menu");
      navigate("/garage");
    }
  };

  // Back to Main configuration screen
  const handleHomeMenu = () => {
    setPhase("menu");
    navigate("/garage");
  };

  // Submit highest score to leaderboard
  const handleRaceFinish = async () => {
    setPhase("completed");
    if (currentPl) {
      try {
        await addDoc(collection(db, "leaderboards"), {
          playerName: profile?.name || currentPl.name || "Anonymous Racer",
          selectedCar: settings?.selectedCar || "ferrari",
          topSpeed: Math.floor(currentPl.speed * 3.6) || 280,
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.error("Error submitting score record:", e);
      }
    }
  };

  const currentPl = cars.find((c) => c.id === "player") || cars[0];
  const currentOpponents = cars.filter((c) => c.id !== "player" && !c.id.startsWith("traffic"));

  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  return (
    <OrientationForceLandscape isAuthenticated={!!profile}>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />

        {/* Admin Protected Pages */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <DashboardLayout>
                <AdminDashboard />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/maps"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <DashboardLayout>
                <ManageMaps />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/cars"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <DashboardLayout>
                <ManageCars />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/rooms"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <DashboardLayout>
                <ManageRooms />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <DashboardLayout>
                <ManageUsers />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/analytics"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <DashboardLayout>
                <ManageAnalytics />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Broadcaster Protected Pages */}
        <Route
          path="/broadcaster"
          element={
            <ProtectedRoute allowedRoles={["broadcaster"]}>
              <DashboardLayout>
                <BroadcasterDashboard />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/broadcaster/live"
          element={
            <ProtectedRoute allowedRoles={["broadcaster"]}>
              <DashboardLayout>
                <BroadcasterLiveDesk />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/broadcaster/camera"
          element={
            <ProtectedRoute allowedRoles={["broadcaster"]}>
              <DashboardLayout>
                <BroadcasterLiveDesk />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/broadcaster/overlay"
          element={
            <ProtectedRoute allowedRoles={["broadcaster"]}>
              <DashboardLayout>
                <BroadcasterLiveDesk />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Esports Live Stream Spectator Client (Locked to broadcaster role) */}
        <Route
          path="/live"
          element={
            <ProtectedRoute allowedRoles={["broadcaster"]}>
              <SpectatorPage />
            </ProtectedRoute>
          }
        />
        {/* Public Spectator View (Accessible by Players/Admins/Broadcasters) */}
        <Route
          path="/spectator"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <SpectatorPage />
            </ProtectedRoute>
          }
        />

        {/* Pro Racer User Protected Pages */}
        <Route
          path="/garage"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <DashboardLayout>
                <Menu
                  onStartGame={(cfg) => {
                    handleStartGame(cfg);
                    navigate("/race");
                  }}
                  onCreateRoom={async (cfg, activeLiveMode) => {
                    if (profile?.role === "user") {
                      navigate("/create-room", {
                        state: { selectedCar: cfg.selectedCar, selectedMap: cfg.selectedMap },
                      });
                    } else {
                      await handleCreateRoom(cfg, activeLiveMode);
                      navigate("/rooms");
                    }
                  }}
                  onJoinRoom={(cfg) => {
                    if (profile?.role === "user") {
                      navigate("/join-room");
                    } else {
                      handleJoinRoom(cfg);
                    }
                  }}
                />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rooms"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <DashboardLayout>
                {phase === "multiplayer_lobby" && mp.room ? (
                  <LobbyScreen
                    room={mp.room}
                    playerId={mp.playerId || ""}
                    onLeave={() => {
                      mp.leaveRoom();
                      setPhase("menu");
                      navigate("/garage");
                    }}
                    onToggleReady={(ready) => {
                      mp.toggleReady(ready);
                    }}
                    onStartNow={() => {
                      mp.startRaceNow();
                    }}
                  />
                ) : (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-black uppercase tracking-tight">Matchmaker Lobby</h2>
                      <p className="text-xs text-slate-400 mt-1">
                        Join or host active multiplayer gaming staging rooms
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
                      <div className="bg-slate-950/60 p-6 sm:p-8 rounded-3xl border border-slate-900 space-y-4">
                        <h3 className="text-sm font-black uppercase tracking-widest text-cyan-400 flex items-center space-x-2">
                          <Sparkles className="w-4 h-4 text-cyan-400" />
                          <span>Join Live Arena Grid</span>
                        </h3>
                        <p className="text-xs text-slate-404 leading-relaxed">
                          If another player or broadcaster has created a multiplayer game session, retrieve the 6-digit
                          invitation Room Code and enter it to jump straight on the line up!
                        </p>

                        {liveJoinError && (
                          <div className="p-3 bg-red-950/40 border border-red-500/20 text-red-400 rounded-xl text-xs flex items-center space-x-2 animate-pulse">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{liveJoinError}</span>
                          </div>
                        )}

                        <div className="space-y-3.5 pt-2">
                          <button
                            onClick={handleJoinLiveRace}
                            disabled={isJoiningLive}
                            className="w-full py-4 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-550 disabled:opacity-50 text-white font-black uppercase text-xs tracking-widest rounded-2xl transition shadow-[0_4px_20px_rgba(6,182,212,0.35)] flex items-center justify-center space-x-2 cursor-pointer border border-cyan-500/30"
                          >
                            {isJoiningLive ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>CONNECTING TO LIVE...</span>
                              </>
                            ) : (
                              <>
                                <Radio className="w-4 h-4 animate-pulse" />
                                <span>JOIN LIVE RACE</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() =>
                              handleJoinRoom({
                                playerName: profile?.name || "Racer Handle",
                                difficulty: "medium",
                                carColor: "#00ccff",
                                selectedCar: "ferrari",
                                selectedMap: "map1",
                              })
                            }
                            className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white font-black uppercase text-xs tracking-widest rounded-2xl transition cursor-pointer"
                          >
                            ENTER CODE MANUALLY
                          </button>
                        </div>
                      </div>

                      <div className="bg-slate-950/60 p-6 sm:p-8 rounded-3xl border border-slate-900 space-y-4 flex flex-col justify-between">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-widest text-[#00f2ffa5]">
                            Host Staging Server
                          </h3>
                          <p className="text-xs text-slate-404 leading-relaxed mt-2.5">
                            Set up custom lap numbers, control weather environments, toggle computer AI bot
                            difficulties, and invite real opponents or drone cameras.
                          </p>
                        </div>
                        <button
                          onClick={() => navigate("/garage")}
                          className="w-full py-4 bg-slate-900 hover:bg-slate-800 border border-slate-805 text-slate-400 hover:text-white font-black uppercase text-xs tracking-widest rounded-2xl transition cursor-pointer mt-4"
                        >
                          CHOOSE MATCH PARAMETERS
                        </button>
                      </div>
                    </div>

                    {showJoinModal && (
                      <JoinRoomModal
                        onClose={() => {
                          setShowJoinModal(false);
                          mp.setError(null);
                        }}
                        onJoin={handleJoinSubmit}
                        isLoading={mp.isConnecting}
                        errorMsg={mp.error}
                        setError={(err) => {
                          mp.setError(err);
                        }}
                      />
                    )}
                  </div>
                )}
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/race"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <RacingCanvasUnit
                settings={settings}
                phase={phase}
                timeOfDay={timeOfDay}
                setTimeOfDay={setTimeOfDay}
                weather={weather}
                setWeather={setWeather}
                trackHelper={trackHelperRef.current}
                physicsService={physicsServiceRef.current}
                cars={cars}
                controls={controls}
                setControls={setControls}
                isPaused={isPaused}
                setIsPaused={setIsPaused}
                soundEnabled={soundEnabled}
                countdownMsg={countdownMsg}
                countdownLabel={countdownLabel}
                elapsedTime={elapsedTime}
                handleRaceFinish={handleRaceFinish}
                handleTickUpdate={handleTickUpdate}
                handleRestartRace={handleRestartRace}
                handleHomeMenu={handleHomeMenu}
                handleNextRace={handleNextRace}
                mp={mp}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <DashboardLayout>
                <UserProfilePage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/leaderboard"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <DashboardLayout>
                <UserLeaderboardPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Dedicated Normal User Matchmaking Room routes */}
        <Route
          path="/create-room"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <DashboardLayout>
                <CreateRoomPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/join-room"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <DashboardLayout>
                <JoinRoomPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/room/:roomCode"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <DashboardLayout>
                <WaitingLobbyPage />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/race/:roomCode"
          element={
            <ProtectedRoute allowedRoles={["user", "admin", "broadcaster"]}>
              <UserRacePage />
            </ProtectedRoute>
          }
        />

        {/* Catch-all redirect to profile dashboard or login screen */}
        <Route
          path="*"
          element={
            profile ? (
              profile.role === "admin" ? (
                <Navigate to="/admin" replace />
              ) : profile.role === "broadcaster" ? (
                <Navigate to="/broadcaster" replace />
              ) : (
                <Navigate to="/garage" replace />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </OrientationForceLandscape>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppBody />
      </BrowserRouter>
    </AuthProvider>
  );
}