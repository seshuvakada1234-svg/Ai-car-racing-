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
  console.error(`[RoomService] ${operationType} failed at ${path}:`, error);
  // Listener errors are delivered through onError, never disguised as a deleted room.
  if (operationType === OperationType.GET || operationType === OperationType.LIST) return;
  throw error instanceof Error ? error : new Error(String(error));
}

function normalizeRoom(data: any, code: string): RoomState {
  const selectedCar = typeof data.selectedCar === "object" ? data.selectedCar?.id : data.selectedCar;
  const mapId = data.selectedMap?.id || data.mapType || data.mapId || "map1";
  return {
    ...data,
    roomCode: code,
    code,
    id: code,
    hostId: data.hostId || data.ownerUid,
    ownerUid: data.hostId || data.ownerUid,
    selectedCar: selectedCar || "ferrari",
    selectedCarObj: typeof data.selectedCar === "object" ? data.selectedCar : data.selectedCarObj,
    mapType: mapId,
    mapId,
    status: data.status || data.phase || "waiting",
    players: Array.isArray(data.players) ? data.players : [],
  };
}

export function getSelectedCarObj(carId: string) {
  const id = carId || "ferrari";
  if (id === "bugatti") {
    return {
      id: "bugatti",
      name: "Bugatti Chiron",
      manufacturer: "Bugatti",
      class: "HYPER CLASS",
      topSpeed: 420,
      acceleration: "2.4s",
      handling: 80,
      drivetrain: "AWD",
      color: "#00ccff",
      thumbnail: "/assets/images/bugatti_garage_1781251768295.jpg"
    };
  } else if (id === "porsche") {
    return {
      id: "porsche",
      name: "Porsche 911 GT3",
      manufacturer: "Porsche",
      class: "A CLASS",
      topSpeed: 320,
      acceleration: "3.2s",
      handling: 98,
      drivetrain: "RWD",
      color: "#00ff3c",
      thumbnail: "/assets/images/bugatti_garage_1781251768295.jpg"
    };
  } else {
    return {
      id: "ferrari",
      name: "Ferrari Purosangue",
      manufacturer: "Ferrari",
      class: "A CLASS",
      topSpeed: 310,
      acceleration: "3.3s",
      handling: 90,
      drivetrain: "AWD",
      color: "#ff003c",
      thumbnail: "/assets/images/bugatti_garage_1781251768295.jpg"
    };
  }
}

export function getSelectedMapObj(mapId: string, lapsValue = 3) {
  return {
    id: "race2map",
    name: "Race 2",
    preview: "/maps/race2/preview.jpg",
    laps: 3,
    difficulty: "Medium",
    trackLength: "...",
    weather: "Clear"
  };
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
    mapType = "race2map",
    maxPlayers = 3,
  ): Promise<string> {
    try {
      // 1. Enforce active database maintenance for stale items passively
      await this.deleteExpiredRooms();

      // 2. Create a new room with a brand-new unique room code
      const rawCode = await RoomCodeGenerator.generateUnique();
      const roomCode = rawCode.trim().toUpperCase();

      console.log("Creating new unique room:", roomCode);

      const hostPlayer: RoomPlayer = {
        uid: hostId,
        id: hostId, // compatibility
        name: hostName,
        playerName: hostName,
        nickname: hostName, // compatibility
        photoURL: hostPhotoURL || "",
        joinedAt: Date.now(),
        ready: false,
        isReady: false, // compatibility
        selectedCar: selectedCar,
        carId: selectedCar,
        mapDownloaded: false,
        mapReady: false,
        isHost: true,
        isAI: false,
      };

      const expiresAtDate = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

      const carObj = getSelectedCarObj(selectedCar);
      const mapObj = {
        id: "race2map",
        name: "Race 2",
        preview: "/maps/race2/preview.jpg",
        laps: 3,
        difficulty: "Medium",
        trackLength: "...",
        weather: "Clear"
      };

      const roomData: any = {
        roomCode,
        code: roomCode, // compatibility
        id: roomCode, // compatibility
        hostId,
        hostName,
        hostPhoto: hostPhotoURL || "",
        roomName: `${hostName}'s Arena`,
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
        mapType: "race2map",
        mapId: "race2map", // compatibility
        selectedCars: { [hostId]: selectedCar },
        selectedCar: carObj,
        selectedMap: mapObj,
        gameState: "lobby",
        currentPlayers: 1,
      };

      const roomRef = doc(db, "rooms", roomCode);
      const playerRef = doc(db, "rooms", roomCode, "players", hostId);
      // Publish membership and the room together. A listener must never observe
      // a created room without its host player document.
      await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(roomRef);
        if (existing.exists()) throw new Error("Room code already exists. Please retry.");
        transaction.set(roomRef, roomData);
        transaction.set(playerRef, hostPlayer);
      });

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
    if (!RoomValidator.isValidCode(cleanCode)) throw new Error("Invalid room code");

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

        const players = room.players || [];
        const maxPlayers = room.maxPlayers || 3;
        const existingIdx = players.findIndex((p) => (p.uid || p.id) === playerId);

        // 2. Check if the room is waiting (skip if player is already registered and rejoining)
        if (existingIdx < 0 && room.status !== "waiting" && room.phase !== "waiting") {
          throw new Error("Race already started");
        }

        // 3. Check if the room is not full (skip if player is already registered and rejoining)
        if (existingIdx < 0 && players.length >= maxPlayers) {
          throw new Error("Room Full");
        }

        // Validate other expiration, archiving conditions
        RoomValidator.validateRoomToJoin(room, playerId);

        // Membership is idempotent. A reload must preserve grid order, loading
        // readiness, the chosen car, and saved race progress.
        const playerRef = doc(db, "rooms", cleanCode, "players", playerId);
        if (existingIdx >= 0) {
          const playerSnap = await transaction.get(playerRef);
          if (!playerSnap.exists()) transaction.set(playerRef, players[existingIdx]);
          return;
        }

        let updatedPlayers = [...players];

        const isHostPlayer = room.hostId === playerId || room.ownerUid === playerId;
        const newPlayer: RoomPlayer = {
          uid: playerId,
          id: playerId, // compatibility
          name: playerName,
          playerName,
          nickname: playerName, // compatibility
          photoURL: playerPhotoURL || "",
          joinedAt: Date.now(),
          ready: false,
          isReady: false, // compatibility
          selectedCar: selectedCar,
          carId: selectedCar,
          mapDownloaded: false,
          mapReady: false,
          isHost: isHostPlayer,
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
   * Explicit leave/kick only. Network loss, socket close, route changes and
   * listener cleanup must never call this destructive membership operation.
   */
  public static async leaveRoom(roomCode: string, uid: string): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    if (!cleanCode || !uid) return;

    const roomRef = doc(db, "rooms", cleanCode);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) return;

        const room = snap.data() as RoomState;
        const players = room.players || [];
        
        const isPlayerIn = players.some((p) => (p.uid || p.id) === uid);
        if (!isPlayerIn) return;

        const updatedPlayers = players.filter((p) => (p.uid || p.id) !== uid);
        const updatedSelectedCars = { ...room.selectedCars };
        delete updatedSelectedCars[uid];

        const originalCount = players.length;

        // Rule 1: If the room has ONLY 2 players (Host + Player2) or less:
        // If either player leaves:
        // - Remove that player from Firestore.
        // - Delete the room document.
        // - Stop all room listeners.
        // - Return the remaining player to the Garage.
        // - Show: "The room has been closed because there are no opponents remaining."
        if (originalCount <= 2) {
          transaction.delete(roomRef);
          for (const p of players) {
            const pRef = doc(db, "rooms", cleanCode, "players", p.uid || p.id!);
            transaction.delete(pRef);
          }
          return;
        }

        // Rule 2 & 3: If the room has 3 or more players:
        // - Remove only the leaving player from Firestore.
        // - Keep the room alive.
        // - Update Firestore immediately (players[], currentPlayers, hostId, updatedAt).
        // - If the HOST leaves, choose the oldest remaining player (first player who joined) as the new host.
        //   Update: hostId = newHostId, show "You are now the Room Host" (handled in client component on snapshot update).
        let nextHostId = room.hostId;
        let nextHostName = room.hostName || room.ownerName || "Host";

        if (room.hostId === uid || room.ownerUid === uid) {
          // Host is leaving! Transfer host role to the oldest remaining player.
          const sortedRemaining = [...updatedPlayers].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
          if (sortedRemaining.length > 0) {
            const newHost = sortedRemaining[0];
            nextHostId = newHost.uid || newHost.id!;
            nextHostName = newHost.playerName || newHost.nickname || newHost.name || "Host";

            // Update the new host's details in players array to have isHost = true
            const finalPlayers = updatedPlayers.map((p) => {
              if ((p.uid || p.id) === nextHostId) {
                return { ...p, isHost: true };
              }
              return p;
            });

            transaction.update(roomRef, {
              hostId: nextHostId,
              ownerUid: nextHostId, // compatibility
              hostName: nextHostName,
              ownerName: nextHostName, // compatibility
              players: finalPlayers,
              selectedCars: updatedSelectedCars,
              currentPlayers: finalPlayers.length,
              updatedAt: serverTimestamp(),
            });

            // Also update the subcollection player document for the new host
            const newHostRef = doc(db, "rooms", cleanCode, "players", nextHostId);
            transaction.set(newHostRef, { isHost: true }, { merge: true });
          } else {
            // No players remaining, delete room
            transaction.delete(roomRef);
          }
        } else {
          // A non-host player is leaving!
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
          const pRef = doc(db, "rooms", cleanCode, "players", p.uid || p.id!);
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
          ...(status === "racing" && ["waiting", "starting"].includes(snap.data().status)
            ? { raceStarted: false, countdownStartTime: null } : {}),
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
    updates: Partial<Pick<RoomState, "mapType" | "mapId" | "selectedCar"> & { laps?: number; weather?: string; environment?: string }>,
  ): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    const roomRef = doc(db, "rooms", cleanCode);
    try {
      const snap = await getDoc(roomRef);
      if (!snap.exists()) return;
      const currentData = snap.data() as any;

      const normalizedUpd: any = {};
      
      // If car is updated
      if (updates.selectedCar) {
        const carId = updates.selectedCar;
        const carObj = getSelectedCarObj(carId);
        normalizedUpd.selectedCar = carObj;
        normalizedUpd.hostCar = carId;
        // Keep selectedCars record updated
        const selectedCars = currentData.selectedCars || {};
        selectedCars[currentData.hostId || currentData.ownerUid] = carId;
        normalizedUpd.selectedCars = selectedCars;
      }

      // If map or laps or other map parameters are updated
      const currentMapObj = currentData.selectedMap || {};
      const mapId = updates.mapId || updates.mapType || currentMapObj.id || "map1";
      const lapsValue = updates.laps !== undefined ? updates.laps : (currentMapObj.laps || 3);
      const weatherValue = updates.weather || currentMapObj.weather || "Clear";
      const envValue = updates.environment || currentMapObj.environment || "Forest";

      if (updates.mapId || updates.mapType || updates.laps !== undefined || updates.weather || updates.environment) {
        const mapObj: NonNullable<RoomState["selectedMap"]> = getSelectedMapObj(mapId, lapsValue);
        // Overwrite weather and environment if provided
        if (updates.weather) mapObj.weather = updates.weather;
        if (updates.environment) mapObj.environment = updates.environment;
        
        normalizedUpd.selectedMap = mapObj;
        normalizedUpd.mapType = mapId;
        normalizedUpd.mapId = mapId;
        normalizedUpd.hostMap = mapId;
        normalizedUpd.laps = lapsValue;
        if (updates.weather) normalizedUpd.weather = updates.weather;
      }

      normalizedUpd.updatedAt = serverTimestamp();
      await updateDoc(roomRef, normalizedUpd);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `rooms/${cleanCode}`);
    }
  }

  /**
   * Toggles player's readiness in both the room's player array and player subcollection
   */
  public static async toggleReady(roomCode: string, playerId: string, isReady: boolean): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    const roomRef = doc(db, "rooms", cleanCode);
    const playerRef = doc(db, "rooms", cleanCode, "players", playerId);

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) return;

        const room = snap.data() as RoomState;
        const players = room.players || [];
        if (!players.some((p) => (p.uid || p.id) === playerId)) {
          throw new Error("Player is no longer a member of this room.");
        }
        
        const updatedPlayers = players.map((p) => {
          if (p.uid === playerId) {
            return {
              ...p,
              ready: isReady,
              isReady: isReady, // compatibility
            };
          }
          return p;
        });

        transaction.update(roomRef, {
          players: updatedPlayers,
          updatedAt: serverTimestamp(),
        });

        transaction.set(playerRef, {
          ready: isReady,
          isReady: isReady, // compatibility
        }, { merge: true });
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `rooms/${cleanCode}/players/${playerId}`);
      throw e;
    }
  }

  /**
   * Updates player's map download status in both the room's player array and player subcollection
   */
  public static async updatePlayerDownloadStatus(
    roomCode: string,
    playerId: string,
    mapReady: boolean,
    progress: number,
    downloadedMB: number,
    totalMB: number
  ): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    const roomRef = doc(db, "rooms", cleanCode);
    const playerRef = doc(db, "rooms", cleanCode, "players", playerId);

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) return;

        const room = snap.data() as RoomState;
        const players = room.players || [];
        if (!players.some((p) => (p.uid || p.id) === playerId)) {
          throw new Error("Player is no longer a member of this room.");
        }
        
        const isCompleted = progress >= 100 || mapReady;

        const updatedPlayers = players.map((p) => {
          if (p.uid === playerId) {
            return {
              ...p,
              mapReady: isCompleted,
              mapDownloaded: isCompleted,
              ready: isCompleted,
              isReady: isCompleted,
              downloadProgress: progress,
              downloadedMB,
              totalMB,
            };
          }
          return p;
        });

        transaction.update(roomRef, {
          players: updatedPlayers,
          updatedAt: serverTimestamp(),
        });

        transaction.set(playerRef, {
          mapReady: isCompleted,
          mapDownloaded: isCompleted,
          ready: isCompleted,
          isReady: isCompleted,
          downloadProgress: progress,
          downloadedMB,
          totalMB,
        }, { merge: true });
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `rooms/${cleanCode}/players/${playerId}`);
      throw e;
    }
  }

  /**
   * Updates player's detailed multi-stage loading status
   */
  public static async updatePlayerLoadingStatus(
    roomCode: string,
    playerId: string,
    status: {
      mapReady?: boolean;
      mapProgress?: number;
      carReady?: boolean;
      carProgress?: number;
      glbParsing?: boolean;
      vehicleInitialized?: boolean;
      ready?: boolean;
      sceneReady?: boolean;
      connected?: boolean;
    }
  ): Promise<void> {
    const cleanCode = roomCode.toUpperCase().trim();
    const roomRef = doc(db, "rooms", cleanCode);
    const playerRef = doc(db, "rooms", cleanCode, "players", playerId);

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) return;

        const room = snap.data() as RoomState;
        const players = room.players || [];
        if (!players.some((p) => (p.uid || p.id) === playerId)) {
          throw new Error("Player is no longer a member of this room.");
        }

        const updatedPlayers = players.map((p) => {
          if (p.uid === playerId || p.id === playerId) {
            return {
              ...p,
              ...status,
              isReady: status.ready !== undefined ? status.ready : (p.isReady ?? false),
            };
          }
          return p;
        });

        transaction.update(roomRef, {
          players: updatedPlayers,
          updatedAt: serverTimestamp(),
        });

        transaction.set(playerRef, {
          ...status,
          ...(status.ready !== undefined ? { isReady: status.ready } : {}),
        }, { merge: true });
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `rooms/${cleanCode}/players/${playerId}`);
      throw e;
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
      { includeMetadataChanges: true },
      (snap) => {
        const metadata = snap.metadata;
        if (snap.exists()) {
          onUpdate(normalizeRoom(snap.data(), cleanCode));
        } else if (!metadata.fromCache && !metadata.hasPendingWrites) {
          // An empty local cache (especially offline) is not proof of deletion.
          onUpdate(null);
        }
      },
      (err) => {
        if (onError) onError(err);
        handleFirestoreError(err, OperationType.GET, `rooms/${cleanCode}`);
      },
    );
  }

  public static async getRoom(roomCode: string): Promise<RoomState | null> {
    const code = RoomValidator.normalizeCode(roomCode);
    const snap = await getDoc(doc(db, "rooms", code));
    return snap.exists() ? normalizeRoom(snap.data(), code) : null;
  }

  /**
   * Updates player's real-time physical telemetry
   */
  public static async updatePlayerPosition(
    code: string,
    uid: string,
    coords: any,
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
        // Re-read inside a transaction: a join/start after the query must cancel
        // cleanup rather than delete a room that has just become active.
        await runTransaction(db, async (transaction) => {
          const current = await transaction.get(d.ref);
          if (!current.exists()) return;
          const room = current.data() as RoomState;
          if (room.hostId !== auth.currentUser?.uid) return;
          if (["starting", "countdown", "racing"].includes(room.status)) return;
          const activity = RoomValidator.timestampMillis(room.updatedAt || room.createdAt);
          const expiry = RoomValidator.timestampMillis(room.expiresAt);
          const lastActive = activity ?? (expiry === null ? now : expiry - cutoff);
          if (now - lastActive <= cutoff) return;
          for (const player of room.players || []) {
            transaction.delete(doc(db, "rooms", d.id, "players", player.uid || player.id!));
          }
          transaction.delete(d.ref);
        });
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
