/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type RoomStatus = "waiting" | "countdown" | "racing" | "finished" | "archived" | "closed" | "complete";

export interface RoomPlayer {
  uid: string;
  id?: string; // alias for compatibility (RoomPlayer standard uses id & uid)
  playerName: string;
  nickname?: string; // alias for compatibility (RoomPlayer standard uses nickname & playerName)
  photoURL: string;
  joinedAt: number;
  ready: boolean;
  isReady?: boolean; // alias for compatibility
  carId: string;
  carColor?: string;
  isHost: boolean;
  isAI: boolean;

  // New properties
  name?: string;
  selectedCar?: string;
  mapDownloaded?: boolean;

  // Map download synchronizations
  mapReady?: boolean;
  sceneReady?: boolean;
  downloadProgress?: number;
  downloadedMB?: number;
  totalMB?: number;

  // Multi-user racing synchronizations
  position?: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  angle?: number;
  speed?: number;
  isDrifting?: boolean;
  currentLap?: number;
  isFinished?: boolean;
  totalDistanceTraveled?: number;
}

export interface RoomState {
  roomCode: string;
  code?: string; // alias for compatibility
  id?: string; // alias for compatibility
  hostId: string;
  hostName?: string;
  ownerUid?: string; // alias for compatibility
  ownerName?: string; // alias for compatibility
  players: RoomPlayer[];
  maxPlayers: number;
  status: RoomStatus;
  phase?: RoomStatus; // alias for compatibility
  countdown: number;
  createdAt: any;
  updatedAt: any;
  expiresAt: any;
  mapType: string;
  mapId?: string; // alias for compatibility
  difficulty?: "easy" | "medium" | "hard"; // alias for compatibility
  laps?: number; // alias for compatibility
  weather?: string; // alias for compatibility
  selectedCars: Record<string, string>; // Player UID to Selected Car ID mapping
  selectedCar?: string; // alias for compatibility
  gameState: string;
  currentPlayers: number;
  isArchived?: boolean;
  countdownStartTime?: any;
}
