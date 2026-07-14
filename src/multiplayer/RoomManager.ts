/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RoomService } from "./RoomService";
import { RoomState, RoomPlayer as GenericRoomPlayer } from "./RoomState";
import { Unsubscribe } from "firebase/firestore";
import { auth } from "../lib/firebase";

// Safe fallback storage when browser denies localStorage/sessionStorage access in sandboxed iframes
const memoryStorage = new Map<string, string>();

function safeGetItem(type: "local" | "session", key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = type === "local" ? window.localStorage : window.sessionStorage;
    if (!storage) return memoryStorage.get(key) || null;
    return storage.getItem(key);
  } catch (e) {
    return memoryStorage.get(key) || null;
  }
}

function safeSetItem(type: "local" | "session", key: string, value: string): void {
  try {
    memoryStorage.set(key, value);
    if (typeof window === "undefined") return;
    const storage = type === "local" ? window.localStorage : window.sessionStorage;
    if (storage) {
      storage.setItem(key, value);
    }
  } catch (e) {}
}

function safeRemoveItem(type: "local" | "session", key: string): void {
  try {
    memoryStorage.delete(key);
    if (typeof window === "undefined") return;
    const storage = type === "local" ? window.localStorage : window.sessionStorage;
    if (storage) {
      storage.removeItem(key);
    }
  } catch (e) {}
}

export type RoomStatus = "waiting" | "countdown" | "racing" | "finished" | "archived" | "closed" | "complete";

export interface RoomPlayer {
  id: string;
  nickname: string;
  carId: string;
  isHost: boolean;
  isReady: boolean;
  isAI: boolean;
  joinedAt: number;
  carColor?: string;

  // Physical sync
  position?: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  angle?: number;
  speed?: number;
  isDrifting?: boolean;
  currentLap?: number;
  isFinished?: boolean;
  totalDistanceTraveled?: number;
}

export interface RoomData {
  roomCode: string;
  code?: string;
  id?: string;
  isLiveMode?: boolean;
  hostId: string;
  map: string;
  difficulty: "easy" | "medium" | "hard";
  laps: number;
  weather: string;
  players: RoomPlayer[];
  status: RoomStatus;
  phase?: RoomStatus;
  countdown: number;
  createdAt: any;
  maxPlayers: number;
  countdownStartTime?: any;
}

export class RoomManager {
  private static currentRoomCode: string | null = null;
  private static currentPlayerId: string | null = null;
  private static unsubscribe: Unsubscribe | null = null;

  static async createRoom(
    hostNickname: string,
    hostCarId: string,
    carColor?: string,
    isLiveMode = false,
    difficulty: "easy" | "medium" | "hard" = "medium",
    map = "map1",
    laps = 3,
    weather = "clear",
  ): Promise<string> {
    const hostId = this.getOrCreatePlayerId();
    const rawCode = await RoomService.createRoom(hostId, hostNickname, "", hostCarId, map);
    const code = rawCode.trim().toUpperCase();

    // Save local state for browser reconnection & context
    safeSetItem("local", "activeRoomCode", code);
    safeSetItem("session", "last_room_code", code);
    safeSetItem("session", "last_player_nickname", hostNickname);
    safeSetItem("session", "last_car_id", hostCarId);
    if (carColor) safeSetItem("session", "last_car_color", carColor);

    // Now update extra parameters
    await RoomService.updateRoomSettings(code, {
      difficulty,
      laps,
      weather,
    } as any);

    RoomManager.currentRoomCode = code;
    RoomManager.currentPlayerId = hostId;
    return code;
  }

  static async joinRoom(code: string, nickname: string, carId: string, carColor?: string): Promise<RoomData> {
    const cleanCode = code.trim().toUpperCase();
    const playerId = this.getOrCreatePlayerId();

    // Check Firebase and perform proper validation
    await RoomService.joinRoom(cleanCode, playerId, nickname, "", carId);

    // Save local state for browser reconnection & context
    safeSetItem("local", "activeRoomCode", cleanCode);
    safeSetItem("session", "last_room_code", cleanCode);
    safeSetItem("session", "last_player_nickname", nickname);
    safeSetItem("session", "last_car_id", carId);
    if (carColor) safeSetItem("session", "last_car_color", carColor);

    RoomManager.currentRoomCode = cleanCode;
    RoomManager.currentPlayerId = playerId;

    // Return the formatted RoomData
    return new Promise((resolve, reject) => {
      const unsub = RoomService.listenToRoom(cleanCode, (room) => {
        unsub();
        if (room) {
          resolve(this.mapToRoomData(room));
        } else {
          reject(new Error("Room not found after joining"));
        }
      });
    });
  }

  static listenToRoom(code: string, onChange: (room: RoomData) => void): () => void {
    const cleanCode = code.toUpperCase().trim();
    const unsub = RoomService.listenToRoom(cleanCode, (room) => {
      if (room) {
        onChange(this.mapToRoomData(room));
      }
    });
    return unsub;
  }

  static async updateHostSettings(
    code: string,
    settings: Partial<Pick<RoomData, "map" | "difficulty" | "laps" | "weather">>,
  ): Promise<void> {
    const cleanCode = code.toUpperCase().trim();
    const mapped: any = {};
    if (settings.map) mapped.mapType = settings.map;
    if (settings.difficulty) mapped.difficulty = settings.difficulty;
    if (settings.laps) mapped.laps = settings.laps;
    if (settings.weather) mapped.weather = settings.weather;

    await RoomService.updateRoomSettings(cleanCode, mapped);
  }

  static async setPlayerReady(code: string, playerId: string): Promise<void> {
    // Already set to ready on join/create so we can immediately start or let user override
    console.log(`Setting player ready ${playerId}`);
  }

  static async startRace(code: string): Promise<void> {
    await RoomService.setRoomStatus(code, "racing");
  }

  static async updateCurrentPlayerPosition(code: string, playerId: string, carState: any): Promise<void> {
    await RoomService.updatePlayerPosition(code, playerId, {
      position: { x: carState.position.x, y: carState.position.y, z: carState.position.z },
      velocity: { x: carState.velocity.x, y: carState.velocity.y, z: carState.velocity.z },
      angle: carState.angle,
      rotation: carState.angle,
      speed: carState.speed,
      steering: carState.steerValue ?? 0,
      steerValue: carState.steerValue ?? 0,
      wheelRotation: carState.wheelspinAngle ?? 0,
      nitro: carState.isNitroActive || false,
      isNitroActive: carState.isNitroActive || false,
      drift: carState.isDrifting || false,
      isDrifting: carState.isDrifting || false,
      lap: carState.currentLap || 1,
      currentLap: carState.currentLap || 1,
      checkpoint: carState.currentCheckpointIndex || 0,
      currentCheckpointIndex: carState.currentCheckpointIndex || 0,
      isFinished: carState.isFinished || false,
      totalDistanceTraveled: carState.totalDistanceTraveled || 0,
      timestamp: Date.now(),
    });
  }

  static async updateAICarsPosition(code: string, aiCarsState: any[]): Promise<void> {
    // Supports updating secondary AI positions
    console.log(`AI positional update for ${code}`, aiCarsState.length);
  }

  static async closeRoom(code: string): Promise<void> {
    const cleanCode = code.trim().toUpperCase();
    const playerId = this.getOrCreatePlayerId();
    await RoomService.leaveRoom(cleanCode, playerId);
    safeRemoveItem("local", "activeRoomCode");
    safeRemoveItem("session", "last_room_code");
    RoomManager.currentRoomCode = null;
  }

  static async deleteRoom(code: string): Promise<void> {
    const cleanCode = code.trim().toUpperCase();
    await RoomService.deleteRoom(cleanCode);
    safeRemoveItem("local", "activeRoomCode");
    safeRemoveItem("session", "last_room_code");
    RoomManager.currentRoomCode = null;
  }

  // ── Reconnection Handler ───────────────────────────────────

  /**
   * Attempts to rebuild the state and automatically reconnect the player on reload
   */
  static async attemptReconnect(): Promise<RoomData | null> {
    const lastRoom = safeGetItem("local", "activeRoomCode") || safeGetItem("session", "last_room_code");
    const lastNickname = safeGetItem("session", "last_player_nickname");
    const lastCar = safeGetItem("session", "last_car_id");
    const lastColor = safeGetItem("session", "last_car_color") || undefined;

    if (!lastRoom || !lastNickname || !lastCar) return null;

    const normalizedCode = lastRoom.trim().toUpperCase();

    try {
      console.log(`Attempting automatic reconnect to Room: ${normalizedCode}`);
      const data = await this.joinRoom(normalizedCode, lastNickname, lastCar, lastColor);
      return data;
    } catch (e) {
      console.warn("Reconnection auto-attempt silent discard:", e);
      // Clean stale session records
      safeRemoveItem("local", "activeRoomCode");
      safeRemoveItem("session", "last_room_code");
      return null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  static getCurrentCode(): string | null {
    if (!RoomManager.currentRoomCode) {
      const codeFromStorage = safeGetItem("local", "activeRoomCode") || safeGetItem("session", "last_room_code");
      RoomManager.currentRoomCode = codeFromStorage ? codeFromStorage.trim().toUpperCase() : null;
    }
    return RoomManager.currentRoomCode;
  }

  static getCurrentPlayerId(): string {
    if (auth.currentUser) {
      return auth.currentUser.uid;
    }
    if (!RoomManager.currentPlayerId) {
      RoomManager.currentPlayerId = this.getOrCreatePlayerId();
    }
    return RoomManager.currentPlayerId;
  }

  static isHost(room: RoomData): boolean {
    return room.hostId === RoomManager.getCurrentPlayerId();
  }

  public static getOrCreatePlayerId(): string {
    if (auth.currentUser) {
      return auth.currentUser.uid;
    }
    let id = safeGetItem("session", "racePlayerId");
    if (!id) {
      id = `player_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      safeSetItem("session", "racePlayerId", id);
    }
    return id;
  }

  private static mapToRoomData(room: RoomState): RoomData {
    return {
      roomCode: room.roomCode,
      code: room.roomCode,
      id: room.roomCode,
      hostId: room.hostId,
      map: room.mapType || "map1",
      difficulty: room.difficulty || "medium",
      laps: room.laps || 3,
      weather: room.weather || "clear",
      players: room.players.map((p) => ({
        id: p.uid,
        nickname: p.playerName,
        carId: p.carId,
        carColor: p.carColor,
        isHost: p.isHost,
        isReady: p.ready,
        isAI: p.isAI,
        joinedAt: p.joinedAt,
        position: p.position,
        velocity: p.velocity,
        angle: p.angle,
        speed: p.speed,
        isDrifting: p.isDrifting,
        currentLap: p.currentLap,
        isFinished: p.isFinished,
        totalDistanceTraveled: p.totalDistanceTraveled,
      })),
      status: room.status,
      phase: room.status,
      countdown: room.countdown,
      createdAt: room.createdAt,
      maxPlayers: room.maxPlayers,
      countdownStartTime: room.countdownStartTime,
    };
  }
}
