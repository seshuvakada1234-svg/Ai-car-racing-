/**
 * File: multiplayerRaceStartSync.ts
 *
 * Purpose:
 * Synchronize multiplayer race startup so every player enters the race
 * at exactly the same moment.
 */

import { db, auth } from "../lib/firebase";
import { doc, updateDoc, onSnapshot, serverTimestamp, getDoc, runTransaction } from "firebase/firestore";
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
 * Measure clock offset by performing a series of writes to Firestore,
 * subtracting half the round-trip time, and taking the median of 3 samples.
 */
export async function measureServerTimeOffset(roomCode: string, uid: string): Promise<void> {
  const cleanCode = roomCode.toUpperCase().trim();
  const playerRef = doc(db, "rooms", cleanCode, "players", uid);
  const offsets: number[] = [];

  console.log(`[Clock Sync] Measuring server time offset for room ${cleanCode}, player ${uid}...`);

  for (let i = 0; i < 3; i++) {
    try {
      const performanceToEpochOffset = Date.now() - performance.now();
      const t0 = performance.now();
      
      // Write { _pingAt: serverTimestamp() } to rooms/{roomCode}/players/{uid}
      await updateDoc(playerRef, {
        _pingAt: serverTimestamp()
      });
      
      // Wait until Firestore returns the resolved timestamp
      const t1 = performance.now();
      const snap = await getDoc(playerRef);
      const pingTimestamp = snap.data()?._pingAt;
      
      if (pingTimestamp && typeof pingTimestamp.toMillis === "function") {
        const serverMillis = pingTimestamp.toMillis();
        // client time estimated at midpoint of the write transaction
        const estimatedClientTime = (t0 + (t1 - t0) / 2) + performanceToEpochOffset;
        const offset = serverMillis - estimatedClientTime;
        offsets.push(offset);
        console.log(`[Clock Sync] Sample ${i + 1}: t0=${t0.toFixed(1)}, t1=${t1.toFixed(1)}, RTT=${(t1 - t0).toFixed(1)}ms, serverMillis=${serverMillis}, offset=${offset.toFixed(1)}ms`);
      } else {
        console.warn(`[Clock Sync] Sample ${i + 1} failed: pingTimestamp was missing or could not be resolved`);
      }
    } catch (err) {
      console.error(`[Clock Sync] Sample ${i + 1} failed with error:`, err);
    }
    
    // Add a tiny delay between samples
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (offsets.length > 0) {
    offsets.sort((a, b) => a - b);
    let medianOffset = 0;
    if (offsets.length === 3) {
      medianOffset = offsets[1];
    } else if (offsets.length === 2) {
      medianOffset = (offsets[0] + offsets[1]) / 2;
    } else {
      medianOffset = offsets[0];
    }
    setEstimatedServerTimeOffset(medianOffset);
  } else {
    console.warn(`[Clock Sync] No valid server time offset samples retrieved, keeping default offset of ${serverTimeOffset}ms`);
  }
}

/**
 * 1. Listen to Firestore room updates.
 * Clock calibration is performed by measureServerTimeOffset, not by document age.
 */
export function initializeRaceStartSync(roomCode: string, onUpdate?: (room: any) => void) {
  const cleanCode = roomCode.toUpperCase().trim();
  const roomRef = doc(db, "rooms", cleanCode);
  
  return onSnapshot(roomRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      
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
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) throw new Error("Room Closed");
    const room = snapshot.data();
    if (room.hostId !== auth.currentUser?.uid) throw new Error("Only the room host can start the countdown");
    if (room.status !== "racing" || room.raceStarted) return;
    const humans = (room.players || []).filter((player: any) => !player.isAI);
    if (!humans.length || !humans.every((player: any) => player.mapReady && player.carReady && player.sceneReady && player.ready)) return;
    transaction.update(roomRef, {
      status: "countdown", phase: "countdown",
      countdownStartTime: serverTimestamp(), updatedAt: serverTimestamp(),
    });
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
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) throw new Error("Room Closed");
    const room = snapshot.data();
    if (room.hostId !== auth.currentUser?.uid) throw new Error("Only the room host can begin the race");
    if (room.status !== "countdown") return;
    transaction.update(roomRef, {
      status: "racing", phase: "racing", raceStarted: true, updatedAt: serverTimestamp(),
    });
  });
}
