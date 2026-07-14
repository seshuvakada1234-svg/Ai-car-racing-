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

    // Initialize position and targetPosition on first receive
    if (!car.targetPosition && netPlayer.position) {
      car.position.x = netPlayer.position.x;
      car.position.y = netPlayer.position.y;
      car.position.z = netPlayer.position.z;
      car.targetPosition = { x: netPlayer.position.x, y: netPlayer.position.y, z: netPlayer.position.z };
      
      if (typeof netPlayer.angle === "number") {
        car.angle = netPlayer.angle;
        car.targetAngle = netPlayer.angle;
      }
      
      if (netPlayer.velocity) {
        car.velocity.x = netPlayer.velocity.x;
        car.velocity.y = netPlayer.velocity.y;
        car.velocity.z = netPlayer.velocity.z;
        car.targetVelocity = { x: netPlayer.velocity.x, y: netPlayer.velocity.y, z: netPlayer.velocity.z };
      }
    } else {
      // Store targets for interpolation
      if (netPlayer.position) {
        car.targetPosition = { x: netPlayer.position.x, y: netPlayer.position.y, z: netPlayer.position.z };
      }
      if (netPlayer.velocity) {
        car.targetVelocity = { x: netPlayer.velocity.x, y: netPlayer.velocity.y, z: netPlayer.velocity.z };
      }
      if (typeof netPlayer.angle === "number") {
        car.targetAngle = netPlayer.angle;
      }
    }

    // Set other properties
    if (typeof netPlayer.speed === "number") {
      car.targetSpeed = netPlayer.speed;
    }
    if (typeof netPlayer.isDrifting === "boolean") {
      car.isDrifting = netPlayer.isDrifting;
      car.targetIsDrifting = netPlayer.isDrifting;
    }
    if (typeof netPlayer.currentLap === "number") {
      car.currentLap = netPlayer.currentLap;
    } else if (typeof netPlayer.lap === "number") {
      car.currentLap = netPlayer.lap;
    }
    if (typeof netPlayer.currentCheckpointIndex === "number") {
      car.currentCheckpointIndex = netPlayer.currentCheckpointIndex;
    } else if (typeof netPlayer.checkpoint === "number") {
      car.currentCheckpointIndex = netPlayer.checkpoint;
    }
    if (typeof netPlayer.totalDistanceTraveled === "number") {
      car.totalDistanceTraveled = netPlayer.totalDistanceTraveled;
    }
    if (typeof netPlayer.isFinished === "boolean") {
      car.isFinished = netPlayer.isFinished;
    }

    // Steering, wheel rotation and nitro sync
    if (typeof netPlayer.steerValue === "number") {
      car.steerValue = netPlayer.steerValue;
    } else if (typeof netPlayer.steering === "number") {
      car.steerValue = netPlayer.steering;
    }

    if (typeof netPlayer.isNitroActive === "boolean") {
      car.isNitroActive = netPlayer.isNitroActive;
    } else if (typeof netPlayer.nitro === "boolean") {
      car.isNitroActive = netPlayer.nitro;
    }
  }
}
