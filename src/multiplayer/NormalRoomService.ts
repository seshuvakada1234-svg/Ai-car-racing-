/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, auth } from "../lib/firebase";
import {
  doc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
  getDocs,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { RoomService } from "./RoomService";
import { RoomPlayer, RoomState } from "./RoomState";

export interface NormalPlayer {
  uid: string;
  playerName: string;
  photoURL: string;
  joinedAt: number;
  ready: boolean;
  carId?: string;
  carColor?: string;

  // Track metrics
  position?: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  angle?: number;
  speed?: number;
  isDrifting?: boolean;
  currentLap?: number;
  isFinished?: boolean;
  totalDistanceTraveled?: number;
}

export interface NormalRoom {
  roomCode: string;
  ownerUid: string;
  ownerName: string;
  selectedCar: string;
  mapId: string;
  status: "waiting" | "countdown" | "racing" | "finished" | "archived" | "closed" | "complete";
  maxPlayers: number;
  currentPlayers: number;
  players: string[];
  createdAt: any;
}

export class NormalRoomService {
  /**
   * Generates a completely unique, secure room code and registers the room doc
   */
  static async createRoom(
    ownerUid: string,
    ownerName: string,
    ownerPhotoURL: string,
    selectedCar: string,
    mapId: string,
    maxPlayers = 3,
  ): Promise<string> {
    return RoomService.createRoom(ownerUid, ownerName, ownerPhotoURL, selectedCar, mapId, maxPlayers);
  }

  /**
   * Performs critical safety validations before allowing a user to join this match
   */
  static async joinRoom(code: string, uid: string, playerName: string, photoURL: string): Promise<void> {
    // Read the room selection default car first
    const cleanCode = code.toUpperCase().trim();
    const roomRef = doc(db, "rooms", cleanCode);
    const snap = await getDoc(roomRef);
    let car = "porsche_911_gt3";
    if (snap.exists()) {
      car = (snap.data() as RoomState).selectedCar || car;
    }
    await RoomService.joinRoom(cleanCode, uid, playerName, photoURL || "", car);
  }

  /**
   * Updates host room configurations
   */
  static async updateRoomSettings(
    code: string,
    ownerUid: string,
    updates: Partial<Pick<NormalRoom, "mapId" | "selectedCar">>,
  ): Promise<void> {
    await RoomService.updateRoomSettings(code, updates);
  }

  /**
   * Triggers room status transition (waiting -> countdown -> racing)
   */
  static async setRoomStatus(code: string, status: NormalRoom["status"]): Promise<void> {
    await RoomService.setRoomStatus(code, status);
  }

  /**
   * Leaves or disbands room cleanly
   */
  static async leaveOrCancelRoom(code: string, uid: string): Promise<void> {
    await RoomService.leaveRoom(code, uid);
  }

  /**
   * Delete room and its players subcollection atomically.
   */
  static async deleteRoom(code: string): Promise<void> {
    await RoomService.deleteRoom(code);
  }

  /**
   * Listen to any changes in the main room doc.
   */
  static listenToRoom(code: string, callback: (room: NormalRoom | null) => void) {
    return RoomService.listenToRoom(code, (state) => {
      if (!state) {
        callback(null);
        return;
      }
      callback({
        roomCode: state.roomCode,
        ownerUid: state.hostId,
        ownerName: state.ownerName || "Host",
        selectedCar: state.selectedCar || "porsche_911_gt3",
        mapId: state.mapType,
        status: state.status,
        maxPlayers: state.maxPlayers,
        currentPlayers: state.currentPlayers,
        players: state.players.map((p) => p.uid),
        createdAt: state.createdAt,
      });
    });
  }

  /**
   * Listen to changes in the players subcollection.
   */
  static listenToPlayers(code: string, callback: (players: NormalPlayer[]) => void) {
    const cleanCode = code.toUpperCase().trim();
    const playersRef = collection(db, "rooms", cleanCode, "players");
    return onSnapshot(playersRef, (snap) => {
      const list: NormalPlayer[] = [];
      snap.forEach((doc) => {
        const d = doc.data();
        list.push({
          uid: d.uid || doc.id,
          playerName: d.playerName || d.nickname || "Driver",
          photoURL: d.photoURL || "",
          joinedAt: d.joinedAt || Date.now(),
          ready: d.ready ?? d.isReady ?? true,
          carId: d.carId || "porsche_911_gt3",
          carColor: d.carColor,
          position: d.position,
          velocity: d.velocity,
          angle: d.angle,
          speed: d.speed,
          isDrifting: d.isDrifting,
          currentLap: d.currentLap,
          isFinished: d.isFinished,
          totalDistanceTraveled: d.totalDistanceTraveled,
        });
      });
      list.sort((a, b) => a.joinedAt - b.joinedAt);
      callback(list);
    });
  }

  /**
   * Updates player's real-time physical telemetry
   */
  static async updatePlayerPosition(
    code: string,
    uid: string,
    coords: {
      position: { x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
      angle: number;
      speed: number;
      isDrifting: boolean;
      currentLap: number;
      isFinished: boolean;
      totalDistanceTraveled: number;
    },
  ): Promise<void> {
    const cleanCode = code.toUpperCase().trim();
    const playerRef = doc(db, "rooms", cleanCode, "players", uid);
    await updateDoc(playerRef, coords);
  }
}
