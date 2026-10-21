/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useCallback, useSyncExternalStore } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import { RoomManager, RoomData } from "../multiplayer/RoomManager";
import { RoomValidator } from "../multiplayer/RoomValidator";

export interface UseRoomReturn {
  room: RoomData | null;
  roomCode: string | null;
  isHost: boolean;
  loading: boolean;
  error: string | null;
  roomMissing: boolean;
  retryRoom: () => void;
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

interface RoomSnapshot {
  room: RoomData | null;
  roomCode: string | null;
  loading: boolean;
  error: string | null;
  roomMissing: boolean;
}

const emptySnapshot: RoomSnapshot = {
  room: null, roomCode: null, loading: false, error: null, roomMissing: false,
};
let snapshot = emptySnapshot;
const listeners = new Set<() => void>();
let unsubscribeRoom: (() => void) | null = null;
let unsubscribeSession: (() => void) | null = null;
let unsubscribeAuth: (() => void) | null = null;
let subscribedUid: string | null = null;
let generation = 0;

function publish(update: Partial<RoomSnapshot>) {
  snapshot = { ...snapshot, ...update };
  listeners.forEach((listener) => listener());
}

function detachRoomListener() {
  generation++;
  unsubscribeRoom?.();
  unsubscribeRoom = null;
  subscribedUid = null;
}

function syncRoom(force = false) {
  const code = RoomManager.getCurrentCode();
  const uid = auth.currentUser?.uid;
  if (!code || !uid) {
    detachRoomListener();
    publish({ ...emptySnapshot, roomCode: code, loading: !!code });
    return;
  }
  if (!force && unsubscribeRoom && snapshot.roomCode === code && subscribedUid === uid) return;

  detachRoomListener();
  const currentGeneration = generation;
  subscribedUid = uid;
  // This happens BEFORE onSnapshot can deliver anything, including cached data.
  publish({ ...emptySnapshot, roomCode: code, loading: true });
  // Own this listener directly. LiveModeManager's SyncManager subscription must
  // not replace the shared React room subscription.
  unsubscribeRoom = RoomManager.listenToRoom(code, (room) => {
    if (generation !== currentGeneration) return;
    publish({ room, roomCode: code, loading: false, error: null, roomMissing: room === null });
  }, (error) => {
    if (generation !== currentGeneration) return;
    console.error(`[useRoom] Subscription failed for ${code}:`, error);
    publish({ loading: false, error: error.message, roomMissing: false });
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    unsubscribeSession = RoomManager.subscribeToSession(() => syncRoom());
    unsubscribeAuth = onAuthStateChanged(auth, () => syncRoom());
    syncRoom();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribeSession?.();
      unsubscribeAuth?.();
      unsubscribeSession = unsubscribeAuth = null;
      detachRoomListener();
      snapshot = emptySnapshot;
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => emptySnapshot;

export function useRoom(requestedCode?: string): UseRoomReturn {
  const code = requestedCode === undefined ? undefined : RoomValidator.normalizeCode(requestedCode);
  useEffect(() => {
    if (code && RoomValidator.isValidCode(code)) RoomManager.rememberSession(code);
  }, [code]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // A URL change must not expose the previous room for even one render.
  const matchesRequest = code === undefined || state.roomCode === code;
  const invalidCode = code !== undefined && !RoomValidator.isValidCode(code);
  const room = matchesRequest && !invalidCode ? state.room : null;

  const createRoom = useCallback(async (
    nickname: string, carId: string, carColor?: string, isLiveMode = false,
    difficulty: "easy" | "medium" | "hard" = "medium", map = "map1", laps = 3, weather = "clear",
  ) => {
    publish({ loading: true, error: null, roomMissing: false });
    try {
      const createdCode = await RoomManager.createRoom(nickname, carId, carColor, isLiveMode, difficulty, map, laps, weather);
      syncRoom();
      return createdCode;
    } catch (error) {
      publish({ loading: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, []);

  const joinRoom = useCallback(async (roomCode: string, nickname: string, carId: string, carColor?: string) => {
    publish({ loading: true, error: null, roomMissing: false });
    try {
      await RoomManager.joinRoom(roomCode, nickname, carId, carColor);
      syncRoom(true);
    } catch (error) {
      publish({ loading: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, []);

  const leaveRoom = useCallback(async () => {
    const activeCode = RoomManager.getCurrentCode();
    if (activeCode) await RoomManager.closeRoom(activeCode);
  }, []);

  const deleteRoom = useCallback(async () => {
    const activeCode = RoomManager.getCurrentCode();
    if (activeCode) await RoomManager.deleteRoom(activeCode);
  }, []);

  const updateSettings = useCallback(async (settings: Partial<Pick<RoomData, "map" | "difficulty" | "laps" | "weather">>) => {
    const activeCode = RoomManager.getCurrentCode();
    if (activeCode) await RoomManager.updateHostSettings(activeCode, settings);
  }, []);

  const setReady = useCallback(async () => {
    const activeCode = RoomManager.getCurrentCode();
    const playerId = RoomManager.getCurrentPlayerId();
    if (activeCode && playerId) await RoomManager.setPlayerReady(activeCode, playerId);
  }, []);

  return {
    room,
    roomCode: code ?? state.roomCode,
    isHost: !!room && RoomManager.isHost(room),
    loading: !invalidCode && (!matchesRequest || state.loading),
    error: invalidCode ? "Invalid room code" : matchesRequest ? state.error : null,
    roomMissing: matchesRequest && !invalidCode && state.roomMissing,
    retryRoom: () => syncRoom(true),
    createRoom, joinRoom, leaveRoom, deleteRoom, updateSettings, setReady,
  };
}
