import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TrackGeometryHelper } from "../utils/track";
import { GamePhysicsService } from "../physics/GamePhysics";
import { buildMultiplayerLineup } from "./raceInitialization";
import type { RoomData } from "./RoomManager";

const room: RoomData = {
  roomCode: "ABC123", hostId: "host", map: "race2map", difficulty: "medium", laps: 3, weather: "clear",
  status: "racing", countdown: 0, createdAt: 1, maxPlayers: 3,
  players: ["guest", "host"].map((id) => ({ id, nickname: id, carId: "porsche", isHost: id === "host", isReady: false, isAI: false, joinedAt: 1 })),
};
const grid = [
  { position: new THREE.Vector3(10, 2.38, 20), headingY: 0.5 },
  { position: new THREE.Vector3(15, 2.38, 20), headingY: 0.5 },
];

describe("multiplayer physics and grid initialization", () => {
  it("assigns the same authored grid slot to each UID on every client", () => {
    const track = new TrackGeometryHelper("race2map");
    const host = buildMultiplayerLineup(room, "host", track, grid);
    const guest = buildMultiplayerLineup({ ...room, players: [...room.players].reverse() }, "guest", track, grid);
    expect(host.find((car) => car.id === "player")?.position).toEqual(guest.find((car) => car.id === "remote_host")?.position);
    expect(host.find((car) => car.id === "remote_guest")?.position).toEqual(guest.find((car) => car.id === "player")?.position);
    expect(host.map((car) => car.racePosition)).toEqual([1, 2]);
    expect(host.every((car) => !car.isAI)).toBe(true);
    expect(new GamePhysicsService(track).trackHelper).toBe(track);
  });

  it("refuses to spawn on the temporary track before GLB grid markers are ready", () => {
    const track = new TrackGeometryHelper("race2map");
    expect(() => buildMultiplayerLineup(room, "host", track)).toThrow("road-verified GLB grid slots");
    expect(() => buildMultiplayerLineup(room, "unknown", track, grid)).toThrow("has not joined");
  });

  it("restores genuine race telemetry on reconnect, while new races start on the grid", () => {
    const track = new TrackGeometryHelper("race2map");
    const saved = new Map([["host", { position: { x: 100, y: 4, z: 250 }, currentLap: 2, currentCheckpointIndex: 8, angle: 1 }]]);
    const restored = buildMultiplayerLineup({ ...room, raceStarted: true }, "host", track, grid, saved);
    expect(restored[0]).toMatchObject({ position: { x: 100, y: 4, z: 250 }, currentLap: 2, currentCheckpointIndex: 8 });
    expect(buildMultiplayerLineup(room, "host", track, grid, saved)[0].position.x).toBe(10);
  });
});
