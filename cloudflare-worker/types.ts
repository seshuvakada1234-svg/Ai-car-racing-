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
  | WsPlayerJoinedPacket
  | WsPlayerLeftPacket
  | WsVehicleUpdatePacket;

export interface WsJoinPacket {
  type: "join";
  roomCode: string;
  playerId: string;
}

export interface WsPlayerJoinedPacket {
  type: "playerJoined";
  playerId: string;
}

export interface WsPlayerLeftPacket {
  type: "playerLeft";
  playerId: string;
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
