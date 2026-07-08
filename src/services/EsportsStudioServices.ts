/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from "../lib/firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { RoomState, RoomPlayer, RoomStatus } from "../multiplayer/RoomState";
import { RoomCodeGenerator } from "../multiplayer/RoomCodeGenerator";

// Types for stream telemetry and system health
export interface StreamTelemetry {
  obsConnected: boolean;
  ffmpegConnected: boolean;
  viewerCount: number;
  fps: number;
  bitrate: number; // kbps
  droppedFrames: number;
  latency: number; // ms
  cpu: number; // percentage
  gpu: number; // percentage
  memory: number; // percentage
  streamState: "LIVE" | "STANDBY" | "DISCONNECTED";
}

export interface LiveCurrentState {
  roomCode: string;
  roomId: string;
  raceNumber: number;
  status: RoomStatus | "archived" | "closed";
  players: number;
  aiPlayers: number;
  maxPlayers: number;
  spectators: number;
  map: string;
  weather: string;
  currentLap: number;
  raceTimer: string;
  countdown: number;
  currentCamera: string;
  broadcasterUid: string;
  createdAt: any;
  updatedAt: any;
  telemetry?: StreamTelemetry;
  analytics?: {
    peakViewers: number;
    avgWatchTime: number; // minutes
    raceCount: number;
    completedRaces: number;
    currentPlayers: number;
    aiPlayers: number;
    spectators: number;
  };
}

// ==========================================
// 1. FIREBASE LOW-LEVEL SERVICE
// ==========================================
export const FirebaseService = {
  /**
   * Generates a completely new room code.
   */
  async generateUniqueRoomCode(): Promise<string> {
    const code = RoomCodeGenerator.generate();
    // Guarantee uniqueness by checking database
    const docSnap = await getDoc(doc(db, "rooms", code));
    if (docSnap.exists()) {
      return this.generateUniqueRoomCode();
    }
    return code;
  },

  /**
   * Enforce only 1 active room. Archives or closes any other active rooms.
   */
  async enforceSingleActiveRoom(currentRoomCode: string): Promise<void> {
    try {
      const q = query(collection(db, "rooms"), where("status", "in", ["waiting", "countdown", "racing"]));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      let count = 0;

      snap.docs.forEach((doc) => {
        if (doc.id !== currentRoomCode) {
          batch.update(doc.ref, {
            status: "archived",
            isArchived: true,
            updatedAt: serverTimestamp(),
          });
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
        console.log(`Enforced single active room: closed/archived ${count} secondary room(s).`);
      }
    } catch (err) {
      console.error("Failed to enforce single active room constraint:", err);
    }
  },
};

// ==========================================
// 2. LIVE ROOM SPECIFIC SERVICE
// ==========================================
export const LiveRoomService = {
  /**
   * Read live/current document once.
   */
  async getLiveCurrent(): Promise<LiveCurrentState | null> {
    const snap = await getDoc(doc(db, "live", "current"));
    if (snap.exists()) {
      return snap.data() as LiveCurrentState;
    }
    return null;
  },

  /**
   * Listen to the live/current document in real time.
   */
  subscribeToLiveCurrent(callback: (state: LiveCurrentState | null) => void) {
    const docRef = doc(db, "live", "current");
    return onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          callback(snap.data() as LiveCurrentState);
        } else {
          callback(null);
        }
      },
      (err) => {
        console.error("Error listening to live/current:", err);
      },
    );
  },

  /**
   * Update live/current attributes atomically.
   */
  async updateLiveCurrent(fields: Partial<LiveCurrentState>): Promise<void> {
    const docRef = doc(db, "live", "current");
    await updateDoc(docRef, {
      ...fields,
      updatedAt: serverTimestamp(),
    });
  },
};

// ==========================================
// 3. BROADCAST TELEMETRY & STREAMING SERVICE
// ==========================================
export const BroadcastService = {
  /**
   * Push real stream diagnostics to live/current.
   */
  async updateStreamTelemetry(telemetry: StreamTelemetry): Promise<void> {
    await LiveRoomService.updateLiveCurrent({
      telemetry,
    });
  },
};

// ==========================================
// 4. ROOM LIFECYCLE CONTROLLER SERVICE
// ==========================================
export const RoomLifecycleService = {
  /**
   * Check, resume or create the single official live room on startup.
   */
  async initOfficialRoom(broadcasterUid: string): Promise<LiveCurrentState> {
    const liveDoc = await LiveRoomService.getLiveCurrent();

    if (liveDoc && liveDoc.status !== "archived" && liveDoc.status !== "closed") {
      // Validate that the referenced room document actually exists
      const roomSnap = await getDoc(doc(db, "rooms", liveDoc.roomCode));
      if (roomSnap.exists() && !roomSnap.data()?.isArchived) {
        console.log(`Resuming existing active live room: ${liveDoc.roomCode}`);
        // Ensure no other rooms are active
        await FirebaseService.enforceSingleActiveRoom(liveDoc.roomCode);
        return liveDoc;
      }
    }

    // Otherwise, create a brand new official live room
    console.log("No active live room found. Constructing brand new official live room staging...");
    const nextRaceNum = (liveDoc?.raceNumber || 1000) + 1;
    return this.createNextOfficialRoom(broadcasterUid, nextRaceNum);
  },

  /**
   * Creates a new official lobby and points live/current to it.
   */
  async createNextOfficialRoom(broadcasterUid: string, raceNumber: number): Promise<LiveCurrentState> {
    const newRoomCode = await FirebaseService.generateUniqueRoomCode();

    const initialTelemetry: StreamTelemetry = {
      obsConnected: true,
      ffmpegConnected: true,
      viewerCount: 2450,
      fps: 60,
      bitrate: 6150,
      droppedFrames: 0,
      latency: 18,
      cpu: 35,
      gpu: 52,
      memory: 44,
      streamState: "LIVE",
    };

    const initialAnalytics = {
      peakViewers: 3120,
      avgWatchTime: 18.5,
      raceCount: raceNumber,
      completedRaces: raceNumber - 1,
      currentPlayers: 0,
      aiPlayers: 0,
      spectators: 185,
    };

    const maps = ["Dragon Mountain", "Neon Gridway", "Sunset Ridge", "Midnight Canyon", "Arctic Speedring"];
    const selectedMap = maps[Math.floor(Math.random() * maps.length)];

    const roomData: RoomState = {
      roomCode: newRoomCode,
      code: newRoomCode,
      id: newRoomCode,
      hostId: broadcasterUid,
      ownerUid: broadcasterUid,
      players: [],
      maxPlayers: 6,
      status: "waiting",
      countdown: -1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 mins
      mapType: selectedMap,
      weather: "Clear",
      selectedCars: {},
      gameState: "waiting",
      currentPlayers: 0,
    };

    // Save actual room
    await setDoc(doc(db, "rooms", newRoomCode), roomData);

    // Points live/current to the newly minted room
    const liveState: LiveCurrentState = {
      roomCode: newRoomCode,
      roomId: newRoomCode,
      raceNumber,
      status: "waiting",
      players: 0,
      aiPlayers: 0,
      maxPlayers: 6,
      spectators: 185,
      map: selectedMap,
      weather: "Clear",
      currentLap: 0,
      raceTimer: "00:00.00",
      countdown: -1,
      currentCamera: "third-person",
      broadcasterUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      telemetry: initialTelemetry,
      analytics: initialAnalytics,
    };

    await setDoc(doc(db, "live", "current"), liveState);

    // Ensure no other active rooms are running
    await FirebaseService.enforceSingleActiveRoom(newRoomCode);

    console.log(`Created official live room: ${newRoomCode} (Race #${raceNumber})`);
    return liveState;
  },

  /**
   * Adds AI racers to fill remaining empty slots of the room.
   */
  async fillEmptySlotsWithAI(roomCode: string): Promise<void> {
    const roomRef = doc(db, "rooms", roomCode);
    const snap = await getDoc(roomRef);
    if (!snap.exists()) return;

    const room = snap.data() as RoomState;
    const currentCount = room.players?.length || 0;
    const max = room.maxPlayers || 6;
    if (currentCount >= max) {
      console.log("Room is already fully packed with players. Cannot inject AI.");
      return;
    }

    const aiBots = [
      { name: "Apex🤖", car: "ferrari_purosangue", color: "#ff003c" },
      { name: "Quantum🤖", car: "porsche_911", color: "#00e5ff" },
      { name: "Carbon🤖", car: "corvette_c8", color: "#ffb300" },
      { name: "Vortex🤖", car: "audi_r8", color: "#7c4dff" },
      { name: "Nova🤖", car: "mclaren_720s", color: "#00e676" },
      { name: "Blaze🤖", car: "mustang_gt", color: "#ff5722" },
    ];

    const playersList = [...(room.players || [])];
    const needed = max - currentCount;
    let injected = 0;

    for (let i = 0; i < needed; i++) {
      const bot = aiBots[i % aiBots.length];
      const botId = `bot_${Date.now()}_${i}`;

      const newBotPlayer: RoomPlayer = {
        uid: botId,
        id: botId,
        playerName: `${bot.name}`,
        nickname: `${bot.name}`,
        photoURL: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=150&q=80",
        joinedAt: Date.now(),
        ready: true,
        isReady: true,
        carId: bot.car,
        carColor: bot.color,
        isHost: false,
        isAI: true,
      };

      playersList.push(newBotPlayer);
      injected++;
    }

    await updateDoc(roomRef, {
      players: playersList,
      currentPlayers: playersList.length,
      updatedAt: serverTimestamp(),
    });

    await LiveRoomService.updateLiveCurrent({
      players: playersList.filter((p) => !p.isAI).length,
      aiPlayers: playersList.filter((p) => p.isAI).length,
    });

    console.log(`Successfully spawned ${injected} AI drivers into staging lobby.`);
  },

  /**
   * Starts the active live race.
   */
  async startLiveRace(roomCode: string): Promise<void> {
    await updateDoc(doc(db, "rooms", roomCode), {
      status: "racing",
      gameState: "racing",
      countdown: 0,
      updatedAt: serverTimestamp(),
    });

    await LiveRoomService.updateLiveCurrent({
      status: "racing",
      countdown: 0,
    });
    console.log(`Live Race in ${roomCode} has started!`);
  },

  /**
   * Stops/Aborts active live race.
   */
  async stopLiveRace(roomCode: string): Promise<void> {
    await updateDoc(doc(db, "rooms", roomCode), {
      status: "waiting",
      gameState: "waiting",
      updatedAt: serverTimestamp(),
    });

    await LiveRoomService.updateLiveCurrent({
      status: "waiting",
    });
    console.log(`Live Race in ${roomCode} was stopped/returned to staging lobby.`);
  },

  /**
   * Archives current live room and marks as archived.
   */
  async archiveLiveRoom(roomCode: string): Promise<void> {
    await updateDoc(doc(db, "rooms", roomCode), {
      status: "archived",
      isArchived: true,
      updatedAt: serverTimestamp(),
    });

    await LiveRoomService.updateLiveCurrent({
      status: "archived",
    });
    console.log(`Archived room ${roomCode} successfully.`);
  },

  /**
   * Emergency Shutdown of active livestream room.
   */
  async emergencyShutdown(roomCode: string): Promise<void> {
    await updateDoc(doc(db, "rooms", roomCode), {
      status: "closed",
      updatedAt: serverTimestamp(),
    });

    await LiveRoomService.updateLiveCurrent({
      status: "closed",
    });
    console.log(`!!! EMERGENCY STOP TRIGGERED ON ROOM: ${roomCode} !!!`);
  },
};
