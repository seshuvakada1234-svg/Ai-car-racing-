import * as THREE from "three";
import type { CarState } from "../types";
import type { TrackGeometryHelper } from "../utils/track";
import type { RoomData } from "./RoomManager";

export interface GridSpawn {
  position: THREE.Vector3;
  headingY: number;
}

export function buildMultiplayerLineup(
  room: RoomData, playerId: string, track: TrackGeometryHelper,
  gridSpawns?: GridSpawn[], savedPlayers: ReadonlyMap<string, any> = new Map(),
): CarState[] {
  const ids = room.players.map((p) => p.uid || p.id);
  if (!playerId || !ids.includes(playerId)) throw new Error("The signed-in player has not joined this room. Join through the lobby first.");
  if (new Set(ids).size !== ids.length || ids.some((id) => !id)) throw new Error("Room contains invalid or duplicate player IDs");
  const players = [...room.players].sort((a, b) => {
    const aId = a.uid || a.id;
    const bId = b.uid || b.id;
    if (aId === room.hostId && bId !== room.hostId) return -1;
    if (bId === room.hostId && aId !== room.hostId) return 1;
    // Firebase UIDs are case-sensitive; use ordinal ordering, not browser locale.
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
  const length = track.curve.getLength();
  if (!Number.isFinite(length) || length <= 0) throw new Error("Cannot spawn cars: the track curve has no valid length");
  if (track.mapType === "racing2" && (!gridSpawns || gridSpawns.length < players.length)) {
    throw new Error(`Cannot spawn ${players.length} players: only ${gridSpawns?.length || 0} road-verified GLB grid slots are available`);
  }

  return players.map((player, index) => {
    const uid = player.uid || player.id;
    const progress = ((1 - (15 + index * 8) / length) % 1 + 1) % 1;
    const tangent = track.curve.getTangentAt(progress).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const base = track.curve.getPointAt(progress).addScaledVector(normal, index % 2 === 0 ? -2.5 : 2.5);
    const grid = gridSpawns?.[index];
    const spawn = grid ? grid.position : base.clone().add(new THREE.Vector3(0, 0.38, 0));
    const saved = savedPlayers.get(uid) || player;
    const hasSavedState = !!(room.raceStarted === true && saved.position &&
      [saved.position.x, saved.position.y, saved.position.z].every(Number.isFinite));
    const position = hasSavedState ? { ...saved.position } : { x: spawn.x, y: spawn.y, z: spawn.z };
    const angle = hasSavedState && Number.isFinite(saved.angle) ? saved.angle : grid?.headingY ?? Math.atan2(tangent.x, tangent.z);
    if (![position.x, position.y, position.z, angle].every(Number.isFinite)) {
      throw new Error(`Invalid spawn transform for player ${uid} at grid slot ${index + 1}`);
    }
    const rawCar = typeof player.carId === "string" ? player.carId.toLowerCase() : "ferrari";
    const savedNumber = (key: string, fallback: number) => hasSavedState && Number.isFinite(saved[key]) ? saved[key] : fallback;
    return {
      id: uid === playerId ? "player" : player.isAI ? uid : `remote_${uid}`,
      name: player.playerName || player.nickname || player.name || "Driver",
      isAI: !!player.isAI && room.hostId === playerId,
      color: player.carColor || "#0062ff",
      carId: rawCar.includes("porsche") ? "porsche" : rawCar.includes("bugatti") ? "bugatti" : "ferrari",
      position,
      velocity: hasSavedState && saved.velocity && [saved.velocity.x, saved.velocity.y, saved.velocity.z].every(Number.isFinite)
        ? { ...saved.velocity } : { x: 0, y: 0, z: 0 },
      angle,
      speed: savedNumber("speed", 0),
      angularVelocity: 0,
      driftFactor: 0,
      isDrifting: hasSavedState && !!saved.isDrifting,
      currentLap: savedNumber("currentLap", 1),
      currentCheckpointIndex: savedNumber("currentCheckpointIndex", 0),
      distanceToNextCheckpoint: 999,
      racePosition: index + 1,
      totalDistanceTraveled: savedNumber("totalDistanceTraveled", -index * 8.5),
      isFinished: hasSavedState && !!saved.isFinished,
      lastActiveTime: Date.now(),
      nitroCharged: 60,
      isNitroActive: false,
      stuckTimer: 0,
      aiTargetNode: 0,
      aiSpeedFactor: 1,
      aiAggression: room.difficulty === "easy" ? 0.45 : room.difficulty === "hard" ? 0.95 : 0.72,
      throttle: 0, brake: 0, steering: 0, gear: "D", awake: true, mass: 1450, engineRunning: true, steerValue: 0,
    };
  });
}
