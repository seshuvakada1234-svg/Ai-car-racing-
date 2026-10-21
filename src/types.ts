/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Difficulty = "easy" | "medium" | "hard";

export type CameraMode =
  | "CHASE"
  | "COCKPIT"
  | "CINEMATIC"
  // AAA arcade racing modes (NFS Unbound / Heat / Most Wanted inspired)
  | "FAR_CHASE"
  | "CLOSE_CHASE"
  | "HOOD";

export interface GamePhysicsState {
  position: import("three").Vector3;
  direction: import("three").Vector3;
  speed: number;
  crashIntensity: number;
}

export interface ControlsState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  nitro: boolean;
  handbrake?: boolean;
  steerValue?: number; // -1.0 to 1.0 steering wheel value
  gear?: "P" | "R" | "N" | "D";
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface CarState {
  id: string; // 'player' or AI names
  name: string;
  isAI: boolean;
  color: string;
  carId?: string; // Player-selected car ID (e.g., 'ferrari', 'bugatti', 'porsche')

  // Physics state
  position: Vector3D;
  velocity: Vector3D;
  speed: number; // in km/h or relative units
  angle: number; // facing heading angle (in radians)
  quaternion?: Vector3D & { w: number }; // Optional orientation from the vehicle relay
  angularVelocity: number;
  steerValue?: number; // Smoothed steering value for return force and analog dampening
  driftFactor: number;
  isDrifting: boolean;

  // Game state
  currentLap: number;
  currentCheckpointIndex: number;
  distanceToNextCheckpoint: number;
  racePosition: number;
  totalDistanceTraveled: number;
  isFinished: boolean;
  finishTime?: number; // Race clock seconds when this car crossed Finish after 3 laps

  lastActiveTime: number; // For stuck recovery

  // Nitro resource
  nitroCharged: number; // 0 to 100
  isNitroActive: boolean;

  // State attributes
  difficulty?: Difficulty;
  aiTargetNode: number;
  aiSpeedFactor: number;
  aiAggression: number;
  stuckTimer: number;
  lastRecoveryTime?: number;
  recoveryCount?: number;
  floatTimer?: number;
  lastValidY?: number;

  // Control & Pipeline State
  throttle?: number;
  brake?: number;
  steering?: number;
  gear?: "P" | "R" | "N" | "D";
  awake?: boolean;
  mass?: number;
  engineRunning?: boolean;
}

export interface Checkpoint {
  position: Vector3D;
  direction: Vector3D;
  width: number;
  index: number;
}

export interface TrackNode {
  position: { x: number; y: number; z: number };
  width: number;
  type?: "normal" | "tunnel" | "bridge" | "hairpin" | "straight" | "jump";
}

export interface GameSettings {
  playerName: string;
  difficulty: Difficulty;
  carColor: string;
  selectedCar: "ferrari" | "bugatti" | "porsche";
  selectedMap?: "map1" | "map2";
}

export type GamePhase = "menu" | "countdown" | "racing" | "completed";

export interface LapTime {
  lap: number;
  time: number; // in seconds
}
