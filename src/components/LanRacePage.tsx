// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as THREE from "three";

import { CarState, ControlsState, GamePhase } from "../types";
import { TrackGeometryHelper } from "../utils/track";
import { GamePhysicsService } from "../physics/GamePhysics";
import { terrainManager } from "../world/TerrainManager";
import { setPlayerSelectedModelKey } from "../world/procedural";

import { GameCanvas } from "./GameCanvas";
import { HUD } from "./HUD";
import { GameOver } from "./GameOver";
import { RoomCodeHUD } from "./RoomCodeHUD";

import { SyncManager } from "../multiplayer/SyncManager";
import { connectLanVehicleSocket, LanVehicleClient } from "../lan/lanVehicleSocket";
import { fetchLanRoom, leaveLanRoom, markLanRaceRunning, reconnectLanSession } from "../lan/lanApi";
import { clearLanSession, loadLanSession, saveLanSession } from "../lan/localGuest";
import { LanRoom, LanSession } from "../lan/types";
import { recordLanRaceResult } from "../lan/lanScoreStore";

const LAN_MAP_ID = "map1";
const GO_HOLD_MS = 1000;
const REMOTE_COLORS = ["#ff8a00", "#00ccff", "#d946ef", "#22c55e", "#f59e0b", "#fb7185", "#a78bfa"];

const defaultControls: ControlsState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  nitro: false,
  handbrake: false,
  gear: "D",
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function angleFromRotation(rotation: any): number {
  if (!rotation || !isFiniteNumber(rotation.y) || !isFiniteNumber(rotation.w)) {
    return 0;
  }
  return 2 * Math.atan2(rotation.y, rotation.w);
}

function toRemoteState(payload: any) {
  return {
    position: payload?.position || { x: 0, y: 0, z: 0 },
    velocity: payload?.velocity || { x: 0, y: 0, z: 0 },
    angle: angleFromRotation(payload?.rotation),
    speed: isFiniteNumber(payload?.speed) ? payload.speed : 0,
    drift: !!payload?.drift,
    nitro: !!payload?.nitro,
    lap: isFiniteNumber(payload?.lap) ? payload.lap : 1,
    checkpoint: isFiniteNumber(payload?.checkpoint) ? payload.checkpoint : 0,
    totalDistanceTraveled: isFiniteNumber(payload?.totalDistanceTraveled) ? payload.totalDistanceTraveled : 0,
    isFinished: !!payload?.isFinished,
    steering: isFiniteNumber(payload?.steering) ? payload.steering : 0,
    wheelRotation: isFiniteNumber(payload?.wheelRotation) ? payload.wheelRotation : 0,
  };
}

function buildLineup(room: LanRoom, session: LanSession, helper: TrackGeometryHelper): CarState[] {
  const sorted = [...room.players].sort((a, b) => {
    if (a.isHost && !b.isHost) return -1;
    if (!a.isHost && b.isHost) return 1;
    return a.joinedAt - b.joinedAt;
  });

  const curveLength = helper.curve.getLength();
  const wheelRadius = 0.38;

  return sorted.map((player, idx) => {
    const isMe = player.playerId === session.playerId;
    const side = idx % 2 === 0 ? -1 : 1;
    const spacingDistance = 15.0 + idx * 8.0;
    const progress = (((1.0 - spacingDistance / curveLength) % 1.0) + 1.0) % 1.0;

    const pt = helper.curve.getPointAt(progress);
    const tangent = helper.curve.getTangentAt(progress).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const spawnPos = pt.clone().addScaledVector(normal, side * 2.5);
    const roadHeightRaw = terrainManager.getRoadHeight(spawnPos);
    const roadHeight = Number.isFinite(roadHeightRaw) ? roadHeightRaw : spawnPos.y;
    const spawnY = roadHeight + wheelRadius;
    const startAngle = Math.atan2(tangent.x, tangent.z);

    return {
      id: isMe ? "player" : `remote_${player.playerId}`,
      name: player.name || (isMe ? "You" : "LAN Racer"),
      isAI: false,
      color: isMe ? "#06b6d4" : REMOTE_COLORS[idx % REMOTE_COLORS.length],
      carId: "ferrari",
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
      aiAggression: 0.7,
    };
  });
}

export const LanRacePage: React.FC = () => {
  const navigate = useNavigate();
  const { roomCode } = useParams<{ roomCode: string }>();
  const normalizedCode = (roomCode || "").toUpperCase().trim();

  const [session, setSession] = useState<LanSession | null>(null);
  const [room, setRoom] = useState<LanRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [trackHelper, setTrackHelper] = useState<TrackGeometryHelper | null>(null);
  const [physicsService, setPhysicsService] = useState<GamePhysicsService | null>(null);
  const [cars, setCars] = useState<CarState[]>([]);
  const [controls, setControls] = useState<ControlsState>(defaultControls);
  const [phase, setPhase] = useState<GamePhase>("menu");
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  const [countdownMsg, setCountdownMsg] = useState("SYNC");
  const [countdownLabel, setCountdownLabel] = useState("Awaiting start signal");
  const [authoritativeRaceStartTime, setAuthoritativeRaceStartTime] = useState<number | null>(null);
  const [serverOffset, setServerOffset] = useState(0);

  const [showExitDialog, setShowExitDialog] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const remoteStatesRef = useRef<Map<string, any>>(new Map());
  const socketRef = useRef<LanVehicleClient | null>(null);
  const lastTimeRef = useRef<number>(Date.now());
  const racingMarkedRef = useRef(false);
  const finishRecordedRef = useRef(false);

  const currentPlayer = useMemo(() => cars.find((car) => car.id === "player") || cars[0], [cars]);
  const opponents = useMemo(() => cars.filter((car) => car.id !== "player" && !car.id.startsWith("traffic")), [cars]);

  const safeLeaveAndExit = useCallback(async () => {
    if (!normalizedCode) {
      navigate("/lan", { replace: true });
      return;
    }

    if (isLeaving) return;
    setIsLeaving(true);

    try {
      if (session) {
        await leaveLanRoom(session);
      }
    } catch {
      // Room may already be closed, still continue local cleanup.
    } finally {
      try {
        socketRef.current?.disconnect();
      } catch {}
      socketRef.current = null;
      clearLanSession(normalizedCode);
      setIsLeaving(false);
      navigate("/lan", { replace: true });
    }
  }, [session, normalizedCode, navigate, isLeaving]);

  useEffect(() => {
    if (!normalizedCode) {
      navigate("/lan", { replace: true });
      return;
    }

    let active = true;

    const initialize = async () => {
      setLoading(true);
      setError(null);

      try {
        const cached = loadLanSession(normalizedCode);
        if (!cached) {
          throw new Error("No LAN session found for this race room. Rejoin from LAN mode.");
        }

        const recon = await reconnectLanSession(cached);
        if (!active) return;

        saveLanSession(recon.session);
        setSession(recon.session);
        setRoom(recon.room);
        setServerOffset(recon.room.serverTime - Date.now());

        if (isFiniteNumber(recon.room.raceStartTime)) {
          setAuthoritativeRaceStartTime(recon.room.raceStartTime);
        }

        if (recon.room.status === "waiting") {
          navigate(`/lan/room/${normalizedCode}`, { replace: true });
          return;
        }

        const helper = new TrackGeometryHelper(LAN_MAP_ID);
        const physics = new GamePhysicsService(helper);
        setPlayerSelectedModelKey("ferrari_purosangue");

        setTrackHelper(helper);
        setPhysicsService(physics);
        setCars(buildLineup(recon.room, recon.session, helper));
        setElapsedTime(0);

        if (recon.room.status === "racing") {
          setPhase("racing");
          lastTimeRef.current = Date.now();
        } else {
          setPhase("countdown");
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.message || "Failed to initialize LAN race.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      active = false;
    };
  }, [normalizedCode, navigate]);

  useEffect(() => {
    if (!session || !normalizedCode) return;

    let active = true;
    const poll = async () => {
      try {
        const next = await fetchLanRoom(session.baseUrl, normalizedCode);
        if (!active) return;

        setRoom(next);
        setServerOffset(next.serverTime - Date.now());
        if (isFiniteNumber(next.raceStartTime)) {
          setAuthoritativeRaceStartTime((prev) => {
            if (!isFiniteNumber(prev)) return next.raceStartTime;
            return Math.min(prev, next.raceStartTime);
          });
        }

        if (next.status === "waiting" && phase !== "completed") {
          navigate(`/lan/room/${normalizedCode}`, { replace: true });
          return;
        }

        if (next.status === "racing" && phase !== "racing" && phase !== "completed") {
          setPhase("racing");
          lastTimeRef.current = Date.now();
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.message || "LAN room polling failed.");
      }
    };

    poll();
    const id = window.setInterval(poll, 800);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [session, normalizedCode, navigate, phase]);

  useEffect(() => {
    if (!session) return;

    const upsertRemote = (remotePlayerId: string, payload: any) => {
      if (!remotePlayerId || remotePlayerId === session.playerId) return;
      remoteStatesRef.current.set(remotePlayerId, toRemoteState(payload));
    };

    const vehicleClient = connectLanVehicleSocket({
      baseUrl: session.baseUrl,
      roomCode: session.roomCode,
      playerId: session.playerId,
      authToken: session.authToken,
      callbacks: {
        onRemoteUpdate: (remotePlayerId, data) => {
          if (data?.type === "player_list" || data?.type === "playerList") {
            const latestStates = data.latestStates || {};
            Object.keys(latestStates).forEach((id) => {
              upsertRemote(id, latestStates[id]);
            });
            return;
          }
          upsertRemote(remotePlayerId, data);
        },
        onPlayerLeft: (playerId) => {
          remoteStatesRef.current.delete(playerId);
          setCars((prev) =>
            prev.filter((car) => {
              const netId = car.id.startsWith("remote_") ? car.id.slice("remote_".length) : car.id;
              return netId !== playerId;
            }),
          );
        },
        onRaceStart: (startTime) => {
          if (!isFiniteNumber(startTime)) return;
          setAuthoritativeRaceStartTime((prev) => {
            if (!isFiniteNumber(prev)) return startTime;
            return Math.min(prev, startTime);
          });
          setPhase("countdown");
        },
      },
    });

    socketRef.current = vehicleClient;

    return () => {
      vehicleClient.disconnect();
      if (socketRef.current === vehicleClient) {
        socketRef.current = null;
      }
    };
  }, [session]);

  useEffect(() => {
    if (phase !== "countdown") return;

    const tick = () => {
      if (!isFiniteNumber(authoritativeRaceStartTime)) {
        setCountdownLabel("Awaiting start signal");
        setCountdownMsg("SYNC");
        return;
      }

      const now = Date.now() + serverOffset;
      const msLeft = authoritativeRaceStartTime - now;
      const remaining = Math.ceil(msLeft / 1000);

      if (remaining > 0) {
        setCountdownLabel("Race starts in");
        setCountdownMsg(String(remaining));
        return;
      }

      if (msLeft > -GO_HOLD_MS) {
        setCountdownLabel("Grid light");
        setCountdownMsg("GO!");
        return;
      }

      setPhase("racing");
      lastTimeRef.current = Date.now();

      if (session?.isHost && !racingMarkedRef.current) {
        racingMarkedRef.current = true;
        markLanRaceRunning(session)
          .then((nextRoom) => {
            setRoom(nextRoom);
            setServerOffset(nextRoom.serverTime - Date.now());
          })
          .catch(() => {});
      }
    };

    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [phase, authoritativeRaceStartTime, serverOffset, session]);

  useEffect(() => {
    let frameId = 0;

    const updateClock = () => {
      if (phase === "racing" && !isPaused) {
        const now = Date.now();
        const delta = (now - lastTimeRef.current) / 1000;
        setElapsedTime((prev) => prev + delta);
        lastTimeRef.current = now;
      } else {
        lastTimeRef.current = Date.now();
      }

      frameId = requestAnimationFrame(updateClock);
    };

    frameId = requestAnimationFrame(updateClock);
    return () => cancelAnimationFrame(frameId);
  }, [phase, isPaused]);

  useEffect(() => {
    return () => {
      try {
        socketRef.current?.disconnect();
      } catch {}
      socketRef.current = null;
    };
  }, []);

  const handleTickUpdate = (updatedCars: CarState[]) => {
    const localCar = updatedCars.find((car) => car.id === "player");
    if (localCar) {
      socketRef.current?.sendVehicleUpdate(localCar);
    }

    const nextCars = updatedCars.map((car) => {
      if (car.id === "player") return car;
      const netId = car.id.startsWith("remote_") ? car.id.slice("remote_".length) : car.id;
      const netState = remoteStatesRef.current.get(netId);
      if (netState) {
        SyncManager.unpackCarState(car, netState);
      }
      return car;
    });

    setCars(nextCars);
  };

  const handleRaceFinish = () => {
    if (finishRecordedRef.current) return;
    finishRecordedRef.current = true;
    setPhase("completed");

    const me = cars.find((car) => car.id === "player");
    if (!me || !room) return;

    const topSpeed = Math.round(
      cars.reduce((max, car) => {
        const kmh = Math.abs(car.speed || 0) * 3.6;
        return Math.max(max, kmh);
      }, 0),
    );

    recordLanRaceResult({
      roomCode: room.roomCode,
      playerName: me.name || session?.playerName || "LAN Racer",
      elapsedTimeSec: elapsedTime,
      topSpeedKmh: topSpeed,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white px-6 py-8 flex items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs tracking-widest uppercase text-slate-400">Preparing LAN race scene...</p>
        </div>
      </div>
    );
  }

  if (error || !session || !trackHelper || !physicsService || cars.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 text-white px-6 py-8 flex items-center justify-center">
        <div className="max-w-xl rounded-3xl border border-slate-800 bg-slate-900/50 p-6 space-y-4 text-center">
          <h1 className="text-2xl font-black">LAN Race Unavailable</h1>
          <p className="text-sm text-slate-400">{error || "Could not initialize race state."}</p>
          <button
            onClick={() => navigate("/lan")}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-black uppercase tracking-widest cursor-pointer"
          >
            Return To LAN Mode
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
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
        weather="sunny"
        raceSettings={{ selectedMap: LAN_MAP_ID }}
      />

      {(phase === "racing" || phase === "countdown") && currentPlayer && (
        <HUD
          player={currentPlayer}
          opponents={opponents}
          controls={controls}
          setControls={setControls}
          elapsedTime={elapsedTime}
          trackHelper={trackHelper}
          onPauseToggle={() => {
            if (phase === "racing") {
              setIsPaused((prev) => !prev);
            }
          }}
          isPaused={isPaused}
          onExitRace={() => {
            setShowExitDialog(true);
            setIsPaused(true);
          }}
        />
      )}

      {(phase === "racing" || phase === "countdown") && room && (
        <RoomCodeHUD roomCode={room.roomCode} playersCount={room.players.length} isLiveMode={false} />
      )}

      {phase === "countdown" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/40 pointer-events-none">
          <div className="bg-slate-900/84 border border-slate-700/60 backdrop-blur-md px-10 py-8 rounded-3xl flex flex-col items-center min-w-[200px]">
            <span className="text-[12px] font-black text-slate-400 tracking-widest uppercase">{countdownLabel}</span>
            <span
              className={`text-6xl font-black mt-3 text-transparent bg-clip-text ${
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

      {showExitDialog && (
        <div className="absolute inset-0 z-[999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-sm w-full text-center space-y-4">
            <h3 className="text-xl font-bold text-white uppercase tracking-wider">Leave LAN Race?</h3>
            <p className="text-slate-400 text-sm">
              Leaving now exits this LAN room on your device and returns you to LAN mode.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  setShowExitDialog(false);
                  setIsPaused(false);
                }}
                className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold tracking-wide uppercase transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={safeLeaveAndExit}
                className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-bold tracking-wide uppercase transition cursor-pointer"
              >
                Leave Race
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "completed" && currentPlayer && (
        <GameOver
          player={currentPlayer}
          opponents={opponents}
          elapsedTime={elapsedTime}
          onHome={safeLeaveAndExit}
          onRestart={() => navigate(`/lan/room/${normalizedCode}`)}
        />
      )}
    </div>
  );
};
