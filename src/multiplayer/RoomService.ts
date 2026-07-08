/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, auth } from "../lib/firebase";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
} from "firebase/firestore";
import { RoomState, RoomPlayer, RoomStatus } from "./RoomState";
import { RoomCodeGenerator } from "./RoomCodeGenerator";
import { RoomValidator } from "./RoomValidator";

enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMessage = error instanceof Error ? error.message : String(error);
  const isPermissionError = errMessage.toLowerCase().includes("permission") || errMessage.toLowerCase().includes("denied");
  const isReadOp = operationType === OperationType.GET || operationType === OperationType.LIST;

  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
    },
    operationType,
    path,
  };

  if (isPermissionError || isReadOp) {
    console.warn(`[RoomService Safe-Recovery] Handled ${operationType} error on path "${path}" gracefully without throwing: ${errMessage}`);
    return;
  }

  console.error("Firestore Error details: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export class RoomService {
  /**
   * Generates a completely unique, verified room code and stores the initial setup inside Firestore.
   */
  public static async createRoom(
    hostId: string,
    hostName: string,
    hostPhotoURL: string,
    selectedCar: string,
    mapType = "map1",
    maxPlayers = 3,
  ): Promise<string> {
    try {
      // 1. Enforce active database maintenance for stale items passively
      await this.deleteExpiredRooms();

      // 2. Generate and verify code
      const rawCode = await RoomCodeGenerator.generateUnique();
      const roomCode = rawCode.trim().toUpperCase();

      console.log("Creating room:", roomCode);

      const hostPlayer: RoomPlayer = {
        uid: hostId,
        id: hostId, // compatibility
        playerName: hostName,
        nickname: hostName, // compatibility
        photoURL: hostPhotoURL || "",
        joinedAt: Date.now(),
        ready: true,
        isReady: true, // compatibility
        carId: selectedCar,
        isHost: true,
        isAI: false,
      };

      const expiresAtDate = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

      const roomData: RoomState = {
        roomCode,
        code: roomCode, // compatibility
        id: roomCode, // compatibility
        hostId,
        ownerUid: hostId, // compatibility
        ownerName: hostName, // compatibility
        players: [hostPlayer],
        maxPlayers,
        status: "waiting",
        phase: "waiting", // compatibility
        countdown: 30,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        expiresAt: expiresAtDate,
        mapType,
        mapId: mapType, // compatibility
        selectedCars: { [hostId]: selectedCar },
        selectedCar, // compatibility
        gameState: "lobby",
        currentPlayers: 1,
      };

      const roomRef = doc(db, "rooms", roomCode);
      await setDoc(roomRef, roomData);

      // Support subcollection structure used by legacy real-time loops
      const playerRef = doc(db, "rooms", roomCode, "players", hostId);
      await setDoc(playerRef, hostPlayer);

      return roomCode;
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, "rooms");
      throw e;
    }
  }

  /**
   * Validates room conditions and pushes player info inside players array and subcollection atomic-like.
   */
  public static async joinRoom(
    roomCode: string,
    playerId: string,
    playerName: string,
    playerPhotoURL: string,
    selectedCar: string,
  ): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    if (!cleanCode) throw new Error("Invalid room code");

    console.log("Joining room:", cleanCode);

    const roomRef = doc(db, "rooms", cleanCode);

    try {
      const snap = await getDoc(roomRef);
      const roomExists = snap.exists();
      console.log("Room exists:", roomExists);

      if (!roomExists) {
        throw new Error("Room Closed");
      }

      const room = snap.data() as RoomState;
      console.log("Players:", room.players ? room.players.length : 0);
      console.log("Room status:", room.status || "waiting");

      // Enforce Room validation checks
      RoomValidator.validateRoomToJoin(room);

      const existingIdx = room.players.findIndex((p) => p.uid === playerId);
      let updatedPlayers = [...room.players];

      const newPlayer: RoomPlayer = {
        uid: playerId,
        id: playerId, // compatibility
        playerName,
        nickname: playerName, // compatibility
        photoURL: playerPhotoURL || "",
        joinedAt: Date.now(),
        ready: true,
        isReady: true, // compatibility
        carId: selectedCar,
        isHost: false,
        isAI: false,
      };

      if (existingIdx >= 0) {
        updatedPlayers[existingIdx] = newPlayer;
      } else {
        updatedPlayers.push(newPlayer);
      }

      const updatedSelectedCars = {
        ...room.selectedCars,
        [playerId]: selectedCar,
      };

      await setDoc(
        roomRef,
        {
          players: updatedPlayers,
          selectedCars: updatedSelectedCars,
          currentPlayers: updatedPlayers.length,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      // Build fallback subcollection tracking references
      const playerRef = doc(db, "rooms", cleanCode, "players", playerId);
      await setDoc(playerRef, newPlayer);
    } catch (e: any) {
      const specErrors = [
        "Room Closed",
        "Room Archived",
        "Room Finished",
        "Room Expired",
        "Room Full",
        "Invalid room code",
        "Room expired",
        "Room full",
        "Race already started",
      ];
      if (specErrors.includes(e.message)) {
        throw e;
      }
      handleFirestoreError(e, OperationType.WRITE, `rooms/${cleanCode}`);
      throw e;
    }
  }

  /**
   * Leaves a room. If user was the Host, disband/cancel the room completely.
   */
  public static async leaveRoom(roomCode: string, uid: string): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    if (!cleanCode) return;

    const roomRef = doc(db, "rooms", cleanCode);
    try {
      const snap = await getDoc(roomRef);
      if (!snap.exists()) return;

      const room = snap.data() as RoomState;

      if (room.hostId === uid || room.ownerUid === uid) {
        // Disband room and clean all subdocs
        const subSnap = await getDocs(collection(db, "rooms", cleanCode, "players"));
        for (const plDoc of subSnap.docs) {
          await deleteDoc(doc(db, "rooms", cleanCode, "players", plDoc.id));
        }
        await deleteDoc(roomRef);
      } else {
        const updatedPlayers = room.players.filter((p) => p.uid !== uid);
        const updatedSelectedCars = { ...room.selectedCars };
        delete updatedSelectedCars[uid];

        await setDoc(
          roomRef,
          {
            players: updatedPlayers,
            selectedCars: updatedSelectedCars,
            currentPlayers: updatedPlayers.length,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );

        await deleteDoc(doc(db, "rooms", cleanCode, "players", uid));
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `rooms/${cleanCode}`);
    }
  }

  /**
   * Set status like wait, countdown, racing, finished.
   */
  public static async setRoomStatus(roomCode: string, status: RoomStatus): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    const roomRef = doc(db, "rooms", cleanCode);
    try {
      await updateDoc(roomRef, {
        status,
        phase: status, // compatibility
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `rooms/${cleanCode}`);
    }
  }

  /**
   * Updates host room parameters.
   */
  public static async updateRoomSettings(
    roomCode: string,
    updates: Partial<Pick<RoomState, "mapType" | "mapId" | "selectedCar">>,
  ): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    const roomRef = doc(db, "rooms", cleanCode);
    try {
      const normalizedUpd: any = { ...updates };
      if (updates.mapId) normalizedUpd.mapType = updates.mapId;
      if (updates.mapType) normalizedUpd.mapId = updates.mapType;

      normalizedUpd.updatedAt = serverTimestamp();
      await updateDoc(roomRef, normalizedUpd);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `rooms/${cleanCode}`);
    }
  }

  /**
   * Subscribes to real-time updates of the main room doc.
   */
  public static listenToRoom(
    roomCode: string,
    onUpdate: (room: RoomState | null) => void,
    onError?: (err: any) => void,
  ): Unsubscribe {
    const cleanCode = roomCode.toUpperCase().trim();
    const roomRef = doc(db, "rooms", cleanCode);

    return onSnapshot(
      roomRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as RoomState;
          onUpdate({
            ...data,
            code: cleanCode,
            id: cleanCode,
            ownerUid: data.hostId,
            mapId: data.mapType,
          });
        } else {
          onUpdate(null);
        }
      },
      (err) => {
        if (onError) onError(err);
        handleFirestoreError(err, OperationType.GET, `rooms/${cleanCode}`);
      },
    );
  }

  /**
   * Updates player's real-time physical telemetry
   */
  public static async updatePlayerPosition(
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
    try {
      await updateDoc(playerRef, coords);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `rooms/${cleanCode}/players/${uid}`);
    }
  }

  /**
   * Delete rooms inactive for more than 30 minutes to clean up state.
   */
  public static async deleteExpiredRooms(): Promise<void> {
    try {
      const roomsRef = collection(db, "rooms");
      const snap = await getDocs(roomsRef);
      const now = Date.now();
      const cutoff = 30 * 60 * 1000;

      for (const d of snap.docs) {
        const room = d.data() as RoomState;
        let lastActiveTime = now;
        const timeSource = room.updatedAt || room.createdAt;

        if (timeSource) {
          if (typeof timeSource.toMillis === "function") {
            lastActiveTime = timeSource.toMillis();
          } else if (typeof timeSource.toDate === "function") {
            lastActiveTime = timeSource.toDate().getTime();
          } else if (timeSource.seconds) {
            lastActiveTime = timeSource.seconds * 1000;
          } else if (typeof timeSource === "number") {
            lastActiveTime = timeSource;
          }
        }

        if (now - lastActiveTime > cutoff) {
          console.log(`Passive expired check: Deleting inactive room doc ${d.id}`);
          const playersRef = collection(db, "rooms", d.id, "players");
          const plSnap = await getDocs(playersRef);
          for (const plDoc of plSnap.docs) {
            await deleteDoc(doc(db, "rooms", d.id, "players", plDoc.id));
          }
          await deleteDoc(doc(db, "rooms", d.id));
        }
      }
    } catch (err: any) {
      // Normal players are not authorized to list or delete other rooms.
      // We expect permission-denied errors for standard users and suppress them.
      const isPermissionDenied = err?.code === "permission-denied" || 
                                 (err?.message && err.message.toLowerCase().includes("permission"));
      if (!isPermissionDenied) {
        console.warn("Silent clean expired rooms failed:", err);
      }
    }
  }
}
