/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { toast } from "sonner";

// Interfaces for serialization
export interface Vector3State {
  x: number;
  y: number;
  z: number;
}

export interface VehicleSyncState {
  playerId: string;
  position: Vector3State;
  velocity: Vector3State;
  speed: number;
  angle: number;
  currentLap: number;
  currentCheckpointIndex: number;
  isNitroActive: boolean;
  isDrifting: boolean;
  steerValue: number;
  wheelRotation: number;
  timestamp: number;
  isFinished?: boolean;
  racePosition?: number;
}

// Callback type for incoming remote player state updates
export type RemoteUpdateCallback = (playerId: string, state: any) => void;

class MultiplayerVehicleSyncManager {
  private socket: WebSocket | null = null;
  private roomCode: string = "";
  private playerId: string = "";
  private playerName: string = "";
  private selectedCar: string = "ferrari";
  private carColor: string = "#ff0000";
  private onRemoteUpdate: RemoteUpdateCallback | null = null;
  private onDisconnectCallback: (() => void) | null = null;

  private isVoluntaryDisconnect: boolean = false;
  private reconnectTimeout: any = null;
  private lastSendTime: number = 0;
  
  // Track last sent state to avoid redundant packets
  private lastSentPosition: Vector3State = { x: 0, y: 0, z: 0 };
  private lastSentAngle: number = 0;
  private lastSentTimeForce: number = 0;

  /**
   * Builds the WS URL dynamically based on browser context
   */
  private getWsUrl(): string {
    if (typeof window === "undefined") return "";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  /**
   * Initializes the connection and joins the room
   */
  public connect(params: {
    roomCode: string;
    playerId: string;
    playerName: string;
    selectedCar: string;
    carColor: string;
    onRemoteUpdate: RemoteUpdateCallback;
    onDisconnect?: () => void;
  }) {
    if (typeof window === "undefined") return;

    this.disconnect(); // Ensure any stale connection is cleared first

    this.roomCode = params.roomCode.toUpperCase().trim();
    this.playerId = params.playerId;
    this.playerName = params.playerName;
    this.selectedCar = params.selectedCar;
    this.carColor = params.carColor;
    this.onRemoteUpdate = params.onRemoteUpdate;
    this.onDisconnectCallback = params.onDisconnect || null;
    this.isVoluntaryDisconnect = false;

    const wsUrl = this.getWsUrl();
    if (!wsUrl) {
      console.error("[Vehicle Sync] Could not determine dynamic WebSocket URL");
      return;
    }

    console.log(`[Vehicle Sync] Initiating WebSocket synchronization channel to: ${wsUrl}`);
    
    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log("[Vehicle Sync] WebSocket connected successfully!");
        
        // Handshake: Join room with our existing Firestore credentials
        this.sendJoinRoom();
      };

      this.socket.onclose = (event) => {
        console.log(`[Vehicle Sync] Connection closed (Code: ${event.code}, Clean: ${event.wasClean})`);
        
        if (!this.isVoluntaryDisconnect) {
          if (this.onDisconnectCallback) {
            this.onDisconnectCallback();
          }
          this.triggerReconnect();
        }
      };

      this.socket.onerror = (err) => {
        console.error("[Vehicle Sync] WebSocket connection error:", err);
      };

      this.socket.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    } catch (err) {
      console.error("[Vehicle Sync] Failed to spawn WebSocket connection:", err);
      this.triggerReconnect();
    }
  }

  /**
   * Sends the room mapping/registration packet
   */
  private sendJoinRoom() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const joinPayload = {
      type: "JOIN_ROOM",
      payload: {
        roomCode: this.roomCode,
        playerName: this.playerName,
        selectedCar: this.selectedCar,
        carColor: this.carColor,
        playerId: this.playerId, // Critical: maps this socket to the Firestore user ID
      },
    };

    console.log("[Vehicle Sync] Dispatching JOIN_ROOM handshake packet", joinPayload);
    this.socket.send(JSON.stringify(joinPayload));
  }

  /**
   * Auto reconnection mechanism with a safe debounce
   */
  private triggerReconnect() {
    if (this.isVoluntaryDisconnect) return;
    if (this.reconnectTimeout) return;

    console.log("[Vehicle Sync] Attempting channel reconnection in 3 seconds...");
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect({
        roomCode: this.roomCode,
        playerId: this.playerId,
        playerName: this.playerName,
        selectedCar: this.selectedCar,
        carColor: this.carColor,
        onRemoteUpdate: this.onRemoteUpdate!,
        onDisconnect: this.onDisconnectCallback || undefined,
      });
    }, 3000);
  }

  /**
   * Closes the connection voluntarily
   */
  public disconnect() {
    this.isVoluntaryDisconnect = true;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
      this.socket = null;
    }

    console.log("[Vehicle Sync] Voluntarily terminated WebSocket sync channel.");
  }

  /**
   * Handles incoming room messages
   */
  private handleMessage(rawData: string) {
    try {
      const data = JSON.parse(rawData);
      if (!data || typeof data.type !== "string") return;

      switch (data.type) {
        case "SYNC_STATE": {
          const players = data.payload?.players;
          if (!Array.isArray(players)) return;

          players.forEach((p: any) => {
            // Never process or overwrite local player's state
            if (p.id === this.playerId || p.uid === this.playerId) return;

            // Log RECEIVE details exactly as requested by user
            console.log(
              `RECEIVE:\n` +
              `senderPlayerId: ${p.id}\n` +
              `position: ${JSON.stringify(p.position)}\n` +
              `rotation: ${p.angle}\n` +
              `timestamp: ${Date.now()}`
            );

            // Forward the remote player's state back via update callback
            if (this.onRemoteUpdate) {
              this.onRemoteUpdate(p.id, p);
            }
          });
          break;
        }

        case "ERROR":
          console.warn("[Vehicle Sync] Received error from server:", data.payload?.message);
          break;
      }
    } catch (err) {
      console.error("[Vehicle Sync] Error parsing incoming WebSocket payload:", err);
    }
  }

  /**
   * Transmits vehicle update packet at exactly 20Hz (every 50ms)
   */
  public sendUpdate(carState: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    
    // Throttle: exact 50ms interval (20Hz)
    if (now - this.lastSendTime < 50) return;

    const pos = carState.position;
    const vel = carState.velocity || { x: 0, y: 0, z: 0 };
    const angle = carState.angle ?? 0;
    const speed = carState.speed ?? 0;

    // Skip redundant updates to save bandwidth unless force keepalive (every 500ms)
    const distSq =
      Math.pow(pos.x - this.lastSentPosition.x, 2) +
      Math.pow(pos.y - this.lastSentPosition.y, 2) +
      Math.pow(pos.z - this.lastSentPosition.z, 2);
    
    const angleDiff = Math.abs(angle - this.lastSentAngle);
    const isStationary = distSq < 0.0001 && angleDiff < 0.001;

    if (isStationary && now - this.lastSentTimeForce < 500) {
      return; // Skip sending to save CPU/Bandwidth
    }

    this.lastSendTime = now;
    this.lastSentTimeForce = now;
    this.lastSentPosition = { x: pos.x, y: pos.y, z: pos.z };
    this.lastSentAngle = angle;

    // Build optimized, compressed payload: round decimals to 3 points
    const payload = {
      position: {
        x: Math.round(pos.x * 1000) / 1000,
        y: Math.round(pos.y * 1000) / 1000,
        z: Math.round(pos.z * 1000) / 1000,
      },
      velocity: {
        x: Math.round(vel.x * 1000) / 1000,
        y: Math.round(vel.y * 1000) / 1000,
        z: Math.round(vel.z * 1000) / 1000,
      },
      speed: Math.round(speed * 100) / 100,
      angle: Math.round(angle * 1000) / 1000,
      currentLap: carState.currentLap ?? 1,
      currentCheckpointIndex: carState.currentCheckpointIndex ?? 0,
      isNitroActive: !!carState.isNitroActive,
      isDrifting: !!carState.isDrifting,
      steerValue: Math.round((carState.steerValue ?? 0) * 1000) / 1000,
      wheelRotation: Math.round((carState.wheelspinAngle ?? 0) * 1000) / 1000,
      isFinished: !!carState.isFinished,
      racePosition: carState.racePosition ?? 1,
      timestamp: now,
    };

    // Print SEND log precisely as required
    console.log(
      `SEND:\n` +
      `playerId: ${this.playerId}\n` +
      `position: ${JSON.stringify(payload.position)}\n` +
      `rotation: ${payload.angle}\n` +
      `timestamp: ${now}`
    );

    const updatePacket = {
      type: "UPDATE_CAR",
      payload,
    };

    try {
      this.socket.send(JSON.stringify(updatePacket));
    } catch (err) {
      console.error("[Vehicle Sync] Failed to send update packet:", err);
    }
  }

  /**
   * Transmits AI car updates on behalf of the host over WebSockets
   */
  public sendAICars(aiCars: any[]) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const formattedAICars = aiCars.map((car) => {
      const pos = car.position;
      const vel = car.velocity || { x: 0, y: 0, z: 0 };
      return {
        id: car.id,
        name: car.name || "AI Racer",
        selectedCar: car.carId || "ferrari",
        color: car.color || "#ff0000",
        position: {
          x: Math.round(pos.x * 1000) / 1000,
          y: Math.round(pos.y * 1000) / 1000,
          z: Math.round(pos.z * 1000) / 1000,
        },
        velocity: {
          x: Math.round(vel.x * 1000) / 1000,
          y: Math.round(vel.y * 1000) / 1000,
          z: Math.round(vel.z * 1000) / 1000,
        },
        speed: Math.round((car.speed ?? 0) * 100) / 100,
        angle: Math.round((car.angle ?? 0) * 1000) / 1000,
        currentLap: car.currentLap ?? 1,
        isFinished: !!car.isFinished,
        racePosition: car.racePosition ?? 1,
        isDrifting: !!car.isDrifting,
        isNitroActive: !!car.isNitroActive,
        finishTime: car.finishTime,
      };
    });

    const updatePacket = {
      type: "UPDATE_AI_CARS",
      payload: {
        cars: formattedAICars,
      },
    };

    try {
      this.socket.send(JSON.stringify(updatePacket));
    } catch (err) {
      console.error("[Vehicle Sync] Failed to send AI update packet:", err);
    }
  }
}

export const multiplayerVehicleSync = new MultiplayerVehicleSyncManager();
