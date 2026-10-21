import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/firestoreError";
import { NormalRoomService, NormalRoom, NormalPlayer } from "../multiplayer/NormalRoomService";
import { RoomManager } from "../multiplayer/RoomManager";
import { measureServerTimeOffset } from "../multiplayer/multiplayerRaceStartSync";
import { loadRacingMap } from "../services/racingMapAsset";
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
  const [roomError, setRoomError] = useState<string | null>(null);
  const [loadedRoomCode, setLoadedRoomCode] = useState<string | null>(null);
  const [subscriptionAttempt, setSubscriptionAttempt] = useState(0);
  const leavingRef = useRef(false);
  const joinAttemptRef = useRef<string | null>(null);

  // Map downloading status state variables
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadedMB, setDownloadedMB] = useState<number>(0);
  const [totalMB, setTotalMB] = useState<number>(0);
  const [isCheckingCache, setIsCheckingCache] = useState<boolean>(true);
  const [mapReadyLocal, setMapReadyLocal] = useState<boolean>(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);

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
  const isMember = !!profile?.uid && !!room?.players.includes(profile.uid);
  const allPlayersReady = room ? (mapReadyLocal && players.length === (room.maxPlayers || 3) && players.every(p => p.ready === true && p.mapReady === true)) : false;
  const allReady = allPlayersReady;

  // 1. Real-time Firestore Subscriptions
  useEffect(() => {
    if (!normalizedCode || !profile?.uid) return;

    setLoading(true);
    setRoom(null);
    setPlayers([]);
    setRoomError(null);
    setLoadedRoomCode(null);
    joinAttemptRef.current = null;
    const onError = (error: Error) => {
      setRoomError(error.message);
      setLoading(false);
    };
    const unsubRoom = NormalRoomService.listenToRoom(normalizedCode, (updatedRoom) => {
      setRoom(updatedRoom);
      setLoadedRoomCode(normalizedCode);
      setLoading(false);
    }, onError);

    const unsubPlayers = NormalRoomService.listenToPlayers(normalizedCode, (updatedPlayers) => {
      setPlayers(updatedPlayers);
    }, onError);

    return () => {
      unsubRoom();
      unsubPlayers();
    };
  }, [normalizedCode, profile?.uid, subscriptionAttempt]);

  // 1c. Measure clock offset exactly once on entering the waiting room
  const measuredOffsetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!normalizedCode || !profile?.uid || !isMember) return;
    const key = `${normalizedCode}:${profile.uid}`;
    if (measuredOffsetRef.current === key) return;
    measuredOffsetRef.current = key;

    const runSync = async () => {
      try {
        await measureServerTimeOffset(normalizedCode, profile.uid);
      } catch (e) {
        console.error("Error during server clock calibration:", e);
      }
    };
    runSync();
  }, [normalizedCode, profile?.uid, isMember]);

  // 1b. Automatic Map Checking and Downloading Hook
  useEffect(() => {
    if (!isMember || !profile?.uid) return;
    let active = true;
    let lastWrite = 0;
    let writes = Promise.resolve();
    const uid = profile.uid;
    setMapReadyLocal(false);
    setMapError(null);
    setDownloadProgress(0);
    setIsCheckingCache(true);
    async function checkAndDownloadMap() {
      try {
        await NormalRoomService.updatePlayerDownloadStatus(normalizedCode, uid, false, 0, 0, 0);
        if (!active) return;
        let sizeMB = 0;
        if (room?.mapId === "race2map" || room?.mapId === "racing2") {
          const asset = await loadRacingMap((progress) => {
            if (!active) return;
            const loadedMB = progress.bytesLoaded / 1024 / 1024;
            const total = (progress.bytesTotal || 0) / 1024 / 1024;
            setIsCheckingCache(false);
            setDownloadProgress(progress.percentage);
            setDownloadedMB(loadedMB);
            setTotalMB(total);
            if (Date.now() - lastWrite >= 1000 && progress.percentage < 100) {
              lastWrite = Date.now();
              writes = writes.then(async () => {
                if (active) await NormalRoomService.updatePlayerDownloadStatus(normalizedCode, uid, false, progress.percentage, loadedMB, total);
              }).catch((error) => console.error("[Lobby] Download progress write failed:", error));
            }
          });
          sizeMB = asset.buffer.byteLength / 1024 / 1024;
        }
        await writes;
        if (!active) return;
        await NormalRoomService.updatePlayerDownloadStatus(normalizedCode, uid, true, 100, sizeMB, sizeMB);
        if (!active) return;
        setMapReadyLocal(true);
        setDownloadProgress(100);
        setDownloadedMB(sizeMB);
        setTotalMB(sizeMB);
        setIsCheckingCache(false);
      } catch (error) {
        console.error(`[Lobby] Map initialization failed in ${normalizedCode}:`, error);
        if (active) {
          setMapError(error instanceof Error ? error.message : String(error));
          setMapReadyLocal(false);
          setIsCheckingCache(false);
        }
      }
    }

    checkAndDownloadMap();

    return () => {
      active = false;
    };
  }, [room?.mapId, profile?.uid, normalizedCode, isMember, mapAttempt]);

  // 2. Automatically return to Garage if the room is canceled/deleted
  useEffect(() => {
    if (!loading && loadedRoomCode === normalizedCode && !room && !roomError) {
      const voluntary = sessionStorage.getItem("voluntarily_leaving_room");
      if (voluntary) {
        sessionStorage.removeItem("voluntarily_leaving_room");
      } else {
        console.log("Room deleted or canceled. Returning to garage.");
        sessionStorage.setItem("room_closed_no_opponents", "true");
      }
      RoomManager.clearSession(normalizedCode);
      navigate("/garage");
    }
  }, [room, loading, navigate, loadedRoomCode, normalizedCode, roomError]);

  // Track if local player became the Host during waiting lobby
  const prevHostIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!room) return;
    const activePlayerId = profile?.uid || RoomManager.getCurrentPlayerId();
    if (!activePlayerId) return;

    if (prevHostIdRef.current !== null && prevHostIdRef.current !== room.hostId) {
      if (room.hostId === activePlayerId) {
        toast.success("You are now the Room Host.", {
          position: "top-center"
        });
      }
    }
    prevHostIdRef.current = room.hostId || null;
  }, [room?.hostId, profile?.uid]);

  // 3. Auto-Join Trigger
  useEffect(() => {
    if (!room || isMember || leavingRef.current || roomError) return;
    const key = `${normalizedCode}:${profile?.uid}`;
    if (!loading && profile && joinAttemptRef.current !== key) {
      joinAttemptRef.current = key;
      NormalRoomService.joinRoom(normalizedCode, profile.uid, profile.name, profile.photoURL).catch((err) => {
        console.error("Auto-join failed:", err);
        setRoomError(err.message);
      });
    }
  }, [room, isMember, profile, loading, normalizedCode, roomError]);

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

    if (room.status !== "starting" || !isMember) {
      setLocalSecondsLeft(null);
      return;
    }

    let secondsLeft = 3;
    let launchTimer: ReturnType<typeof setTimeout> | undefined;
    setLocalSecondsLeft(secondsLeft);
    setCountdownMsg("GET READY");
    const interval = setInterval(() => {
      secondsLeft--;
      setLocalSecondsLeft(secondsLeft);
      if (secondsLeft > 0) return;
      clearInterval(interval);
      setCountdownMsg("GO!");
      launchTimer = setTimeout(() => {
        if (isHost && !leavingRef.current) {
          NormalRoomService.setRoomStatus(normalizedCode, "racing").catch((error) => {
            console.error("[Lobby] Race launch failed:", error);
            setRoomError(error.message);
          });
        }
      }, 600);
    }, 1000);

    return () => { clearInterval(interval); clearTimeout(launchTimer); };
  }, [room?.status, allReady, isHost, isMember, normalizedCode]);

  // Redirect to active race if state updates to racing
  useEffect(() => {
    if (isMember && (room?.status === "racing" || room?.status === "countdown")) {
      navigate(`/race/${normalizedCode}`);
    }
  }, [room?.status, isMember, navigate, normalizedCode]);

  const fallbackCopy = (text: string) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (fallbackErr) {
      console.error("Fallback copy failed:", fallbackErr);
    }
  };

  // Copy code helper
  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(normalizedCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch((err) => {
        console.warn("Clipboard writeText failed, trying fallback:", err);
        fallbackCopy(normalizedCode);
      });
    } catch (err) {
      console.warn("Clipboard writeText threw error, trying fallback:", err);
      fallbackCopy(normalizedCode);
    }
  };

  // Leave room triggers
  const handleLeave = async () => {
    if (!profile) return;
    leavingRef.current = true;
    try {
      sessionStorage.setItem("voluntarily_leaving_room", "true");
      await NormalRoomService.leaveOrCancelRoom(normalizedCode, profile.uid);
      navigate("/garage");
    } catch (err) {
      console.error("Error leaving room:", err);
      leavingRef.current = false;
      toast.error(err instanceof Error ? err.message : "Failed to leave room.");
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

  if (roomError) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white space-y-4 font-sans p-6">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p role="alert" className="text-sm text-red-300">{roomError}</p>
        <button className="px-4 py-2 bg-slate-900 rounded-lg" onClick={() => setSubscriptionAttempt((n) => n + 1)}>Retry connection</button>
        <button onClick={() => navigate("/garage")}>Return to Garage</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white space-y-4 font-sans select-none">
        <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
        <span className="text-[10px] tracking-widest text-slate-500 uppercase font-mono font-bold animate-pulse">
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

  let bottomStatusText = "WAITING FOR PLAYERS...";
  if (players.length < (room.maxPlayers || 3)) {
    bottomStatusText = `WAITING... NEED ${(room.maxPlayers || 3) - players.length} MORE`;
  } else if (room.status === "countdown" || room.status === "starting") {
    bottomStatusText = "COUNTDOWN IN PROGRESS";
  } else if (!allReady) {
    bottomStatusText = "WAITING FOR GRID READINESS...";
  } else if (allReady && isHost) {
    bottomStatusText = "ALL SYSTEMS READY • LAUNCH THE RACE";
  } else if (allReady && !isHost) {
    bottomStatusText = "WAITING FOR HOST LAUNCH SIGNAL...";
  }

  return (
    <div id="room-waiting-lobby" className="w-full h-screen max-h-screen bg-black text-white p-2 flex flex-col relative select-none leading-normal text-[10px] overflow-hidden">
      <div className="absolute w-[300px] h-[300px] bg-purple-600/5 rounded-full blur-[100px] pointer-events-none top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />

      {/* TOP BAR */}
      <div className="h-[12vh] min-h-[44px] max-h-[55px] bg-slate-950/90 border border-purple-500/30 p-2 rounded-xl shadow-[0_0_8px_rgba(168,85,247,0.15)] flex items-center justify-between gap-4 select-none shrink-0 relative z-10">
        {/* Left Side: Match Lobby Info */}
        <div className="flex flex-col text-left shrink-0">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_4px_#22d3ee]" />
            <span className="text-[8px] uppercase font-black text-cyan-400 tracking-wider font-mono">
              REAL-TIME MATCH LOBBY • {room.status === "countdown" ? "COUNTDOWN" : "WAITING"}
            </span>
          </div>
          <span className="text-[8px] font-mono text-amber-500 font-black uppercase tracking-wider mt-0.5 leading-none flex items-center gap-0.5">
            <Crown className="w-2.5 h-2.5 text-amber-400 shrink-0" />
            <span>HOST: {room.ownerName}</span>
          </span>
        </div>

        {/* Center: Arena Name */}
        <div className="text-center min-w-0 flex-1 px-2">
          <h2 className="text-[12px] md:text-sm font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400 truncate leading-none">
            {room.roomName || `${room.ownerName}'s Arena`}
          </h2>
        </div>

        {/* Right Side: Code, Status & Main Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Room Code */}
          <div className="flex items-center gap-1 bg-purple-950/30 border border-purple-500/20 px-2 py-0.5 rounded-md h-7">
            <span className="text-[7px] font-mono text-slate-400 uppercase">CODE:</span>
            <span className="text-[10px] font-black font-mono tracking-wider text-pink-400">{normalizedCode}</span>
            <button
              onClick={handleCopy}
              className="p-0.5 rounded bg-slate-900 border border-white/5 text-slate-300 hover:text-white transition active:scale-95 shrink-0 cursor-pointer"
              title="Copy Code"
            >
              <Copy className="w-2.5 h-2.5" />
            </button>
          </div>

          {/* Copy confirmation feedback */}
          {copied && (
            <span className="text-[7px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.5 rounded uppercase leading-none">
              COPIED
            </span>
          )}

          {/* Ready Ratio Indicator */}
          <div className="text-[8px] font-black text-slate-400 font-mono bg-slate-900/80 px-2 py-1 border border-white/5 rounded-md h-7 flex items-center shrink-0">
            READY: <span className="text-cyan-400 font-black ml-1">{readyCount}/{totalCount}</span>
          </div>

          {/* Large Host Start Race or Guest Ready button */}
          {isHost ? (
            <button
              onClick={() => {
                if (allPlayersReady) {
                  NormalRoomService.setRoomStatus(normalizedCode, "racing");
                }
              }}
              disabled={!allPlayersReady}
              className={`px-3 py-1 font-black uppercase text-[9px] tracking-wider rounded-md transition flex items-center justify-center gap-1 shadow-md shrink-0 h-7 ${
                allPlayersReady
                  ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-emerald-500/20 hover:brightness-110 active:scale-95 cursor-pointer"
                  : "bg-slate-900 border border-white/5 text-slate-500 cursor-not-allowed"
              }`}
            >
              {allPlayersReady ? <Play className="w-2.5 h-2.5" /> : <Loader2 className="w-2.5 h-2.5 animate-spin text-slate-500" />}
              <span>{allPlayersReady ? "START RACE" : "WAITING"}</span>
            </button>
          ) : (
            profile && players.some(p => p.uid === profile.uid) && (
              <button
                onClick={handleReadyToggle}
                disabled={(room?.mapId === "race2map" || room?.mapId === "racing2") && !mapReadyLocal}
                className={`px-3 py-1 font-black uppercase text-[9px] tracking-wider rounded-md transition flex items-center justify-center gap-1 shadow-md shrink-0 h-7 ${
                  (room?.mapId === "race2map" || room?.mapId === "racing2") && !mapReadyLocal
                    ? "bg-slate-900 border border-white/5 text-slate-500 cursor-not-allowed"
                    : players.find(p => p.uid === profile.uid)?.ready
                      ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white border border-emerald-500/20 active:scale-95 cursor-pointer"
                      : "bg-gradient-to-r from-rose-600 to-pink-500 text-white border border-rose-500/20 active:scale-95 cursor-pointer"
                }`}
              >
                <CheckCircle2 className="w-2.5 h-2.5" />
                <span>
                  {players.find(p => p.uid === profile.uid)?.ready ? "READY(CANCEL)" : "READY UP"}
                </span>
              </button>
            )
          )}

          {/* Disband/Leave button */}
          <button
            onClick={handleLeave}
            className="px-2.5 py-1 bg-slate-900 border border-white/5 text-red-400 hover:text-red-300 font-extrabold uppercase text-[8px] tracking-wider rounded-md transition cursor-pointer flex items-center gap-1 h-7 shrink-0"
          >
            {isHost ? <Trash2 className="w-2.5 h-2.5" /> : <LogOut className="w-2.5 h-2.5" />}
            <span>{isHost ? "CANCEL" : "LEAVE"}</span>
          </button>
        </div>
      </div>

      {/* CENTER AREA */}
      <div className="h-[74vh] flex gap-2 w-full min-h-0 shrink-0 relative z-10 mt-1.5">
        
        {/* LEFT PANEL (40% width): Active Racer Grid */}
        <div className="w-[40%] bg-slate-950/80 border border-purple-500/30 rounded-xl p-2 flex flex-col h-full min-h-0 shadow-[0_0_8px_rgba(168,85,247,0.1)] shrink-0">
          <div className="flex justify-between items-center border-b border-purple-500/20 pb-1 mb-1.5 shrink-0">
            <h3 className="text-[9px] font-black uppercase tracking-wider text-purple-400 flex items-center gap-1">
              <Users className="w-3 h-3 text-cyan-400 shrink-0" />
              <span>ACTIVE RACER GRID ({players.length} / {room.maxPlayers || 3})</span>
            </h3>
            <span className="text-[7px] font-mono text-cyan-400 font-bold bg-cyan-400/10 border border-cyan-400/20 px-1 py-0.5 rounded uppercase shrink-0">
              {players.length >= (room.maxPlayers || 3) ? "GRID SECURED" : "FILLING"}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 min-h-0">
            {Array.from({ length: room.maxPlayers || 3 }).map((_, idx) => {
              const plr = players[idx];
              if (plr) {
                const isPlayerHost = plr.uid === room.ownerUid;
                const localIsMe = profile && plr.uid === profile.uid;
                const plrCar = CARS_METADATA[plr.carId || "ferrari"] || CARS_METADATA.ferrari;

                return (
                  <div
                    key={plr.uid}
                    className="flex items-center justify-between bg-purple-950/10 border border-purple-500/20 p-1.5 rounded-lg gap-2 relative overflow-hidden shrink-0"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-cyan-400" />
                    
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {/* Avatar */}
                      <div className="w-6 h-6 rounded-full bg-slate-900 border border-purple-500/20 overflow-hidden flex items-center justify-center shrink-0">
                        {plr.photoURL ? (
                          <img src={plr.photoURL} alt={plr.playerName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <Compass className="w-3.5 h-3.5 text-cyan-400 rotate-45 animate-pulse" />
                        )}
                      </div>

                      {/* Name & Selected Car */}
                      <div className="flex flex-col min-w-0 text-left leading-none">
                        <div className="flex items-center gap-1 leading-none">
                          <span className="text-[9px] font-black text-white truncate max-w-[75px] uppercase">
                            {plr.playerName}
                          </span>
                          {localIsMe && (
                            <span className="bg-cyan-500/15 border border-cyan-500/25 text-[6px] text-cyan-400 font-black font-mono tracking-wider px-0.5 rounded uppercase shrink-0">
                              YOU
                            </span>
                          )}
                        </div>
                        <span className="text-[7px] font-mono text-slate-400 flex items-center gap-0.5 mt-0.5 leading-none">
                          <Car className="w-2 h-2 text-purple-400 shrink-0" />
                          <span className="truncate max-w-[80px]">{plrCar.name}</span>
                        </span>
                      </div>
                    </div>

                    {/* Badge and Ready Metrics */}
                    <div className="flex items-center gap-1 shrink-0">
                      {isPlayerHost && (
                        <span className="flex items-center bg-amber-500/10 border border-amber-500/25 text-amber-500 font-mono font-black text-[6px] tracking-wider px-1 py-0.5 rounded uppercase gap-0.5">
                          <Crown className="w-2 h-2 text-amber-400 shrink-0" />
                          <span>HOST</span>
                        </span>
                      )}
                      
                      <span className={`flex items-center font-mono font-black text-[6px] tracking-wider px-1 py-0.5 rounded uppercase border ${
                        plr.ready 
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                          : "bg-red-500/10 border-red-500/20 text-red-400"
                      }`}>
                        {plr.ready ? "READY" : "NOT READY"}
                      </span>

                      {/* Map Status indicator per player */}
                      {(room?.mapId === "race2map" || room?.mapId === "racing2") && (
                        <div className="shrink-0 w-14 text-right">
                          {plr.mapReady ? (
                            <span className="text-[6px] font-bold text-emerald-400 font-mono flex items-center gap-0.5 select-none justify-end">
                              <span className="w-1 h-1 rounded-full bg-emerald-400" />
                              MAP
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              <div className="flex justify-between text-[5px] font-mono text-slate-400 leading-none">
                                <span>DL</span>
                                <span>{plr.downloadProgress ?? 0}%</span>
                              </div>
                              <div className="h-0.5 w-full bg-slate-900 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-cyan-400 rounded-full transition-all duration-300"
                                  style={{ width: `${plr.downloadProgress ?? 0}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              {/* Empty Position slot */}
              return (
                <div
                  key={`empty-${idx}`}
                  className="flex items-center justify-between p-1.5 rounded-lg bg-slate-900/30 border border-dashed border-white/5 text-slate-500 min-h-[38px] shrink-0"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full border border-dashed border-white/10 flex items-center justify-center text-[8px] text-slate-600 font-mono">
                      {idx + 1}
                    </div>
                    <div className="flex flex-col text-left leading-none">
                      <span className="font-bold text-slate-500 uppercase tracking-wider text-[8px]">OPEN SLOT</span>
                      <span className="text-[6px] text-slate-600 uppercase">WAITING FOR DRIVER...</span>
                    </div>
                  </div>
                  <span className="animate-pulse text-cyan-400/40 text-[8px]">●</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANEL (60% width): Split into SELECTED CAR and SELECTED MAP */}
        <div className="w-[60%] h-full flex gap-2 min-w-0 shrink-0">
          
          {/* Card 1: SELECTED CAR */}
          <div className="bg-slate-950/80 border border-purple-500/30 rounded-xl p-2.5 flex flex-col h-full min-h-0 shadow-[0_0_8px_rgba(168,85,247,0.1)] w-1/2">
            <div className="flex justify-between items-center border-b border-purple-500/20 pb-1 shrink-0 mb-1.5">
              <h3 className="text-[9px] font-black uppercase tracking-wider text-purple-400 flex items-center gap-1">
                <Car className="w-3 h-3 text-purple-400 shrink-0" />
                <span>SELECTED VEHICLE</span>
              </h3>
              {!isHost && (
                <span className="flex items-center gap-0.5 text-[6px] font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1 py-0.5 rounded uppercase shrink-0">
                  <Lock className="w-2 h-2 shrink-0" />
                  <span>LOCKED</span>
                </span>
              )}
            </div>

            <div className="flex-1 min-h-0 flex flex-col justify-between">
              <div className="space-y-1.5">
                {/* Name Card with no images */}
                <div className="bg-purple-950/20 border border-purple-500/20 p-1.5 rounded-lg text-left">
                  <div className="flex justify-between items-start gap-1">
                    <div className="min-w-0">
                      <span className="text-[6px] font-mono font-black tracking-wider text-purple-400 uppercase block">{carSpec.manufacturer}</span>
                      <span className="text-[10px] font-black text-white uppercase leading-none tracking-tight truncate block">{carSpec.name}</span>
                    </div>
                    <span className="bg-purple-600/30 border border-purple-500/50 text-purple-300 font-mono font-black text-[7px] tracking-wider px-1 py-0.5 rounded uppercase leading-none shrink-0">
                      {carSpec.class}
                    </span>
                  </div>
                </div>

                {/* Tech Specs block */}
                <div className="grid grid-cols-2 gap-1.5 text-left text-[7px] font-mono">
                  <div className="bg-white/[0.02] border border-white/5 p-1 rounded-md leading-none">
                    <span className="text-slate-500 block text-[5px] mb-0.5">DRIVETRAIN</span>
                    <span className="text-white font-extrabold text-[8px]">{carSpec.drivetrain}</span>
                  </div>
                  <div className="bg-white/[0.02] border border-white/5 p-1 rounded-md leading-none">
                    <span className="text-slate-500 block text-[5px] mb-0.5">PAINT COLOR</span>
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full border border-white/10 shrink-0" style={{ backgroundColor: carSpec.color }} />
                      <span className="text-white text-[7px] uppercase truncate">{carSpec.color}</span>
                    </div>
                  </div>
                </div>

                {/* Telemetry specifications list */}
                <div className="space-y-1 text-left">
                  {/* Top Speed */}
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[7px] font-bold text-slate-400 uppercase font-mono leading-none">
                      <span className="flex items-center gap-0.5"><Gauge className="w-2.5 h-2.5 text-cyan-400" /> TOP SPEED</span>
                      <span className="text-white font-black">{carSpec.topSpeed} KM/H</span>
                    </div>
                    <div className="h-1 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-400 shadow-[0_0_4px_#22d3ee] rounded-full" style={{ width: `${(carSpec.topSpeed / 450) * 100}%` }} />
                    </div>
                  </div>

                  {/* Acceleration */}
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[7px] font-bold text-slate-400 uppercase font-mono leading-none">
                      <span className="flex items-center gap-0.5"><Zap className="w-2.5 h-2.5 text-pink-500" /> ACCELERATION</span>
                      <span className="text-white font-black">{carSpec.acceleration} (0-100)</span>
                    </div>
                    <div className="h-1 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-pink-500 shadow-[0_0_4px_#ec4899] rounded-full" style={{ width: activeCarId === "bugatti" ? "95%" : activeCarId === "porsche" ? "75%" : "72%" }} />
                    </div>
                  </div>

                  {/* Handling */}
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[7px] font-bold text-slate-400 uppercase font-mono leading-none">
                      <span className="flex items-center gap-0.5"><Activity className="w-2.5 h-2.5 text-emerald-400" /> HANDLING</span>
                      <span className="text-white font-black">{carSpec.handling} / 100</span>
                    </div>
                    <div className="h-1 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400 shadow-[0_0_4px_#34d399] rounded-full" style={{ width: `${carSpec.handling}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Host car modifier dropdown */}
              <div className="mt-1 shrink-0 text-left">
                <span className="text-[7px] uppercase font-bold tracking-wider text-slate-500 font-mono block mb-0.5">MODIFY SELECTED VEHICLE SPEC</span>
                {isHost ? (
                  <select
                    value={activeCarId}
                    onChange={(e) => handleCarChange(e.target.value)}
                    className="bg-slate-950 border border-purple-500/30 text-slate-100 font-bold text-[8px] p-1 rounded-md outline-none cursor-pointer w-full transition h-7 text-left"
                  >
                    <option value="ferrari">Ferrari Purosangue (A-Class)</option>
                    <option value="bugatti">Bugatti Chiron (Hyper-Class)</option>
                    <option value="porsche">Porsche 911 GT3 (A-Class)</option>
                  </select>
                ) : (
                  <div className="bg-slate-900 border border-white/5 p-1 px-1.5 rounded-md text-[8px] font-mono text-slate-400 flex items-center justify-between h-7">
                    <span className="truncate">{carSpec.name}</span>
                    <span className="text-[7px] uppercase text-amber-500 font-bold">LOCKED</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: SELECTED MAP */}
          <div className="bg-slate-950/80 border border-purple-500/30 rounded-xl p-2.5 flex flex-col h-full min-h-0 shadow-[0_0_8px_rgba(168,85,247,0.1)] w-1/2">
            <div className="flex justify-between items-center border-b border-purple-500/20 pb-1 shrink-0 mb-1.5">
              <h3 className="text-[9px] font-black uppercase tracking-wider text-purple-400 flex items-center gap-1">
                <MapIcon className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>ARENA SECTOR</span>
              </h3>
              {!isHost && (
                <span className="flex items-center gap-0.5 text-[6px] font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1 py-0.5 rounded uppercase shrink-0">
                  <Lock className="w-2 h-2 shrink-0" />
                  <span>LOCKED</span>
                </span>
              )}
            </div>

            <div className="flex-1 min-h-0 flex flex-col justify-between">
              <div className="space-y-1.5">
                {/* Map Title Card with no images */}
                <div className="bg-purple-950/20 border border-purple-500/20 p-1.5 rounded-lg text-left">
                  <div className="flex justify-between items-start gap-1">
                    <div className="min-w-0">
                      <span className="text-[6px] font-mono font-black tracking-wider text-emerald-400 uppercase block">TRACK MAP</span>
                      <span className="text-[10px] font-black text-white uppercase leading-none tracking-tight truncate block">{mapSpec.name}</span>
                    </div>
                    <span className={`font-mono font-black text-[6px] tracking-wider px-1 rounded uppercase shrink-0 py-0.5 border ${
                      mapSpec.difficulty === "easy"
                        ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/20"
                        : mapSpec.difficulty === "medium"
                          ? "bg-amber-600/20 text-amber-400 border-amber-500/20"
                          : "bg-red-600/20 text-red-400 border-red-500/20"
                    }`}>
                      {mapSpec.difficulty}
                    </span>
                  </div>
                </div>

                {/* Map Stats */}
                <div className="grid grid-cols-2 gap-1 px-0.5 text-[7px] font-mono text-left leading-none">
                  <div className="flex flex-col">
                    <span className="text-slate-500 text-[5px] uppercase font-bold">TRACK LENGTH</span>
                    <span className="text-white font-extrabold text-[8px] mt-0.5">{mapSpec.trackLength}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-slate-500 text-[5px] uppercase font-bold">ENVIRONMENT</span>
                    <span className="text-white font-extrabold uppercase text-[8px] mt-0.5 truncate">{mapSpec.environment}</span>
                  </div>
                </div>

                {/* Lap Limit and Weather Select dropdowns inline */}
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="flex flex-col text-left">
                    <span className="text-[6px] font-bold text-slate-500 uppercase tracking-wider font-mono mb-0.5">LAP COUNT</span>
                    {isHost ? (
                      <select
                        value={currentLaps}
                        onChange={(e) => handleLapsChange(parseInt(e.target.value))}
                        className="bg-slate-950 border border-purple-500/30 text-slate-200 font-bold text-[7.5px] p-1 rounded-md outline-none cursor-pointer w-full transition h-6"
                      >
                        <option value={1}>1 Lap</option>
                        <option value={2}>2 Laps</option>
                        <option value={3}>3 Laps</option>
                        <option value={5}>5 Laps</option>
                        <option value={10}>10 Laps</option>
                      </select>
                    ) : (
                      <div className="bg-slate-900 border border-white/5 p-1 rounded-md text-[7.5px] font-mono font-bold text-slate-300 h-6 flex items-center leading-none">
                        {currentLaps} Laps
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col text-left">
                    <span className="text-[6px] font-bold text-slate-500 uppercase tracking-wider font-mono mb-0.5">WEATHER</span>
                    {isHost ? (
                      <select
                        value={currentWeather}
                        onChange={(e) => handleWeatherChange(e.target.value)}
                        className="bg-slate-950 border border-purple-500/30 text-slate-200 font-bold text-[7.5px] p-1 rounded-md outline-none cursor-pointer w-full transition h-6"
                      >
                        <option value="Clear">Clear Day</option>
                        <option value="Sunset">Sunset</option>
                        <option value="Rainy">Rainy</option>
                        <option value="Snowy">Snowy</option>
                        <option value="Foggy">Foggy</option>
                        <option value="Dusty">Sandstorm</option>
                      </select>
                    ) : (
                      <div className="bg-slate-900 border border-white/5 p-1 rounded-md text-[7.5px] font-mono font-bold text-slate-300 capitalize h-6 flex items-center leading-none truncate font-sans">
                        {currentWeather}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Map cache verification and download status panel */}
              {(room?.mapId === "race2map" || room?.mapId === "racing2") && (
                <div className="p-1 px-1.5 bg-slate-900/60 border border-white/5 rounded-lg text-left shrink-0">
                  {mapError ? (
                    <div role="alert" className="text-[8px] text-rose-400 font-mono space-y-1">
                      <p className="max-h-16 overflow-y-auto break-words">{mapError}</p>
                      <button className="font-bold underline" onClick={() => setMapAttempt((attempt) => attempt + 1)}>RETRY MAP DOWNLOAD</button>
                    </div>
                  ) : isCheckingCache ? (
                    <div className="flex items-center gap-1 text-[6.5px] text-slate-400 font-mono leading-none py-0.5">
                      <Loader2 className="w-2 h-2 animate-spin text-cyan-400 shrink-0" />
                      <span>Verifying cache...</span>
                    </div>
                  ) : mapReadyLocal ? (
                    <div className="flex items-center gap-1 text-[7px] text-emerald-400 font-mono font-black leading-none py-0.5">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                      <span className="uppercase text-[6px]">MAP READY TO RACE</span>
                    </div>
                  ) : (
                    <div className="space-y-0.5 py-0.5">
                      <div className="flex justify-between items-center text-[5.5px] font-mono leading-none">
                        <span className="text-cyan-400 font-bold animate-pulse">DLING MAP...</span>
                        <span className="text-white">{downloadProgress ?? 0}%</span>
                      </div>
                      <div className="h-0.5 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500"
                          style={{ width: `${downloadProgress ?? 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* BOTTOM BAR */}
      <div className="h-[11vh] min-h-[36px] max-h-[46px] bg-slate-950/90 border border-purple-500/30 p-2 rounded-xl shadow-[0_0_8px_rgba(168,85,247,0.15)] flex items-center justify-between gap-4 select-none shrink-0 relative z-10 mt-1.5">
        {/* Left: Roster Ready Status */}
        <div className="flex flex-col text-left shrink-0 leading-none">
          <span className="text-[6.5px] uppercase tracking-wider text-slate-500 font-mono block">Roster Ready</span>
          <div className={`text-[10px] font-black font-mono tracking-wider uppercase flex items-center gap-1 mt-0.5 ${allReady ? "text-emerald-400" : "text-pink-500"}`}>
            <span className={`w-1 h-1 rounded-full ${allReady ? "bg-emerald-400" : "bg-pink-500 animate-pulse"}`} />
            <span>{readyCount} / {totalCount} READY</span>
          </div>
        </div>

        {/* Center: Live Status Telemetry message */}
        <div className="flex-1 flex items-center justify-center gap-1.5 px-2">
          <span className="text-[8px] font-black uppercase text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded tracking-wider animate-pulse truncate leading-none">
            {bottomStatusText}
          </span>
          {/* Active seconds left overlay in starting count */}
          {(room.status === "countdown" || room.status === "starting") && localSecondsLeft !== null && (
            <span className="text-[10px] font-mono font-black text-pink-500 px-1.5 py-0.5 bg-pink-500/10 border border-pink-500/30 rounded animate-bounce shrink-0 leading-none">
              {localSecondsLeft > 0 ? `LOBBY SECONDS: ${localSecondsLeft}` : "GO!"}
            </span>
          )}
        </div>

        {/* Right: Cancel/Leave button duplication or active helper indicator */}
        <div className="shrink-0 flex items-center">
          <button
            onClick={handleLeave}
            className="px-2 py-1 bg-rose-950/20 border border-rose-500/30 text-rose-400 font-black uppercase text-[8px] tracking-wider rounded-md transition hover:bg-rose-950/40 active:scale-95 cursor-pointer h-7 flex items-center gap-1 leading-none shrink-0"
          >
            {isHost ? <Trash2 className="w-2.5 h-2.5" /> : <LogOut className="w-2.5 h-2.5" />}
            <span>{isHost ? "CANCEL ROOM" : "LEAVE ROOM"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
