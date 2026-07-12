import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/firestoreError";
import { NormalRoomService, NormalRoom, NormalPlayer } from "../multiplayer/NormalRoomService";
import {
  Compass,
  Users,
  Sparkles,
  Copy,
  Trash2,
  LogOut,
  Loader2,
  Play,
  Lock,
  Unlock,
  Car,
  Map as MapIcon,
  Layers,
  CloudSun,
  CheckCircle2,
  AlertCircle,
  Crown,
  Gauge,
  Zap,
  Settings,
  Activity
} from "lucide-react";

// Predefined metadata lookup for cars
const CARS_METADATA: Record<string, {
  name: string;
  manufacturer: string;
  class: string;
  topSpeed: number;
  acceleration: string;
  handling: number;
  drivetrain: string;
  color: string;
  image: string;
}> = {
  ferrari: {
    name: "Ferrari Purosangue",
    manufacturer: "Ferrari",
    class: "A CLASS",
    topSpeed: 310,
    acceleration: "3.3s",
    handling: 90,
    drivetrain: "AWD",
    color: "#ff003c",
    image: "https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&w=600&q=80"
  },
  bugatti: {
    name: "Bugatti Chiron",
    manufacturer: "Bugatti",
    class: "HYPER CLASS",
    topSpeed: 420,
    acceleration: "2.4s",
    handling: 80,
    drivetrain: "AWD",
    color: "#00ccff",
    image: "https://images.unsplash.com/photo-1600706432502-75a0e2e21327?auto=format&fit=crop&w=600&q=80"
  },
  porsche: {
    name: "Porsche 911 GT3",
    manufacturer: "Porsche",
    class: "A CLASS",
    topSpeed: 320,
    acceleration: "3.2s",
    handling: 98,
    drivetrain: "RWD",
    color: "#00ff3c",
    image: "https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&w=600&q=80"
  }
};

// Predefined metadata lookup for maps
const MAPS_METADATA: Record<string, {
  name: string;
  difficulty: "easy" | "medium" | "hard";
  trackLength: string;
  weather: string;
  environment: string;
  image: string;
}> = {
  race2map: {
    name: "Race 2",
    difficulty: "medium",
    trackLength: "...",
    weather: "Clear",
    environment: "Arena",
    image: "/maps/race2/preview.jpg"
  },
  map1: {
    name: "Dragon Forest",
    difficulty: "medium",
    trackLength: "10 KM",
    weather: "Clear",
    environment: "Forest",
    image: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=600&q=80"
  },
  map2: {
    name: "Coastal Highway",
    difficulty: "easy",
    trackLength: "10 KM",
    weather: "Sunset",
    environment: "Coastal",
    image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80"
  },
  map3: {
    name: "Desert Storm",
    difficulty: "hard",
    trackLength: "10 KM",
    weather: "Dusty",
    environment: "Desert",
    image: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=600&q=80"
  },
  map4: {
    name: "Snow Valley",
    difficulty: "hard",
    trackLength: "10 KM",
    weather: "Snowy",
    environment: "Alpine",
    image: "https://images.unsplash.com/photo-1482862549707-f63cb32c5fd9?auto=format&fit=crop&w=600&q=80"
  },
  map5: {
    name: "Night City",
    difficulty: "medium",
    trackLength: "10 KM",
    weather: "Rainy",
    environment: "Urban",
    image: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=600&q=80"
  },
  map6: {
    name: "Mountain Pass",
    difficulty: "medium",
    trackLength: "10 KM",
    weather: "Foggy",
    environment: "Mountain",
    image: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=600&q=80"
  },
  racing2: {
    name: "Racing 2",
    difficulty: "medium",
    trackLength: "Custom GLB",
    weather: "Clear",
    environment: "Arena",
    image: "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=600&q=80"
  }
};

export const WaitingLobbyPage: React.FC = () => {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [room, setRoom] = useState<NormalRoom | null>(null);
  const [players, setPlayers] = useState<NormalPlayer[]>([]);
  const [activeMaps, setActiveMaps] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [localSecondsLeft, setLocalSecondsLeft] = useState<number | null>(null);
  const [countdownMsg, setCountdownMsg] = useState("ALL PLAYERS READY");
  const [loading, setLoading] = useState(true);

  // Map downloading status state variables
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadedMB, setDownloadedMB] = useState<number>(0);
  const [totalMB, setTotalMB] = useState<number>(0);
  const [isCheckingCache, setIsCheckingCache] = useState<boolean>(true);
  const [mapReadyLocal, setMapReadyLocal] = useState<boolean>(false);

  // Load maps from Firestore for dropdown choices
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "maps"), (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const active = list.filter((m: any) => m.status !== "Disabled");
      setActiveMaps(active);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "maps");
    });
    return () => unsub();
  }, []);

  const normalizedCode = (roomCode || "").toUpperCase().trim();
  const isHost = room && profile ? room.ownerUid === profile.uid : false;
  const allPlayersReady = room ? (players.length === (room.maxPlayers || 3) && players.every(p => p.ready === true)) : false;
  const allReady = allPlayersReady;

  // 1. Real-time Firestore Subscriptions
  useEffect(() => {
    if (!normalizedCode) return;

    setLoading(true);
    const unsubRoom = NormalRoomService.listenToRoom(normalizedCode, (updatedRoom) => {
      setRoom(updatedRoom);
      setLoading(false);
    });

    const unsubPlayers = NormalRoomService.listenToPlayers(normalizedCode, (updatedPlayers) => {
      setPlayers(updatedPlayers);
    });

    return () => {
      unsubRoom();
      unsubPlayers();
    };
  }, [normalizedCode]);

  // 1b. Automatic Map Checking and Downloading Hook
  useEffect(() => {
    if (!room || !profile?.uid) return;

    let active = true;

    async function checkAndDownloadMap() {
      const activeMapId = room?.mapId || "race2map";
      
      // If it's not a GLB-based map, it is instantly ready
      if (activeMapId !== "race2map" && activeMapId !== "racing2") {
        if (active) {
          setMapReadyLocal(true);
          setIsCheckingCache(false);
          setDownloadProgress(100);
        }
        try {
          await NormalRoomService.updatePlayerDownloadStatus(
            normalizedCode,
            profile.uid,
            true, // mapReady
            100,  // progress
            0,    // downloadedMB
            0     // totalMB
          );
        } catch (e) {
          console.error("Failed to update download status", e);
        }
        return;
      }

      const mapUrl = "https://pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/map/Untitled12.glb";
      const cacheName = "map-assets-cache";

      try {
        if (active) {
          setIsCheckingCache(true);
        }
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(mapUrl);

        if (cachedResponse) {
          console.log("Map exists in browser cache!");
          if (!active) return;
          setMapReadyLocal(true);
          setIsCheckingCache(false);
          setDownloadProgress(100);

          // Mark player as Map Ready in Firestore
          await NormalRoomService.updatePlayerDownloadStatus(
            normalizedCode,
            profile.uid,
            true, // mapReady
            100,  // progress
            45,   // downloadedMB
            45    // totalMB
          );
          return;
        }

        // If it does not exist: Automatically start downloading the map.
        console.log("Map does not exist in browser cache. Starting download...");
        if (!active) return;
        setIsCheckingCache(false);
        setDownloadProgress(0);

        // Try downloading via proxy first, fall back to direct URL
        const targetUrl = `/api/proxy?url=${encodeURIComponent(mapUrl)}`;
        
        let response: Response;
        try {
          response = await fetch(targetUrl);
          if (!response.ok) throw new Error("Proxy fetch failed");
        } catch (err) {
          console.warn("Proxy fetch failed, falling back to direct URL", err);
          response = await fetch(mapUrl);
        }

        if (!response.ok) {
          throw new Error(`Failed to download map: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        const contentLengthHeader = response.headers.get("Content-Length");
        // Fallback to ~45 MB if Content-Length header is missing/chunked
        const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 47139152;
        const totalMBVal = +(totalBytes / (1024 * 1024)).toFixed(1);
        
        if (active) {
          setTotalMB(totalMBVal);
        }

        if (!reader) {
          throw new Error("ReadableStream not supported in response body.");
        }

        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;
        let lastUpdateTime = Date.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            chunks.push(value);
            receivedBytes += value.length;
          }

          const currentPercent = Math.min(Math.round((receivedBytes / totalBytes) * 100), 99);
          const currentMB = +(receivedBytes / (1024 * 1024)).toFixed(1);

          if (active) {
            setDownloadProgress(currentPercent);
            setDownloadedMB(currentMB);
          }

          // Throttle Firestore updates to at most once per second
          const now = Date.now();
          if (now - lastUpdateTime > 1000) {
            lastUpdateTime = now;
            await NormalRoomService.updatePlayerDownloadStatus(
              normalizedCode,
              profile.uid,
              false, // mapReady
              currentPercent,
              currentMB,
              totalMBVal
            ).catch(err => console.error("Error writing progress to db:", err));
          }
        }

        // Complete: verify file size
        const combinedBlob = new Blob(chunks);
        if (combinedBlob.size < 1000) {
          throw new Error("Downloaded file is invalid or too small");
        }

        // Save to browser cache
        await cache.put(mapUrl, new Response(combinedBlob, {
          headers: {
            "Content-Type": "model/gltf-binary",
            "Content-Length": combinedBlob.size.toString()
          }
        }));

        console.log("Map downloaded and successfully saved to browser cache!");
        
        if (active) {
          setMapReadyLocal(true);
          setDownloadProgress(100);
          setDownloadedMB(totalMBVal);
        }

        // Mark player as Map Ready in Firestore
        await NormalRoomService.updatePlayerDownloadStatus(
          normalizedCode,
          profile.uid,
          true, // mapReady
          100,
          totalMBVal,
          totalMBVal
        );

      } catch (err) {
        console.error("Map downloading failed:", err);
        // Fallback gracefully so they are not permanently blocked in case of network issue
        if (active) {
          setMapReadyLocal(true);
          setDownloadProgress(100);
          setIsCheckingCache(false);
        }
        try {
          await NormalRoomService.updatePlayerDownloadStatus(
            normalizedCode,
            profile.uid,
            true, // mapReady
            100,
            45,
            45
          );
        } catch (e) {
          console.error(e);
        }
      }
    }

    checkAndDownloadMap();

    return () => {
      active = false;
    };
  }, [room?.mapId, profile?.uid, normalizedCode]);

  // 2. Automatically return to Garage if the room is canceled/deleted
  useEffect(() => {
    if (!loading && !room) {
      console.log("Room deleted or canceled. Returning to garage.");
      navigate("/garage");
    }
  }, [room, loading, navigate]);

  // 3. Auto-Join Trigger
  useEffect(() => {
    if (!room) return;

    const isPlayerIn = players.some((p) => p.uid === profile?.uid);
    if (!loading && players.length > 0 && !isPlayerIn && profile) {
      NormalRoomService.joinRoom(normalizedCode, profile.uid, profile.name, profile.photoURL).catch((err) => {
        console.error("Auto-join failed:", err);
      });
    }
  }, [room?.status, players.length, isHost, profile, loading, normalizedCode]);

  // 4. Local Countdown Engager
  useEffect(() => {
    if (!room) return;

    // If anyone left or isn't ready during starting, host resets back to waiting
    if (room.status === "starting" && !allReady) {
      if (isHost) {
        console.log("A player left or isn't ready anymore! Resetting status to waiting.");
        NormalRoomService.setRoomStatus(normalizedCode, "waiting").catch((err) => {
          console.error("Error resetting room status:", err);
        });
      }
      setLocalSecondsLeft(null);
      return;
    }

    if (room.status !== "starting" && room.status !== "countdown") {
      setLocalSecondsLeft(null);
      return;
    }

    if (localSecondsLeft === null) {
      setLocalSecondsLeft(3);
      setCountdownMsg("GET READY");
    }

    const interval = setInterval(() => {
      setLocalSecondsLeft((prev) => {
        if (prev === null) return 3;
        if (prev <= 1) {
          clearInterval(interval);
          setCountdownMsg("GO!");

          setTimeout(() => {
            if (isHost) {
              NormalRoomService.setRoomStatus(normalizedCode, "racing").catch((err) => {
                console.error("Error setting status to racing:", err);
              });
            }
            navigate(`/race/${normalizedCode}`);
          }, 600);

          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [room?.status, allReady, isHost, navigate, normalizedCode, localSecondsLeft]);

  // Redirect to active race if state updates to racing
  useEffect(() => {
    if (room?.status === "racing") {
      navigate(`/race/${normalizedCode}`);
    }
  }, [room?.status, navigate, normalizedCode]);

  // Copy code helper
  const handleCopy = () => {
    navigator.clipboard.writeText(normalizedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Leave room triggers
  const handleLeave = async () => {
    if (!profile) return;
    try {
      await NormalRoomService.leaveOrCancelRoom(normalizedCode, profile.uid);
      navigate("/garage");
    } catch (err) {
      console.error("Error leaving room:", err);
    }
  };

  // Host configuration updates
  const handleMapChange = async (map: string) => {
    if (!profile || !isHost) return;
    try {
      await NormalRoomService.updateRoomSettings(normalizedCode, profile.uid, { mapId: map });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCarChange = async (car: string) => {
    if (!profile || !isHost) return;
    try {
      await NormalRoomService.updateRoomSettings(normalizedCode, profile.uid, { selectedCar: car });
    } catch (err) {
      console.error(err);
    }
  };

  const handleLapsChange = async (lapsCount: number) => {
    if (!profile || !isHost) return;
    try {
      await NormalRoomService.updateRoomSettings(normalizedCode, profile.uid, { laps: lapsCount } as any);
    } catch (err) {
      console.error(err);
    }
  };

  const handleWeatherChange = async (weatherVal: string) => {
    if (!profile || !isHost) return;
    try {
      await NormalRoomService.updateRoomSettings(normalizedCode, profile.uid, { weather: weatherVal } as any);
    } catch (err) {
      console.error(err);
    }
  };

  // Toggle ready status for joined player
  const handleReadyToggle = async () => {
    if (!profile) return;
    const myPlayerRecord = players.find(p => p.uid === profile.uid);
    if (!myPlayerRecord) return;
    const newReadyState = !myPlayerRecord.ready;
    try {
      await NormalRoomService.toggleReady(normalizedCode, profile.uid, newReadyState);
    } catch (err) {
      console.error("Toggle ready failed:", err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[85vh] flex flex-col items-center justify-center text-white space-y-4">
        <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
        <span className="text-xs tracking-widest text-slate-500 uppercase font-mono font-bold">
          Synchronizing Grid Sync...
        </span>
      </div>
    );
  }

  if (!room) return null;

  // Resolve metadata for selected car and map
  const activeCarId = room.selectedCar || "ferrari";
  const carSpec = CARS_METADATA[activeCarId] || CARS_METADATA.ferrari;

  const activeMapId = "race2map";
  const mapSpec = MAPS_METADATA[activeMapId] || MAPS_METADATA.race2map;

  // Sync parameters overridden by Firestore fields
  const currentLaps = room.laps || 3;
  const currentWeather = room.weather || mapSpec.weather;

  // Ready State Calculation
  const readyCount = players.filter(p => p.ready).length;
  const totalCount = players.length;

  return (
    <div id="room-waiting-lobby" className="w-full max-w-7xl mx-auto py-8 px-4 text-white space-y-8 flex flex-col relative">
      <div className="absolute w-[500px] h-[500px] bg-cyan-600/5 rounded-full blur-[140px] pointer-events-none top-10 right-10" />

      {/* HEADER CONTROLLER BANNER */}
      <div className="flex flex-col md:flex-row items-center justify-between bg-slate-950/40 border border-white/5 p-6 rounded-3xl backdrop-blur-md gap-6 select-none relative">
        <div className="space-y-2 text-center md:text-left flex-1">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5">
            <span className="text-[9px] uppercase font-black text-cyan-400 tracking-widest bg-cyan-400/10 border border-cyan-400/20 px-3 py-1 rounded-full">
              REAL-TIME MATCH LOBBY {room.status === "countdown" ? "• COUNTDOWN" : "• WAITING"}
            </span>
            <div className="flex items-center space-x-1.5 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full text-amber-500 font-mono text-[9px] font-bold uppercase tracking-wider">
              <Crown className="w-3 h-3 text-amber-400 shrink-0" />
              <span>HOST: {room.ownerName}</span>
            </div>
          </div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400">
            {room.roomName || `${room.ownerName}'s Arena`}
          </h2>
          <p className="text-xs text-slate-400 font-medium">
            Join other drivers and wait for the Host to launch the countdown! Only fully-ready rosters can launch.
          </p>
        </div>

        {/* COPY ROOM CODE MODULE */}
        <div className="flex flex-col items-center bg-slate-950/80 p-4 border border-white/5 rounded-2xl min-w-[240px]">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Share Room Code</span>
          <div className="flex items-center space-x-3 mt-1.5">
            <span className="text-3xl font-black font-mono tracking-wider text-pink-500">{normalizedCode}</span>
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-slate-900 border border-white/5 text-slate-300 hover:text-white hover:bg-slate-800 transition active:scale-95"
              title="Copy Room Code"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <span className="text-[9px] text-slate-500 font-mono mt-1 uppercase text-center">
            {copied ? "✓ Copy success!" : `Invite up to ${room.maxPlayers || 3} racers`}
          </span>
        </div>
      </div>

      {/* CENTRAL 3-COLUMN BENTO GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* COLUMN 1: ACTIVE PLAYER ROSTER */}
        <div className="bg-slate-950/40 border border-white/5 p-6 rounded-3xl backdrop-blur-md flex flex-col space-y-4">
          <div className="flex justify-between items-center border-b border-white/5 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Users className="w-4 h-4 text-cyan-400" />
              <span>ACTIVE RACER GRID ({players.length} / {room.maxPlayers || 3})</span>
            </h3>
            <span className="text-[9px] font-mono text-cyan-400 font-bold bg-cyan-400/10 border border-cyan-400/20 px-2 py-0.5 rounded uppercase">
              {players.length >= (room.maxPlayers || 3) ? "LOBBY SECURED" : "FILLING SLOTS"}
            </span>
          </div>

          <div className="flex-1 space-y-3.5">
            {/* Render slots from 0 to maxPlayers - 1 */}
            {Array.from({ length: room.maxPlayers || 3 }).map((_, idx) => {
              const plr = players[idx];
              if (plr) {
                const isPlayerHost = plr.uid === room.ownerUid;
                const localIsMe = profile && plr.uid === profile.uid;
                const plrCar = CARS_METADATA[plr.carId || "ferrari"] || CARS_METADATA.ferrari;

                return (
                  <div
                    key={plr.uid}
                    className="flex items-center justify-between bg-white/[0.02] border border-white/5 hover:border-white/10 p-3.5 rounded-2xl shadow-lg relative overflow-hidden transition group"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-t from-purple-600 to-cyan-400" />
                    
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-slate-900 border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
                        {plr.photoURL ? (
                          <img src={plr.photoURL} alt={plr.playerName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <Compass className="w-5 h-5 text-indigo-400 rotate-45 animate-pulse" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-black text-white truncate max-w-[120px]">
                            {plr.playerName}
                          </span>
                          {localIsMe && (
                            <span className="bg-cyan-500/15 border border-cyan-500/25 text-[8px] text-cyan-400 font-black font-mono tracking-wider px-1 rounded uppercase shrink-0">
                              YOU
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                          <Car className="w-2.5 h-2.5 text-purple-400 shrink-0" />
                          <span className="truncate">{plrCar.name}</span>
                        </span>
                        
                        {/* Map download progress synced in Firestore */}
                        {(room?.mapId === "race2map" || room?.mapId === "racing2") && (
                          <div className="mt-1 w-full max-w-[150px] space-y-0.5">
                            {plr.mapReady ? (
                              <span className="text-[8px] font-bold text-emerald-400 font-mono flex items-center gap-1 select-none">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                MAP READY
                              </span>
                            ) : (
                              <div className="space-y-0.5 text-left">
                                <div className="flex justify-between text-[8px] font-mono text-slate-400">
                                  <span>DOWNLOADING</span>
                                  <span>{plr.downloadProgress ?? 0}%</span>
                                </div>
                                <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-cyan-400 rounded-full transition-all duration-300"
                                    style={{ width: `${plr.downloadProgress ?? 0}%` }}
                                  />
                                </div>
                                {plr.downloadedMB !== undefined && plr.totalMB !== undefined && plr.totalMB > 0 && (
                                  <span className="text-[7px] text-slate-500 font-mono block leading-none">
                                    {plr.downloadedMB}MB / {plr.totalMB}MB
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {isPlayerHost && (
                        <div className="flex items-center space-x-1 bg-amber-500/10 border border-amber-500/25 text-amber-500 font-mono font-black text-[7px] tracking-widest px-2 py-1 rounded uppercase">
                          <Crown className="w-2.5 h-2.5 text-amber-400" />
                          <span>HOST</span>
                        </div>
                      )}
                      <div className={`flex items-center space-x-1 font-mono font-black text-[8px] tracking-wider px-2.5 py-1 rounded-full uppercase border ${
                        plr.ready 
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-sm shadow-emerald-500/5" 
                          : "bg-red-500/10 border-red-500/20 text-red-400"
                      }`}>
                        <span className="text-[10px] leading-none mr-0.5">{plr.ready ? "🟢" : "🔴"}</span>
                        <span>{plr.ready ? "READY" : "NOT READY"}</span>
                      </div>
                    </div>
                  </div>
                );
              }

              // Empty Slot Placeholder
              return (
                <div
                  key={`empty-${idx}`}
                  className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.01] border border-dashed border-white/5 text-slate-500 text-[10px] min-h-[64px] transition"
                >
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-full border border-dashed border-white/10 flex items-center justify-center text-slate-600">
                      ?
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="font-bold text-slate-500 uppercase tracking-widest text-[9px]">Player {idx + 1}</span>
                      <span className="text-[9px] text-slate-600">Waiting for driver connection...</span>
                    </div>
                  </div>
                  <span className="animate-pulse text-cyan-400/40">●</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* COLUMN 2: SELECTED CAR PANEL */}
        <div className="bg-slate-950/40 border border-white/5 p-6 rounded-3xl backdrop-blur-md flex flex-col space-y-4">
          <div className="flex justify-between items-center border-b border-white/5 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Car className="w-4 h-4 text-purple-400" />
              <span>SELECTED CAR</span>
            </h3>
            {!isHost && (
              <span className="flex items-center space-x-1 text-[8px] font-mono text-amber-500 font-bold bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded uppercase">
                <Lock className="w-2.5 h-2.5" />
                <span>Locked by Host</span>
              </span>
            )}
          </div>

          {/* CAR DETAILS INFORMATION BLOCK */}
          <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl text-left">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[8px] font-black tracking-widest text-purple-400 uppercase block font-mono">{carSpec.manufacturer}</span>
                <span className="text-sm font-black text-white uppercase leading-tight tracking-tight">{carSpec.name}</span>
              </div>
              <span className="bg-purple-600 text-white font-mono font-black text-[9px] tracking-wider px-2.5 py-1 rounded uppercase shadow-md shadow-purple-600/20">
                {carSpec.class}
              </span>
            </div>
          </div>

          {/* SPECIFICATIONS & STATS */}
          <div className="flex-1 space-y-3">
            {/* Top Speed */}
            <div className="space-y-1 text-left">
              <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase font-mono">
                <span className="flex items-center gap-1"><Gauge className="w-3 h-3 text-cyan-400" /> TOP SPEED</span>
                <span className="text-white font-extrabold">{carSpec.topSpeed} KM/H</span>
              </div>
              <div className="h-1.5 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] rounded-full transition-all duration-500"
                  style={{ width: `${(carSpec.topSpeed / 450) * 100}%` }}
                />
              </div>
            </div>

            {/* Acceleration */}
            <div className="space-y-1 text-left">
              <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase font-mono">
                <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-pink-500" /> ACCELERATION (0-100)</span>
                <span className="text-white font-extrabold">{carSpec.acceleration}</span>
              </div>
              <div className="h-1.5 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-pink-500 shadow-[0_0_8px_#ec4899] rounded-full transition-all duration-500"
                  style={{ width: carSpec.id === "bugatti" ? "95%" : carSpec.id === "porsche" ? "75%" : "72%" }}
                />
              </div>
            </div>

            {/* Handling */}
            <div className="space-y-1 text-left">
              <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase font-mono">
                <span className="flex items-center gap-1"><Activity className="w-3 h-3 text-emerald-400" /> HANDLING SPECS</span>
                <span className="text-white font-extrabold">{carSpec.handling} / 100</span>
              </div>
              <div className="h-1.5 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 shadow-[0_0_8px_#34d399] rounded-full transition-all duration-500"
                  style={{ width: `${carSpec.handling}%` }}
                />
              </div>
            </div>

            {/* Drivetrain and Color */}
            <div className="grid grid-cols-2 gap-3.5 pt-1">
              <div className="p-2.5 bg-white/[0.02] border border-white/5 rounded-xl flex flex-col justify-center text-left">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest font-mono">DRIVETRAIN</span>
                <span className="text-xs font-black text-white uppercase mt-0.5 tracking-wider">{carSpec.drivetrain}</span>
              </div>
              <div className="p-2.5 bg-white/[0.02] border border-white/5 rounded-xl flex flex-col justify-center text-left">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest font-mono">PAINT COLOR</span>
                <div className="flex items-center space-x-1.5 mt-1">
                  <div className="w-3 h-3 rounded-full border border-white/10 shrink-0 shadow-lg shadow-black/40" style={{ backgroundColor: carSpec.color }} />
                  <span className="text-[10px] font-mono text-white tracking-wide uppercase">{carSpec.color}</span>
                </div>
              </div>
            </div>
          </div>

          {/* DRIVER CAR SELECT DROPDOWN */}
          <div className="pt-2 text-left space-y-1.5 shrink-0">
            <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500 font-mono block">Modify Chosen Vehicle Spec</span>
            {isHost ? (
              <select
                value={activeCarId}
                onChange={(e) => handleCarChange(e.target.value)}
                className="bg-slate-950 border border-white/10 hover:border-purple-500/20 text-slate-100 font-bold text-xs p-3 rounded-xl outline-none cursor-pointer w-full transition text-left focus:ring-1 focus:ring-purple-500"
              >
                <option value="ferrari">Ferrari Purosangue (A-Class)</option>
                <option value="bugatti">Bugatti Chiron (Hyper-Class)</option>
                <option value="porsche">Porsche 911 GT3 (A-Class)</option>
              </select>
            ) : (
              <div className="bg-slate-950/80 border border-white/5 p-3 rounded-xl text-xs font-mono font-bold text-slate-500 flex items-center justify-between">
                <span>{carSpec.name}</span>
                <span className="text-[8px] bg-slate-900 border border-white/5 px-2 py-0.5 rounded uppercase tracking-wider text-amber-500 flex items-center space-x-1">
                  <Lock className="w-2.5 h-2.5 shrink-0" />
                  <span>Locked</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* COLUMN 3: SELECTED MAP & ACTION PANEL */}
        <div className="bg-slate-950/40 border border-white/5 p-6 rounded-3xl backdrop-blur-md flex flex-col space-y-4">
          <div className="flex justify-between items-center border-b border-white/5 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <MapIcon className="w-4 h-4 text-emerald-400" />
              <span>SELECTED MAP</span>
            </h3>
            {!isHost && (
              <span className="flex items-center space-x-1 text-[8px] font-mono text-amber-500 font-bold bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded uppercase">
                <Lock className="w-2.5 h-2.5" />
                <span>Locked by Host</span>
              </span>
            )}
          </div>

          {/* MAP DETAILS INFORMATION BLOCK */}
          <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl text-left">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[8px] font-black tracking-widest text-emerald-400 uppercase block font-mono">TRACK SECTOR</span>
                <span className="text-sm font-black text-white uppercase leading-tight tracking-tight">{mapSpec.name}</span>
              </div>
              <span className={`font-mono font-black text-[8px] tracking-wider px-2.5 py-1 rounded uppercase shadow-md ${
                mapSpec.difficulty === "easy"
                  ? "bg-emerald-600/30 text-emerald-400 border border-emerald-500/30"
                  : mapSpec.difficulty === "medium"
                    ? "bg-amber-600/30 text-amber-400 border border-amber-500/30"
                    : "bg-red-600/30 text-red-400 border border-red-500/30"
              }`}>
                {mapSpec.difficulty}
              </span>
            </div>
          </div>

          {/* MAP CONFIGURATION SPECIFICS */}
          <div className="flex-1 space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 bg-white/[0.02] border border-white/5 rounded-xl flex flex-col justify-center text-left">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest font-mono">TRACK LENGTH</span>
                <span className="text-xs font-black text-white mt-0.5">{mapSpec.trackLength}</span>
              </div>
              <div className="p-2.5 bg-white/[0.02] border border-white/5 rounded-xl flex flex-col justify-center text-left">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest font-mono">ENVIRONMENT</span>
                <span className="text-xs font-black text-white mt-0.5 uppercase">{mapSpec.environment}</span>
              </div>
            </div>

            {/* Host controllers for laps and weather */}
            <div className="space-y-3.5 text-left pt-1">
              {/* Laps */}
              <div className="flex flex-col space-y-1">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest font-mono">LAP COUNT LIMIT</span>
                {isHost ? (
                  <select
                    value={currentLaps}
                    onChange={(e) => handleLapsChange(parseInt(e.target.value))}
                    className="bg-slate-950 border border-white/10 hover:border-emerald-500/20 text-slate-200 font-bold text-xs p-2.5 rounded-xl outline-none cursor-pointer w-full transition focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value={1}>1 Lap (Sprint)</option>
                    <option value={2}>2 Laps (Standard)</option>
                    <option value={3}>3 Laps (Competitive)</option>
                    <option value={5}>5 Laps (Endurance)</option>
                    <option value={10}>10 Laps (Grand Prix)</option>
                  </select>
                ) : (
                  <div className="bg-slate-950/80 border border-white/5 p-2.5 rounded-xl text-xs font-sans font-black text-slate-300">
                    {currentLaps} Laps
                  </div>
                )}
              </div>

              {/* Weather */}
              <div className="flex flex-col space-y-1">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest font-mono">WEATHER ENVIRONMENT</span>
                {isHost ? (
                  <select
                    value={currentWeather}
                    onChange={(e) => handleWeatherChange(e.target.value)}
                    className="bg-slate-950 border border-white/10 hover:border-emerald-500/20 text-slate-200 font-bold text-xs p-2.5 rounded-xl outline-none cursor-pointer w-full transition focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="Clear">Clear Day</option>
                    <option value="Sunset">Golden Sunset</option>
                    <option value="Rainy">Tropical Rain</option>
                    <option value="Snowy">Blizzard White</option>
                    <option value="Foggy">Heavy Fog</option>
                    <option value="Dusty">Desert Sandstorm</option>
                  </select>
                ) : (
                  <div className="bg-slate-950/80 border border-white/5 p-2.5 rounded-xl text-xs font-sans font-black text-slate-300 capitalize">
                    {currentWeather}
                  </div>
                )}
              </div>

              {/* Map Selection Hidden */}
            </div>
          </div>

          {/* MAP DOWNLOAD STATUS PANEL */}
          {(room?.mapId === "race2map" || room?.mapId === "racing2") && (
            <div className="p-4 bg-slate-950/80 border border-white/5 rounded-2xl space-y-2 text-left">
              <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400 font-mono block">
                Map Download Status
              </span>
              {isCheckingCache ? (
                <div className="flex items-center space-x-2 text-xs text-slate-400 font-mono">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                  <span>Checking local map cache...</span>
                </div>
              ) : mapReadyLocal ? (
                <div className="space-y-1">
                  <div className="flex items-center space-x-2 text-xs text-emerald-400 font-mono font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>MAP VERIFIED & READY TO RACE</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono block">
                    Map loaded successfully from browser Cache Storage.
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-cyan-400 font-black animate-pulse">DOWNLOADING MAP ENVIRONMENT...</span>
                    <span className="text-white font-bold">{downloadProgress ?? 0}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-900 border border-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 shadow-[0_0_8px_#22d3ee] rounded-full transition-all duration-300"
                      style={{ width: `${downloadProgress ?? 0}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[9px] text-slate-400 font-mono">
                    <span>PROGRESS</span>
                    <span>{downloadedMB} MB / {totalMB} MB</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* LOBBY DECISIONS BAR / PANEL */}
      <div className="bg-slate-950/40 border border-white/5 p-6 rounded-3xl backdrop-blur-md select-none relative">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          
          {/* READY STATUS INFORMATION */}
          <div className="flex flex-col md:flex-row items-center gap-4 text-center md:text-left">
            <div className="bg-white/[0.03] border border-white/5 p-4 rounded-2xl min-w-[200px] flex flex-col justify-center">
              <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono block mb-1">Roster Readiness</span>
              {players.length < (room.maxPlayers || 3) ? (
                <>
                  <div className="text-xl font-black text-pink-500 font-mono tracking-wide uppercase flex items-center justify-center md:justify-start gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-pink-500 animate-ping" />
                    <span>{readyCount} / {totalCount} READY</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1.5 font-mono">
                    Waiting for {(room.maxPlayers || 3) - players.length} player(s) to connect
                  </span>
                </>
              ) : (
                <>
                  <div className={`text-xl font-black font-mono tracking-wide uppercase flex items-center justify-center md:justify-start gap-1.5 ${
                    allReady ? "text-emerald-400" : "text-amber-500"
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${allReady ? "bg-emerald-400" : "bg-amber-500 animate-pulse"}`} />
                    <span>{readyCount} / {totalCount} READY</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-1.5 font-mono">
                    {allReady 
                      ? "All grid positions ready to race!" 
                      : players.some(p => (room?.mapId === "race2map" || room?.mapId === "racing2") && !p.mapReady)
                        ? "Waiting for drivers to finish downloading map..."
                        : "Waiting for remaining drivers to click READY"
                    }
                  </span>
                </>
              )}
            </div>

            {/* COUNTDOWN TICKER OVERLAY */}
            {(room.status === "countdown" || room.status === "starting") && localSecondsLeft !== null && (
              <div className="flex items-center space-x-3 bg-pink-600/10 border border-pink-500/20 px-5 py-3 rounded-2xl animate-pulse">
                <div className="text-3xl font-mono font-black text-pink-500">{localSecondsLeft > 0 ? localSecondsLeft : "GO!"}</div>
                <div className="text-left">
                  <span className="text-[8px] font-black uppercase tracking-widest text-pink-400 block leading-none font-mono">{countdownMsg}</span>
                  <span className="text-[9px] text-slate-400">Loading virtual track environment...</span>
                </div>
              </div>
            )}
          </div>

          {/* DYNAMIC PLAYER ACTION DECISIONS */}
          <div className="flex flex-wrap items-center justify-center gap-3 w-full md:w-auto">
            {/* GUEST PLAYER READY BUTTON */}
            {!isHost && profile && players.some(p => p.uid === profile.uid) && (
              <button
                onClick={handleReadyToggle}
                disabled={(room?.mapId === "race2map" || room?.mapId === "racing2") && !mapReadyLocal}
                className={`px-8 py-4.5 font-black uppercase text-[11px] tracking-widest rounded-2xl transition duration-200 flex items-center justify-center space-x-2 shadow-lg min-w-[180px] ${
                  (room?.mapId === "race2map" || room?.mapId === "racing2") && !mapReadyLocal
                    ? "bg-slate-900 border border-white/5 text-slate-500 cursor-not-allowed"
                    : players.find(p => p.uid === profile.uid)?.ready
                      ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-emerald-600/10 border border-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                      : "bg-gradient-to-r from-rose-600 to-pink-500 text-white shadow-rose-600/10 border border-rose-500/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {players.find(p => p.uid === profile.uid)?.ready ? "READY (CANCEL)" : "READY UP NOW"}
                </span>
              </button>
            )}

            {/* HOST START RACE BUTTON */}
            {isHost && (
              <button
                onClick={() => {
                  if (allPlayersReady) {
                    NormalRoomService.setRoomStatus(normalizedCode, "racing");
                  }
                }}
                disabled={!allPlayersReady}
                className={`px-8 py-4.5 font-black uppercase text-[11px] tracking-widest rounded-2xl transition duration-200 flex items-center justify-center space-x-2 shadow-lg min-w-[200px] ${
                  allPlayersReady
                    ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-emerald-500/25 hover:brightness-110 hover:scale-[1.02] cursor-pointer active:scale-[0.98]"
                    : "bg-slate-900 border border-white/5 text-slate-500 cursor-not-allowed"
                }`}
              >
                {allPlayersReady ? (
                  <>
                    <Play className="w-4 h-4 shrink-0" />
                    <span>START THE RACE</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin text-slate-500" />
                    <span>WAITING FOR PLAYERS...</span>
                  </>
                )}
              </button>
            )}

            {/* LEAVE OR DISBAND ROOM BUTTON */}
            <button
              onClick={handleLeave}
              className="px-6 py-4.5 bg-slate-900 border border-white/5 text-red-400 hover:text-red-300 hover:bg-slate-800 font-extrabold uppercase text-[10px] tracking-widest rounded-2xl transition cursor-pointer flex items-center justify-center space-x-1.5"
            >
              {isHost ? (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>CANCEL ROOM</span>
                </>
              ) : (
                <>
                  <LogOut className="w-4 h-4" />
                  <span>LEAVE ROOM</span>
                </>
              )}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
