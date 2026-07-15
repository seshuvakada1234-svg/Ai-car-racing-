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
  name?: string;
  playerName: string;
  photoURL: string;
  joinedAt: number;
  ready: boolean;
  selectedCar?: string;
  carId?: string;
  carColor?: string;

  // Map download fields
  mapDownloaded?: boolean;
  mapReady?: boolean;
  downloadProgress?: number;
  downloadedMB?: number;
  totalMB?: number;

  // Car loading/validation fields
  carReady?: boolean;
  carProgress?: number;
  glbParsing?: boolean;
  vehicleInitialized?: boolean;
  sceneReady?: boolean;

  // Track metrics
  position?: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  angle?: number;
  rotation?: number;
  speed?: number;
  steering?: number;
  steerValue?: number;
  wheelRotation?: number;
  nitro?: boolean;
  isNitroActive?: boolean;
  drift?: boolean;
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
  // Enhanced metadata fields
  roomName?: string;
  hostId?: string;
  hostName?: string;
  hostPhoto?: string;
  hostCar?: string;
  hostMap?: string;
  laps?: number;
  weather?: string;
  selectedCarObj?: {
    id: string;
    name: string;
    manufacturer: string;
    class: string;
    topSpeed: number;
    acceleration: string;
    handling: number;
    drivetrain: string;
    color: string;
    thumbnail: string;
  };
  selectedMapObj?: {
    id: string;
    name: string;
    preview: string;
    difficulty: string;
    trackLength: string;
    laps: number;
    weather: string;
    environment: string;
  };
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
        selectedCar: typeof state.selectedCar === "object" && state.selectedCar ? (state.selectedCar as any).id : (state.selectedCar || "porsche_911_gt3"),
        mapId: typeof state.selectedMap === "object" && state.selectedMap ? (state.selectedMap as any).id : (state.mapType || "map1"),
        status: state.status,
        maxPlayers: state.maxPlayers,
        currentPlayers: state.currentPlayers,
        players: state.players.map((p) => p.uid),
        createdAt: state.createdAt,
        roomName: (state as any).roomName || `${state.ownerName || "Host"}'s Arena`,
        hostId: state.hostId,
        hostName: state.ownerName || (state as any).hostName || "Host",
        hostPhoto: (state as any).hostPhoto || "",
        hostCar: (state as any).hostCar || (typeof state.selectedCar === "object" && state.selectedCar ? (state.selectedCar as any).id : (state.selectedCar || "ferrari")),
        hostMap: (state as any).hostMap || (typeof state.selectedMap === "object" && state.selectedMap ? (state.selectedMap as any).id : (state.mapType || "map1")),
        laps: (state as any).laps || (typeof state.selectedMap === "object" && state.selectedMap ? (state.selectedMap as any).laps : 3),
        weather: (state as any).weather || (typeof state.selectedMap === "object" && state.selectedMap ? (state.selectedMap as any).weather : "Clear"),
        selectedCarObj: (state as any).selectedCar && typeof (state as any).selectedCar === "object" ? (state as any).selectedCar : null,
        selectedMapObj: (state as any).selectedMap && typeof (state as any).selectedMap === "object" ? (state as any).selectedMap : null,
      });
    });
  }

  /**
   * Updates a player's ready status in Firestore
   */
  static async toggleReady(code: string, uid: string, isReady: boolean): Promise<void> {
    await RoomService.toggleReady(code, uid, isReady);
  }

  /**
   * Updates player's map download status in Firestore
   */
  static async updatePlayerDownloadStatus(
    code: string,
    uid: string,
    mapReady: boolean,
    progress: number,
    downloadedMB: number,
    totalMB: number
  ): Promise<void> {
    await RoomService.updatePlayerDownloadStatus(code, uid, mapReady, progress, downloadedMB, totalMB);
  }

  /**
   * Updates player's precise multi-stage loading status in Firestore
   */
  static async updatePlayerLoadingStatus(
    code: string,
    uid: string,
    status: {
      mapReady?: boolean;
      mapProgress?: number;
      carReady?: boolean;
      carProgress?: number;
      glbParsing?: boolean;
      vehicleInitialized?: boolean;
      ready?: boolean;
      sceneReady?: boolean;
    }
  ): Promise<void> {
    await RoomService.updatePlayerLoadingStatus(code, uid, status);
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

        // Print RECEIVE log on every incoming packet arrival if it contains active coordinates
        const hasValidCoords = d.position && 
                               typeof d.position === "object" && 
                               typeof d.position.x === "number" && 
                               typeof d.position.y === "number" && 
                               typeof d.position.z === "number";
        if (hasValidCoords) {
          console.log(
            `[RECEIVE]\n` +
            `playerId: ${doc.id}\n` +
            `position: ${JSON.stringify(d.position)}\n` +
            `rotation: ${d.angle ?? d.rotation ?? 0}\n` +
            `speed: ${d.speed ?? 0}\n` +
            `timestamp: ${d.timestamp || Date.now()}`
          );
        }

        list.push({
          uid: d.uid || doc.id,
          name: d.name || d.playerName || d.nickname || "Driver",
          playerName: d.playerName || d.nickname || "Driver",
          photoURL: d.photoURL || "",
          joinedAt: d.joinedAt || Date.now(),
          ready: d.ready ?? d.isReady ?? true,
          selectedCar: d.selectedCar || d.carId || "porsche_911_gt3",
          carId: d.carId || "porsche_911_gt3",
          carColor: d.carColor,
          mapDownloaded: d.mapDownloaded ?? d.mapReady ?? false,
          mapReady: d.mapReady,
          sceneReady: d.sceneReady ?? false,
          downloadProgress: d.downloadProgress,
          downloadedMB: d.downloadedMB,
          totalMB: d.totalMB,
          position: d.position,
          velocity: d.velocity,
          angle: d.angle,
          rotation: d.rotation,
          speed: d.speed,
          steering: d.steering,
          steerValue: d.steerValue,
          wheelRotation: d.wheelRotation,
          nitro: d.nitro,
          isNitroActive: d.isNitroActive,
          drift: d.drift,
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
