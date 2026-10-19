import { LanSession } from "./types";

const GUEST_KEY = "lan_guest_profile";
const BASE_URL_KEY = "lan_server_base_url";
const SESSION_PREFIX = "lan_room_session_";

export function getDefaultGuestName(): string {
  return `Racer-${Math.floor(Math.random() * 900 + 100)}`;
}

export function loadLanGuestName(): string {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return getDefaultGuestName();
    const data = JSON.parse(raw);
    if (typeof data?.name === "string" && data.name.trim()) {
      return data.name.trim();
    }
  } catch {}
  return getDefaultGuestName();
}

export function saveLanGuestName(name: string): void {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify({ name: name.trim() }));
  } catch {}
}

export function loadLanBaseUrl(): string | null {
  try {
    const raw = localStorage.getItem(BASE_URL_KEY);
    if (!raw) return null;
    if (raw.trim()) return raw.trim();
  } catch {}
  return null;
}

export function saveLanBaseUrl(baseUrl: string): void {
  try {
    localStorage.setItem(BASE_URL_KEY, baseUrl.trim());
  } catch {}
}

export function saveLanSession(session: LanSession): void {
  try {
    localStorage.setItem(`${SESSION_PREFIX}${session.roomCode}`, JSON.stringify(session));
  } catch {}
}

export function loadLanSession(roomCode: string): LanSession | null {
  try {
    const raw = localStorage.getItem(`${SESSION_PREFIX}${roomCode.toUpperCase().trim()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.roomCode === "string" &&
      typeof parsed.playerId === "string" &&
      typeof parsed.authToken === "string" &&
      typeof parsed.baseUrl === "string"
    ) {
      return {
        roomCode: parsed.roomCode,
        playerId: parsed.playerId,
        authToken: parsed.authToken,
        isHost: !!parsed.isHost,
        playerName: typeof parsed.playerName === "string" ? parsed.playerName : "LAN Racer",
        baseUrl: parsed.baseUrl,
      };
    }
  } catch {}
  return null;
}

export function clearLanSession(roomCode: string): void {
  try {
    localStorage.removeItem(`${SESSION_PREFIX}${roomCode.toUpperCase().trim()}`);
  } catch {}
}
