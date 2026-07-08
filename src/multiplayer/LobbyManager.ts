import { RoomData, RoomManager } from "./RoomManager";
import { PlayerManager } from "./PlayerManager";

export type LobbyState = "waiting" | "countdown" | "starting";

export interface LobbySnapshot {
  state: LobbyState;
  countdown: number; // seconds remaining
  canStart: boolean; // host-only start button enabled?
  humanCount: number;
  aiCount: number;
  allReady: boolean;
}

export class LobbyManager {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static secondsLeft = 30;
  private static onTick: ((s: LobbySnapshot) => void) | null = null;

  // ── Start the lobby countdown (host only, call once) ─────────────────────

  static startCountdown(room: RoomData, onSnapshot: (s: LobbySnapshot) => void, onRaceStart: () => void): void {
    LobbyManager.stop();
    LobbyManager.secondsLeft = 30;
    LobbyManager.onTick = onSnapshot;

    LobbyManager.timer = setInterval(async () => {
      LobbyManager.secondsLeft -= 1;
      onSnapshot(LobbyManager.makeSnapshot(room));

      if (LobbyManager.secondsLeft <= 0) {
        LobbyManager.stop();
        await RoomManager.startRace(room.roomCode);
        onRaceStart();
      }
    }, 1000);

    onSnapshot(LobbyManager.makeSnapshot(room));
  }

  // ── Update snapshot when room doc changes ─────────────────────────────────

  static refreshSnapshot(room: RoomData): LobbySnapshot {
    return LobbyManager.makeSnapshot(room);
  }

  // ── Host triggers immediate start ─────────────────────────────────────────

  static async triggerStart(room: RoomData): Promise<void> {
    LobbyManager.stop();
    await RoomManager.startRace(room.roomCode);
  }

  // ── Stop timer ────────────────────────────────────────────────────────────

  static stop(): void {
    if (LobbyManager.timer !== null) {
      clearInterval(LobbyManager.timer);
      LobbyManager.timer = null;
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private static makeSnapshot(room: RoomData): LobbySnapshot {
    const humanCount = PlayerManager.humanCount(room);
    const aiCount = PlayerManager.aiCount(room);
    const allReady = PlayerManager.allReady(room);
    const canStart = humanCount >= 1; // host can always force start

    let state: LobbyState = "waiting";
    if (LobbyManager.secondsLeft < 30) state = "countdown";
    if (LobbyManager.secondsLeft <= 0) state = "starting";

    return {
      state,
      countdown: LobbyManager.secondsLeft,
      canStart,
      humanCount,
      aiCount,
      allReady,
    };
  }
}
