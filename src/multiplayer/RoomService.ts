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
  runTransaction,
  query,
  where,
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

      // 2. Search for an existing waiting room owned by this host to reuse
      const roomsRef = collection(db, "rooms");
      const q = query(roomsRef, where("hostId", "==", hostId), where("status", "==", "waiting"));
      const querySnapshot = await getDocs(q);

      let roomCode = "";

      if (!querySnapshot.empty) {
        // Reuse the first found room code
        roomCode = querySnapshot.docs[0].id;
        console.log("Reusing existing waiting room:", roomCode);

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

        // Clear any other players from the players subcollection to avoid stale joins
        const playersCollectionRef = collection(db, "rooms", roomCode, "players");
        const playersSnap = await getDocs(playersCollectionRef);
        for (const plDoc of playersSnap.docs) {
          if (plDoc.id !== hostId) {
            await deleteDoc(doc(db, "rooms", roomCode, "players", plDoc.id));
          }
        }

        // Set/overwrite host player in subcollection
        const hostPlayerRef = doc(db, "rooms", roomCode, "players", hostId);
        await setDoc(hostPlayerRef, hostPlayer);

        // Update the main room document
        const roomRef = doc(db, "rooms", roomCode);
        await updateDoc(roomRef, {
          hostId,
          hostName,
          ownerUid: hostId,
          ownerName: hostName,
          players: [hostPlayer],
          maxPlayers,
          status: "waiting",
          phase: "waiting",
          countdown: 30,
          updatedAt: serverTimestamp(),
          expiresAt: expiresAtDate,
          mapType,
          mapId: mapType,
          selectedCars: { [hostId]: selectedCar },
          selectedCar,
          gameState: "lobby",
          currentPlayers: 1,
        });

      } else {
        // Create a new room as usual
        const rawCode = await RoomCodeGenerator.generateUnique();
        roomCode = rawCode.trim().toUpperCase();

        console.log("Creating new room:", roomCode);

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
          hostName,
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
      }

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
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        
        // 1. Check if the room exists
        if (!snap.exists()) {
          throw new Error("Room Closed");
        }

        const room = snap.data() as RoomState;

        // 2. Check if the room is waiting
        if (room.status !== "waiting" && room.phase !== "waiting") {
          throw new Error("Race already started");
        }

        const players = room.players || [];
        const maxPlayers = room.maxPlayers || 3;
        const existingIdx = players.findIndex((p) => p.uid === playerId);

        // 3. Check if the room is not full (skip if player is already registered and rejoining)
        if (existingIdx < 0 && players.length >= maxPlayers) {
          throw new Error("Room Full");
        }

        // Validate other expiration, archiving conditions
        RoomValidator.validateRoomToJoin(room);

        let updatedPlayers = [...players];

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
          isHost: room.hostId === playerId,
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

        // Update room doc
        transaction.update(roomRef, {
          players: updatedPlayers,
          selectedCars: updatedSelectedCars,
          currentPlayers: updatedPlayers.length,
          updatedAt: serverTimestamp(),
        });

        // Set player subcollection
        const playerRef = doc(db, "rooms", cleanCode, "players", playerId);
        transaction.set(playerRef, newPlayer);
      });
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
   * Leaves a room. If user was the Host and leaves before the race starts, delete the room automatically.
   */
  public static async leaveRoom(roomCode: string, uid: string): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    if (!cleanCode) return;

    const roomRef = doc(db, "rooms", cleanCode);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) return;

        const room = snap.data() as RoomState;
        const players = room.players || [];
        
        const isPlayerIn = players.some((p) => p.uid === uid);
        if (!isPlayerIn) return;

        const updatedPlayers = players.filter((p) => p.uid !== uid);
        const updatedSelectedCars = { ...room.selectedCars };
        delete updatedSelectedCars[uid];

        const beforeStart = room.status === "waiting" || room.status === "countdown" || room.status === "starting" || room.phase === "waiting";

        if (room.hostId === uid || room.ownerUid === uid) {
          if (beforeStart) {
            // Delete the room automatically as required by Requirement 6
            transaction.delete(roomRef);
            for (const p of players) {
              const pRef = doc(db, "rooms", cleanCode, "players", p.uid);
              transaction.delete(pRef);
            }
          } else {
            // If the race already started, transfer host if there are remaining players
            if (updatedPlayers.length > 0) {
              const newHost = updatedPlayers[0];
              newHost.isHost = true;
              newHost.ready = true;
              if (newHost.isReady !== undefined) newHost.isReady = true;

              const finalPlayers = updatedPlayers.map((p) => p.uid === newHost.uid ? newHost : p);

              transaction.update(roomRef, {
                hostId: newHost.uid,
                ownerUid: newHost.uid, // compatibility
                hostName: newHost.playerName,
                ownerName: newHost.playerName, // compatibility
                players: finalPlayers,
                selectedCars: updatedSelectedCars,
                currentPlayers: finalPlayers.length,
                updatedAt: serverTimestamp(),
              });

              const newHostRef = doc(db, "rooms", cleanCode, "players", newHost.uid);
              transaction.update(newHostRef, { isHost: true, ready: true, isReady: true });
            } else {
              transaction.delete(roomRef);
            }
          }
        } else {
          // Normal player leaving
          transaction.update(roomRef, {
            players: updatedPlayers,
            selectedCars: updatedSelectedCars,
            currentPlayers: updatedPlayers.length,
            updatedAt: serverTimestamp(),
          });
        }

        // Always delete the leaving player's doc in subcollection
        const leavingPlayerRef = doc(db, "rooms", cleanCode, "players", uid);
        transaction.delete(leavingPlayerRef);
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `rooms/${cleanCode}`);
    }
  }

  /**
   * Delete room and its players subcollection atomically.
   */
  public static async deleteRoom(roomCode: string): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    if (!cleanCode) return;
    const roomRef = doc(db, "rooms", cleanCode);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) return;

        const room = snap.data() as RoomState;
        const players = room.players || [];

        transaction.delete(roomRef);
        for (const p of players) {
          const pRef = doc(db, "rooms", cleanCode, "players", p.uid);
          transaction.delete(pRef);
        }
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `rooms/${cleanCode}`);
    }
  }

  /**
   * Set status like wait, countdown, racing, finished.
   */
  public static async setRoomStatus(roomCode: string, status: RoomStatus): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    const roomRef = doc(db, "rooms", cleanCode);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) {
          throw new Error("Room not found");
        }
        transaction.update(roomRef, {
          status,
          phase: status, // compatibility
          updatedAt: serverTimestamp(),
        });
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `rooms/${cleanCode}`);
      throw e;
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
      if (!auth.currentUser) return;
      const roomsRef = collection(db, "rooms");
      // Query only rooms owned by this user to avoid listing others and triggering permission-denied
      const q = query(roomsRef, where("hostId", "==", auth.currentUser.uid));
      const snap = await getDocs(q);
      const now = Date.now();
      const cutoff = 30 * 60 * 1000; // 30 minutes

      for (const d of snap.docs) {
        const room = d.data() as RoomState;
        
        // Skip deleting rooms that are starting or racing (active game sessions)
        if (room.status === "starting" || room.status === "racing") {
          continue;
        }

        let lastActiveTime = 0;
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

        // If lastActiveTime couldn't be parsed, fallback to expiresAt or now
        if (lastActiveTime === 0) {
          if (room.expiresAt) {
            const expDate = room.expiresAt instanceof Date ? room.expiresAt : (typeof room.expiresAt.toDate === "function" ? room.expiresAt.toDate() : new Date(room.expiresAt));
            lastActiveTime = expDate.getTime() - cutoff;
          } else {
            lastActiveTime = now;
          }
        }

        if (now - lastActiveTime > cutoff) {
          console.log(`Passive expired check: Deleting expired room doc ${d.id}`);
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
