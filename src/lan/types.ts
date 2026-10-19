export type LanRoomStatus = "waiting" | "countdown" | "racing" | "finished" | "closed";

export interface LanRoomPlayer {
  playerId: string;
  name: string;
  ready: boolean;
  isHost: boolean;
  joinedAt: number;
}

export interface LanRoom {
  roomCode: string;
  status: LanRoomStatus;
  hostPlayerId: string;
  raceStartTime: number | null;
  maxPlayers: number;
  players: LanRoomPlayer[];
  serverTime: number;
}

export interface LanSession {
  roomCode: string;
  playerId: string;
  authToken: string;
  isHost: boolean;
  playerName: string;
  baseUrl: string;
}

export interface LanHostInfo {
  hostIps: string[];
  suggestedUrls: string[];
  port: number;
  serverTime: number;
}
