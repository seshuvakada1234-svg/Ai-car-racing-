/**
 * Cloudflare Worker Environment bindings
 */
export interface Env {
  // Durable Object Namespace binding
  VEHICLE_ROOM: DurableObjectNamespace;
}

/**
 * Represent standard 3D coordinates
 */
export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Represent 3D rotation orientation using Quaternions
 */
export interface QuaternionD {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * WebSocket incoming and outgoing packet definitions
 */
export type WsPacket =
  | WsJoinPacket
  | WsPlayerListPacket
  | WsPlayerJoinedPacket
  | WsPlayerJoinAliasPacket
  | WsPlayerLeftPacket
  | WsPlayerLeaveAliasPacket
  | WsStartRacePacket
  | WsCountdownPacket
  | WsRaceStartPacket
  | WsRaceStartAliasPacket
  | WsVehicleUpdatePacket
  | WsVehicleUpdateAliasPacket;

export interface WsJoinPacket {
  type: "join";
  roomCode: string;
  playerId: string;
}

export interface WsPlayerListPacket {
  type: "player_list";
  players: string[];
  latestStates: Record<string, any>;
}

export interface WsPlayerJoinedPacket {
  type: "playerJoined";
  playerId: string;
}

export interface WsPlayerJoinAliasPacket {
  type: "player_join";
  playerId: string;
}

export interface WsPlayerLeftPacket {
  type: "playerLeft";
  playerId: string;
}

export interface WsPlayerLeaveAliasPacket {
  type: "player_leave";
  playerId: string;
}

export interface WsStartRacePacket {
  type: "start_race";
}

export interface WsCountdownPacket {
  type: "countdown";
}

export interface WsRaceStartPacket {
  type: "race_start";
  startTime: number;
}

export interface WsRaceStartAliasPacket {
  type: "raceStart";
  startTime: number;
}

export interface WsVehicleUpdatePacket {
  type: "vehicleUpdate";
  roomCode: string;
  playerId: string;
  position: Vector3D;
  rotation: QuaternionD;
  speed: number;
  steering: number;
  wheelRotation: number;
  nitro: boolean;
  drift: boolean;
  lap?: number;
  checkpoint?: number;
  totalDistanceTraveled?: number;
  isFinished?: boolean;
  timestamp: number;
}

export interface WsVehicleUpdateAliasPacket extends Omit<WsVehicleUpdatePacket, "type"> {
  type: "vehicle_update";
}
