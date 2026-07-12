/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";
import { RoomManager, RoomData } from "../multiplayer/RoomManager";
import { SyncManager } from "../multiplayer/SyncManager";

export interface UseRoomReturn {
  room: RoomData | null;
  roomCode: string | null;
  isHost: boolean;
  loading: boolean;
  error: string | null;
  createRoom: (
    nickname: string,
    carId: string,
    carColor?: string,
    isLiveMode?: boolean,
    difficulty?: "easy" | "medium" | "hard",
    map?: string,
    laps?: number,
    weather?: string,
  ) => Promise<string>;
  joinRoom: (code: string, nickname: string, carId: string, carColor?: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  deleteRoom: () => Promise<void>;
  updateSettings: (settings: Partial<Pick<RoomData, "map" | "difficulty" | "laps" | "weather">>) => Promise<void>;
  setReady: () => Promise<void>;
}

// Global shared state for useRoom callbacks and variables (prevents multiple duplicate listeners on subpages)
let globalRoom: RoomData | null = null;
let globalRoomCode: string | null = RoomManager.getCurrentCode();
let globalLoading = false;
let globalError: string | null = null;

const listeners = new Set<() => void>();

function updateGlobalState(room: RoomData | null, roomCode: string | null, loading: boolean, error: string | null) {
  globalRoom = room;
  globalRoomCode = roomCode;
  globalLoading = loading;
  globalError = error;
  listeners.forEach((listener) => listener());
}

let unsubscribeFromSync: (() => void) | null = null;

function subscribeToRoom(code: string) {
  if (unsubscribeFromSync) {
    unsubscribeFromSync();
  }
  unsubscribeFromSync = SyncManager.attach(code, (updatedRoom) => {
    updateGlobalState(updatedRoom, code, false, null);
  });
}

function unsubscribeFromRoom() {
  if (unsubscribeFromSync) {
    unsubscribeFromSync();
    unsubscribeFromSync = null;
  }
  updateGlobalState(null, null, false, null);
  SyncManager.detach();
}

// Initial bootstrap if room code is available on load
if (globalRoomCode && !unsubscribeFromSync) {
  subscribeToRoom(globalRoomCode);
}

export function useRoom(): UseRoomReturn {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const listener = () => forceUpdate({});
    listeners.add(listener);

    // Dynamic Safe Reconnect trigger on mount if disconnected
    if (!globalRoom && !globalLoading) {
      const code = RoomManager.getCurrentCode();
      if (code) {
        setImmediateReconnect(code);
      }
    }

    return () => {
      listeners.delete(listener);
    };
  }, []);

  const setImmediateReconnect = async (code: string) => {
    try {
      const room = await RoomManager.attemptReconnect();
      if (room) {
        subscribeToRoom(room.roomCode);
      }
    } catch (e: any) {
      console.warn("Silent mount-period reconnection abort:", e);
    }
  };

  const createRoom = useCallback(
    async (
      nickname: string,
      carId: string,
      carColor?: string,
      isLiveMode = false,
      difficulty: "easy" | "medium" | "hard" = "medium",
      map = "map1",
      laps = 3,
      weather = "clear",
    ): Promise<string> => {
      updateGlobalState(globalRoom, globalRoomCode, true, null);
      try {
        const code = await RoomManager.createRoom(
          nickname,
          carId,
          carColor,
          isLiveMode,
          difficulty,
          map,
          laps,
          weather,
        );
        subscribeToRoom(code);
        return code;
      } catch (e: any) {
        updateGlobalState(globalRoom, globalRoomCode, false, e.message);
        throw e;
      }
    },
    [],
  );

  const joinRoom = useCallback(
    async (code: string, nickname: string, carId: string, carColor?: string): Promise<void> => {
      updateGlobalState(globalRoom, globalRoomCode, true, null);
      try {
        await RoomManager.joinRoom(code, nickname, carId, carColor);
        subscribeToRoom(code.toUpperCase());
      } catch (e: any) {
        updateGlobalState(globalRoom, globalRoomCode, false, e.message);
        throw e;
      }
    },
    [],
  );

  const leaveRoom = useCallback(async (): Promise<void> => {
    if (!globalRoomCode) return;
    const code = globalRoomCode;
    const room = globalRoom;
    unsubscribeFromRoom();
    if (room && RoomManager.isHost(room)) {
      await RoomManager.closeRoom(code);
    }
  }, []);

  const deleteRoom = useCallback(async (): Promise<void> => {
    if (!globalRoomCode) return;
    const code = globalRoomCode;
    unsubscribeFromRoom();
    await RoomManager.deleteRoom(code);
  }, []);

  const updateSettings = useCallback(
    async (settings: Partial<Pick<RoomData, "map" | "difficulty" | "laps" | "weather">>): Promise<void> => {
      if (!globalRoomCode) return;
      await RoomManager.updateHostSettings(globalRoomCode, settings);
    },
    [],
  );

  const setReady = useCallback(async (): Promise<void> => {
    if (!globalRoomCode) return;
    const playerId = RoomManager.getCurrentPlayerId();
    if (playerId) {
      await RoomManager.setPlayerReady(globalRoomCode, playerId);
    }
  }, []);

  const isHost = globalRoom ? RoomManager.isHost(globalRoom) : false;

  return {
    room: globalRoom,
    roomCode: globalRoomCode,
    isHost,
    loading: globalLoading,
    error: globalError,
    createRoom,
    joinRoom,
    leaveRoom,
    deleteRoom,
    updateSettings,
    setReady,
  };
}
