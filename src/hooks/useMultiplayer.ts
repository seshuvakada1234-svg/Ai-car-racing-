import { useMemo, useState, useCallback } from "react";
import { RoomData, RoomManager } from "../multiplayer/RoomManager";
import { PlayerManager, GridEntry } from "../multiplayer/PlayerManager";
import { useRoom } from "./useRoom";

export interface UseMultiplayerReturn {
  // Room states
  room: RoomData | null;
  playerId: string | null;
  isConnecting: boolean;
  error: string | null;
  roomMissing: boolean;
  retryRoom: () => void;

  // Grid states
  grid: GridEntry[];
  humanCount: number;
  aiCount: number;
  allReady: boolean;
  hudSummary: string;

  // Room methods
  createRoom: (
    nickname: string,
    carId: string,
    modelColor: string,
    isLiveMode: boolean,
    difficulty: "easy" | "medium" | "hard",
    map: string,
  ) => Promise<string>;
  joinRoom: (code: string, nickname: string, carId: string, carColor: string) => Promise<boolean>;
  leaveRoom: () => Promise<void>;
  deleteRoom: () => Promise<void>;
  toggleReady: (ready?: boolean) => void;
  startRaceNow: () => void;
  setError: (err: string | null) => void;

  // Sync methods
  sendLocalCar: (car: any) => void;
  sendAICars: (aiCars: any[]) => void;
}

// Track throttled timestamps outside hook to persist across hook re-renders
let lastLocalSend = 0;
let lastAiSend = 0;

export function useMultiplayer(roomOverride?: RoomData | null, roomCode?: string): UseMultiplayerReturn {
  const {
    room: hookRoom,
    loading: isConnecting,
    error,
    roomMissing,
    retryRoom,
    createRoom: createRoomBase,
    joinRoom: joinRoomBase,
    leaveRoom,
    deleteRoom,
    setReady,
  } = useRoom(roomCode);

  const room = roomOverride !== undefined ? roomOverride : hookRoom;

  const [localError, setLocalError] = useState<string | null>(null);

  const setError = useCallback((err: string | null) => {
    setLocalError(err);
  }, []);

  const grid = useMemo(() => (room ? PlayerManager.buildGrid(room) : []), [room]);

  const humanCount = room ? PlayerManager.humanCount(room) : 0;
  const aiCount = room ? PlayerManager.aiCount(room) : 0;
  const allReady = room ? PlayerManager.allReady(room) : false;
  const hudSummary = room ? PlayerManager.getHudSummary(room) : "";

  const playerId = RoomManager.getCurrentPlayerId();

  const createRoom = useCallback(
    async (
      nickname: string,
      carId: string,
      modelColor: string,
      isLiveMode: boolean,
      difficulty: "easy" | "medium" | "hard",
      map: string,
    ): Promise<string> => {
      // 3 Laps and sunset weather as standard defaults
      return createRoomBase(nickname, carId, modelColor, isLiveMode, difficulty, map, 3, "sunset");
    },
    [createRoomBase],
  );

  const joinRoom = useCallback(
    async (code: string, nickname: string, carId: string, carColor: string): Promise<boolean> => {
      try {
        await joinRoomBase(code, nickname, carId, carColor);
        return true;
      } catch (e) {
        return false;
      }
    },
    [joinRoomBase],
  );

  const toggleReady = useCallback(() => {
    setReady();
  }, [setReady]);

  const startRaceNow = useCallback(async () => {
    const code = RoomManager.getCurrentCode();
    if (code) {
      await RoomManager.startRace(code);
    }
  }, []);

  const sendLocalCar = useCallback(async (car: any) => {
    const now = Date.now();
    // Throttle to 50ms (exactly 20 updates per second) as requested
    if (now - lastLocalSend < 50) return;
    lastLocalSend = now;

    const code = RoomManager.getCurrentCode();
    const pid = RoomManager.getCurrentPlayerId();
    if (!code || !pid) return;

    // Log telemetry before send
    const pos = car.position ? { x: car.position.x, y: car.position.y, z: car.position.z } : null;
    const rot = car.angle ?? 0;
    const sp = car.speed ?? 0;
    console.log(
      `[SEND]\n` +
      `playerId: ${pid}\n` +
      `roomCode: ${code}\n` +
      `position: ${JSON.stringify(pos)}\n` +
      `rotation: ${rot}\n` +
      `speed: ${sp}\n` +
      `timestamp: ${now}`
    );

    try {
      await RoomManager.updateCurrentPlayerPosition(code, pid, car);
    } catch (e) {
      // quiet fail on active frame rendering
    }
  }, []);

  const sendAICars = useCallback(async (aiCars: any[]) => {
    const now = Date.now();
    if (now - lastAiSend < 200) return;
    lastAiSend = now;

    const code = RoomManager.getCurrentCode();
    if (!code) return;

    try {
      await RoomManager.updateAICarsPosition(code, aiCars);
    } catch (e) {
      // quiet fail on active frame rendering
    }
  }, []);

  return {
    room,
    playerId,
    isConnecting,
    error: error || localError,
    roomMissing,
    retryRoom,
    grid,
    humanCount,
    aiCount,
    allReady,
    hudSummary,
    createRoom,
    joinRoom,
    leaveRoom,
    deleteRoom,
    toggleReady,
    startRaceNow,
    setError,
    sendLocalCar,
    sendAICars,
  };
}
