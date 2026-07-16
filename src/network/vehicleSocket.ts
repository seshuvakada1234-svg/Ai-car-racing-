let socket: WebSocket | null = null;
let activeRoomCode = "";
let activePlayerId = "";
let lastSendTime = 0;

export function sendVehicleUpdate(car: any): void {
  if (!socket || socket.readyState !== WebSocket.OPEN || !activeRoomCode || !activePlayerId) {
    return;
  }

  const now = Date.now();
  if (now - lastSendTime < 50) return; // 20Hz throttling (every 50ms)
  lastSendTime = now;

  const position = car.position ? { x: car.position.x, y: car.position.y, z: car.position.z } : { x: 0, y: 0, z: 0 };
  
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

export function connectVehicleSocket(
  roomCode: string,
  playerId: string,
  onRemoteUpdate: (playerId: string, data: any) => void,
  onPlayerLeft: (playerId: string) => void
): () => void {
  // Close any existing socket first
  if (socket) {
    try {
      socket.close();
    } catch (e) {}
    socket = null;
  }

  activeRoomCode = roomCode.toUpperCase().trim();
  activePlayerId = playerId;
  lastSendTime = 0;

  const isHttps = window.location.protocol === "https:";
  const wsProtocol = isHttps ? "wss:" : "ws:";
  const defaultUrl = `${wsProtocol}//${window.location.host}/ws/vehicle`;
  const url = import.meta.env.VITE_VEHICLE_WS_URL || defaultUrl;

  console.log(`[WS CLIENT] Connecting to vehicle WebSocket relay at: ${url}`);
  
  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    console.log("[WS CLIENT] Connection established.");
    const joinPacket = {
      type: "join",
      roomCode: activeRoomCode,
      playerId: activePlayerId
    };
    ws.send(JSON.stringify(joinPacket));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === "vehicleUpdate") {
        const { playerId, roomCode } = data;
        if (playerId === activePlayerId) return; // skip self
        
        console.log("[CLIENT RECEIVE]", { playerId, roomCode });
        onRemoteUpdate(playerId, data);
        return;
      }

      if (data.type === "playerLeft") {
        const { playerId } = data;
        console.log("[WS CLIENT] Remote player left:", playerId);
        onPlayerLeft(playerId);
        return;
      }
    } catch (err) {
      console.error("[WS CLIENT] Error parsing message:", err);
    }
  };

  ws.onerror = (err) => {
    console.error("[WS CLIENT] WebSocket error:", err);
  };

  ws.onclose = () => {
    console.log("[WS CLIENT] Connection closed.");
    if (socket === ws) {
      socket = null;
    }
  };

  return () => {
    console.log("[WS CLIENT] Disconnecting vehicle WebSocket manually.");
    if (socket === ws) {
      ws.close();
      socket = null;
    }
  };
}
