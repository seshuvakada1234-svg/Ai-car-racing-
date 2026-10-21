/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RoomState } from "./RoomState";

export class RoomValidator {
  /**
   * Validates if the room is joinable. Throws clear, user-facing error strings directly.
   * Required validation messages by specifications:
   * - "Invalid room code"
   * - "Room expired"
   * - "Room full"
   */
  public static validateRoomToJoin(room: RoomState | null, playerId?: string): void {
    if (!room) {
      throw new Error("Room Closed");
    }

    // Verify room not archived
    if (room.isArchived === true || room.status === "archived") {
      throw new Error("Room Archived");
    }

    // Verify room is finished
    if (room.status === "finished" || room.status === "complete") {
      throw new Error("Room Finished");
    }

    // Verify room is active / not closed
    if (room.status === "closed") {
      throw new Error("Room Closed");
    }

    const isMember = !!playerId && (room.players || []).some((p) => (p.uid || p.id) === playerId);
    const activeRace = ["starting", "countdown", "racing"].includes(room.status);
    if (room.status !== "waiting" && !(isMember && activeRace)) {
      throw new Error("Race already started");
    }

    // Reloading a full room or an active race must not evict an existing member.
    if (isMember && activeRace) return;

    // Checking 30 minutes room expiration (last active check)
    let isExpired = false;
    const now = Date.now();

    if (room.updatedAt || room.createdAt) {
      const lastActivity = this.timestampMillis(room.updatedAt || room.createdAt);
      isExpired = lastActivity !== null && now - lastActivity > 30 * 60 * 1000;
    } else if (room.expiresAt) {
      let expiresTime = 0;
      if (typeof room.expiresAt.toMillis === "function") {
        expiresTime = room.expiresAt.toMillis();
      } else if (typeof room.expiresAt.toDate === "function") {
        expiresTime = room.expiresAt.toDate().getTime();
      } else if (room.expiresAt.seconds) {
        expiresTime = room.expiresAt.seconds * 1000;
      } else {
        expiresTime = new Date(room.expiresAt).getTime();
      }
      if (now > expiresTime) {
        isExpired = true;
      }
    } else {
      let createdTime = now;
      const timeSource = room.createdAt || room.updatedAt;

      if (timeSource) {
        if (typeof timeSource.toMillis === "function") {
          createdTime = timeSource.toMillis();
        } else if (typeof timeSource.toDate === "function") {
          createdTime = timeSource.toDate().getTime();
        } else if (timeSource.seconds) {
          createdTime = timeSource.seconds * 1000;
        } else if (typeof timeSource === "number") {
          createdTime = timeSource;
        } else if (timeSource instanceof Date) {
          createdTime = timeSource.getTime();
        }
      }
      const ageInMinutes = (now - createdTime) / (1000 * 60);
      if (ageInMinutes > 30) {
        isExpired = true;
      }
    }

    if (isExpired) {
      throw new Error("Room Expired");
    }

    // Check capacity
    const playersList = room.players || [];
    const maxCount = room.maxPlayers || 6;
    if (!isMember && playersList.length >= maxCount) {
      throw new Error("Room Full");
    }
  }

  public static timestampMillis(value: any): number | null {
    const millis = typeof value?.toMillis === "function" ? value.toMillis()
      : typeof value?.seconds === "number" ? value.seconds * 1000
      : value instanceof Date ? value.getTime()
      : typeof value === "number" ? value : NaN;
    return Number.isFinite(millis) ? millis : null;
  }

  public static normalizeCode(code: string | null | undefined): string {
    return (code || "").trim().toUpperCase();
  }

  /**
   * Safe check for code string pattern matching ABC123, X9K7PQ, etc.
   */
  public static isValidCode(code: string | null | undefined): boolean {
    if (!code) return false;
    const clean = this.normalizeCode(code);
    return clean.length >= 4 && clean.length <= 12 && /^[A-Z0-9]+$/.test(clean);
  }
}
