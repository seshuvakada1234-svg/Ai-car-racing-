import { Env, WsPacket } from "./types";

/**
 * RoomDurableObject is an in-memory, high-performance WebSocket relay room
 * designed specifically for low-latency vehicle coordinate streaming (20Hz)
 * and server-authoritative race state control.
 */
export class RoomDurableObject {
  state: DurableObjectState;
  env: Env;
  sessions: Map<string, WebSocket>;
  latestStates: Map<string, any>;
  raceStartTime: number | null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.latestStates = new Map();
    this.raceStartTime = null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomCode = (url.searchParams.get("roomCode") || "").toUpperCase().trim();
    const playerId = url.searchParams.get("playerId") || "";

    if (!roomCode || !playerId) {
      return new Response("Missing roomCode or playerId parameters", { status: 400 });
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
      return new Response("Durable Object expected a WebSocket connection", { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept WebSocket connection on our server peer
    server.accept();

    // If this player already has an open socket, close the previous one
    const oldSocket = this.sessions.get(playerId);
    if (oldSocket) {
      try {
        oldSocket.close(1000, "Replaced by new connection");
      } catch (e) {}
    }
    
    // Store connection in-memory
    this.sessions.set(playerId, server);
    console.log(`[Durable Object] Player joined: ${playerId} in room ${roomCode}. Active players: ${this.sessions.size}`);

    // Send complete current player list and their latest coordinates to the newly joined player
    const currentPlayers = Array.from(this.sessions.keys());
    try {
      server.send(
        JSON.stringify({
          type: "player_list",
          players: currentPlayers,
          latestStates: Object.fromEntries(this.latestStates.entries())
        })
      );
    } catch (err) {
      console.error(`[Durable Object] Failed to send player_list to joining player ${playerId}:`, err);
    }

    // Broadcast playerJoined / player_join to all other players in the room
    this.broadcast({ type: "playerJoined", playerId }, playerId);
    this.broadcast({ type: "player_join", playerId }, playerId);

    // If the race has already been started and countdown is active/recent, share it
    if (this.raceStartTime && this.raceStartTime > Date.now() - 30000) {
      try {
        server.send(
          JSON.stringify({
            type: "race_start",
            startTime: this.raceStartTime
          })
        );
      } catch (err) {}
    }

    server.addEventListener("message", (event) => {
      try {
        if (typeof event.data !== "string") return;
        const msg: any = JSON.parse(event.data);

        if (msg.type === "vehicleUpdate" || msg.type === "vehicle_update") {
          // Validate roomCode/playerId match the socket's registration
          if (msg.playerId && msg.playerId !== playerId) {
            console.warn(`[Durable Object] Sender ID mismatch: socket playerId is ${playerId} but update said ${msg.playerId}`);
            return;
          }

          // Ensure the playerId is populated correctly
          msg.playerId = playerId;

          // Store newest state
          this.latestStates.set(playerId, msg);

          // Broadcast to every OTHER socket in the room (raw packet broadcast)
          let broadcastTo = 0;
          for (const [pid, socket] of this.sessions.entries()) {
            if (pid !== playerId) {
              try {
                socket.send(event.data);
                broadcastTo++;
              } catch (err) {
                console.error(`[Durable Object] Error sending to player ${pid}:`, err);
              }
            }
          }
        } else if (msg.type === "start_race" || msg.type === "countdown" || msg.type === "race_start") {
          // Server-authoritative race countdown start
          console.log(`[Durable Object] Start race countdown triggered by ${playerId} in room ${roomCode}`);
          const raceStartTime = Date.now() + 5000;
          this.raceStartTime = raceStartTime;

          // Broadcast race_start to ALL players (including sender!)
          this.broadcast({
            type: "race_start",
            startTime: raceStartTime
          });
          this.broadcast({
            type: "raceStart",
            startTime: raceStartTime
          });
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
    const currentSocket = this.sessions.get(playerId);
    if (currentSocket === socket) {
      this.sessions.delete(playerId);
      this.latestStates.delete(playerId);
      
      // Broadcast leave signals to all other clients
      this.broadcast({ type: "playerLeft", playerId }, playerId);
      this.broadcast({ type: "player_leave", playerId }, playerId);
      
      console.log(`[Durable Object] Player left: ${playerId} from room ${roomCode}. Active players left: ${this.sessions.size}`);
    }
  }

  private broadcast(msg: any, excludePlayerId?: string) {
    const payload = JSON.stringify(msg);
    for (const [pid, socket] of this.sessions.entries()) {
      if (pid !== excludePlayerId) {
        try {
          socket.send(payload);
        } catch (err) {
          console.error(`[Durable Object] Broadcast failure to player ${pid}:`, err);
        }
      }
    }
  }
}

