import { Env } from "./types";

const RACE_START_DELAY_MS = 5000;
const RECENT_RACE_START_WINDOW_MS = 30000;

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface QuaternionLike extends Vector3Like {
  w: number;
}

function cleanRoomCode(roomCode: string): string {
  return roomCode.toUpperCase().trim();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVector3(value: any): value is Vector3Like {
  return (
    value &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z)
  );
}

function isFiniteQuaternion(value: any): value is QuaternionLike {
  return (
    value &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.w)
  );
}

/**
 * RoomDurableObject is an in-memory, high-performance WebSocket relay room
 * designed specifically for low-latency vehicle coordinate streaming (20Hz)
 * and server-authoritative race state control.
 */
export class RoomDurableObject {
  state: DurableObjectState;
  env: Env;

  // Requirement 4: clients collection
  clients: Map<string, { ws: WebSocket; playerId: string }>;
  latestStates: Map<string, any>;
  raceStartTime: number | null;

  // Requirement 3: room.players list
  room: {
    players: string[];
  };

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
    this.latestStates = new Map();
    this.raceStartTime = null;
    this.room = {
      players: [],
    };
  }

  private sendJson(ws: WebSocket, payload: any) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error("[Durable Object] Failed to send payload:", err);
    }
  }

  private sendPlayerList(ws: WebSocket) {
    this.sendJson(ws, {
      type: "player_list",
      players: this.room.players,
      latestStates: Object.fromEntries(this.latestStates.entries()),
    });
  }

  private sendRaceStart(ws: WebSocket, startTime: number) {
    this.sendJson(ws, { type: "race_start", startTime });
    this.sendJson(ws, { type: "raceStart", startTime });
  }

  private sendExistingRaceStart(ws: WebSocket) {
    const startTime = this.raceStartTime;
    if (!startTime) return;
    if (startTime <= Date.now() - RECENT_RACE_START_WINDOW_MS) return;
    this.sendRaceStart(ws, startTime);
  }

  private isCurrentMember(playerId: string, socket: WebSocket): boolean {
    const currentClient = this.clients.get(playerId);
    if (!currentClient || currentClient.ws !== socket) return false;
    return this.room.players.includes(playerId);
  }

  private normalizeVehicleUpdate(msg: any, roomCode: string, playerId: string): any | null {
    if (!msg || typeof msg !== "object") {
      console.warn("[Durable Object] vehicleUpdate rejected: payload must be an object");
      return null;
    }

    const inboundRoom =
      typeof msg.roomCode === "string" && msg.roomCode.trim()
        ? cleanRoomCode(msg.roomCode)
        : roomCode;

    if (inboundRoom !== roomCode) {
      console.warn(
        `[Durable Object] vehicleUpdate rejected: room mismatch (${inboundRoom} vs ${roomCode})`,
      );
      return null;
    }

    if (typeof msg.playerId === "string" && msg.playerId !== playerId) {
      console.warn(
        `[Durable Object] vehicleUpdate rejected: player mismatch (${msg.playerId} vs ${playerId})`,
      );
      return null;
    }

    if (msg.playerId !== undefined && typeof msg.playerId !== "string") {
      console.warn("[Durable Object] vehicleUpdate rejected: playerId must be a string when provided");
      return null;
    }

    if (!isFiniteVector3(msg.position)) {
      console.warn("[Durable Object] vehicleUpdate rejected: invalid position payload");
      return null;
    }

    if (!isFiniteQuaternion(msg.rotation)) {
      console.warn("[Durable Object] vehicleUpdate rejected: invalid rotation payload");
      return null;
    }

    return {
      ...msg,
      type: msg.type === "vehicle_update" ? "vehicle_update" : "vehicleUpdate",
      roomCode,
      playerId,
      position: {
        x: msg.position.x,
        y: msg.position.y,
        z: msg.position.z,
      },
      rotation: {
        x: msg.rotation.x,
        y: msg.rotation.y,
        z: msg.rotation.z,
        w: msg.rotation.w,
      },
    };
  }

  private broadcastRaw(rawPayload: string, excludePlayerId?: string) {
    for (const [pid, client] of this.clients.entries()) {
      if (excludePlayerId && pid === excludePlayerId) continue;
      try {
        client.ws.send(rawPayload);
      } catch (err) {
        console.error(`[Durable Object] Broadcast failure to player ${pid}:`, err);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomCode = cleanRoomCode(url.searchParams.get("roomCode") || "");
    const playerId = url.searchParams.get("playerId") || "";

    if (!roomCode || !playerId) {
      return new Response("Missing roomCode or playerId parameters", { status: 400 });
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Durable Object expected a WebSocket connection", { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept WebSocket connection on our server peer
    server.accept();

    // If this player already has an open socket, replace it without emitting duplicate join.
    const oldClient = this.clients.get(playerId);
    const isNewPlayer = !this.room.players.includes(playerId);
    this.clients.set(playerId, { ws: server, playerId });

    if (isNewPlayer) {
      this.room.players.push(playerId);
    }

    if (oldClient && oldClient.ws !== server) {
      try {
        oldClient.ws.close(1000, "Replaced by new connection");
      } catch (e) {}
    }

    // Requirement 8: Debug Logging - Player joined, Room code, Players in room
    console.log(`[Durable Object] Player joined: ${playerId}`);
    console.log(`Room code: ${roomCode}`);
    console.log(`Players in room: ${this.room.players.length}`);
    console.log(`Room ${roomCode}`);
    console.log(`Players: ${this.room.players.length}`);

    this.sendPlayerList(server);
    this.sendExistingRaceStart(server);

    // Broadcast join only for truly new players.
    if (isNewPlayer) {
      this.broadcast({ type: "playerJoined", playerId }, playerId);
      this.broadcast({ type: "player_join", playerId }, playerId);
    }

    server.addEventListener("message", (event) => {
      try {
        if (typeof event.data !== "string") return;
        const msg: any = JSON.parse(event.data);

        if (!this.isCurrentMember(playerId, server)) {
          console.warn(
            `[Durable Object] Message rejected: stale or unregistered socket for player ${playerId}`,
          );
          return;
        }

        if (msg.type === "join") {
          if (!msg.roomCode || !msg.playerId) {
            console.warn("[Durable Object] join rejected: missing roomCode/playerId");
            return;
          }

          const joinRoom = cleanRoomCode(String(msg.roomCode));
          const joinPlayer = String(msg.playerId);
          if (joinRoom !== roomCode || joinPlayer !== playerId) {
            console.warn(
              `[Durable Object] join rejected: identity lock mismatch for ${playerId} in ${roomCode}`,
            );
            return;
          }

          this.sendPlayerList(server);
          this.sendExistingRaceStart(server);
          return;
        }

        if (msg.type === "vehicleUpdate" || msg.type === "vehicle_update") {
          const normalized = this.normalizeVehicleUpdate(msg, roomCode, playerId);
          if (!normalized) return;

          // Requirement 8: Debug Logging - Vehicle update received
          console.log(`[DO] Received vehicleUpdate from ${playerId}`);

          // Requirement 4: Store latest transform
          this.latestStates.set(playerId, normalized);

          // Requirement 4: Broadcast immediately to every other client
          const raw = JSON.stringify(normalized);
          this.broadcastRaw(raw, playerId);

          // Requirement 8: Debug Logging - Vehicle update broadcast
          console.log(`[DO] Broadcasting to ${Math.max(this.clients.size - 1, 0)} clients`);
          console.log(`Room ${roomCode}`);
          console.log(`Players: ${this.room.players.length}`);
          console.log(`Broadcast vehicle_update to ${Math.max(this.clients.size - 1, 0)} client`);
          return;
        }

        if (msg.type === "start_race" || msg.type === "countdown" || msg.type === "race_start") {
          const now = Date.now();
          const existingStart = this.raceStartTime;

          if (existingStart && existingStart > now - RECENT_RACE_START_WINDOW_MS) {
            this.sendRaceStart(server, existingStart);
            return;
          }

          const raceStartTime = now + RACE_START_DELAY_MS;
          this.raceStartTime = raceStartTime;

          // Requirement 8: Debug Logging - Race started
          console.log(`[Durable Object] Race started in room ${roomCode} at ${raceStartTime}`);

          // Broadcast race_start to ALL players (including sender!)
          this.broadcast({ type: "race_start", startTime: raceStartTime });
          this.broadcast({ type: "raceStart", startTime: raceStartTime });
          return;
        }
      } catch (err) {
        console.error("[Durable Object] Error handling message:", err);
      }
    });

    server.addEventListener("close", () => {
      this.handleDisconnect(playerId, server, roomCode);
    });

    server.addEventListener("error", () => {
      this.handleDisconnect(playerId, server, roomCode);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleDisconnect(playerId: string, socket: WebSocket, roomCode: string) {
    const currentClient = this.clients.get(playerId);
    if (currentClient && currentClient.ws === socket) {
      // Requirement 6 & 8: Remove player and log disconnected
      this.clients.delete(playerId);
      this.latestStates.delete(playerId);
      this.room.players = this.room.players.filter((p) => p !== playerId);

      console.log(`[Durable Object] Player disconnected: ${playerId}`);
      console.log(`Room ${roomCode}`);
      console.log(`Players in room: ${this.room.players.length}`);

      // Requirement 6: Broadcast player_leave
      this.broadcast({ type: "playerLeft", playerId }, playerId);
      this.broadcast({ type: "player_leave", playerId }, playerId);

      if (this.room.players.length === 0) {
        this.raceStartTime = null;
        this.latestStates.clear();
      }
    }
  }

  private broadcast(msg: any, excludePlayerId?: string) {
    const payload = JSON.stringify(msg);
    for (const [pid, client] of this.clients.entries()) {
      if (pid !== excludePlayerId) {
        try {
          client.ws.send(payload);
        } catch (err) {
          console.error(`[Durable Object] Broadcast failure to player ${pid}:`, err);
        }
      }
    }
  }
}
