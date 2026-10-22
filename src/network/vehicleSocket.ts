let socket: WebSocket | null = null;
let activeRoomCode = "";
let activePlayerId = "";
let lastSendTime = 0;
let activeOnRaceStart: ((startTime: number) => void) | null = null;
let activeCleanup: (() => void) | null = null;

/**
 * Returns whether the vehicle WebSocket relay is currently connected and open.
 */
export function isVehicleSocketConnected(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}

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
    carId: car.carId,
    carColor: car.color,
    playerName: car.name,
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

  console.log("[CLIENT A] Sending vehicleUpdate", packet);

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
  activeCleanup?.();
  activeCleanup = null;
}

export function resolveVehicleSocketUrl(baseUrl: string, pageUrl: string, roomCode: string, playerId: string): string {
  const page = new URL(pageUrl);
  const base = baseUrl.trim();
  const url = new URL(base ? (/^[a-z]+:\/\//i.test(base) ? base : `wss://${base}`) : page.origin);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "wss:" && url.protocol !== "ws:") throw new Error("Invalid vehicle relay URL protocol");
  if (page.protocol === "https:" && url.protocol !== "wss:") throw new Error("An HTTPS game requires a wss:// vehicle relay");
  if (url.pathname === "/") url.pathname = base ? "/ws" : "/ws/vehicle";
  url.searchParams.set("roomCode", roomCode.trim().toUpperCase());
  url.searchParams.set("playerId", playerId);
  return url.toString();
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
  disconnectVehicleSocket();
  const code = roomCode.toUpperCase().trim();
  let disposed = false;
  let current: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let url: string;
  try {
    url = resolveVehicleSocketUrl(import.meta.env.VITE_VEHICLE_WS_URL || "", window.location.href, code, playerId);
  } catch (error) {
    console.error("[WS CLIENT] Relay configuration failed:", error);
    return () => {};
  }

  const open = () => {
    if (disposed) return;
    console.log(`[WS CLIENT] Connecting to ${url}`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      console.error(`[WS CLIENT] Could not open relay for ${code}; Firestore remains available:`, error);
      return;
    }
    current = socket = ws;
    activeRoomCode = code;
    activePlayerId = playerId;
    activeOnRaceStart = onRaceStart || null;
    lastSendTime = 0;
    ws.onopen = () => {
      if (disposed || current !== ws) return;
      retries = 0;
      ws.send(JSON.stringify({ type: "join", roomCode: code, playerId }));
    };
    ws.onmessage = (event) => {
      if (disposed || current !== ws) return;
      try {
        const data = JSON.parse(event.data);
        if (data.roomCode && data.roomCode.toUpperCase().trim() !== code) return;
        if (data.type === "vehicleUpdate" || data.type === "vehicle_update") {
          if (data.playerId !== playerId) onRemoteUpdate(data.playerId, data);
        } else if (data.type === "player_list" || data.type === "playerList") {
          onRemoteUpdate("", data);
        } else if (data.type === "playerLeft" || data.type === "player_leave") {
          onPlayerLeft(data.playerId);
        } else if (data.type === "race_start" || data.type === "raceStart") {
          if (Number.isFinite(data.startTime)) onRaceStart?.(data.startTime);
        }
      } catch (error) {
        console.error(`[WS CLIENT] Invalid message in room ${code}:`, error);
      }
    };
    ws.onerror = (error) => console.error(`[WS CLIENT] Relay error in room ${code}:`, error);
    ws.onclose = (event) => {
      if (socket === ws) socket = null;
      console.info(`[WS CLIENT] Relay closed in ${code}: ${event.code} ${event.reason}`);
      if (disposed || current !== ws || event.reason === "Replaced by new connection") return;
      // Transport reconnection never removes Firestore membership.
      retryTimer = setTimeout(open, Math.min(1000 * 2 ** retries++, 10000));
    };
  };
  const cleanup = () => {
    disposed = true;
    clearTimeout(retryTimer);
    if (socket === current) socket = null;
    current?.close();
    if (activeCleanup === cleanup) activeCleanup = null;
  };
  activeCleanup = cleanup;
  open();
  return cleanup;
}
