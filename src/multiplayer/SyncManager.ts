import { RoomData, RoomManager } from "./RoomManager";

type SyncCallback = (room: RoomData) => void;
type StatusCallback = (status: RoomData["status"]) => void;

export class SyncManager {
  private static cleanup: (() => void) | null = null;
  private static lastStatus: RoomData["status"] | null = null;

  // ── Attach listener; returns detach fn ───────────────────────────────────

  static attach(roomCode: string, onRoomChange: SyncCallback, onStatusChange?: StatusCallback): () => void {
    SyncManager.detach();

    const detach = RoomManager.listenToRoom(roomCode, (room) => {
      onRoomChange(room);

      if (onStatusChange && room.status !== SyncManager.lastStatus) {
        SyncManager.lastStatus = room.status;
        onStatusChange(room.status);
      }
    });

    SyncManager.cleanup = detach;
    return detach;
  }

  // ── Detach ────────────────────────────────────────────────────────────────

  static detach(): void {
    SyncManager.cleanup?.();
    SyncManager.cleanup = null;
    SyncManager.lastStatus = null;
  }

  static unpackCarState(car: any, netPlayer: any): void {
    if (!netPlayer) return;
    if (netPlayer.position) {
      car.position.x = netPlayer.position.x;
      car.position.y = netPlayer.position.y;
      car.position.z = netPlayer.position.z;
    }
    if (netPlayer.velocity) {
      car.velocity.x = netPlayer.velocity.x;
      car.velocity.y = netPlayer.velocity.y;
      car.velocity.z = netPlayer.velocity.z;
    }
    if (typeof netPlayer.angle === "number") {
      car.angle = netPlayer.angle;
    }
    if (typeof netPlayer.speed === "number") {
      car.speed = netPlayer.speed;
    }
    if (typeof netPlayer.isDrifting === "boolean") {
      car.isDrifting = netPlayer.isDrifting;
    }
    if (typeof netPlayer.currentLap === "number") {
      car.currentLap = netPlayer.currentLap;
    }
    if (typeof netPlayer.totalDistanceTraveled === "number") {
      car.totalDistanceTraveled = netPlayer.totalDistanceTraveled;
    }
    if (typeof netPlayer.isFinished === "boolean") {
      car.isFinished = netPlayer.isFinished;
    }
  }
}
