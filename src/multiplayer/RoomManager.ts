/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RoomService } from "./RoomService";
import { RoomState, RoomPlayer as GenericRoomPlayer } from "./RoomState";
import { Unsubscribe } from "firebase/firestore";
import { auth } from "../lib/firebase";
import { RoomValidator } from "./RoomValidator";

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

export type RoomStatus = RoomState["status"];

export interface RoomPlayer {
  uid?: string;
  playerName?: string;
  name?: string;
  id: string;
  nickname: string;
  carId: string;
  isHost: boolean;
  isReady: boolean;
  isAI: boolean;
  joinedAt: number;
  carColor?: string;
  ready?: boolean;
  mapReady?: boolean;
  mapProgress?: number;
  carReady?: boolean;
  carProgress?: number;
  glbParsing?: boolean;
  vehicleInitialized?: boolean;
  sceneReady?: boolean;
  connected?: boolean;

  // Physical sync
  position?: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  angle?: number;
  speed?: number;
  isDrifting?: boolean;
  currentLap?: number;
  currentCheckpointIndex?: number;
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
  raceStarted?: boolean;
  selectedCar?: string;
  selectedMap?: RoomState["selectedMap"];
}

export class RoomManager {
  private static currentRoomCode: string | null = null;
  private static sessionLoaded = false;
  private static currentPlayerId: string | null = null;
  private static unsubscribe: Unsubscribe | null = null;
  private static sessionListeners = new Set<() => void>();

  static subscribeToSession(listener: () => void): () => void {
    this.sessionListeners.add(listener);
    return () => { this.sessionListeners.delete(listener); };
  }

  static rememberSession(code: string, nickname?: string, carId?: string, carColor?: string): void {
    const cleanCode = RoomValidator.normalizeCode(code);
    if (!RoomValidator.isValidCode(cleanCode)) throw new Error("Invalid room code");
    const changed = this.currentRoomCode !== cleanCode;
    this.currentRoomCode = cleanCode;
    this.sessionLoaded = true;
    safeSetItem("session", "last_room_code", cleanCode);
    safeSetItem("local", "activeRoomCode", cleanCode);
    if (nickname) safeSetItem("session", "last_player_nickname", nickname);
    if (carId) safeSetItem("session", "last_car_id", carId);
    if (carColor) safeSetItem("session", "last_car_color", carColor);
    if (changed) this.sessionListeners.forEach((listener) => listener());
  }

  static clearSession(code: string): void {
    // An earlier asynchronous leave must not clear a newly joined room.
    if (this.getCurrentCode() !== RoomValidator.normalizeCode(code)) return;
    this.currentRoomCode = null;
    this.sessionLoaded = true;
    if (RoomValidator.normalizeCode(safeGetItem("local", "activeRoomCode")) === RoomValidator.normalizeCode(code)) {
      safeRemoveItem("local", "activeRoomCode");
    }
    safeRemoveItem("session", "last_room_code");
    this.sessionListeners.forEach((listener) => listener());
  }

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
    await auth.authStateReady();
    const hostId = this.getOrCreatePlayerId();
    const rawCode = await RoomService.createRoom(hostId, hostNickname, "", hostCarId, map);
    const code = rawCode.trim().toUpperCase();

    // Now update extra parameters
    await RoomService.updateRoomSettings(code, {
      difficulty,
      laps,
      weather,
    } as any);

    this.rememberSession(code, hostNickname, hostCarId, carColor);
    RoomManager.currentPlayerId = hostId;
    return code;
  }

  static async joinRoom(code: string, nickname: string, carId: string, carColor?: string): Promise<RoomData> {
    await auth.authStateReady();
    const cleanCode = code.trim().toUpperCase();
    const playerId = this.getOrCreatePlayerId();

    // Check Firebase and perform proper validation
    await RoomService.joinRoom(cleanCode, playerId, nickname, "", carId);

    this.rememberSession(cleanCode, nickname, carId, carColor);
    RoomManager.currentPlayerId = playerId;

    const room = await RoomService.getRoom(cleanCode);
    if (!room) throw new Error("Room not found after joining");
    return this.mapToRoomData(room);
  }

  static listenToRoom(code: string, onChange: (room: RoomData | null) => void, onError?: (error: Error) => void): () => void {
    const cleanCode = code.toUpperCase().trim();
    const unsub = RoomService.listenToRoom(cleanCode, (room) => {
      if (room) {
        onChange(this.mapToRoomData(room));
      } else {
        onChange(null);
      }
    }, onError);
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
    await RoomService.toggleReady(code, playerId, true);
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

  static async leaveRoom(code?: string, uid?: string): Promise<void> {
    const rawCode = code || this.getCurrentCode();
    if (!rawCode) return;
    const cleanCode = RoomValidator.normalizeCode(rawCode);
    const playerId = uid || this.getCurrentPlayerId();
    if (!playerId) return;
    await RoomService.leaveRoom(cleanCode, playerId);
    this.clearSession(cleanCode);
  }

  static async closeRoom(code: string): Promise<void> {
    await this.leaveRoom(code);
  }

  static async deleteRoom(code: string): Promise<void> {
    const cleanCode = code.trim().toUpperCase();
    await RoomService.deleteRoom(cleanCode);
    this.clearSession(cleanCode);
  }

  // ── Reconnection Handler ───────────────────────────────────

  /**
   * Attempts to rebuild the state and automatically reconnect the player on reload
   */
  static async attemptReconnect(code = this.getCurrentCode()): Promise<RoomData | null> {
    const lastRoom = code;
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
      console.error(`[RoomManager] Reconnect failed for ${normalizedCode}:`, e);
      // Keep the session on network/auth errors so another attempt can recover.
      throw e;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  static getCurrentCode(): string | null {
    if (!RoomManager.sessionLoaded) {
      RoomManager.sessionLoaded = true;
      // Tabs can visit different rooms; prefer this tab's session over shared localStorage.
      const codeFromStorage = safeGetItem("session", "last_room_code") || safeGetItem("local", "activeRoomCode");
      RoomManager.currentRoomCode = RoomValidator.isValidCode(codeFromStorage) ? RoomValidator.normalizeCode(codeFromStorage) : null;
    }
    return RoomManager.currentRoomCode;
  }

  static getCurrentPlayerId(): string {
    return auth.currentUser?.uid || "";
  }

  static isHost(room: RoomData): boolean {
    return room.hostId === RoomManager.getCurrentPlayerId();
  }

  public static getOrCreatePlayerId(): string {
    if (auth.currentUser) {
      return auth.currentUser.uid;
    }
    throw new Error("Sign in before joining a multiplayer room.");
  }

  private static mapToRoomData(room: RoomState): RoomData {
    return {
      ...room,
      roomCode: room.roomCode,
      code: room.roomCode,
      id: room.roomCode,
      hostId: room.hostId,
      map: room.mapType || "map1",
      difficulty: room.difficulty || "medium",
      laps: room.laps || 3,
      weather: room.weather || "clear",
      players: (room.players || []).map((p) => {
        const canonicalId = p.uid || p.id!;
        return {
          ...p,
          uid: canonicalId,
          id: canonicalId,
          nickname: p.playerName || p.nickname || p.name || "Driver",
          carId: typeof p.carId === "string" ? p.carId : (p.carId as any)?.id || "ferrari",
          carColor: p.carColor,
          isHost: p.isHost,
          isReady: p.ready ?? p.isReady ?? false,
          isAI: p.isAI,
          joinedAt: p.joinedAt,
          mapReady: p.mapReady,
          mapProgress: p.mapProgress ?? p.downloadProgress,
          downloadProgress: p.downloadProgress ?? p.mapProgress,
          carReady: p.carReady,
          carProgress: p.carProgress,
          glbParsing: p.glbParsing,
          vehicleInitialized: p.vehicleInitialized,
          sceneReady: p.sceneReady,
          position: p.position,
          velocity: p.velocity,
          angle: p.angle,
          speed: p.speed,
          isDrifting: p.isDrifting,
          currentLap: p.currentLap,
          isFinished: p.isFinished,
          totalDistanceTraveled: p.totalDistanceTraveled,
        };
      }),
      status: room.status,
      phase: room.status,
      countdown: room.countdown,
      createdAt: room.createdAt,
      maxPlayers: room.maxPlayers,
      countdownStartTime: room.countdownStartTime,
    };
  }
}
