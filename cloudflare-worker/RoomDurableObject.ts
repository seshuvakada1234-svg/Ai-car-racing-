import { Env } from "./types";

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
      players: []
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomCode = (url.searchParams.get("roomCode") || "").toUpperCase().trim();
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

    // If this player already has an open socket, close the previous one
    const oldClient = this.clients.get(playerId);
    if (oldClient) {
      try {
        oldClient.ws.close(1000, "Replaced by new connection");
      } catch (e) {}
    }

    // Store connection in-memory in our clients collection
    this.clients.set(playerId, { ws: server, playerId });

    // Requirement 3: Add player to room.players
    if (!this.room.players.includes(playerId)) {
      this.room.players.push(playerId);
    }

    // Requirement 8: Debug Logging - Player joined, Room code, Players in room
    console.log(`[Durable Object] Player joined: ${playerId}`);
    console.log(`Room code: ${roomCode}`);
    console.log(`Players in room: ${this.room.players.length}`);
    console.log(`Room ${roomCode}`);
    console.log(`Players: ${this.room.players.length}`);

    // Requirement 3: Send complete player list to the new player
    try {
      server.send(
        JSON.stringify({
          type: "player_list",
          players: this.room.players,
          latestStates: Object.fromEntries(this.latestStates.entries())
        })
      );
    } catch (err) {
      console.error(`[Durable Object] Failed to send player_list to joining player ${playerId}:`, err);
    }

    // Requirement 3: Broadcast player_join to every existing player
    this.broadcast({ type: "playerJoined", playerId }, playerId);
    this.broadcast({ type: "player_join", playerId }, playerId);

    // If the race has already been started, share it with the joining player
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

          // Requirement 8: Debug Logging - Vehicle update received
          console.log(`[Durable Object] Vehicle update received from ${playerId}`);

          // Requirement 4: Store latest transform
          this.latestStates.set(playerId, msg);

          // Requirement 4: Broadcast immediately to every other client
          let broadcastTo = 0;
          for (const client of this.clients.values()) {
            if (client.ws !== server) {
              try {
                client.ws.send(event.data);
                broadcastTo++;
              } catch (err) {
                console.error(`[Durable Object] Error sending to player ${client.playerId}:`, err);
              }
            }
          }

          // Requirement 8: Debug Logging - Vehicle update broadcast
          console.log(`[Durable Object] Vehicle update broadcast to ${broadcastTo} client(s)`);
          console.log(`Room ${roomCode}`);
          console.log(`Players: ${this.room.players.length}`);
          console.log(`Broadcast vehicle_update to ${broadcastTo} client`);

        } else if (msg.type === "start_race" || msg.type === "countdown" || msg.type === "race_start") {
          // Requirement 5: The Durable Object is the only authority
          const raceStartTime = Date.now() + 5000;
          this.raceStartTime = raceStartTime;

          // Requirement 8: Debug Logging - Race started
          console.log(`[Durable Object] Race started in room ${roomCode} at ${raceStartTime}`);

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
