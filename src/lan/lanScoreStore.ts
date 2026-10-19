export interface LanRaceResult {
  id: string;
  roomCode: string;
  playerName: string;
  elapsedTimeSec: number;
  topSpeedKmh: number;
  createdAt: number;
}

const LAN_SCORE_KEY = "lan_race_results_v1";
const MAX_RESULTS = 50;

function safeParse(raw: string | null): LanRaceResult[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => {
      return (
        item &&
        typeof item.id === "string" &&
        typeof item.roomCode === "string" &&
        typeof item.playerName === "string" &&
        typeof item.elapsedTimeSec === "number" &&
        typeof item.topSpeedKmh === "number" &&
        typeof item.createdAt === "number"
      );
    });
  } catch {
    return [];
  }
}

export function loadLanRaceResults(): LanRaceResult[] {
  try {
    return safeParse(localStorage.getItem(LAN_SCORE_KEY)).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function recordLanRaceResult(input: Omit<LanRaceResult, "id" | "createdAt">): LanRaceResult {
  const entry: LanRaceResult = {
    ...input,
    id: `lan_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`,
    createdAt: Date.now(),
  };

  try {
    const existing = loadLanRaceResults();
    const next = [entry, ...existing].slice(0, MAX_RESULTS);
    localStorage.setItem(LAN_SCORE_KEY, JSON.stringify(next));
  } catch {
    // Keep gameplay flowing if localStorage is blocked.
  }

  return entry;
}
