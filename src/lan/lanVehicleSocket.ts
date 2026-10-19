import { normalizeLanBaseUrl } from "./lanApi";

export interface LanVehicleCallbacks {
  onRemoteUpdate: (playerId: string, data: any) => void;
  onPlayerLeft?: (playerId: string) => void;
  onRaceStart?: (startTime: number) => void;
}

export interface LanVehicleClient {
  sendVehicleUpdate: (car: any) => void;
  triggerStartRace: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
}

interface LanVehicleConfig {
  baseUrl: string;
  roomCode: string;
  playerId: string;
  authToken: string;
  callbacks: LanVehicleCallbacks;
}

function toWsBase(baseUrl: string): string {
  const normalized = normalizeLanBaseUrl(baseUrl);
  if (normalized.startsWith("https://")) {
    return `wss://${normalized.substring("https://".length)}`;
  }
  if (normalized.startsWith("http://")) {
    return `ws://${normalized.substring("http://".length)}`;
  }
  if (normalized.startsWith("wss://") || normalized.startsWith("ws://")) {
    return normalized;
  }
  return `ws://${normalized}`;
}

export function connectLanVehicleSocket(config: LanVehicleConfig): LanVehicleClient {
  const roomCode = config.roomCode.toUpperCase().trim();
  const wsBase = toWsBase(config.baseUrl).replace(/\/+$/, "");
  const url = `${wsBase}/ws/vehicle?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(config.playerId)}&token=${encodeURIComponent(config.authToken)}`;

  let socket: WebSocket | null = null;
  let lastSendTime = 0;

  socket = new WebSocket(url);

  socket.onopen = () => {
    try {
      socket?.send(
        JSON.stringify({
          type: "join",
          roomCode,
          playerId: config.playerId,
          token: config.authToken,
        }),
      );
    } catch (err) {
      console.warn("[LAN WS] Failed to send join packet:", err);
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "vehicleUpdate" || data.type === "vehicle_update") {
        if (data.playerId === config.playerId) return;
        config.callbacks.onRemoteUpdate(data.playerId, data);
        return;
      }

      if (data.type === "player_list" || data.type === "playerList") {
        config.callbacks.onRemoteUpdate("", data);
        return;
      }

      if (data.type === "playerLeft" || data.type === "player_leave") {
        config.callbacks.onPlayerLeft?.(data.playerId);
        return;
      }

      if (data.type === "race_start" || data.type === "raceStart") {
        if (typeof data.startTime === "number" && Number.isFinite(data.startTime)) {
          config.callbacks.onRaceStart?.(data.startTime);
        }
      }
    } catch (err) {
      console.error("[LAN WS] Message parse error:", err);
    }
  };

  socket.onerror = (err) => {
    console.error("[LAN WS] Socket error:", err);
  };

  const sendVehicleUpdate = (car: any) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - lastSendTime < 50) return;
    lastSendTime = now;

    const angle = car.angle ?? 0;
    const packet = {
      type: "vehicleUpdate",
      roomCode,
      playerId: config.playerId,
      carId: car.carId,
      carColor: car.color,
      playerName: car.name,
      position: car.position ? { x: car.position.x, y: car.position.y, z: car.position.z } : { x: 0, y: 0, z: 0 },
      rotation: {
        x: 0,
        y: Math.sin(angle / 2),
        z: 0,
        w: Math.cos(angle / 2),
      },
      speed: car.speed ?? 0,
      steering: car.steerValue ?? car.steering ?? 0,
      wheelRotation: car.wheelspinAngle ?? car.wheelRotation ?? 0,
      nitro: !!(car.isNitroActive ?? car.nitro),
      drift: !!(car.isDrifting ?? car.drift),
      lap: car.currentLap ?? car.lap ?? 1,
      checkpoint: car.currentCheckpointIndex ?? car.checkpoint ?? 0,
      totalDistanceTraveled: car.totalDistanceTraveled ?? 0,
      isFinished: !!car.isFinished,
      timestamp: now,
    };

    try {
      socket.send(JSON.stringify(packet));
    } catch (err) {
      console.error("[LAN WS] Failed to send vehicle update:", err);
    }
  };

  const triggerStartRace = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(
        JSON.stringify({
          type: "start_race",
        }),
      );
    } catch (err) {
      console.warn("[LAN WS] Failed to trigger race start:", err);
    }
  };

  const disconnect = () => {
    if (!socket) return;
    try {
      socket.close();
    } catch {}
    socket = null;
  };

  return {
    sendVehicleUpdate,
    triggerStartRace,
    disconnect,
    isConnected: () => !!socket && socket.readyState === WebSocket.OPEN,
  };
}
