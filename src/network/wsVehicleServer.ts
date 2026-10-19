import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

const RACE_START_DELAY_MS = 5000;
const RECENT_RACE_START_WINDOW_MS = 30000;

interface Registration {
  roomCode: string;
  playerId: string;
  authToken?: string;
}

export type VehicleWsMembershipValidator = (
  roomCode: string,
  playerId: string,
  authToken?: string,
) => boolean;

let membershipValidator: VehicleWsMembershipValidator | null = null;

export function setVehicleWsMembershipValidator(validator: VehicleWsMembershipValidator | null): void {
  membershipValidator = validator;
}

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

export function setupVehicleWsServer(wss: WebSocketServer) {
  // Map to store: socket -> { roomCode, playerId }
  const socketData = new Map<WebSocket, Registration>();

  // Map to store: roomCode -> Set of sockets
  const rooms = new Map<string, Set<WebSocket>>();

  // Map to store room membership and latest transforms (contract-compatible with DO)
  const roomPlayers = new Map<string, Set<string>>();
  const roomLatestStates = new Map<string, Map<string, any>>();
  const roomRaceStartTimes = new Map<string, number>();

  const normalizeVehicleUpdatePayload = (data: any, reg: Registration) => {
    if (!data || typeof data !== "object") {
      console.warn("[WS SERVER] vehicleUpdate rejected: payload must be an object");
      return null;
    }

    const roomCode = reg.roomCode;
    const playerId = reg.playerId;
    const inboundRoom =
      typeof data.roomCode === "string" && data.roomCode.trim()
        ? cleanRoomCode(data.roomCode)
        : roomCode;

    if (inboundRoom !== roomCode) {
      console.warn(
        `[WS SERVER] Validation failed for ${playerId}: packet room ${inboundRoom} != registration ${roomCode}`,
      );
      return null;
    }

    if (typeof data.playerId === "string" && data.playerId !== playerId) {
      console.warn(
        `[WS SERVER] Validation failed for ${playerId}: packet playerId ${data.playerId} mismatched`,
      );
      return null;
    }

    if (data.playerId !== undefined && typeof data.playerId !== "string") {
      console.warn(
        `[WS SERVER] Validation failed for ${playerId}: packet playerId must be a string when provided`,
      );
      return null;
    }

    if (!isFiniteVector3(data.position)) {
      console.warn(`[WS SERVER] Validation failed for ${playerId}: packet position is malformed`);
      return null;
    }

    if (!isFiniteQuaternion(data.rotation)) {
      console.warn(`[WS SERVER] Validation failed for ${playerId}: packet rotation is malformed`);
      return null;
    }

    return {
      ...data,
      type: data.type === "vehicle_update" ? "vehicle_update" : "vehicleUpdate",
      roomCode,
      playerId,
      position: {
        x: data.position.x,
        y: data.position.y,
        z: data.position.z,
      },
      rotation: {
        x: data.rotation.x,
        y: data.rotation.y,
        z: data.rotation.z,
        w: data.rotation.w,
      },
    };
  };

  const getOrCreateRoomSockets = (roomCode: string) => {
    let roomSockets = rooms.get(roomCode);
    if (!roomSockets) {
      roomSockets = new Set<WebSocket>();
      rooms.set(roomCode, roomSockets);
    }
    return roomSockets;
  };

  const getOrCreateRoomPlayers = (roomCode: string) => {
    let players = roomPlayers.get(roomCode);
    if (!players) {
      players = new Set<string>();
      roomPlayers.set(roomCode, players);
    }
    return players;
  };

  const getOrCreateLatestStates = (roomCode: string) => {
    let latest = roomLatestStates.get(roomCode);
    if (!latest) {
      latest = new Map<string, any>();
      roomLatestStates.set(roomCode, latest);
    }
    return latest;
  };

  const broadcastToRoom = (roomCode: string, payload: any, excludeSocket?: WebSocket) => {
    const roomSockets = rooms.get(roomCode);
    if (!roomSockets) return 0;

    const raw = JSON.stringify(payload);
    let sent = 0;
    for (const socket of roomSockets) {
      if (excludeSocket && socket === excludeSocket) continue;
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(raw);
        sent++;
      } catch (err) {
        console.error("[WS SERVER] Error broadcasting payload:", err);
      }
    }
    return sent;
  };

  const sendPlayerList = (ws: WebSocket, roomCode: string) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    const players = Array.from(roomPlayers.get(roomCode) || []);
    const latestStates = Object.fromEntries((roomLatestStates.get(roomCode) || new Map()).entries());

    ws.send(
      JSON.stringify({
        type: "player_list",
        players,
        latestStates,
      }),
    );
  };

  const sendExistingRaceStart = (ws: WebSocket, roomCode: string) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    const startTime = roomRaceStartTimes.get(roomCode);
    if (!startTime) return;
    if (startTime <= Date.now() - RECENT_RACE_START_WINDOW_MS) return;

    ws.send(JSON.stringify({ type: "race_start", startTime }));
    ws.send(JSON.stringify({ type: "raceStart", startTime }));
  };

  const unregisterSocket = (ws: WebSocket, broadcastLeave = true) => {
    const reg = socketData.get(ws);
    if (!reg) return;

    const { roomCode, playerId } = reg;
    socketData.delete(ws);

    const roomSockets = rooms.get(roomCode);
    if (roomSockets) {
      roomSockets.delete(ws);
      if (roomSockets.size === 0) {
        rooms.delete(roomCode);
        roomPlayers.delete(roomCode);
        roomLatestStates.delete(roomCode);
        roomRaceStartTimes.delete(roomCode);
        console.log(`[WS SERVER] Room ${roomCode} emptied and cleaned up`);
        return;
      }
    }

    const stillConnected = Array.from(socketData.values()).some(
      (info) => info.roomCode === roomCode && info.playerId === playerId,
    );

    if (!stillConnected) {
      roomPlayers.get(roomCode)?.delete(playerId);
      roomLatestStates.get(roomCode)?.delete(playerId);

      if (broadcastLeave) {
        broadcastToRoom(roomCode, { type: "playerLeft", playerId });
        broadcastToRoom(roomCode, { type: "player_leave", playerId });
      }
    }

    console.log(`[WS SERVER] Player ${playerId} left room ${roomCode}`);
  };

  const registerSocket = (ws: WebSocket, roomCode: string, playerId: string, authToken?: string) => {
    const cleanCode = cleanRoomCode(roomCode);
    if (!cleanCode || !playerId) return;
    const normalizedToken = typeof authToken === "string" ? authToken : "";

    if (membershipValidator && !membershipValidator(cleanCode, playerId, normalizedToken)) {
      console.warn(`[WS SERVER] Membership validation failed for ${playerId} in ${cleanCode}`);
      return;
    }

    const existing = socketData.get(ws);
    if (existing && existing.roomCode === cleanCode && existing.playerId === playerId) {
      if ((existing.authToken || "") !== normalizedToken) {
        console.warn(`[WS SERVER] Identity lock: token mismatch for ${playerId} in ${cleanCode}`);
        return;
      }
      sendPlayerList(ws, cleanCode);
      sendExistingRaceStart(ws, cleanCode);
      return;
    }

    if (existing) {
      console.warn(
        `[WS SERVER] Identity lock: socket cannot change registration from ${existing.playerId}@${existing.roomCode} to ${playerId}@${cleanCode}`,
      );
      return;
    }

    socketData.set(ws, { roomCode: cleanCode, playerId, authToken: normalizedToken });

    const roomSockets = getOrCreateRoomSockets(cleanCode);
    roomSockets.add(ws);

    const players = getOrCreateRoomPlayers(cleanCode);
    const isNewPlayer = !players.has(playerId);
    players.add(playerId);

    // Ensure room state map exists (for future player_list updates)
    getOrCreateLatestStates(cleanCode);

    sendPlayerList(ws, cleanCode);
    sendExistingRaceStart(ws, cleanCode);

    if (isNewPlayer) {
      broadcastToRoom(cleanCode, { type: "playerJoined", playerId }, ws);
      broadcastToRoom(cleanCode, { type: "player_join", playerId }, ws);
    }

    console.log(`[WS SERVER] Player ${playerId} joined room ${cleanCode}`);
  };

  wss.on("connection", (ws: WebSocket, request?: any) => {
    // Attempt auto-join from URL search parameters if available
    if (request && request.url) {
      try {
        const urlObj = new URL(request.url, `http://${request.headers?.host || "localhost"}`);
        const roomCode = urlObj.searchParams.get("roomCode");
        const playerId = urlObj.searchParams.get("playerId");
        const authToken = urlObj.searchParams.get("token") || "";
        if (roomCode && playerId) {
          registerSocket(ws, roomCode, playerId, authToken);
          console.log(`[WS SERVER] Player ${playerId} auto-joined room ${cleanRoomCode(roomCode)} via URL params`);
        }
      } catch (err) {
        console.error("[WS SERVER] Error parsing connection URL parameters:", err);
      }
    }

    ws.on("message", (message: string) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === "join") {
          const { roomCode, playerId, token } = data;
          if (!roomCode || !playerId) return;
          registerSocket(ws, roomCode, playerId, token);
          return;
        }

        if (data.type === "vehicleUpdate" || data.type === "vehicle_update") {
          const reg = socketData.get(ws);
          if (!reg) {
            console.warn("[WS SERVER] vehicleUpdate rejected: socket is not registered in any room");
            return;
          }

          const outbound = normalizeVehicleUpdatePayload(data, reg);
          if (!outbound) return;

          const roomCode = reg.roomCode;
          const playerId = reg.playerId;

          if (membershipValidator && !membershipValidator(roomCode, playerId, reg.authToken || "")) {
            console.warn(`[WS SERVER] vehicleUpdate rejected: membership validator denied ${playerId} in ${roomCode}`);
            return;
          }

          getOrCreateLatestStates(roomCode).set(playerId, outbound);

          console.log("[SERVER RECEIVE]", { playerId, roomCode });

          let broadcastTo = 0;
          const roomSockets = rooms.get(roomCode);
          if (roomSockets) {
            const raw = JSON.stringify(outbound);
            for (const socket of roomSockets) {
              if (socket === ws || socket.readyState !== WebSocket.OPEN) continue;
              socket.send(raw);
              broadcastTo++;
            }
          }

          console.log("[SERVER BROADCAST]", { playerId, roomCode, broadcastTo });
          return;
        }

        if (data.type === "start_race" || data.type === "countdown" || data.type === "race_start") {
          const reg = socketData.get(ws);
          if (!reg) {
            console.warn("[WS SERVER] start_race rejected: socket is not registered in any room");
            return;
          }

          const roomCode = reg.roomCode;
          const playerId = reg.playerId;

          if (membershipValidator && !membershipValidator(roomCode, playerId, reg.authToken || "")) {
            console.warn(`[WS SERVER] start_race rejected: membership validator denied ${playerId} in ${roomCode}`);
            return;
          }

          const isMember = !!rooms.get(roomCode)?.has(ws) && !!roomPlayers.get(roomCode)?.has(playerId);
          if (!isMember) {
            console.warn(`[WS SERVER] start_race rejected: player ${playerId} is not a valid member of ${roomCode}`);
            return;
          }

          const now = Date.now();
          const existingStart = roomRaceStartTimes.get(roomCode);

          if (existingStart && existingStart > now - RECENT_RACE_START_WINDOW_MS) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "race_start", startTime: existingStart }));
              ws.send(JSON.stringify({ type: "raceStart", startTime: existingStart }));
            }
            return;
          }

          const raceStartTime = now + RACE_START_DELAY_MS;
          roomRaceStartTimes.set(roomCode, raceStartTime);

          broadcastToRoom(roomCode, { type: "race_start", startTime: raceStartTime });
          broadcastToRoom(roomCode, { type: "raceStart", startTime: raceStartTime });

          console.log(`[WS SERVER] Race start scheduled in room ${roomCode} at ${raceStartTime}`);
          return;
        }
      } catch (err) {
        console.error("[WS SERVER] Error processing message:", err);
      }
    });

    ws.on("close", () => {
      unregisterSocket(ws, true);
    });

    ws.on("error", () => {
      unregisterSocket(ws, true);
    });
  });
}

export function startVehicleWsServer(port: number) {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server });
  setupVehicleWsServer(wss);

  server.listen(port, "0.0.0.0", () => {
    console.log(`[WS SERVER] Server listening on port ${port}`);
  });

  return server;
}

// Entry point detection for CJS and ESM environments
const isMain = typeof require !== "undefined" && require.main === module;
const isEsmMain =
  process.argv[1] &&
  (process.argv[1].endsWith("wsVehicleServer.ts") ||
    process.argv[1].endsWith("wsVehicleServer.js") ||
    process.argv[1].endsWith("wsVehicleServer.cjs"));

if (isMain || isEsmMain) {
  const PORT = parseInt(process.env.WS_PORT || process.env.PORT || "3001", 10);
  startVehicleWsServer(PORT);
}
