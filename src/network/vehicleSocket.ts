let socket: WebSocket | null = null;
let activeRoomCode = "";
let activePlayerId = "";
let lastSendTime = 0;
let activeOnRaceStart: ((startTime: number) => void) | null = null;

/**
 * Triggers server-authoritative race start via WebSocket
 */
export function triggerWsStartRace(): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "start_race" }));
    console.log("[WS CLIENT] Host triggered start_race via WebSocket.");
  } else {
    console.warn("[WS CLIENT] Cannot trigger start_race, socket not open.");
  }
}


/**
 * Throttled send of vehicle coordinates (position, rotation, speed, nitro, etc.)
 * running at 20Hz (every 50ms) to ensure minimal packet size and high update frequency.
 */
export function sendVehicleUpdate(car: any): void {
  if (!socket || socket.readyState !== WebSocket.OPEN || !activeRoomCode || !activePlayerId) {
    return;
  }

  const now = Date.now();
  if (now - lastSendTime < 50) return; // Exactly 50ms interval throttling (20Hz)
  lastSendTime = now;

  const position = car.position ? { x: car.position.x, y: car.position.y, z: car.position.z } : { x: 0, y: 0, z: 0 };
  
  // Convert car heading angle to a Y-axis rotation quaternion:
  // rotation = { x: 0, y: sin(angle/2), z: 0, w: cos(angle/2) }
  const angle = car.angle ?? 0;
  const rotation = {
    x: 0,
    y: Math.sin(angle / 2),
    z: 0,
    w: Math.cos(angle / 2)
  };

  const speed = car.speed ?? 0;
  const steering = car.steerValue ?? car.steering ?? 0;
  const wheelRotation = car.wheelspinAngle ?? car.wheelRotation ?? 0;
  const nitro = !!(car.isNitroActive ?? car.nitro);
  const drift = !!(car.isDrifting ?? car.drift);
  const lap = car.currentLap ?? car.lap ?? 1;
  const checkpoint = car.currentCheckpointIndex ?? car.checkpoint ?? 0;
  const totalDistanceTraveled = car.totalDistanceTraveled ?? 0;
  const isFinished = !!car.isFinished;

  const packet = {
    type: "vehicleUpdate",
    roomCode: activeRoomCode,
    playerId: activePlayerId,
    position,
    rotation,
    speed,
    steering,
    wheelRotation,
    nitro,
    drift,
    lap,
    checkpoint,
    totalDistanceTraveled,
    isFinished,
    timestamp: now
  };

  console.log("[SEND]", { playerId: activePlayerId, roomCode: activeRoomCode, position });

  try {
    socket.send(JSON.stringify(packet));
  } catch (err) {
    console.error("[WS CLIENT] Error sending vehicle update:", err);
  }
}

/**
 * Disconnects the active vehicle WebSocket connection.
 */
export function disconnectVehicleSocket(): void {
  console.log("[WS CLIENT] Disconnecting vehicle WebSocket manually.");
  if (socket) {
    try {
      socket.close();
    } catch (e) {}
    socket = null;
  }
}

/**
 * Establishes real-time connection to the Cloudflare Workers / Durable Object WebSocket relay.
 */
export function connectVehicleSocket(
  roomCode: string,
  playerId: string,
  onRemoteUpdate: (playerId: string, data: any) => void,
  onPlayerLeft: (playerId: string) => void,
  onRaceStart?: (startTime: number) => void
): () => void {
  // Close any existing socket first to avoid leak
  disconnectVehicleSocket();

  activeRoomCode = roomCode.toUpperCase().trim();
  activePlayerId = playerId;
  lastSendTime = 0;
  activeOnRaceStart = onRaceStart || null;

  const isHttps = window.location.protocol === "https:";
  const wsProtocol = isHttps ? "wss:" : "ws:";
  
  // Check if environment variable is set
  let baseUrl = import.meta.env.VITE_VEHICLE_WS_URL || "";
  
  if (!baseUrl) {
    // Standard local fallback dynamically targeting host root
    baseUrl = `${wsProtocol}//${window.location.host}`;
  } else {
    // Ensure correct protocol in environment variable values
    if (!baseUrl.startsWith("ws://") && !baseUrl.startsWith("wss://")) {
      baseUrl = `${wsProtocol}//${baseUrl}`;
    }
  }

  // When falling back to standard local host proxy we route to /ws/vehicle
  const isLocalHost = baseUrl.includes("localhost") || baseUrl.includes("3000") || baseUrl.includes(window.location.host);
  const pathPrefix = isLocalHost ? "/ws/vehicle" : "/ws";

  // Build connection URL with roomCode and playerId query parameters
  const url = `${baseUrl.replace(/\/+$/, "")}${pathPrefix}?roomCode=${encodeURIComponent(activeRoomCode)}&playerId=${encodeURIComponent(activePlayerId)}`;

  console.log(`[WS CLIENT] Connecting to vehicle WebSocket relay at: ${url}`);
  
  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    console.log("[WS CLIENT] Connection established successfully.");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === "vehicleUpdate" || data.type === "vehicle_update") {
        const { playerId, roomCode } = data;
        if (playerId === activePlayerId) return; // ignore self
        
        onRemoteUpdate(playerId, data);
        return;
      }

      if (data.type === "playerLeft" || data.type === "player_leave") {
        const { playerId } = data;
        console.log("[WS CLIENT] Remote player left room:", playerId);
        onPlayerLeft(playerId);
        return;
      }

      if (data.type === "playerJoined" || data.type === "player_join") {
        const { playerId } = data;
        console.log("[WS CLIENT] Remote player joined room:", playerId);
        return;
      }

      if (data.type === "race_start" || data.type === "raceStart") {
        const { startTime } = data;
        console.log("[WS CLIENT] Race start countdown signal received:", startTime);
        if (activeOnRaceStart) {
          activeOnRaceStart(startTime);
        }
        return;
      }
    } catch (err) {
      console.error("[WS CLIENT] Error parsing incoming message:", err);
    }
  };

  ws.onerror = (err) => {
    console.error("[WS CLIENT] WebSocket error occurred:", err);
  };

  ws.onclose = () => {
    console.log("[WS CLIENT] Connection closed.");
    if (socket === ws) {
      socket = null;
    }
  };

  return () => {
    if (socket === ws) {
      ws.close();
      socket = null;
    }
  };
}
