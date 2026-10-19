import express, { Request, Response, Router } from "express";
import os from "os";
import crypto from "crypto";

export type LanRoomStatus = "waiting" | "countdown" | "racing" | "finished" | "closed";

export interface LanRoomPlayer {
  playerId: string;
  name: string;
  ready: boolean;
  isHost: boolean;
  joinedAt: number;
}

export interface LanRoomSnapshot {
  roomCode: string;
  status: LanRoomStatus;
  hostPlayerId: string;
  raceStartTime: number | null;
  maxPlayers: number;
  players: LanRoomPlayer[];
  serverTime: number;
}

export interface LanSessionAuth {
  roomCode: string;
  playerId: string;
  authToken: string;
  isHost: boolean;
  playerName: string;
}

interface LanRoomPlayerInternal extends LanRoomPlayer {
  authToken: string;
  lastSeen: number;
}

interface LanRoomInternal {
  roomCode: string;
  status: LanRoomStatus;
  hostPlayerId: string;
  raceStartTime: number | null;
  maxPlayers: number;
  players: Map<string, LanRoomPlayerInternal>;
  createdAt: number;
  updatedAt: number;
}

interface MembershipContext {
  room: LanRoomInternal;
  player: LanRoomPlayerInternal;
}

interface LanRoomErrorData {
  status: number;
  message: string;
}

class LanRoomError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeRoomCode(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

function sanitizePlayerName(raw: string): string {
  const cleaned = String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return "LAN Racer";
  return cleaned.slice(0, 24);
}

function getParamString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

function generateRoomCode(usedCodes: Set<string>): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 5000; i++) {
    let code = "L";
    for (let j = 0; j < 5; j++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!usedCodes.has(code)) return code;
  }
  throw new Error("Unable to allocate LAN room code");
}

function createAuthToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

function createPlayerId(): string {
  return `lan_${crypto.randomBytes(6).toString("hex")}`;
}

function toSnapshot(room: LanRoomInternal, now: number): LanRoomSnapshot {
  const players = Array.from(room.players.values())
    .map((player) => ({
      playerId: player.playerId,
      name: player.name,
      ready: player.ready,
      isHost: player.isHost,
      joinedAt: player.joinedAt,
    }))
    .sort((a, b) => {
      if (a.isHost && !b.isHost) return -1;
      if (!a.isHost && b.isHost) return 1;
      return a.joinedAt - b.joinedAt;
    });

  return {
    roomCode: room.roomCode,
    status: room.status,
    hostPlayerId: room.hostPlayerId,
    raceStartTime: room.raceStartTime,
    maxPlayers: room.maxPlayers,
    players,
    serverTime: now,
  };
}

function getLanIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const ips = new Set<string>();

  for (const key of Object.keys(interfaces)) {
    const entries = interfaces[key] || [];
    for (const info of entries) {
      if (!info) continue;
      if (info.family !== "IPv4") continue;
      if (info.internal) continue;
      ips.add(info.address);
    }
  }

  return Array.from(ips).sort();
}

export class LanRoomStore {
  private readonly rooms = new Map<string, LanRoomInternal>();
  private readonly now: () => number;

  private readonly RACE_START_DELAY_MS = 5000;
  private readonly RECENT_RACE_START_WINDOW_MS = 30000;
  private readonly ROOM_TTL_MS = 2 * 60 * 60 * 1000;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private advanceRoomState(room: LanRoomInternal, now = this.now()): void {
    if (room.status === "countdown" && room.raceStartTime && now >= room.raceStartTime) {
      room.status = "racing";
      room.updatedAt = now;
    }
  }

  private getRoomOrThrow(roomCode: string): LanRoomInternal {
    const code = normalizeRoomCode(roomCode);
    const room = this.rooms.get(code);
    if (!room) {
      throw new LanRoomError(404, `LAN room ${code} not found`);
    }
    this.advanceRoomState(room);
    return room;
  }

  private requireMembership(roomCode: string, playerId: string, authToken: string): MembershipContext {
    const room = this.getRoomOrThrow(roomCode);
    const player = room.players.get(playerId);

    if (!player) {
      throw new LanRoomError(403, "Player is not a member of this LAN room");
    }
    if (!authToken || player.authToken !== authToken) {
      throw new LanRoomError(403, "Invalid LAN session token");
    }

    player.lastSeen = this.now();
    return { room, player };
  }

  private cleanupExpiredRooms(now = this.now()) {
    for (const [code, room] of this.rooms.entries()) {
      if (room.players.size === 0) {
        this.rooms.delete(code);
        continue;
      }
      if (now - room.updatedAt > this.ROOM_TTL_MS) {
        this.rooms.delete(code);
      }
    }
  }

  public createRoom(playerName: string, maxPlayers = 6): { room: LanRoomSnapshot; session: LanSessionAuth } {
    this.cleanupExpiredRooms();

    const now = this.now();
    const roomCode = generateRoomCode(new Set(this.rooms.keys()));
    const hostPlayerId = createPlayerId();
    const authToken = createAuthToken();

    const host: LanRoomPlayerInternal = {
      playerId: hostPlayerId,
      name: sanitizePlayerName(playerName),
      ready: true,
      isHost: true,
      joinedAt: now,
      authToken,
      lastSeen: now,
    };

    const room: LanRoomInternal = {
      roomCode,
      status: "waiting",
      hostPlayerId,
      raceStartTime: null,
      maxPlayers: Math.max(2, Math.min(8, maxPlayers)),
      players: new Map([[hostPlayerId, host]]),
      createdAt: now,
      updatedAt: now,
    };

    this.rooms.set(roomCode, room);

    return {
      room: toSnapshot(room, now),
      session: {
        roomCode,
        playerId: hostPlayerId,
        authToken,
        isHost: true,
        playerName: host.name,
      },
    };
  }

  public joinRoom(roomCode: string, playerName: string): { room: LanRoomSnapshot; session: LanSessionAuth } {
    const room = this.getRoomOrThrow(roomCode);
    const now = this.now();

    if (room.status !== "waiting") {
      throw new LanRoomError(409, "LAN room is no longer accepting new players");
    }

    if (room.players.size >= room.maxPlayers) {
      throw new LanRoomError(409, "LAN room is full");
    }

    const playerId = createPlayerId();
    const authToken = createAuthToken();
    const player: LanRoomPlayerInternal = {
      playerId,
      name: sanitizePlayerName(playerName),
      ready: false,
      isHost: false,
      joinedAt: now,
      authToken,
      lastSeen: now,
    };

    room.players.set(playerId, player);
    room.updatedAt = now;

    return {
      room: toSnapshot(room, now),
      session: {
        roomCode: room.roomCode,
        playerId,
        authToken,
        isHost: false,
        playerName: player.name,
      },
    };
  }

  public reconnect(roomCode: string, playerId: string, authToken: string): { room: LanRoomSnapshot; session: LanSessionAuth } {
    const { room, player } = this.requireMembership(roomCode, playerId, authToken);
    const now = this.now();
    room.updatedAt = now;
    return {
      room: toSnapshot(room, now),
      session: {
        roomCode: room.roomCode,
        playerId: player.playerId,
        authToken: player.authToken,
        isHost: player.isHost,
        playerName: player.name,
      },
    };
  }

  public getRoom(roomCode: string): LanRoomSnapshot {
    const room = this.getRoomOrThrow(roomCode);
    return toSnapshot(room, this.now());
  }

  public setReady(roomCode: string, playerId: string, authToken: string, ready: boolean): LanRoomSnapshot {
    const { room, player } = this.requireMembership(roomCode, playerId, authToken);
    player.ready = !!ready;
    room.updatedAt = this.now();
    return toSnapshot(room, this.now());
  }

  public startRace(roomCode: string, playerId: string, authToken: string): LanRoomSnapshot {
    const { room, player } = this.requireMembership(roomCode, playerId, authToken);
    const now = this.now();

    if (!player.isHost || room.hostPlayerId !== playerId) {
      throw new LanRoomError(403, "Only the host can start a LAN race");
    }

    const existing = room.raceStartTime;
    if (existing && existing > now - this.RECENT_RACE_START_WINDOW_MS) {
      room.status = existing <= now ? "racing" : "countdown";
      room.updatedAt = now;
      return toSnapshot(room, now);
    }

    room.raceStartTime = now + this.RACE_START_DELAY_MS;
    room.status = "countdown";
    room.updatedAt = now;
    return toSnapshot(room, now);
  }

  public markRacing(roomCode: string, playerId: string, authToken: string): LanRoomSnapshot {
    const { room, player } = this.requireMembership(roomCode, playerId, authToken);
    if (!player.isHost || room.hostPlayerId !== playerId) {
      throw new LanRoomError(403, "Only the host can finalize LAN race start");
    }

    room.status = "racing";
    if (!room.raceStartTime) {
      room.raceStartTime = this.now();
    }
    room.updatedAt = this.now();
    return toSnapshot(room, this.now());
  }

  public leaveRoom(roomCode: string, playerId: string, authToken: string): { closed: boolean; room: LanRoomSnapshot | null } {
    const { room, player } = this.requireMembership(roomCode, playerId, authToken);
    const now = this.now();

    room.players.delete(player.playerId);
    room.updatedAt = now;

    if (room.players.size === 0 || player.isHost) {
      this.rooms.delete(room.roomCode);
      return { closed: true, room: null };
    }

    if (!room.players.has(room.hostPlayerId)) {
      const nextHost = Array.from(room.players.values()).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      nextHost.isHost = true;
      nextHost.ready = true;
      room.hostPlayerId = nextHost.playerId;
    }

    return { closed: false, room: toSnapshot(room, now) };
  }

  public validateMembershipForRelay(roomCode: string, playerId: string, authToken?: string): boolean {
    const code = normalizeRoomCode(roomCode);
    const room = this.rooms.get(code);

    // Unknown room codes are treated as non-LAN sessions and are not blocked.
    if (!room) return true;

    const player = room.players.get(playerId);
    if (!player) return false;
    if (!authToken) return false;

    const ok = player.authToken === authToken;
    if (ok) {
      player.lastSeen = this.now();
      room.updatedAt = this.now();
    }
    return ok;
  }

  public hostInfo(port: number) {
    const ips = getLanIpAddresses();
    return {
      hostIps: ips,
      suggestedUrls: ips.map((ip) => `http://${ip}:${port}`),
      port,
      serverTime: this.now(),
    };
  }
}

function sendJson(res: Response, status: number, payload: any) {
  res.status(status).json(payload);
}

function toLanError(error: unknown): LanRoomErrorData {
  if (error instanceof LanRoomError) {
    return { status: error.status, message: error.message };
  }
  return {
    status: 500,
    message: error instanceof Error ? error.message : "Unexpected LAN server error",
  };
}

export function createLanRoomRouter(store: LanRoomStore, serverPort: number): Router {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  });

  router.get("/health", (req, res) => {
    sendJson(res, 200, { status: "ok", serverTime: Date.now() });
  });

  router.get("/host-info", (req, res) => {
    sendJson(res, 200, store.hostInfo(serverPort));
  });

  router.post("/rooms", (req: Request, res: Response) => {
    try {
      const playerName = sanitizePlayerName(req.body?.playerName || "LAN Host");
      const maxPlayers = Number.isFinite(req.body?.maxPlayers) ? Number(req.body.maxPlayers) : 6;
      const result = store.createRoom(playerName, maxPlayers);
      sendJson(res, 200, result);
    } catch (error) {
      const err = toLanError(error);
      sendJson(res, err.status, { error: err.message });
    }
  });

  router.post("/rooms/:roomCode/join", (req: Request, res: Response) => {
    try {
      const roomCode = normalizeRoomCode(getParamString(req.params.roomCode));
      const playerName = sanitizePlayerName(req.body?.playerName || "LAN Racer");
      const result = store.joinRoom(roomCode, playerName);
      sendJson(res, 200, result);
    } catch (error) {
      const err = toLanError(error);
      sendJson(res, err.status, { error: err.message });
    }
  });

  router.post("/rooms/:roomCode/reconnect", (req: Request, res: Response) => {
    try {
      const roomCode = normalizeRoomCode(getParamString(req.params.roomCode));
      const playerId = String(req.body?.playerId || "").trim();
      const authToken = String(req.body?.authToken || "").trim();
      const result = store.reconnect(roomCode, playerId, authToken);
      sendJson(res, 200, result);
    } catch (error) {
      const err = toLanError(error);
      sendJson(res, err.status, { error: err.message });
    }
  });

  router.get("/rooms/:roomCode", (req: Request, res: Response) => {
    try {
      const roomCode = normalizeRoomCode(getParamString(req.params.roomCode));
      const room = store.getRoom(roomCode);
      sendJson(res, 200, { room });
    } catch (error) {
      const err = toLanError(error);
      sendJson(res, err.status, { error: err.message });
    }
  });

  router.post("/rooms/:roomCode/ready", (req: Request, res: Response) => {
    try {
      const roomCode = normalizeRoomCode(getParamString(req.params.roomCode));
      const playerId = String(req.body?.playerId || "").trim();
      const authToken = String(req.body?.authToken || "").trim();
      const ready = !!req.body?.ready;
      const room = store.setReady(roomCode, playerId, authToken, ready);
      sendJson(res, 200, { room });
    } catch (error) {
      const err = toLanError(error);
      sendJson(res, err.status, { error: err.message });
    }
  });

  router.post("/rooms/:roomCode/start", (req: Request, res: Response) => {
    try {
      const roomCode = normalizeRoomCode(getParamString(req.params.roomCode));
      const playerId = String(req.body?.playerId || "").trim();
      const authToken = String(req.body?.authToken || "").trim();
      const room = store.startRace(roomCode, playerId, authToken);
      sendJson(res, 200, { room });
    } catch (error) {
      const err = toLanError(error);
      sendJson(res, err.status, { error: err.message });
    }
  });

  router.post("/rooms/:roomCode/racing", (req: Request, res: Response) => {
    try {
      const roomCode = normalizeRoomCode(getParamString(req.params.roomCode));
      const playerId = String(req.body?.playerId || "").trim();
      const authToken = String(req.body?.authToken || "").trim();
      const room = store.markRacing(roomCode, playerId, authToken);
      sendJson(res, 200, { room });
    } catch (error) {
      const err = toLanError(error);
      sendJson(res, err.status, { error: err.message });
    }
  });

  router.post("/rooms/:roomCode/leave", (req: Request, res: Response) => {
    try {
      const roomCode = normalizeRoomCode(getParamString(req.params.roomCode));
      const playerId = String(req.body?.playerId || "").trim();
      const authToken = String(req.body?.authToken || "").trim();
      const result = store.leaveRoom(roomCode, playerId, authToken);
      sendJson(res, 200, result);
    } catch (error) {
      const err = toLanError(error);
      sendJson(res, err.status, { error: err.message });
    }
  });

  return router;
}
