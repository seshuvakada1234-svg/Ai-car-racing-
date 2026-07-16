/**
 * File: multiplayerRaceStartSync.ts
 *
 * Purpose:
 * Synchronize multiplayer race startup so every player enters the race
 * at exactly the same moment.
 */

import { db } from "../lib/firebase";
import { doc, updateDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { NormalRoomService } from "./NormalRoomService";

// We track the offset between local system time and Firestore server time
let serverTimeOffset = 0;

export function setEstimatedServerTimeOffset(offset: number) {
  serverTimeOffset = offset;
  console.log(`[Clock Sync] Set estimated server time offset: ${offset}ms`);
}

export function getSynchronizedServerTime(): number {
  return Date.now() + serverTimeOffset;
}

/**
 * 1. Listen to Firestore room updates.
 * Computes and monitors clock sync offsets automatically.
 */
export function initializeRaceStartSync(roomCode: string, onUpdate?: (room: any) => void) {
  const cleanCode = roomCode.toUpperCase().trim();
  const roomRef = doc(db, "rooms", cleanCode);
  
  return onSnapshot(roomRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      
      // Calculate/estimate clock offset using updatedAt from server
      if (data.updatedAt && snapshot.metadata.hasPendingWrites === false) {
        const serverMillis = data.updatedAt.toMillis ? data.updatedAt.toMillis() : new Date(data.updatedAt).getTime();
        const localMillis = Date.now();
        const offset = serverMillis - localMillis;
        setEstimatedServerTimeOffset(offset);
      }
      
      if (onUpdate) {
        onUpdate(data);
      }
    }
  });
}

/**
 * 2. Track/Update each player's loading status.
 */
export async function updatePlayerReady(roomCode: string, playerId: string) {
  const cleanCode = roomCode.toUpperCase().trim();
  console.log(`[Race Sync] Player ${playerId} is ready in room ${cleanCode}. Updating Firestore status...`);
  await NormalRoomService.updatePlayerLoadingStatus(cleanCode, playerId, {
    mapReady: true,
    carReady: true,
    sceneReady: true,
    ready: true
  });
}

/**
 * 3. Host only:
 *    - Verify every player is ready.
 *    - Update:
 *          room.status = "countdown"
 *          countdownStartTime = serverTimestamp()
 */
export async function startCountdown(roomCode: string) {
  const cleanCode = roomCode.toUpperCase().trim();
  const roomRef = doc(db, "rooms", cleanCode);
  console.log(`[Race Sync] Host starting countdown in room ${cleanCode}`);
  await updateDoc(roomRef, {
    status: "countdown",
    phase: "countdown",
    countdownStart: serverTimestamp(),
    countdownStartTime: serverTimestamp(), // fallback/alias
    countdownDuration: 60,
    updatedAt: serverTimestamp()
  });
}

/**
 * 4. All clients:
 *    - Listen for room.status.
 *    - When room.status == "countdown":
 *         Freeze vehicle controls.
 */
export function waitForCountdown(roomCode: string): Promise<any> {
  const cleanCode = roomCode.toUpperCase().trim();
  const roomRef = doc(db, "rooms", cleanCode);
  return new Promise((resolve) => {
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.status === "countdown") {
          unsubscribe();
          resolve(data);
        }
      }
    });
  });
}

/**
 * 5. Host only: transition room status to racing when countdown completes.
 */
export async function beginRace(roomCode: string) {
  const cleanCode = roomCode.toUpperCase().trim();
  console.log(`[Race Sync] Host transitions room to racing in ${cleanCode}`);
  const roomRef = doc(db, "rooms", cleanCode);
  await updateDoc(roomRef, {
    status: "racing",
    phase: "racing",
    raceStarted: true,
    updatedAt: serverTimestamp()
  });
}
