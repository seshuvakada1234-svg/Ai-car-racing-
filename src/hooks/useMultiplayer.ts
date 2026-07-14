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
  leaveRoom: () => void;
  deleteRoom: () => void;
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

export function useMultiplayer(roomOverride?: RoomData | null): UseMultiplayerReturn {
  const {
    room: hookRoom,
    loading: isConnecting,
    error,
    createRoom: createRoomBase,
    joinRoom: joinRoomBase,
    leaveRoom,
    deleteRoom,
    setReady,
  } = useRoom();

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

  const playerId = useMemo(() => RoomManager.getCurrentPlayerId(), [room]);

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
    // Throttle to 40ms (approx. 25 updates per second) for smooth real-time syncing
    if (now - lastLocalSend < 40) return;
    lastLocalSend = now;

    const code = RoomManager.getCurrentCode();
    const pid = RoomManager.getCurrentPlayerId();
    if (!code || !pid) return;

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
