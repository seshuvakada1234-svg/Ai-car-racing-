import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

export function setupVehicleWsServer(wss: WebSocketServer) {
  // Map to store: socket -> { roomCode, playerId }
  const socketData = new Map<WebSocket, { roomCode: string; playerId: string }>();

  // Map to store: roomCode -> Set of sockets
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === "join") {
          const { roomCode, playerId } = data;
          if (!roomCode || !playerId) return;

          const cleanRoomCode = roomCode.toUpperCase().trim();
          
          // Store connection metadata
          socketData.set(ws, { roomCode: cleanRoomCode, playerId });

          // Add to room
          if (!rooms.has(cleanRoomCode)) {
            rooms.set(cleanRoomCode, new Set());
          }
          rooms.get(cleanRoomCode)!.add(ws);

          console.log(`[WS SERVER] Player ${playerId} joined room ${cleanRoomCode}`);
          return;
        }

        if (data.type === "vehicleUpdate") {
          const { roomCode, playerId } = data;
          if (!roomCode || !playerId) return;

          const cleanRoomCode = roomCode.toUpperCase().trim();

          // Validate roomCode/playerId match the socket's registration
          const reg = socketData.get(ws);
          if (!reg || reg.roomCode !== cleanRoomCode || reg.playerId !== playerId) {
            console.warn(`[WS SERVER] Validation failed for ${playerId} in ${cleanRoomCode}`);
            return;
          }

          console.log("[SERVER RECEIVE]", { playerId, roomCode: cleanRoomCode });

          // Broadcast to other sockets in that room
          const roomSockets = rooms.get(cleanRoomCode);
          let broadcastTo = 0;
          if (roomSockets) {
            for (const socket of roomSockets) {
              if (socket !== ws && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(data));
                broadcastTo++;
              }
            }
          }

          console.log("[SERVER BROADCAST]", { playerId, roomCode: cleanRoomCode, broadcastTo });
          return;
        }

      } catch (err) {
        console.error("[WS SERVER] Error processing message:", err);
      }
    });

    ws.on("close", () => {
      const reg = socketData.get(ws);
      if (reg) {
        const { roomCode, playerId } = reg;
        socketData.delete(ws);

        const roomSockets = rooms.get(roomCode);
        if (roomSockets) {
          roomSockets.delete(ws);
          if (roomSockets.size === 0) {
            rooms.delete(roomCode);
          } else {
            // Broadcast playerLeft to rest of room
            const leaveMsg = JSON.stringify({ type: "playerLeft", playerId });
            for (const socket of roomSockets) {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(leaveMsg);
              }
            }
          }
        }
        console.log(`[WS SERVER] Player ${playerId} left room ${roomCode}`);
      }
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
const isMain = typeof require !== 'undefined' && require.main === module;
const isEsmMain = process.argv[1] && (
  process.argv[1].endsWith("wsVehicleServer.ts") ||
  process.argv[1].endsWith("wsVehicleServer.js") ||
  process.argv[1].endsWith("wsVehicleServer.cjs")
);

if (isMain || isEsmMain) {
  const PORT = parseInt(process.env.WS_PORT || process.env.PORT || "3001", 10);
  startVehicleWsServer(PORT);
}
