/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
import { RoomCodeGenerator } from "./RoomCodeGenerator";

export interface ServerPlayer {
  id: string;
  name: string;
  selectedCar: "ferrari" | "bugatti" | "porsche";
  carColor: string;
  ready: boolean;
  isHost: boolean;
  isAI: boolean;

  // Intercepted realtime position fields
  position?: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  speed?: number;
  angle?: number;
  currentLap?: number;
  isFinished?: boolean;
  finishTime?: number;
  racePosition?: number;
  isDrifting?: boolean;
  isNitroActive?: boolean;
  nitroCharged?: number;
}

export interface ServerRoom {
  code: string;
  hostId: string;
  players: Map<string, ServerPlayer>;
  difficulty: "easy" | "medium" | "hard";
  selectedMap: "map1" | "map2";
  phase: "lobby" | "countdown" | "racing" | "completed";
  countdown: number; // 30-second countdown
  isLiveMode: boolean;
}

// Global server-wide database of rooms
const roomsData = new Map<string, ServerRoom>();
// Sockets index map to easily clean up disconnects
const socketToRoomMap = new Map<WebSocket, { roomCode: string; playerId: string }>();

// Broadcaster helper
function broadcastToRoom(room: ServerRoom, payload: any) {
  const jsonEncoded = JSON.stringify(payload);
  for (const [playerId, player] of room.players.entries()) {
    if (player.isAI) continue;
    // We send payload to socket of player
    for (const [socket, info] of socketToRoomMap.entries()) {
      if (info.roomCode === room.code && info.playerId === playerId) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(jsonEncoded);
        }
      }
    }
  }
}

// Convert central Room schema into readable client objects
function serializeRoom(room: ServerRoom) {
  return {
    code: room.code,
    hostId: room.hostId,
    difficulty: room.difficulty,
    selectedMap: room.selectedMap,
    phase: room.phase,
    countdown: room.countdown,
    isLiveMode: room.isLiveMode,
    players: Array.from(room.players.values()),
  };
}

/**
 * Attaches real-time WebSocket capabilities into Express/HTTP Server
 */
export function setupMultiplayerWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    try {
      const urlObj = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
      const pathname = urlObj.pathname.replace(/\/+$/, "");
      if (pathname !== "/ws/vehicle") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      }
    } catch (err) {
      console.error("[Multiplayer Server] Upgrade routing error:", err);
    }
  });

  wss.on("error", (err) => {
    console.error("[Multiplayer Server] WebSocketServer error occurred:", err);
  });

  console.log("[Multiplayer Server] Initiated dynamic WebSocket service on port 3000.");

  wss.on("connection", (ws) => {
    console.log("[Multiplayer Server] New remote player connected.");

    ws.on("message", (message) => {
      try {
        const rawString = message.toString();
        const data = JSON.parse(rawString);
        const { type, payload } = data;

        switch (type) {
          case "CREATE_ROOM": {
            const { playerName, selectedCar, carColor, difficulty, selectedMap, isLiveMode } = payload;
            const code = RoomCodeGenerator.generate();
            const playerId = "host_" + Math.random().toString(36).substring(2, 8);

            const newRoom: ServerRoom = {
              code,
              hostId: playerId,
              players: new Map(),
              difficulty: difficulty || "medium",
              selectedMap: selectedMap || "map1",
              phase: "lobby",
              countdown: 30,
              isLiveMode: !!isLiveMode,
            };

            const firstPlayer: ServerPlayer = {
              id: playerId,
              name: playerName || "Host Racer",
              selectedCar: (selectedCar as any) || "ferrari",
              carColor: carColor || "#ff5500",
              ready: true,
              isHost: true,
              isAI: false,
            };

            newRoom.players.set(playerId, firstPlayer);
            roomsData.set(code, newRoom);
            socketToRoomMap.set(ws, { roomCode: code, playerId });

            // Send confirmation code
            ws.send(
              JSON.stringify({
                type: "ROOM_CREATED",
                payload: {
                  roomCode: code,
                  playerId,
                  roomState: serializeRoom(newRoom),
                },
              }),
            );

            // Launch the 30-seconds autonomous clock ticker
            startLobbyTicker(newRoom);
            break;
          }

          case "JOIN_ROOM": {
            const { roomCode, playerName, selectedCar, carColor } = payload;
            const cleanCode = (roomCode || "").toUpperCase().trim();
            const room = roomsData.get(cleanCode);

            if (!room) {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  payload: { message: `Room ${cleanCode} not found` },
                }),
              );
              return;
            }

            if (room.phase !== "lobby") {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  payload: { message: "Race has already started or completed in this room." },
                }),
              );
              return;
            }

            // Count existing human players (max 5 humans allowed)
            const humanCount = Array.from(room.players.values()).filter((p) => !p.isAI).length;
            if (humanCount >= 5) {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  payload: { message: "Lobby is full! Maximum 5 human players reached." },
                }),
              );
              return;
            }

            const playerId = "player_" + Math.random().toString(36).substring(2, 8);
            const joinedPlayer: ServerPlayer = {
              id: playerId,
              name: playerName || "Challenger",
              selectedCar: (selectedCar as any) || "ferrari",
              carColor: carColor || "#00ffcc",
              ready: room.isLiveMode ? true : false, // Autoready in live mode
              isHost: false,
              isAI: false,
            };

            room.players.set(playerId, joinedPlayer);
            socketToRoomMap.set(ws, { roomCode: cleanCode, playerId });

            ws.send(
              JSON.stringify({
                type: "ROOM_JOINED",
                payload: {
                  roomCode: cleanCode,
                  playerId,
                  roomState: serializeRoom(room),
                },
              }),
            );

            // Broadcast room update to all other members in the room
            broadcastToRoom(room, {
              type: "ROOM_UPDATE",
              payload: { roomState: serializeRoom(room) },
            });
            break;
          }

          case "PLAYER_READY": {
            const socketInfo = socketToRoomMap.get(ws);
            if (!socketInfo) return;
            const room = roomsData.get(socketInfo.roomCode);
            if (!room) return;

            const player = room.players.get(socketInfo.playerId);
            if (player) {
              player.ready = !!payload.ready;
              broadcastToRoom(room, {
                type: "ROOM_UPDATE",
                payload: { roomState: serializeRoom(room) },
              });
            }
            break;
          }

          case "START_RACE_NOW": {
            const socketInfo = socketToRoomMap.get(ws);
            if (!socketInfo) return;
            const room = roomsData.get(socketInfo.roomCode);
            if (!room) return;

            // Only designated host can manually speed up start
            if (room.hostId === socketInfo.playerId) {
              triggerRaceLaunch(room);
            }
            break;
          }

          case "UPDATE_CAR": {
            const socketInfo = socketToRoomMap.get(ws);
            if (!socketInfo) return;
            const room = roomsData.get(socketInfo.roomCode);
            if (!room) return;

            const player = room.players.get(socketInfo.playerId);
            if (player) {
              // Write positional state from network
              player.position = payload.position;
              player.velocity = payload.velocity;
              player.speed = payload.speed;
              player.angle = payload.angle;
              player.currentLap = payload.currentLap;
              player.isFinished = payload.isFinished;
              player.racePosition = payload.racePosition;
              player.isDrifting = payload.isDrifting;
              player.isNitroActive = payload.isNitroActive;
              player.nitroCharged = payload.nitroCharged;

              if (payload.finishTime) {
                player.finishTime = payload.finishTime;
              }

              // Fast forwarding states update to everyone else in real-time
              broadcastToRoom(room, {
                type: "SYNC_STATE",
                payload: {
                  players: Array.from(room.players.values()),
                },
              });
            }
            break;
          }

          case "UPDATE_AI_CARS": {
            // Only host sends AI update payloads for central reliability
            const socketInfo = socketToRoomMap.get(ws);
            if (!socketInfo) return;
            const room = roomsData.get(socketInfo.roomCode);
            if (!room) return;

            if (socketInfo.playerId === room.hostId) {
              const { cars } = payload;
              if (Array.isArray(cars)) {
                cars.forEach((ai: any) => {
                  let existing = room.players.get(ai.id);
                  if (!existing) {
                    existing = {
                      id: ai.id,
                      name: ai.name,
                      selectedCar: ai.selectedCar || "ferrari",
                      carColor: ai.color || "#ff0000",
                      ready: true,
                      isHost: false,
                      isAI: true,
                    };
                    room.players.set(ai.id, existing);
                  }
                  existing.position = ai.position;
                  existing.velocity = ai.velocity;
                  existing.speed = ai.speed;
                  existing.angle = ai.angle;
                  existing.currentLap = ai.currentLap;
                  existing.isFinished = ai.isFinished;
                  existing.racePosition = ai.racePosition;
                  existing.isDrifting = ai.isDrifting;
                  existing.isNitroActive = ai.isNitroActive;
                  existing.finishTime = ai.finishTime;
                });

                broadcastToRoom(room, {
                  type: "SYNC_STATE",
                  payload: {
                    players: Array.from(room.players.values()),
                  },
                });
              }
            }
            break;
          }

          case "CROSS_FINISH_LINE": {
            const socketInfo = socketToRoomMap.get(ws);
            if (!socketInfo) return;
            const room = roomsData.get(socketInfo.roomCode);
            if (!room) return;

            const player = room.players.get(socketInfo.playerId);
            if (player) {
              player.isFinished = true;
              player.finishTime = payload.finishTime;

              broadcastToRoom(room, {
                type: "ROOM_UPDATE",
                payload: { roomState: serializeRoom(room) },
              });

              // Check if all human racers completed to transition to completed scoreboard
              const humans = Array.from(room.players.values()).filter((p) => !p.isAI);
              const finishedHumans = humans.filter((p) => p.isFinished);

              if (finishedHumans.length === humans.length && room.phase !== "completed") {
                room.phase = "completed";
                broadcastToRoom(room, {
                  type: "ROOM_UPDATE",
                  payload: { roomState: serializeRoom(room) },
                });

                if (room.isLiveMode) {
                  // In continuous live mode, countdown 15 seconds on scoreboard then cycle around
                  setTimeout(() => {
                    cycleLiveModeRoom(room);
                  }, 15000);
                }
              }
            }
            break;
          }

          case "LIVE_MODE_CYCLE": {
            // Force cycle next live race
            const socketInfo = socketToRoomMap.get(ws);
            if (!socketInfo) return;
            const room = roomsData.get(socketInfo.roomCode);
            if (!room) return;
            if (room.isLiveMode && socketInfo.playerId === room.hostId) {
              cycleLiveModeRoom(room);
            }
            break;
          }
        }
      } catch (err) {
        console.error("[Multiplayer Server] Error processing socket packet:", err);
      }
    });

    ws.on("close", () => {
      const socketInfo = socketToRoomMap.get(ws);
      if (socketInfo) {
        const { roomCode, playerId } = socketInfo;
        const room = roomsData.get(roomCode);

        console.log(`[Multiplayer Server] Player ${playerId} closed connectivity.`);

        if (room) {
          room.players.delete(playerId);
          socketToRoomMap.delete(ws);

          // If the player who disconnected was the room host
          if (room.hostId === playerId) {
            console.log(`[Multiplayer Server] Host left room ${roomCode}. Disassembling lobby.`);
            broadcastToRoom(room, {
              type: "ERROR",
              payload: { message: "The Host disconnected. Lobby has closed." },
            });
            RoomCodeGenerator.release(roomCode);
            roomsData.delete(roomCode);
          } else {
            // Simply update other joined players
            broadcastToRoom(room, {
              type: "ROOM_UPDATE",
              payload: { roomState: serializeRoom(room) },
            });
          }
        }
      }
    });
  });
}

/**
 * Autonomous lobby room countdown timer tracking
 */
function startLobbyTicker(room: ServerRoom) {
  const intervalId = setInterval(() => {
    const currentRoom = roomsData.get(room.code);
    if (!currentRoom) {
      clearInterval(intervalId);
      return;
    }

    if (currentRoom.phase !== "lobby") {
      clearInterval(intervalId);
      return;
    }

    currentRoom.countdown--;

    broadcastToRoom(currentRoom, {
      type: "ROOM_UPDATE",
      payload: { roomState: serializeRoom(currentRoom) },
    });

    if (currentRoom.countdown <= 0) {
      clearInterval(intervalId);
      triggerRaceLaunch(currentRoom);
    }
  }, 1000);
}

/**
 * Broadcast launch signal to all clients
 */
function triggerRaceLaunch(room: ServerRoom) {
  room.phase = "countdown";

  // Fill remaining slots automatically with AI competitors (up to 3 AI cars max)
  const humanCount = Array.from(room.players.values()).filter((p) => !p.isAI).length;
  const aiCountNeeded = Math.max(0, Math.min(3, 4 - humanCount));

  // Generate randomized pro racing AI names & styles
  const aiNames = ["Nova", "Phantom", "Titan"];
  const aiColors = ["#ffe105", "#00f6ff", "#ffa200"];

  for (let a = 0; a < aiCountNeeded; a++) {
    const aiId = `ai_fill_${a}_${Math.random().toString(36).substring(2, 6)}`;
    const name = aiNames[a % aiNames.length];
    const color = aiColors[a % aiColors.length];

    const filledAI: ServerPlayer = {
      id: aiId,
      name,
      selectedCar: ["ferrari", "bugatti", "porsche"][Math.floor(Math.random() * 3)] as any,
      carColor: color,
      ready: true,
      isHost: false,
      isAI: true,
    };
    room.players.set(aiId, filledAI);
  }

  // Choose a random map in live mode
  const maps: ("map1" | "map2")[] = ["map1", "map2"];
  if (room.isLiveMode) {
    room.selectedMap = maps[Math.floor(Math.random() * 2)];
  }

  broadcastToRoom(room, {
    type: "START_COUNTDOWN",
    payload: {
      selectedMap: room.selectedMap,
      difficulty: room.difficulty,
      roomState: serializeRoom(room),
    },
  });

  // Switch to racing phase
  setTimeout(() => {
    if (roomsData.has(room.code)) {
      room.phase = "racing";
      broadcastToRoom(room, {
        type: "ROOM_UPDATE",
        payload: { roomState: serializeRoom(room) },
      });
    }
  }, 4000); // Wait for local 3-seconds countdown to flush before setting racing phase
}

/**
 * Cycle Live Mode: Clears old room, reserve a new code, transitions everyone back
 */
function cycleLiveModeRoom(room: ServerRoom) {
  const oldCode = room.code;
  const newCode = RoomCodeGenerator.generate();

  console.log(`[Live Mode] Cycling room: ${oldCode} -> ${newCode}`);

  const recycledRoom: ServerRoom = {
    code: newCode,
    hostId: room.hostId, // Reuse host session
    players: new Map(),
    difficulty: room.difficulty,
    selectedMap: Math.random() > 0.5 ? "map1" : "map2",
    phase: "lobby",
    countdown: 30,
    isLiveMode: true,
  };

  // Re-add host first
  const originalHost = room.players.get(room.hostId);
  if (originalHost) {
    const resetHost: ServerPlayer = {
      ...originalHost,
      ready: true,
      isFinished: false,
      finishTime: undefined,
      position: undefined,
      velocity: undefined,
      currentLap: 1,
    };
    recycledRoom.players.set(room.hostId, resetHost);
  }

  // Carry forward other remaining humans (ready = true by default)
  for (const [playerId, player] of room.players.entries()) {
    if (playerId !== room.hostId && !player.isAI) {
      const resetPlayer: ServerPlayer = {
        ...player,
        ready: true,
        isFinished: false,
        finishTime: undefined,
        position: undefined,
        velocity: undefined,
        currentLap: 1,
      };
      recycledRoom.players.set(playerId, resetPlayer);
    }
  }

  // Register room in global maps
  roomsData.set(newCode, recycledRoom);
  RoomCodeGenerator.release(oldCode);
  roomsData.delete(oldCode);

  // Update sockets in map indices
  for (const [socket, info] of socketToRoomMap.entries()) {
    if (info.roomCode === oldCode) {
      socketToRoomMap.set(socket, { roomCode: newCode, playerId: info.playerId });
    }
  }

  // Broadcast cycle transition redirect
  broadcastToRoom(recycledRoom, {
    type: "ROOM_CYCLED",
    payload: {
      oldCode,
      newCode,
      roomState: serializeRoom(recycledRoom),
    },
  });

  // Launch countdown for recycled room
  startLobbyTicker(recycledRoom);
}
