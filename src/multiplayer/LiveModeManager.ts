import { RoomData, RoomManager } from "./RoomManager";
import { LobbyManager } from "./LobbyManager";
import { SyncManager } from "./SyncManager";

export type LivePhase = "lobby" | "racing" | "finished";

export interface LiveState {
  phase: LivePhase;
  room: RoomData;
}

export class LiveModeManager {
  private static onPhaseChange: ((s: LiveState) => void) | null = null;
  private static currentRoom: RoomData | null = null;

  // ── Boot: called once after host creates or joiner joins ──────────────────

  static boot(room: RoomData, isHost: boolean, onPhaseChange: (s: LiveState) => void): void {
    LiveModeManager.onPhaseChange = onPhaseChange;
    LiveModeManager.currentRoom = room;

    // Attach Firestore listener
    SyncManager.attach(
      room.roomCode,
      (updated) => {
        LiveModeManager.currentRoom = updated;
        if (!updated) return;
        LiveModeManager.onPhaseChange?.({
          phase: LiveModeManager.toPhase(updated.status),
          room: updated,
        });
      },
      (status) => {
        if (status === "racing") {
          LobbyManager.stop();
        }
      },
    );

    // Host starts the countdown
    if (isHost) {
      LobbyManager.startCountdown(
        room,
        (_snap) => {
          /* lobby UI updates via SyncManager */
        },
        () => {
          /* timer expired — startRace already called inside LobbyManager */
        },
      );
    }

    onPhaseChange({ phase: "lobby", room });
  }

  // ── Host force-starts ─────────────────────────────────────────────────────

  static async forceStart(): Promise<void> {
    if (!LiveModeManager.currentRoom) return;
    await LobbyManager.triggerStart(LiveModeManager.currentRoom);
  }

  // ── Tear down ─────────────────────────────────────────────────────────────

  static teardown(): void {
    LobbyManager.stop();
    SyncManager.detach();
    LiveModeManager.currentRoom = null;
    LiveModeManager.onPhaseChange = null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private static toPhase(status: RoomData["status"]): LivePhase {
    if (status === "racing") return "racing";
    if (status === "finished") return "finished";
    return "lobby";
  }
}
