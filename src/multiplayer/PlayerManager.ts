import { RoomData, RoomPlayer } from "./RoomManager";

export const AI_NAMES = ["Nova", "Phantom", "Titan"];

export interface GridEntry {
  position: number; // 1-based grid slot
  player: RoomPlayer;
  displayName: string; // "Speedster (Host)" / "Nova"
  isHuman: boolean;
}

export class PlayerManager {
  static readonly MAX_PLAYERS = 4;

  // ── Build the full 4-slot grid, filling empty slots with AI ──────────────

  static buildGrid(room: RoomData): GridEntry[] {
    const humans = room.players.filter((p) => !p.isAI);
    const aiCount = PlayerManager.MAX_PLAYERS - humans.length;

    const aiPlayers: RoomPlayer[] = AI_NAMES.slice(0, aiCount).map((name, i) => ({
      id: `ai_${i}`,
      nickname: name,
      carId: `ai_car_${i}`,
      isHost: false,
      isReady: true,
      isAI: true,
      joinedAt: 0,
    }));

    const all = [...humans, ...aiPlayers];

    return all.map((player, idx) => ({
      position: idx + 1,
      player,
      displayName: PlayerManager.formatName(player, room.hostId),
      isHuman: !player.isAI,
    }));
  }

  // ── Counts ────────────────────────────────────────────────────────────────

  static humanCount(room: RoomData): number {
    return room.players.filter((p) => !p.isAI).length;
  }

  static aiCount(room: RoomData): number {
    return PlayerManager.MAX_PLAYERS - PlayerManager.humanCount(room);
  }

  static allReady(room: RoomData): boolean {
    return room.players.filter((p) => !p.isAI).every((p) => p.isReady);
  }

  // ── Display ───────────────────────────────────────────────────────────────

  static formatName(player: RoomPlayer, hostId: string): string {
    if (player.isAI) return player.nickname;
    if (player.id === hostId) return `${player.nickname} (Host)`;
    return player.nickname;
  }

  static getHudSummary(room: RoomData): string {
    const h = PlayerManager.humanCount(room);
    const a = PlayerManager.aiCount(room);
    return `${h} Human${h !== 1 ? "s" : ""} + ${a} AI`;
  }
}
