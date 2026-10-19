import { LanHostInfo, LanRoom, LanSession } from "./types";

function normalizePath(path: string): string {
  if (!path.startsWith("/")) return `/${path}`;
  return path;
}

export function normalizeLanBaseUrl(input: string): string {
  const raw = (input || "").trim();
  if (!raw) {
    return typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, "");
  }

  return `http://${raw.replace(/\/+$/, "")}`;
}

async function lanRequest<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const url = `${normalizeLanBaseUrl(baseUrl)}${normalizePath(path)}`;
  const response = await fetch(url, {
    mode: "cors",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : `LAN request failed (${response.status})`;
    throw new Error(message);
  }

  return body as T;
}

interface RoomResponse {
  room: LanRoom;
}

interface SessionResponse {
  room: LanRoom;
  session: Omit<LanSession, "baseUrl">;
}

export async function fetchLanHostInfo(baseUrl: string): Promise<LanHostInfo> {
  return lanRequest<LanHostInfo>(baseUrl, "/api/lan/host-info", { method: "GET" });
}

export async function createLanRoom(
  baseUrl: string,
  playerName: string,
  maxPlayers = 6,
): Promise<{ room: LanRoom; session: LanSession }> {
  const response = await lanRequest<SessionResponse>(baseUrl, "/api/lan/rooms", {
    method: "POST",
    body: JSON.stringify({ playerName, maxPlayers }),
  });

  return {
    room: response.room,
    session: {
      ...response.session,
      baseUrl: normalizeLanBaseUrl(baseUrl),
    },
  };
}

export async function joinLanRoom(baseUrl: string, roomCode: string, playerName: string): Promise<{ room: LanRoom; session: LanSession }> {
  const response = await lanRequest<SessionResponse>(baseUrl, `/api/lan/rooms/${encodeURIComponent(roomCode)}/join`, {
    method: "POST",
    body: JSON.stringify({ playerName }),
  });

  return {
    room: response.room,
    session: {
      ...response.session,
      baseUrl: normalizeLanBaseUrl(baseUrl),
    },
  };
}

export async function reconnectLanSession(session: LanSession): Promise<{ room: LanRoom; session: LanSession }> {
  const response = await lanRequest<SessionResponse>(
    session.baseUrl,
    `/api/lan/rooms/${encodeURIComponent(session.roomCode)}/reconnect`,
    {
      method: "POST",
      body: JSON.stringify({ playerId: session.playerId, authToken: session.authToken }),
    },
  );

  return {
    room: response.room,
    session: {
      ...response.session,
      baseUrl: normalizeLanBaseUrl(session.baseUrl),
    },
  };
}

export async function fetchLanRoom(baseUrl: string, roomCode: string): Promise<LanRoom> {
  const response = await lanRequest<RoomResponse>(baseUrl, `/api/lan/rooms/${encodeURIComponent(roomCode)}`, {
    method: "GET",
  });
  return response.room;
}

export async function setLanReady(session: LanSession, ready: boolean): Promise<LanRoom> {
  const response = await lanRequest<RoomResponse>(
    session.baseUrl,
    `/api/lan/rooms/${encodeURIComponent(session.roomCode)}/ready`,
    {
      method: "POST",
      body: JSON.stringify({
        playerId: session.playerId,
        authToken: session.authToken,
        ready,
      }),
    },
  );
  return response.room;
}

export async function startLanRace(session: LanSession): Promise<LanRoom> {
  const response = await lanRequest<RoomResponse>(
    session.baseUrl,
    `/api/lan/rooms/${encodeURIComponent(session.roomCode)}/start`,
    {
      method: "POST",
      body: JSON.stringify({
        playerId: session.playerId,
        authToken: session.authToken,
      }),
    },
  );
  return response.room;
}

export async function markLanRaceRunning(session: LanSession): Promise<LanRoom> {
  const response = await lanRequest<RoomResponse>(
    session.baseUrl,
    `/api/lan/rooms/${encodeURIComponent(session.roomCode)}/racing`,
    {
      method: "POST",
      body: JSON.stringify({
        playerId: session.playerId,
        authToken: session.authToken,
      }),
    },
  );
  return response.room;
}

export async function leaveLanRoom(session: LanSession): Promise<void> {
  await lanRequest(
    session.baseUrl,
    `/api/lan/rooms/${encodeURIComponent(session.roomCode)}/leave`,
    {
      method: "POST",
      body: JSON.stringify({
        playerId: session.playerId,
        authToken: session.authToken,
      }),
    },
  );
}
