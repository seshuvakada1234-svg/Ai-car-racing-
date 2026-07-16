/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WebSocketManager
 *
 * The single source of truth for real-time multiplayer WebSocket networking.
 * Decoupled from React components and UI. Handles heartbeat, auto-reconnection,
 * packet throttling, callback registries, and safe JSON serialization.
 */

// Define Vector3 and Quaternion interfaces for serialization
export interface Vector3State {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionState {
  x: number;
  y: number;
  z: number;
  w: number;
}

// Remote Player State
export interface RemotePlayerState {
  playerId: string;
  playerName: string;
  position: Vector3State;
  rotation: QuaternionState;
  velocity: Vector3State;
  steering: number;
  wheelRotation: number;
  speed: number;
  nitro: boolean;
  drift: boolean;
  lap: number;
  checkpoint: number;
  timestamp: number;
}

// Network Callback Interfaces
export interface NetworkCallbacks {
  onPlayerJoined?: (playerId: string, playerName: string) => void;
  onPlayerLeft?: (playerId: string) => void;
  onVehicleUpdate?: (playerId: string, vehicleState: RemotePlayerState) => void;
  onRaceStart?: (payload: any) => void;
  onCountdown?: (payload: any) => void;
  onDisconnect?: () => void;
}

// Base incoming/outgoing packet interface
export interface BasePacket {
  type: string;
}

export interface JoinRoomPacket extends BasePacket {
  type: "joinRoom";
  roomCode: string;
  playerId: string;
  playerName: string;
}

export interface LeaveRoomPacket extends BasePacket {
  type: "leaveRoom";
  roomCode: string;
  playerId: string;
}

export interface VehicleUpdatePacket extends BasePacket {
  type: "vehicleUpdate";
  roomCode: string;
  playerId: string;
  position: Vector3State;
  rotation: QuaternionState;
  velocity: Vector3State;
  steering: number;
  wheelRotation: number;
  speed: number;
  nitro: boolean;
  drift: boolean;
  lap: number;
  checkpoint: number;
  timestamp: number;
}

export interface ReadyPacket extends BasePacket {
  type: "ready";
  roomCode: string;
  playerId: string;
}

export interface CountdownPacket extends BasePacket {
  type: "countdown";
  roomCode: string;
  playerId: string;
}

export interface RaceFinishPacket extends BasePacket {
  type: "raceFinish";
  roomCode: string;
  playerId: string;
  timestamp: number;
}

export interface ServerMessagePacket {
  type:
    | "joinRoom"
    | "leaveRoom"
    | "vehicleUpdate"
    | "countdown"
    | "raceStart"
    | "raceFinish"
    | "playerDisconnected"
    | "ping"
    | "pong";
  playerId?: string;
  playerName?: string;
  roomCode?: string;
  position?: Vector3State;
  rotation?: QuaternionState;
  velocity?: Vector3State;
  steering?: number;
  wheelRotation?: number;
  speed?: number;
  nitro?: boolean;
  drift?: boolean;
  lap?: number;
  checkpoint?: number;
  timestamp?: number;
  duration?: number;
  payload?: any;
}

// Internal State Variables
let socket: WebSocket | null = null;
let currentRoomCode: string = "";
let localPlayerId: string = "";
let localPlayerName: string = "";
let isVoluntaryDisconnect: boolean = false;
let reconnectTimer: any = null;
let heartbeatTimer: any = null;
let lastMessageReceivedTime: number = 0;
let lastSendTime: number = 0;
let lastVehicleState: any = null;

// Registry of Remote Players
const remotePlayers = new Map<string, RemotePlayerState>();

// Callbacks
let callbacks: NetworkCallbacks = {};

/**
 * Gets a clean WebSocket URL from browser location
 */
function getWsUrl(): string {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

/**
 * Connects to the real-time WebSocket multiplayer server
 */
export function connect(customUrl?: string): void {
  if (typeof window === "undefined") return;
  const WS_CTOR = window.WebSocket;
  if (!WS_CTOR) {
    console.error("WebSockets are not supported in this environment.");
    return;
  }

  // If already connected/connecting, do not instantiate a new one
  if (socket && (socket.readyState === WS_CTOR.CONNECTING || socket.readyState === WS_CTOR.OPEN)) {
    return;
  }

  isVoluntaryDisconnect = false;
  const targetUrl = customUrl || getWsUrl();

  if (!targetUrl) {
    console.warn("Could not determine dynamic WebSocket URL.");
    return;
  }

  // Clear existing reconnect timers
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    socket = new WS_CTOR(targetUrl);

    socket.onopen = () => {
      console.log(`[WS CONNECTED] Opened connection to: ${targetUrl}`);
      lastMessageReceivedTime = Date.now();
      startHeartbeat();
    };

    socket.onclose = (event) => {
      console.log(`[WS DISCONNECTED] Connection closed. Code: ${event.code}, Clean: ${event.wasClean}`);
      stopHeartbeat();

      if (!isVoluntaryDisconnect) {
        if (callbacks.onDisconnect) {
          callbacks.onDisconnect();
        }
        triggerAutoReconnect(targetUrl);
      }
    };

    socket.onerror = (error) => {
      console.error("[WebSocket Error] Connection error detected:", error);
    };

    socket.onmessage = (messageEvent) => {
      lastMessageReceivedTime = Date.now();
      handleIncomingMessage(messageEvent.data);
    };
  } catch (err) {
    console.error("Failed to establish WebSocket connection:", err);
    triggerAutoReconnect(targetUrl);
  }
}

/**
 * Disconnects from the WebSocket server voluntarily
 */
export function disconnect(): void {
  isVoluntaryDisconnect = true;
  stopHeartbeat();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
    socket = null;
  }

  remotePlayers.clear();
  currentRoomCode = "";
  console.log("[WS DISCONNECTED] Voluntarily disconnected from real-time multiplayer server.");
}

/**
 * Handles incoming WebSocket message events safely
 */
function handleIncomingMessage(rawData: string): void {
  try {
    const data: ServerMessagePacket = JSON.parse(rawData);

    if (!data || typeof data.type !== "string") {
      console.warn("Received invalid/malformed socket packet:", rawData);
      return;
    }

    // Ignore packets coming from the local player to avoid self-shadowing
    if (data.playerId && data.playerId === localPlayerId) {
      return;
    }

    switch (data.type) {
      case "ping":
        // Automatically respond to server pings with pong
        sendRaw({ type: "pong" });
        break;

      case "pong":
        // Server responded to liveness check
        break;

      case "joinRoom":
        if (data.playerId) {
          const joinedName = data.playerName || "Driver";
          console.log(`[PLAYER JOINED] Player ${joinedName} (${data.playerId}) joined room`);
          if (callbacks.onPlayerJoined) {
            callbacks.onPlayerJoined(data.playerId, joinedName);
          }
        }
        break;

      case "leaveRoom":
      case "playerDisconnected":
        if (data.playerId) {
          console.log(`[PLAYER LEFT] Player ${data.playerId} left room`);
          remotePlayers.delete(data.playerId);
          if (callbacks.onPlayerLeft) {
            callbacks.onPlayerLeft(data.playerId);
          }
        }
        break;

      case "vehicleUpdate":
        if (data.playerId) {
          // Verify that mandatory positional variables exist before unpacking
          const hasCoords =
            data.position &&
            typeof data.position.x === "number" &&
            typeof data.position.y === "number" &&
            typeof data.position.z === "number";

          if (hasCoords) {
            const rot = data.rotation || { x: 0, y: 0, z: 0, w: 1 };
            const vel = data.velocity || { x: 0, y: 0, z: 0 };

            const remoteState: RemotePlayerState = {
              playerId: data.playerId,
              playerName: data.playerName || "Driver",
              position: data.position!,
              rotation: rot,
              velocity: vel,
              steering: typeof data.steering === "number" ? data.steering : 0,
              wheelRotation: typeof data.wheelRotation === "number" ? data.wheelRotation : 0,
              speed: typeof data.speed === "number" ? data.speed : 0,
              nitro: !!data.nitro,
              drift: !!data.drift,
              lap: typeof data.lap === "number" ? data.lap : 1,
              checkpoint: typeof data.checkpoint === "number" ? data.checkpoint : 0,
              timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
            };

            console.log(`[RECEIVE VEHICLE] Received state update from player ${data.playerId}`);
            remotePlayers.set(data.playerId, remoteState);

            if (callbacks.onVehicleUpdate) {
              callbacks.onVehicleUpdate(data.playerId, remoteState);
            }
          }
        }
        break;

      case "countdown":
        console.log("[WS COUNTDOWN] Countdown signal received:", data.payload || data);
        if (callbacks.onCountdown) {
          callbacks.onCountdown(data.payload || data);
        }
        break;

      case "raceStart":
        console.log("[RACE START] Race start signal received");
        if (callbacks.onRaceStart) {
          callbacks.onRaceStart(data.payload || data);
        }
        break;

      case "raceFinish":
        console.log(`[RACE FINISH] Player completed the race: ${data.playerId}`);
        break;

      default:
        console.warn(`[WebSocket] Unknown packet type received: ${data.type}`);
    }
  } catch (err) {
    console.error("Error processing incoming WebSocket payload:", err);
  }
}

/**
 * Sends a raw packet over the WebSocket channel
 */
function sendRaw(packet: any): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    socket.send(JSON.stringify(packet));
  } catch (err) {
    console.error("Failed to dispatch raw WebSocket packet:", err);
  }
}

/**
 * Triggers automatic reconnection logic with exponential retry delays
 */
function triggerAutoReconnect(url: string): void {
  if (isVoluntaryDisconnect) return;

  if (reconnectTimer) return; // Reconnect sequence is already active

  console.log("[WS RECONNECTING] Connection lost. Triggering auto-reconnect...");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(url);
  }, 3000); // Retry every 3 seconds
}

/**
 * Starts the heartbeat timer to keep connection alive
 */
function startHeartbeat(): void {
  stopHeartbeat();

  heartbeatTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      stopHeartbeat();
      return;
    }

    // Verify liveness: if no message has arrived in the last 15 seconds, trigger a reconnect
    const idleDuration = Date.now() - lastMessageReceivedTime;
    if (idleDuration > 15000) {
      console.warn(`[WS TIMEOUT] No packet received for ${idleDuration}ms. Reconnecting.`);
      socket.close(); // Closes connection and triggers auto-reconnect cleanly
      return;
    }

    // Dispatch a ping message to keep browser/ingress session alive
    sendRaw({ type: "ping" });
  }, getTenSeconds());
}

/**
 * Helper to get 10 seconds in ms
 */
function getTenSeconds(): number {
  return 10000;
}

/**
 * Stops the active heartbeat timer
 */
function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Joins a multiplayer lobby room
 */
export function joinRoom(roomCode: string, playerId?: string, playerName?: string): void {
  currentRoomCode = (roomCode || "").toUpperCase().trim();
  if (playerId) localPlayerId = playerId;
  if (playerName) localPlayerName = playerName;

  console.log(`[JOIN ROOM] Requesting room join: ${currentRoomCode}`);

  // Ensure connection is active before sending join message
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connect();
    // Allow a small delay or open event handler to auto-join,
    // or let the user call joinRoom again once connection is complete.
    setTimeout(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        joinRoom(currentRoomCode, playerId, playerName);
      }
    }, 500);
    return;
  }

  const joinPacket: JoinRoomPacket = {
    type: "joinRoom",
    roomCode: currentRoomCode,
    playerId: localPlayerId || "player_anon",
    playerName: localPlayerName || "Anonymous Racer",
  };

  sendRaw(joinPacket);
}

/**
 * Leaves the active room
 */
export function leaveRoom(): void {
  if (!currentRoomCode) return;

  console.log(`[PLAYER LEFT] Voluntarily leaving room ${currentRoomCode}`);

  const leavePacket: LeaveRoomPacket = {
    type: "leaveRoom",
    roomCode: currentRoomCode,
    playerId: localPlayerId || "player_anon",
  };

  sendRaw(leavePacket);
  remotePlayers.clear();
  currentRoomCode = "";
}

/**
 * Sends dynamic vehicle update packets throttled to exactly 20Hz (every 50ms)
 */
export function sendVehicleUpdate(vehicleState: {
  position: Vector3State;
  rotation: QuaternionState;
  velocity: Vector3State;
  steering: number;
  wheelRotation: number;
  speed: number;
  nitro: boolean;
  drift: boolean;
  lap: number;
  checkpoint: number;
}): void {
  lastVehicleState = vehicleState;
  const now = Date.now();

  // Enforce throttle limit of 50ms (exactly 20 updates per second)
  if (now - lastSendTime >= 50) {
    flushVehicleUpdate();
  }
}

/**
 * Dispatches the throttled vehicle update packet
 */
function flushVehicleUpdate(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN || !lastVehicleState) {
    return;
  }

  const now = Date.now();
  lastSendTime = now;

  const updatePacket: VehicleUpdatePacket = {
    type: "vehicleUpdate",
    roomCode: currentRoomCode,
    playerId: localPlayerId || "player_anon",
    position: lastVehicleState.position,
    rotation: lastVehicleState.rotation,
    velocity: lastVehicleState.velocity,
    steering: lastVehicleState.steering,
    wheelRotation: lastVehicleState.wheelRotation,
    speed: lastVehicleState.speed,
    nitro: lastVehicleState.nitro,
    drift: lastVehicleState.drift,
    lap: lastVehicleState.lap,
    checkpoint: lastVehicleState.checkpoint,
    timestamp: now,
  };

  console.log(`[SEND VEHICLE] Vehicle status broadcast:`, updatePacket);
  sendRaw(updatePacket);
}

/**
 * Declares player ready state
 */
export function sendReady(): void {
  if (!currentRoomCode) return;

  const readyPacket: ReadyPacket = {
    type: "ready",
    roomCode: currentRoomCode,
    playerId: localPlayerId || "player_anon",
  };

  sendRaw(readyPacket);
}

/**
 * Requests the race countdown start (Host action)
 */
export function sendCountdown(): void {
  if (!currentRoomCode) return;

  const countdownPacket: CountdownPacket = {
    type: "countdown",
    roomCode: currentRoomCode,
    playerId: localPlayerId || "player_anon",
  };

  sendRaw(countdownPacket);
}

/**
 * Declares that the local racer has crossed the finish line
 */
export function sendRaceFinished(): void {
  if (!currentRoomCode) return;

  const finishPacket: RaceFinishPacket = {
    type: "raceFinish",
    roomCode: currentRoomCode,
    playerId: localPlayerId || "player_anon",
    timestamp: Date.now(),
  };

  sendRaw(finishPacket);
}

/**
 * Registers network callbacks
 */
export function registerCallbacks(newCallbacks: NetworkCallbacks): void {
  callbacks = { ...callbacks, ...newCallbacks };
}

/**
 * Retrieves the live map of all remote players in the active session
 */
export function getRemotePlayers(): Map<string, RemotePlayerState> {
  return remotePlayers;
}

/**
 * Indicates if the WebSocket connection is active
 */
export function isConnected(): boolean {
  return !!socket && socket.readyState === WebSocket.OPEN;
}
