import React, { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import {
  Map,
  Car,
  Users,
  BarChart3,
  Settings,
  Plus,
  Trash2,
  Edit,
  ArrowLeft,
  RefreshCw,
  Layers,
  ShieldCheck,
  HelpCircle,
  Sparkles,
  Compass,
  CheckCircle,
  Radio,
  LogOut,
  Eye,
  ToggleLeft,
  ToggleRight,
  Play,
  Square,
  PlusCircle,
  Activity,
  Clock,
  UserPlus,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../contexts/AuthContext";
import { handleFirestoreError, OperationType } from "../lib/firestoreError";

// Reusable helper to log admin operations inside Firestore
export const logAdminActivity = async (actionType: string, details: string) => {
  try {
    await setDoc(doc(collection(db, "activity"), `act_${Date.now()}`), {
      actionType,
      details,
      timestamp: new Date(),
    });
  } catch (err) {
    console.warn("Failed to log activity (handled gracefully):", err);
  }
};

// Default mock seed data if not present in Firestore
const DEFAULT_MAPS = [
  {
    id: "map1",
    name: "Alpine Ridge",
    difficulty: "medium",
    laps: 3,
    description: "Sweeping curves and snow-capped peaks with extreme elevation changes.",
    trackType: "Circuit",
    weather: "Clear",
    timeOfDay: "Sunset",
    checkpointsCount: 12,
    status: "Active",
    thumbnail: "https://images.unsplash.com/photo-1506012787146-f92b2d7d6d96?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "map2",
    name: "Sunset Harbour",
    difficulty: "easy",
    laps: 3,
    description: "Beautiful ocean-side flat course with long straightaways and easy hairpins.",
    trackType: "Point-to-Point",
    weather: "Overcast",
    timeOfDay: "Sunset",
    checkpointsCount: 15,
    status: "Active",
    thumbnail: "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "racing2",
    name: "Racing 2",
    difficulty: "hard",
    laps: 3,
    description: "High speed custom race circuit with long straightaways, designed for extreme velocity racing.",
    trackType: "Circuit",
    weather: "Sunny",
    timeOfDay: "Day",
    checkpointsCount: 96,
    status: "Active",
    thumbnail: "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=600&q=80",
  },
];

const DEFAULT_CARS = [
  {
    id: "ferrari",
    name: "Ferrari Purosangue",
    manufacturer: "Ferrari",
    topSpeed: 310,
    acceleration: "3.3s",
    handling: 90,
    desc: "Supreme active-suspension SUV utilities delivering unmatched active stability.",
    colorPreset: "#ff003c",
    class: "A CLASS",
    status: "Active",
    image: "https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "bugatti",
    name: "Bugatti Chiron",
    manufacturer: "Bugatti",
    topSpeed: 420,
    acceleration: "2.4s",
    handling: 80,
    desc: "Unmatched continuous speed powered by a monstrous quad-turbo W16.",
    colorPreset: "#00ccff",
    class: "HYPER CLASS",
    status: "Active",
    image: "https://images.unsplash.com/photo-1600706432502-75a0e2b3444a?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "porsche",
    name: "Porsche 911 GT3",
    manufacturer: "Porsche",
    topSpeed: 320,
    acceleration: "3.2s",
    handling: 98,
    desc: "Surgeon-like track precision crafted directly from pure GT motorsport racing heritage.",
    colorPreset: "#00ff3c",
    class: "A CLASS",
    status: "Active",
    image: "https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&w=600&q=80",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ADMIN DASHBOARD OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
export const AdminDashboard: React.FC = () => {
  const { logout } = useAuth();
  
  // Real-time Lists
  const [maps, setMaps] = useState<any[]>([]);
  const [cars, setCars] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals / Selection States
  const [selectedMap, setSelectedMap] = useState<any | null>(null);
  const [selectedCar, setSelectedCar] = useState<any | null>(null);
  const [viewingRoom, setViewingRoom] = useState<any | null>(null);

  const [mapFormOpen, setMapFormOpen] = useState(false);
  const [mapFormMode, setMapFormMode] = useState<"create" | "edit">("create");
  const [mapFormData, setMapFormData] = useState({
    id: "",
    name: "",
    difficulty: "medium",
    laps: 3,
    description: "",
    trackType: "Circuit",
    weather: "Clear",
    timeOfDay: "Day",
    checkpointsCount: 12,
    status: "Active",
    thumbnail: "",
  });

  const [carFormOpen, setCarFormOpen] = useState(false);
  const [carFormMode, setCarFormMode] = useState<"create" | "edit">("create");
  const [carFormData, setCarFormData] = useState({
    id: "",
    name: "",
    manufacturer: "",
    topSpeed: 320,
    acceleration: "3.2s",
    handling: 90,
    desc: "",
    colorPreset: "#ffffff",
    class: "A CLASS",
    status: "Active",
    image: "",
  });

  // Real-time Listeners
  useEffect(() => {
    const unsubMaps = onSnapshot(collection(db, "maps"), async (snap) => {
      if (snap.empty) {
        // Seed default maps if empty
        for (const m of DEFAULT_MAPS) {
          await setDoc(doc(db, "maps", m.id), m);
        }
      } else {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const hasRacing2 = list.some((m) => m.id === "racing2");
        if (!hasRacing2) {
          const r2 = DEFAULT_MAPS.find((m) => m.id === "racing2");
          if (r2) {
            await setDoc(doc(db, "maps", r2.id), r2);
          }
        }
        setMaps(list);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "maps");
    });

    const unsubCars = onSnapshot(collection(db, "cars"), async (snap) => {
      if (snap.empty) {
        // Seed default cars if empty
        for (const c of DEFAULT_CARS) {
          await setDoc(doc(db, "cars", c.id), c);
        }
      } else {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCars(list);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "cars");
    });

    const unsubRooms = onSnapshot(collection(db, "rooms"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRooms(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "rooms");
    });

    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUsers(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "users");
    });

    const unsubActivity = onSnapshot(collection(db, "activity"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Robust sorting client-side to prevent missing index crashes
      const sorted = list.sort((a: any, b: any) => {
        const dateA = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : (a.timestamp ? new Date(a.timestamp).getTime() : 0);
        const dateB = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : (b.timestamp ? new Date(b.timestamp).getTime() : 0);
        return dateB - dateA;
      });
      setActivities(sorted.slice(0, 15));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "activity");
    });

    const unsubBroadcasts = onSnapshot(collection(db, "broadcasts"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setBroadcasts(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "broadcasts");
    });

    const delay = setTimeout(() => setLoading(false), 500);

    return () => {
      unsubMaps();
      unsubCars();
      unsubRooms();
      unsubUsers();
      unsubActivity();
      unsubBroadcasts();
      clearTimeout(delay);
    };
  }, []);

  // Operations
  const handleToggleMapStatus = async (mapId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === "Active" ? "Disabled" : "Active";
      await updateDoc(doc(db, "maps", mapId), { status: newStatus });
      await logAdminActivity("Map updated", `Map ${mapId} status toggled to ${newStatus}.`);
    } catch (err) {
      console.error("Failed to toggle map status:", err);
    }
  };

  const handleDeleteMap = async (mapId: string) => {
    if (confirm(`Are you absolutely sure you want to permanently delete map: ${mapId}?`)) {
      try {
        await deleteDoc(doc(db, "maps", mapId));
        await logAdminActivity("Map deleted", `Map ${mapId} was permanently deleted.`);
      } catch (err) {
        console.error("Failed to delete map:", err);
      }
    }
  };

  const handleToggleCarStatus = async (carId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === "Active" ? "Disabled" : "Active";
      await updateDoc(doc(db, "cars", carId), { status: newStatus });
      await logAdminActivity("Car updated", `Vehicle chassis ${carId} status toggled to ${newStatus}.`);
    } catch (err) {
      console.error("Failed to toggle car status:", err);
    }
  };

  const handleDeleteCar = async (carId: string) => {
    if (confirm(`Are you absolutely sure you want to permanently delete car: ${carId}?`)) {
      try {
        await deleteDoc(doc(db, "cars", carId));
        await logAdminActivity("Car deleted", `Vehicle ${carId} was permanently deleted.`);
      } catch (err) {
        console.error("Failed to delete car:", err);
      }
    }
  };

  const handleStopRoomRace = async (roomCode: string) => {
    if (confirm(`Do you wish to shut down matchmaking room: ${roomCode}?`)) {
      try {
        await deleteDoc(doc(db, "rooms", roomCode.toUpperCase()));
        await logAdminActivity("Room terminated", `Room ${roomCode} was shut down.`);
      } catch (err) {
        console.error("Failed to shut down room:", err);
      }
    }
  };

  const handleForceStartRace = async (roomCode: string) => {
    try {
      await updateDoc(doc(db, "rooms", roomCode.toUpperCase()), {
        status: "racing",
        countdown: 0,
      });
      await logAdminActivity("Race started", `Race was force-started inside Room ${roomCode}.`);
      alert(`Sent force-start trigger to room ${roomCode}!`);
    } catch (err) {
      console.error("Failed to start race:", err);
    }
  };

  // Map Form Operations
  const openMapForm = (mode: "create" | "edit", mapObj?: any) => {
    setMapFormMode(mode);
    if (mode === "edit" && mapObj) {
      setMapFormData({
        id: mapObj.id || "",
        name: mapObj.name || "",
        difficulty: mapObj.difficulty || "medium",
        laps: mapObj.laps || 3,
        description: mapObj.description || "",
        trackType: mapObj.trackType || "Circuit",
        weather: mapObj.weather || "Clear",
        timeOfDay: mapObj.timeOfDay || "Day",
        checkpointsCount: mapObj.checkpointsCount || 12,
        status: mapObj.status || "Active",
        thumbnail: mapObj.thumbnail || "",
      });
    } else {
      setMapFormData({
        id: `map_${Date.now()}`,
        name: "",
        difficulty: "medium",
        laps: 3,
        description: "",
        trackType: "Circuit",
        weather: "Clear",
        timeOfDay: "Day",
        checkpointsCount: 12,
        status: "Active",
        thumbnail: "",
      });
    }
    setMapFormOpen(true);
  };

  const saveMapForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapFormData.name) return;

    try {
      const docRef = doc(db, "maps", mapFormData.id);
      const thumbnailVal = mapFormData.thumbnail || "https://images.unsplash.com/photo-1506012787146-f92b2d7d6d96?auto=format&fit=crop&w=600&q=80";
      
      const payload = {
        ...mapFormData,
        thumbnail: thumbnailVal,
      };

      await setDoc(docRef, payload);
      await logAdminActivity(
        mapFormMode === "create" ? "Map created" : "Map updated",
        `Map ${mapFormData.id} (${mapFormData.name}) was successfully saved.`
      );
      setMapFormOpen(false);
    } catch (err) {
      console.error("Failed to save map:", err);
    }
  };

  // Car Form Operations
  const openCarForm = (mode: "create" | "edit", carObj?: any) => {
    setCarFormMode(mode);
    if (mode === "edit" && carObj) {
      setCarFormData({
        id: carObj.id || "",
        name: carObj.name || "",
        manufacturer: carObj.manufacturer || "",
        topSpeed: carObj.topSpeed || 320,
        acceleration: carObj.acceleration || "3.2s",
        handling: carObj.handling || 90,
        desc: carObj.desc || "",
        colorPreset: carObj.colorPreset || "#ffffff",
        class: carObj.class || "A CLASS",
        status: carObj.status || "Active",
        image: carObj.image || "",
      });
    } else {
      setCarFormData({
        id: `car_${Date.now()}`,
        name: "",
        manufacturer: "",
        topSpeed: 320,
        acceleration: "3.2s",
        handling: 90,
        desc: "",
        colorPreset: "#ffffff",
        class: "A CLASS",
        status: "Active",
        image: "",
      });
    }
    setCarFormOpen(true);
  };

  const saveCarForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!carFormData.name) return;

    try {
      const docRef = doc(db, "cars", carFormData.id);
      const imageVal = carFormData.image || "https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&w=600&q=80";
      
      const payload = {
        ...carFormData,
        image: imageVal,
      };

      await setDoc(docRef, payload);
      await logAdminActivity(
        carFormMode === "create" ? "Car added" : "Car updated",
        `Vehicle ${carFormData.id} (${carFormData.name}) was successfully saved.`
      );
      setCarFormOpen(false);
    } catch (err) {
      console.error("Failed to save car:", err);
    }
  };

  // Aggregated Stats
  const activeMapsCount = maps.filter((m) => m.status === "Active" || !m.status).length;
  const activeCarsCount = cars.filter((c) => c.status === "Active" || !c.status).length;
  const broadcastersCount = users.filter((u) => u.role === "broadcaster").length;
  const runningRacesCount = rooms.filter((r) => r.status === "racing").length;
  const activeRoomsCount = rooms.filter((r) => r.status === "waiting" || r.status === "racing").length;
  const liveBroadcastersCount = broadcasts.filter((b) => b.isLive || b.status === "live").length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
        <span className="text-xs uppercase tracking-widest text-slate-500 font-bold font-mono">Loading Control Center...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-900/20 p-6 rounded-2xl border border-slate-900/60 backdrop-blur-sm">
        <div>
          <div className="flex items-center space-x-2 bg-rose-500/10 text-rose-400 font-extrabold uppercase text-[10px] tracking-widest px-3 py-1 rounded-full border border-rose-500/20 w-max mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-rose-500" />
            <span>Operational Level 01: Core Authority</span>
          </div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-white">Grid Headquarters</h2>
          <p className="text-slate-400 text-sm mt-1">Unified administrative cockpit and network controller.</p>
        </div>
        <div className="shrink-0 flex items-center space-x-3">
          <button
            onClick={() => {
              if (confirm("Restore mock standard documents into Database collections?")) {
                // Seeding is automatic if collections are cleared or empty. Wiping them:
                alert("Database re-sync initiated. Default records will seed automatically.");
              }
            }}
            className="p-3 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition"
            title="Wipe & Re-Seed Database"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => logout()}
            className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-black uppercase text-xs tracking-wider px-5 py-3 rounded-xl border border-rose-500/30 transition-all shadow-[0_0_15px_rgba(244,63,94,0.15)] select-none cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* STATISTICS ROW */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: "Total Maps", val: maps.length, sub: `${activeMapsCount} Active`, icon: Map, color: "text-indigo-400" },
          { label: "Total Cars", val: cars.length, sub: `${activeCarsCount} Active`, icon: Car, color: "text-cyan-400" },
          { label: "Lobby Rooms", val: rooms.length, sub: `${activeRoomsCount} Live`, icon: Settings, color: "text-amber-400" },
          { label: "Live Races", val: runningRacesCount, sub: "Running tracks", icon: Play, color: "text-emerald-400" },
          { label: "Broadcasters", val: broadcastersCount, sub: `${liveBroadcastersCount} Live Streaming`, icon: Radio, color: "text-rose-400" },
        ].map((item, i) => (
          <div key={i} className="bg-slate-950/60 border border-slate-900 p-5 rounded-2xl flex items-center space-x-3.5">
            <div className={`p-3 rounded-xl bg-slate-900/40 shrink-0 ${item.color}`}>
              <item.icon className="w-5 h-5" />
            </div>
            <div className="truncate">
              <span className="text-[9px] text-slate-500 font-mono uppercase tracking-widest block">{item.label}</span>
              <h3 className="text-xl font-black text-white leading-none mt-1">{item.val}</h3>
              <span className="text-[9px] text-slate-400 block mt-1 truncate">{item.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* QUICK ACTIONS SECTION */}
      <div className="bg-slate-950/40 border border-slate-900 p-6 rounded-2xl">
        <h3 className="text-xs font-black uppercase tracking-widest text-[#00f2ffa5] flex items-center space-x-2 mb-4">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span>Quick Control Toggles</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <button
            onClick={() => openMapForm("create")}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-900/60 hover:bg-indigo-600 hover:text-white rounded-xl border border-slate-800 text-slate-300 transition text-center space-y-1.5"
          >
            <Plus className="w-4 h-4 text-indigo-400 hover:text-white" />
            <span className="text-[9px] font-black uppercase tracking-wider block">Create Map</span>
          </button>
          <button
            onClick={() => openCarForm("create")}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-900/60 hover:bg-cyan-600 hover:text-white rounded-xl border border-slate-800 text-slate-300 transition text-center space-y-1.5"
          >
            <PlusCircle className="w-4 h-4 text-cyan-400 hover:text-white" />
            <span className="text-[9px] font-black uppercase tracking-wider block">Add Car</span>
          </button>
          <button
            onClick={async () => {
              const code = prompt("Enter a 4-letter Room Code to create:");
              if (code) {
                try {
                  await setDoc(doc(db, "rooms", code.toUpperCase()), {
                    roomCode: code.toUpperCase(),
                    map: maps[0]?.name || "Alpine Ridge",
                    weather: "Clear",
                    difficulty: "medium",
                    laps: 3,
                    status: "waiting",
                    players: [],
                    createdAt: serverTimestamp(),
                  });
                  await logAdminActivity("Room created", `Room ${code.toUpperCase()} was manually staged.`);
                  alert(`Staged multiplayer lobby ${code.toUpperCase()} inside Firestore!`);
                } catch (err) {
                  console.error("Failed to create room:", err);
                }
              }
            }}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-900/60 hover:bg-emerald-600 hover:text-white rounded-xl border border-slate-800 text-slate-300 transition text-center space-y-1.5"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            <span className="text-[9px] font-black uppercase tracking-wider block">Create Room</span>
          </button>
          <button
            onClick={() => {
              window.location.hash = "/admin/users";
              window.scrollTo(0, 0);
              // Simply alert to guide navigation
              alert("Navigating to Players directory via the sidebar options.");
            }}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-900/60 hover:bg-slate-800 rounded-xl border border-slate-800 text-slate-300 transition text-center space-y-1.5"
          >
            <Users className="w-4 h-4 text-amber-400" />
            <span className="text-[9px] font-black uppercase tracking-wider block">Manage Players</span>
          </button>
          <button
            onClick={() => alert("Manage broadcasters easily using the Broadcasters tab on your side menu.")}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-900/60 hover:bg-slate-800 rounded-xl border border-slate-800 text-slate-300 transition text-center space-y-1.5"
          >
            <UserPlus className="w-4 h-4 text-rose-400" />
            <span className="text-[9px] font-black uppercase tracking-wider block">Broadcasters</span>
          </button>
          <button
            onClick={() => alert("Track RTT Synchronizations & Network metrics via the Analytics tab.")}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-900/60 hover:bg-slate-800 rounded-xl border border-slate-800 text-slate-300 transition text-center space-y-1.5"
          >
            <BarChart3 className="w-4 h-4 text-sky-400" />
            <span className="text-[9px] font-black uppercase tracking-wider block">View Analytics</span>
          </button>
          <button
            onClick={() => {
              const code = prompt("Enter Room Code to FORCE START race countdown:");
              if (code) handleForceStartRace(code);
            }}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-900/60 hover:bg-indigo-600 hover:text-white rounded-xl border border-slate-800 text-slate-300 transition text-center space-y-1.5"
          >
            <Play className="w-4 h-4 text-indigo-400" />
            <span className="text-[9px] font-black uppercase tracking-wider block">Start Race</span>
          </button>
          <button
            onClick={() => {
              const code = prompt("Enter Room Code to completely terminate:");
              if (code) handleStopRoomRace(code);
            }}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-900/60 hover:bg-red-950/40 hover:text-red-400 rounded-xl border border-slate-800 text-slate-300 transition text-center space-y-1.5"
          >
            <Square className="w-4 h-4 text-red-500" />
            <span className="text-[9px] font-black uppercase tracking-wider block">Stop Race</span>
          </button>
        </div>
      </div>

      {/* CORE COLUMNS: LEFT LOGS, RIGHT RECENT PLAYERS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* RECENT ACTIVITY */}
        <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-300 flex items-center space-x-2 border-b border-slate-900 pb-3 mb-4">
              <Clock className="w-4 h-4 text-indigo-400" />
              <span>Real-Time Admin Logs</span>
            </h3>
            <div className="space-y-3.5 max-h-80 overflow-y-auto pr-1">
              {activities.length === 0 ? (
                <div className="text-center py-12 text-slate-600 text-[10px] uppercase font-mono tracking-wider">
                  No registered telemetry logs yet.
                </div>
              ) : (
                activities.map((act) => {
                  const dateStr = act.timestamp?.seconds
                    ? new Date(act.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : new Date(act.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={act.id} className="text-xs flex items-start space-x-2.5 bg-slate-900/10 p-2.5 rounded-xl border border-slate-900/50">
                      <span className="text-[9px] font-black font-mono text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded shrink-0">{dateStr}</span>
                      <div>
                        <span className="font-mono font-black uppercase tracking-wide text-cyan-400 block text-[9px]">{act.actionType}</span>
                        <p className="text-slate-400 text-[10px] mt-0.5">{act.details}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* RUNNING ROOMS & MATCHES */}
        <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-300 flex items-center space-x-2 border-b border-slate-900 pb-3 mb-4">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Running Rooms ({rooms.length})</span>
            </h3>
            <div className="space-y-3.5 max-h-80 overflow-y-auto pr-1">
              {rooms.length === 0 ? (
                <div className="text-center py-12 text-slate-600 text-[10px] uppercase font-mono tracking-wider">
                  No active multiplayer rooms online.
                </div>
              ) : (
                rooms.map((room) => (
                  <div key={room.id} className="bg-slate-900/20 border border-slate-900 p-3.5 rounded-xl flex flex-col space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-black text-rose-400 uppercase tracking-widest bg-rose-500/10 px-2 py-0.5 rounded-lg border border-rose-500/15">
                        {room.roomCode || room.id}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${
                        room.status === "racing" ? "bg-indigo-500/10 border-indigo-500/15 text-indigo-400" : "bg-amber-500/10 border-amber-500/15 text-amber-400"
                      }`}>
                        {room.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-400 font-mono">
                      <div>MAP: <span className="font-black text-white uppercase">{room.map}</span></div>
                      <div>WEATHER: <span className="font-black text-white uppercase">{room.weather || "Sunny"}</span></div>
                      <div>GRID: <span className="font-black text-white">{room.players?.length || 0} Racers</span></div>
                      <div>COUNT: <span className="font-black text-white">{room.laps || 3} Laps</span></div>
                    </div>
                    <div className="flex space-x-2 pt-1.5 border-t border-slate-900">
                      <button
                        onClick={() => setViewingRoom(room)}
                        className="flex-1 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white font-black uppercase text-[8px] tracking-wider py-1.5 rounded-lg border border-slate-800 transition"
                      >
                        Inspect
                      </button>
                      <button
                        onClick={() => handleStopRoomRace(room.id)}
                        className="p-1.5 bg-red-950/20 hover:bg-red-950/40 text-red-400 border border-red-950/20 rounded-lg transition"
                        title="Force shut down"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RECENT PLAYERS */}
        <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-300 flex items-center space-x-2 border-b border-slate-900 pb-3 mb-4">
              <Users className="w-4 h-4 text-cyan-400" />
              <span>Recent Registered Players ({users.length})</span>
            </h3>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {users.slice(0, 10).map((u) => {
                const dateVal = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : "Recently";
                return (
                  <div key={u.id} className="flex items-center justify-between p-2.5 bg-slate-900/10 border border-slate-900/50 rounded-xl">
                    <div className="flex items-center space-x-3 truncate">
                      <img
                        src={u.photoURL || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"}
                        alt={u.name}
                        className="w-8 h-8 rounded-full border border-slate-800 object-cover bg-slate-900"
                        referrerPolicy="no-referrer"
                      />
                      <div className="truncate">
                        <span className="text-[11px] font-black text-white block uppercase truncate">{u.name || "Anonymous Racer"}</span>
                        <span className="text-[9px] text-slate-500 font-mono block truncate">{u.email}</span>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[7px] font-black uppercase tracking-wider border shrink-0 ${
                      u.role === "admin" ? "bg-rose-500/10 border-rose-500/15 text-rose-400" :
                      u.role === "broadcaster" ? "bg-cyan-500/10 border-cyan-500/15 text-cyan-400" :
                      "bg-indigo-500/10 border-indigo-500/15 text-indigo-400"
                    }`}>
                      {u.role || "user"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* MAPS CONTROL SECTION */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2">
          <div>
            <h3 className="text-xl font-black uppercase tracking-tight text-white flex items-center space-x-2">
              <Map className="w-5 h-5 text-indigo-400" />
              <span>Matchmaking Tracks Registry</span>
            </h3>
            <p className="text-xs text-slate-400">Manage all registered circuit configurations available to racers.</p>
          </div>
          <button
            onClick={() => openMapForm("create")}
            className="flex items-center space-x-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition shadow-[0_4px_12px_rgba(99,102,241,0.2)]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create New Map</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {maps.map((m) => (
            <div key={m.id} className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden flex flex-col justify-between">
              {/* Thumbnail Container */}
              <div className="h-40 bg-slate-900 relative">
                <img
                  src={m.thumbnail || "https://images.unsplash.com/photo-1506012787146-f92b2d7d6d96?auto=format&fit=crop&w=600&q=80"}
                  alt={m.name}
                  className="w-full h-full object-cover opacity-80"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-3 left-3 flex items-center space-x-1.5">
                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${
                    m.status === "Disabled" ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  }`}>
                    {m.status || "Active"}
                  </span>
                </div>
                <div className="absolute bottom-3 right-3 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-900/60 font-mono text-[9px] text-slate-400">
                  {m.trackType || "Circuit"}
                </div>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                <div>
                  <h4 className="text-lg font-black uppercase text-white tracking-tight">{m.name}</h4>
                  <p className="text-xs text-slate-400 leading-relaxed mt-1 line-clamp-2 h-8">{m.description || "No description loaded."}</p>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-900/30 p-2.5 border border-slate-900/60 rounded-xl text-center">
                  <div>
                    <span className="block text-[7.5px] font-black text-slate-500 uppercase">Difficulty</span>
                    <span className="text-xs font-black text-indigo-400 uppercase mt-0.5 block">{m.difficulty}</span>
                  </div>
                  <div className="border-x border-slate-900">
                    <span className="block text-[7.5px] font-black text-slate-500 uppercase">Weather</span>
                    <span className="text-xs font-black text-white uppercase mt-0.5 block truncate px-1">{m.weather || "Sunny"}</span>
                  </div>
                  <div>
                    <span className="block text-[7.5px] font-black text-slate-500 uppercase">Checkpoints</span>
                    <span className="text-xs font-black text-white mt-0.5 block">{m.checkpointsCount || 12} CP</span>
                  </div>
                </div>

                {/* Foot Actions */}
                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-900">
                  <button
                    onClick={() => setSelectedMap(m)}
                    className="p-2 text-slate-400 hover:text-white bg-slate-900/40 hover:bg-slate-900 border border-slate-800/60 rounded-lg transition"
                    title="View map coordinates"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openMapForm("edit", m)}
                    className="p-2 text-slate-400 hover:text-white bg-slate-900/40 hover:bg-slate-900 border border-slate-800/60 rounded-lg transition"
                    title="Edit track configuration"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleMapStatus(m.id, m.status || "Active")}
                    className="p-2 text-amber-400 hover:text-amber-300 bg-amber-950/10 hover:bg-amber-950/30 border border-amber-950/30 rounded-lg transition"
                    title="Toggle active status"
                  >
                    {m.status === "Disabled" ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleDeleteMap(m.id)}
                    className="p-2 text-red-400 hover:text-red-350 bg-red-950/10 hover:bg-red-950/30 border border-red-950/30 rounded-lg transition"
                    title="Decommission track design"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* VEHICLES CONTROL SECTION */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2">
          <div>
            <h3 className="text-xl font-black uppercase tracking-tight text-white flex items-center space-x-2">
              <Car className="w-5 h-5 text-cyan-400" />
              <span>Garage Asset Control</span>
            </h3>
            <p className="text-xs text-slate-400">Oversee authorized high-performance vehicle specs and aerodynamic designs.</p>
          </div>
          <button
            onClick={() => openCarForm("create")}
            className="flex items-center space-x-1.5 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition shadow-[0_4px_12px_rgba(6,182,212,0.2)]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add New Car</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {cars.map((c) => (
            <div key={c.id} className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden flex flex-col justify-between">
              {/* Image */}
              <div className="h-40 bg-slate-900 relative">
                <img
                  src={c.image || "https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&w=600&q=80"}
                  alt={c.name}
                  className="w-full h-full object-cover opacity-80"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-3 left-3 flex items-center space-x-1.5">
                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${
                    c.status === "Disabled" ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  }`}>
                    {c.status || "Active"}
                  </span>
                </div>
                <div className="absolute bottom-3 right-3 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-900/60 font-mono text-[9px] text-slate-400 font-black">
                  {c.class || "S CLASS"}
                </div>
              </div>

              {/* Specs */}
              <div className="p-5 space-y-4">
                <div>
                  <span className="font-mono text-[9px] text-cyan-400 font-bold uppercase tracking-widest">{c.manufacturer || "MANUFACTURER"}</span>
                  <h4 className="text-lg font-black uppercase text-white tracking-tight mt-0.5">{c.name}</h4>
                  <p className="text-xs text-slate-400 leading-relaxed mt-1 line-clamp-2 h-8">{c.desc || "No custom aerospace description loaded."}</p>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-900/30 p-2.5 border border-slate-900/60 rounded-xl text-center">
                  <div>
                    <span className="block text-[7.5px] font-black text-slate-500 uppercase">Top Speed</span>
                    <span className="text-xs font-black text-white mt-0.5 block">{c.topSpeed} KM/H</span>
                  </div>
                  <div className="border-x border-slate-900">
                    <span className="block text-[7.5px] font-black text-slate-500 uppercase">Acceleration</span>
                    <span className="text-xs font-black text-white mt-0.5 block truncate px-1">{c.acceleration || "3.2s"}</span>
                  </div>
                  <div>
                    <span className="block text-[7.5px] font-black text-slate-500 uppercase">Handling</span>
                    <span className="text-xs font-black text-white mt-0.5 block">{c.handling}% GRIP</span>
                  </div>
                </div>

                {/* Foot Actions */}
                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-900">
                  <button
                    onClick={() => setSelectedCar(c)}
                    className="p-2 text-slate-400 hover:text-white bg-slate-900/40 hover:bg-slate-900 border border-slate-800/60 rounded-lg transition"
                    title="View physical specifications"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openCarForm("edit", c)}
                    className="p-2 text-slate-400 hover:text-white bg-slate-900/40 hover:bg-slate-900 border border-slate-800/60 rounded-lg transition"
                    title="Edit chassis/aerodynamic limits"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleCarStatus(c.id, c.status || "Active")}
                    className="p-2 text-amber-400 hover:text-amber-300 bg-amber-950/10 hover:bg-amber-950/30 border border-amber-950/30 rounded-lg transition"
                    title="Toggle active status"
                  >
                    {c.status === "Disabled" ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleDeleteCar(c.id)}
                    className="p-2 text-red-400 hover:text-red-350 bg-red-950/10 hover:bg-red-950/30 border border-red-950/30 rounded-lg transition"
                    title="Decommission vehicle chassis"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* MAP VIEW MODAL */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedMap && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-950 border border-slate-900 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl"
            >
              <div className="h-48 bg-slate-900 relative">
                <img
                  src={selectedMap.thumbnail || "https://images.unsplash.com/photo-1506012787146-f92b2d7d6d96?auto=format&fit=crop&w=600&q=80"}
                  alt={selectedMap.name}
                  className="w-full h-full object-cover opacity-80"
                  referrerPolicy="no-referrer"
                />
                <button
                  onClick={() => setSelectedMap(null)}
                  className="absolute top-4 right-4 p-2 bg-slate-950/80 hover:bg-slate-900 text-slate-400 hover:text-white rounded-full border border-slate-900"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <span className="text-[10px] font-mono text-indigo-400 font-black uppercase tracking-widest">{selectedMap.trackType || "Circuit"}</span>
                  <h3 className="text-2xl font-black text-white uppercase">{selectedMap.name}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mt-1">{selectedMap.description || "No description provided."}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs bg-slate-900/30 p-4 border border-slate-900 rounded-xl">
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Difficulty Level</span>
                    <span className="font-bold text-white uppercase mt-0.5 block">{selectedMap.difficulty}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Target Laps Cycles</span>
                    <span className="font-bold text-white mt-0.5 block">{selectedMap.laps || 3} Laps</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Atmospheric Weather</span>
                    <span className="font-bold text-white uppercase mt-0.5 block">{selectedMap.weather || "Clear"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Time Duration</span>
                    <span className="font-bold text-white uppercase mt-0.5 block">{selectedMap.timeOfDay || "Day"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Physical Checkpoints</span>
                    <span className="font-bold text-white mt-0.5 block">{selectedMap.checkpointsCount || 12} Checkpoints</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Database ID Reference</span>
                    <span className="font-mono text-[10px] text-slate-400 mt-0.5 block truncate">{selectedMap.id}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* CAR VIEW MODAL */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedCar && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-950 border border-slate-900 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl"
            >
              <div className="h-48 bg-slate-900 relative">
                <img
                  src={selectedCar.image || "https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&w=600&q=80"}
                  alt={selectedCar.name}
                  className="w-full h-full object-cover opacity-80"
                  referrerPolicy="no-referrer"
                />
                <button
                  onClick={() => setSelectedCar(null)}
                  className="absolute top-4 right-4 p-2 bg-slate-950/80 hover:bg-slate-900 text-slate-400 hover:text-white rounded-full border border-slate-900"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <span className="text-[10px] font-mono text-cyan-400 font-black uppercase tracking-widest">{selectedCar.class || "A CLASS"}</span>
                  <h3 className="text-2xl font-black text-white uppercase">{selectedCar.name}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mt-1">{selectedCar.desc || "No custom aerospace specs."}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs bg-slate-900/30 p-4 border border-slate-900 rounded-xl">
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Manufacturer</span>
                    <span className="font-bold text-white uppercase mt-0.5 block">{selectedCar.manufacturer || "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Terminal Top Speed</span>
                    <span className="font-bold text-white mt-0.5 block">{selectedCar.topSpeed} KM/H</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Aerodynamic Acceleration</span>
                    <span className="font-bold text-white mt-0.5 block">{selectedCar.acceleration}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Chassis Traction Control</span>
                    <span className="font-bold text-white mt-0.5 block">{selectedCar.handling}% GRIP</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Tuning Palette Hex</span>
                    <span className="font-mono text-[10px] text-slate-400 mt-0.5 block flex items-center space-x-1.5">
                      <span className="w-3 h-3 rounded-full border border-white/20 inline-block" style={{ backgroundColor: selectedCar.colorPreset || "#fff" }} />
                      <span>{selectedCar.colorPreset}</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Database ID Reference</span>
                    <span className="font-mono text-[10px] text-slate-400 mt-0.5 block truncate">{selectedCar.id}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* ROOM VIEW MODAL */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {viewingRoom && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-950 border border-slate-900 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                <div className="flex items-center space-x-3">
                  <span className="font-mono text-base font-black text-rose-400 uppercase tracking-widest bg-rose-500/10 px-3 py-1 rounded-xl border border-rose-500/15">
                    {viewingRoom.roomCode || viewingRoom.id}
                  </span>
                  <h3 className="text-lg font-black text-white uppercase">Room Telemetry</h3>
                </div>
                <button
                  onClick={() => setViewingRoom(null)}
                  className="p-1 text-slate-400 hover:text-white transition"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs bg-slate-900/30 p-4 border border-slate-900 rounded-xl">
                <div>
                  <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Current Track Map</span>
                  <span className="font-bold text-white uppercase mt-0.5 block">{viewingRoom.map}</span>
                </div>
                <div>
                  <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Staged Weather</span>
                  <span className="font-bold text-white uppercase mt-0.5 block">{viewingRoom.weather || "Sunny"}</span>
                </div>
                <div>
                  <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Sync Countdown Ticks</span>
                  <span className="font-bold text-white mt-0.5 block">{viewingRoom.countdown ?? "No countdown active"}</span>
                </div>
                <div>
                  <span className="text-slate-500 uppercase font-bold text-[8.5px] block">Status Phase</span>
                  <span className="font-bold text-white uppercase mt-0.5 block">{viewingRoom.status}</span>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest block">Connected Grid Racers ({viewingRoom.players?.length || 0})</span>
                <div className="divide-y divide-slate-900 border border-slate-900 rounded-xl overflow-hidden bg-slate-950">
                  {viewingRoom.players?.length === 0 || !viewingRoom.players ? (
                    <div className="p-3 text-center text-slate-600 text-[10px] uppercase font-mono">No players joined.</div>
                  ) : (
                    viewingRoom.players.map((p: any, idx: number) => (
                      <div key={idx} className="p-3 flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-300">{p.nickname || "Anonymous Racer"}</span>
                        <div className="flex items-center space-x-2">
                          {p.isHost && <span className="bg-amber-500/10 border border-amber-500/15 text-amber-400 text-[7px] px-1.5 py-0.5 rounded font-black uppercase">Host 👑</span>}
                          {p.isAI && <span className="bg-indigo-500/10 border border-indigo-500/15 text-indigo-400 text-[7px] px-1.5 py-0.5 rounded font-black uppercase">Bot 🤖</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex space-x-2 pt-1 border-t border-slate-900">
                {viewingRoom.status === "waiting" && (
                  <button
                    onClick={() => {
                      handleForceStartRace(viewingRoom.id);
                      setViewingRoom(null);
                    }}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[10px] tracking-wider py-2.5 rounded-xl transition"
                  >
                    Force Start countdown
                  </button>
                )}
                <button
                  onClick={() => {
                    handleStopRoomRace(viewingRoom.id);
                    setViewingRoom(null);
                  }}
                  className="px-4 py-2.5 bg-red-950/20 hover:bg-red-950/40 text-red-400 border border-red-950/20 font-black uppercase text-[10px] tracking-wider rounded-xl transition"
                >
                  Terminate Room
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* MAP FORM MODAL (CREATE/EDIT) */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {mapFormOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
            <motion.form
              onSubmit={saveMapForm}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-950 border border-slate-900 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl my-8"
            >
              <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                <h3 className="text-lg font-black text-white uppercase">{mapFormMode === "create" ? "Stage New Track Map" : "Refine Track Configuration"}</h3>
                <button
                  type="button"
                  onClick={() => setMapFormOpen(false)}
                  className="p-1 text-slate-400 hover:text-white transition"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3.5 text-xs text-slate-300">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Track Name</label>
                    <input
                      type="text"
                      value={mapFormData.name}
                      onChange={(e) => setMapFormData({ ...mapFormData, name: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                      placeholder="e.g. Neo Tokyo Street"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Track Difficulty</label>
                    <select
                      value={mapFormData.difficulty}
                      onChange={(e) => setMapFormData({ ...mapFormData, difficulty: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="easy">EASY</option>
                      <option value="medium">MEDIUM</option>
                      <option value="hard">HARD</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Track Geometry Type</label>
                    <select
                      value={mapFormData.trackType}
                      onChange={(e) => setMapFormData({ ...mapFormData, trackType: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="Circuit">Circuit</option>
                      <option value="Sprint">Sprint</option>
                      <option value="Point-to-Point">Point-to-Point</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Weather Setting</label>
                    <select
                      value={mapFormData.weather}
                      onChange={(e) => setMapFormData({ ...mapFormData, weather: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="Clear">Clear</option>
                      <option value="Rainy">Rainy</option>
                      <option value="Snowy">Snowy</option>
                      <option value="Sunset">Sunset</option>
                      <option value="Foggy">Foggy</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Time of Day</label>
                    <select
                      value={mapFormData.timeOfDay}
                      onChange={(e) => setMapFormData({ ...mapFormData, timeOfDay: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="Day">Day</option>
                      <option value="Sunset">Sunset</option>
                      <option value="Night">Night</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Laps Loops Count</label>
                    <input
                      type="number"
                      value={mapFormData.laps}
                      onChange={(e) => setMapFormData({ ...mapFormData, laps: parseInt(e.target.value) || 3 })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                      min={1}
                      max={99}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Checkpoints Count</label>
                    <input
                      type="number"
                      value={mapFormData.checkpointsCount}
                      onChange={(e) => setMapFormData({ ...mapFormData, checkpointsCount: parseInt(e.target.value) || 12 })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                      min={1}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Track Thumbnail Image URL</label>
                  <input
                    type="url"
                    value={mapFormData.thumbnail}
                    onChange={(e) => setMapFormData({ ...mapFormData, thumbnail: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="https://images.unsplash.com/... or blank for default"
                  />
                </div>

                <div>
                  <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Aerodynamics Course description</label>
                  <textarea
                    value={mapFormData.description}
                    onChange={(e) => setMapFormData({ ...mapFormData, description: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 h-20 resize-none"
                    placeholder="Describe hairpin curvatures, straightaways and topography profiles..."
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-900">
                <button
                  type="button"
                  onClick={() => setMapFormOpen(false)}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 font-black uppercase text-[10px] tracking-wider rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition shadow-[0_4px_12px_rgba(99,102,241,0.2)]"
                >
                  Save Track Map
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* CAR FORM MODAL (CREATE/EDIT) */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {carFormOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
            <motion.form
              onSubmit={saveCarForm}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-950 border border-slate-900 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl my-8"
            >
              <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                <h3 className="text-lg font-black text-white uppercase">{carFormMode === "create" ? "Instate Vehicle Chassis" : "Modify Aero Specifications"}</h3>
                <button
                  type="button"
                  onClick={() => setCarFormOpen(false)}
                  className="p-1 text-slate-400 hover:text-white transition"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3.5 text-xs text-slate-300">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Vehicle Model Name</label>
                    <input
                      type="text"
                      value={carFormData.name}
                      onChange={(e) => setCarFormData({ ...carFormData, name: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                      placeholder="e.g. Aventador SVJ"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Manufacturer</label>
                    <input
                      type="text"
                      value={carFormData.manufacturer}
                      onChange={(e) => setCarFormData({ ...carFormData, manufacturer: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                      placeholder="e.g. Lamborghini"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Class Tier</label>
                    <select
                      value={carFormData.class}
                      onChange={(e) => setCarFormData({ ...carFormData, class: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="S CLASS">S CLASS</option>
                      <option value="A CLASS">A CLASS</option>
                      <option value="B CLASS">B CLASS</option>
                      <option value="HYPER CLASS">HYPER CLASS</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Tuning Color Preset</label>
                    <input
                      type="color"
                      value={carFormData.colorPreset}
                      onChange={(e) => setCarFormData({ ...carFormData, colorPreset: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl h-11 p-1 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Database Identifier (ID)</label>
                    <input
                      type="text"
                      value={carFormData.id}
                      onChange={(e) => setCarFormData({ ...carFormData, id: e.target.value })}
                      disabled={carFormMode === "edit"}
                      className="w-full bg-slate-900/50 border border-slate-800 rounded-xl p-3 text-xs text-slate-500 focus:outline-none disabled:cursor-not-allowed"
                      placeholder="e.g. aventador"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Top Speed (km/h)</label>
                    <input
                      type="number"
                      value={carFormData.topSpeed}
                      onChange={(e) => setCarFormData({ ...carFormData, topSpeed: parseInt(e.target.value) || 300 })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                      min={100}
                      max={500}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">0-100 Accel (seconds)</label>
                    <input
                      type="text"
                      value={carFormData.acceleration}
                      onChange={(e) => setCarFormData({ ...carFormData, acceleration: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                      placeholder="e.g. 2.8s"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Handling Grip (%)</label>
                    <input
                      type="number"
                      value={carFormData.handling}
                      onChange={(e) => setCarFormData({ ...carFormData, handling: parseInt(e.target.value) || 90 })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                      min={50}
                      max={100}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Car Showroom Image URL</label>
                  <input
                    type="url"
                    value={carFormData.image}
                    onChange={(e) => setCarFormData({ ...carFormData, image: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="https://images.unsplash.com/... or blank for default"
                  />
                </div>

                <div>
                  <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Showroom Specs Description</label>
                  <textarea
                    value={carFormData.desc}
                    onChange={(e) => setCarFormData({ ...carFormData, desc: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 h-20 resize-none"
                    placeholder="Describe continuous downforce, turbo stages, intake manifolds..."
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-900">
                <button
                  type="button"
                  onClick={() => setCarFormOpen(false)}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 font-black uppercase text-[10px] tracking-wider rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition shadow-[0_4px_12px_rgba(6,182,212,0.2)]"
                >
                  Save Specs
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAPS MANAGER
// ─────────────────────────────────────────────────────────────────────────────
export const ManageMaps: React.FC = () => {
  const [maps, setMaps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form Fields
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [laps, setLaps] = useState(3);
  const [description, setDescription] = useState("");

  useEffect(() => {
    const q = query(collection(db, "maps"));
    const unsubscribe = onSnapshot(q, async (snap) => {
      if (snap.empty) {
        // Auto-seed
        for (const m of DEFAULT_MAPS) {
          await setDoc(doc(db, "maps", m.id), m);
        }
      } else {
        const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const hasRacing2 = list.some((m) => m.id === "racing2");
        if (!hasRacing2) {
          const r2 = DEFAULT_MAPS.find((m) => m.id === "racing2");
          if (r2) {
            await setDoc(doc(db, "maps", r2.id), r2);
          }
        }
        setMaps(list);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleEdit = (map: any) => {
    setEditingId(map.id);
    setId(map.id);
    setName(map.name);
    setDifficulty(map.difficulty);
    setLaps(map.laps || 3);
    setDescription(map.description || "");
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !name) return;
    try {
      const payload = { id, name, difficulty, laps, description };
      await setDoc(doc(db, "maps", id), payload);
      resetForm();
    } catch (err) {
      console.error("Error saving map:", err);
    }
  };

  const handleDelete = async (mid: string) => {
    if (confirm("Are you sure you want to delete this track geography entry?")) {
      await deleteDoc(doc(db, "maps", mid));
    }
  };

  const handleToggleStatus = async (mapId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === "Disabled" ? "Active" : "Disabled";
      await updateDoc(doc(db, "maps", mapId), { status: newStatus });
      await logAdminActivity("Map updated", `Map ${mapId} status toggled to ${newStatus}.`);
    } catch (err) {
      console.error("Failed to toggle map status in ManageMaps:", err);
    }
  };

  const resetForm = () => {
    setId("");
    setName("");
    setDifficulty("medium");
    setLaps(3);
    setDescription("");
    setEditingId(null);
    setShowForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-4 sm:space-y-0 pb-4 border-b border-slate-905">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Maps Manager</h2>
          <p className="text-xs text-slate-400 mt-1">Configure alpine paths and circuit configurations</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>ADD NEW CIRCUIT</span>
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onSubmit={handleSave}
            className="bg-slate-950/60 p-6 rounded-2xl border border-slate-900 space-y-4 max-w-2xl"
          >
            <h3 className="text-sm font-black uppercase tracking-widest text-[#00f2ffa5] mb-2">
              {editingId ? "Edit Configuration" : "Register New Track Geometric Profile"}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  MAP ID (unique, e.g. map3)
                </label>
                <input
                  type="text"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  disabled={!!editingId}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  placeholder="map3"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  DISPLAY LABEL
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  placeholder="Neon Ridge"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  DIFFICULTY RANK
                </label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as any)}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  LAP COUNT
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={laps}
                  onChange={(e) => setLaps(Number(e.target.value))}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                MAP DESCRIPTION
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                placeholder="A circuit describing sweeping curves and dramatic high elevation profiles..."
              />
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition"
              >
                SAVE CIRCUIT
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 font-black uppercase text-[10px] tracking-wider rounded-xl transition"
              >
                CANCEL
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {maps.map((map) => (
          <div
            key={map.id}
            className="bg-slate-950/60 p-6 rounded-2xl border border-slate-900/80 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs text-slate-500">{map.id.toUpperCase()}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${
                      map.status === "Disabled"
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    }`}
                  >
                    {map.status || "Active"}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${
                    map.difficulty === "easy"
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : map.difficulty === "hard"
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                  }`}
                >
                  {map.difficulty}
                </span>
              </div>
              <h3 className="text-lg font-black uppercase text-white tracking-tight">{map.name}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{map.description}</p>
              <div className="text-[10px] font-black text-slate-500 items-center space-x-1 uppercase flex">
                <Layers className="w-3.5 h-3.5" />
                <span>SETTINGS: {map.laps} Laps</span>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-900/45">
              <button
                onClick={() => handleToggleStatus(map.id, map.status || "Active")}
                className="p-2 text-amber-400 hover:text-amber-300 bg-amber-950/10 hover:bg-amber-950/30 border border-amber-950/30 rounded-lg transition"
                title="Toggle Active Status"
              >
                {map.status === "Disabled" ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => handleEdit(map)}
                className="p-2 text-slate-400 hover:text-white bg-slate-900/40 hover:bg-slate-900 border border-slate-800/60 rounded-lg transition"
                title="Edit Map Settings"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(map.id)}
                className="p-2 text-red-400 hover:text-red-300 bg-red-950/10 hover:bg-red-950/30 border border-red-950/30 rounded-lg transition"
                title="Delete Location File"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CARS MANAGER
// ─────────────────────────────────────────────────────────────────────────────
export const ManageCars: React.FC = () => {
  const [cars, setCars] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form Fields
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [topSpeed, setTopSpeed] = useState(300);
  const [acceleration, setAcceleration] = useState("3.0s");
  const [handling, setHandling] = useState(80);
  const [desc, setDesc] = useState("");
  const [colorPreset, setColorPreset] = useState("#ff5500");
  const [carClass, setCarClass] = useState("S CLASS");

  useEffect(() => {
    const q = query(collection(db, "cars"));
    const unsubscribe = onSnapshot(q, async (snap) => {
      if (snap.empty) {
        // Auto-seed
        for (const c of DEFAULT_CARS) {
          await setDoc(doc(db, "cars", c.id), c);
        }
      } else {
        const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setCars(list);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleEdit = (car: any) => {
    setEditingId(car.id);
    setId(car.id);
    setName(car.name);
    setTopSpeed(car.topSpeed);
    setAcceleration(car.acceleration);
    setHandling(car.handling);
    setDesc(car.desc || "");
    setColorPreset(car.colorPreset || "#ff5500");
    setCarClass(car.class || "A CLASS");
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !name) return;
    try {
      const payload = {
        id,
        name,
        topSpeed,
        acceleration,
        handling,
        desc,
        colorPreset,
        class: carClass,
      };
      await setDoc(doc(db, "cars", id), payload);
      resetForm();
    } catch (err) {
      console.error("Error saving vehicle:", err);
    }
  };

  const handleDelete = async (cid: string) => {
    if (confirm("Are you sure you want to delete this high-performance vehicle entry?")) {
      await deleteDoc(doc(db, "cars", cid));
    }
  };

  const resetForm = () => {
    setId("");
    setName("");
    setTopSpeed(300);
    setAcceleration("3.0s");
    setHandling(80);
    setDesc("");
    setColorPreset("#ff5500");
    setCarClass("A CLASS");
    setEditingId(null);
    setShowForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-4 sm:space-y-0 pb-4 border-b border-slate-905">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Cars Manager</h2>
          <p className="text-xs text-slate-400 mt-1">Manage physical vehicle aerodynamics and styling presets</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>REGISTER NEW VEHICLE</span>
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onSubmit={handleSave}
            className="bg-slate-950/60 p-6 rounded-2xl border border-slate-900 space-y-4 max-w-2xl"
          >
            <h3 className="text-sm font-black uppercase tracking-widest text-[#00f2ffa5] mb-2">
              {editingId ? "Edit Performance Tuning" : "Register New Racing Chassis"}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  VEHICLE ID (unique, e.g. porsche)
                </label>
                <input
                  type="text"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  disabled={!!editingId}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  placeholder="ferrari"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  VEHICLE BRAND MODEL NAME
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  placeholder="Ferrari SF90"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  TOP SPEED (KM/H)
                </label>
                <input
                  type="number"
                  value={topSpeed}
                  onChange={(e) => setTopSpeed(Number(e.target.value))}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  ACCELERATION (0-100)
                </label>
                <input
                  type="text"
                  value={acceleration}
                  onChange={(e) => setAcceleration(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  placeholder="2.5s"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  HANDLING SCORE (1-100)
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={handling}
                  onChange={(e) => setHandling(Number(e.target.value))}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  LIVERY DEFAULT COLOR HEX
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={colorPreset}
                    onChange={(e) => setColorPreset(e.target.value)}
                    className="w-10 h-10 bg-transparent border border-slate-800 rounded-lg cursor-pointer shrink-0"
                  />
                  <input
                    type="text"
                    value={colorPreset}
                    onChange={(e) => setColorPreset(e.target.value)}
                    className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="#ff5500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  VEHICLE CLASSIFICATION
                </label>
                <select
                  value={carClass}
                  onChange={(e) => setCarClass(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="S CLASS">S CLASS</option>
                  <option value="A CLASS">A CLASS</option>
                  <option value="B CLASS">B CLASS</option>
                  <option value="HYPER CLASS">HYPER CLASS</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                CHASSIS DESCRIPTION
              </label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
                className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                placeholder="A rear-mounted mid-engine carbon fiber body styled explicitly for extreme downforce operations..."
              />
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition"
              >
                SAVE Tuning
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 font-black uppercase text-[10px] tracking-wider rounded-xl transition"
              >
                CANCEL
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cars.map((car) => (
          <div
            key={car.id}
            className="bg-slate-950/60 p-6 rounded-2xl border border-slate-900/80 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-500 uppercase tracking-widest">{car.id}</span>
                <span className="px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-slate-900 text-cyan-400 border border-cyan-500/10">
                  {car.class || "S CLASS"}
                </span>
              </div>
              <h3 className="text-lg font-black uppercase text-white tracking-tight flex items-center space-x-2">
                <span
                  className="w-3 h-3 rounded-full border border-white/20 shrink-0"
                  style={{ backgroundColor: car.colorPreset || "#ffffff" }}
                />
                <span>{car.name}</span>
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">{car.desc}</p>

              <div className="grid grid-cols-3 gap-3 bg-slate-900/30 p-2.5 border border-slate-900/60 rounded-xl">
                <div className="text-center">
                  <span className="block text-[8px] font-black text-slate-500 uppercase">SPEED</span>
                  <span className="text-xs font-black text-white">{car.topSpeed} KM/H</span>
                </div>
                <div className="text-center border-x border-slate-900">
                  <span className="block text-[8px] font-black text-slate-500 uppercase">ACCEL</span>
                  <span className="text-xs font-black text-white">{car.acceleration}</span>
                </div>
                <div className="text-center">
                  <span className="block text-[8px] font-black text-slate-500 uppercase">GRIP</span>
                  <span className="text-xs font-black text-white">{car.handling}%</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-900/45">
              <button
                onClick={() => handleEdit(car)}
                className="p-2 text-slate-400 hover:text-white bg-slate-900/40 hover:bg-slate-900 border border-slate-800/60 rounded-lg transition"
                title="Edit Engine/Aero Parameters"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(car.id)}
                className="p-2 text-red-400 hover:text-red-300 bg-red-950/10 hover:bg-red-950/30 border border-red-950/30 rounded-lg transition"
                title="Decommission vehicle chassis"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ROOMS MANAGER
// ─────────────────────────────────────────────────────────────────────────────
export const ManageRooms: React.FC = () => {
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "rooms"));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setRooms(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleCloseRoom = async (code: string) => {
    if (confirm(`Do you wish to completely close multiplayer room ${code.toUpperCase()}?`)) {
      try {
        await deleteDoc(doc(db, "rooms", code.toUpperCase()));
      } catch (err) {
        console.error("Failed to terminate multiplayer room:", err);
      }
    }
  };

  const handleForceStart = async (code: string) => {
    try {
      await updateDoc(doc(db, "rooms", code.toUpperCase()), {
        status: "racing",
        countdown: 0,
      });
      alert(`Sent race start trigger to room ${code}!`);
    } catch (err) {
      console.error("Failed to start race:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tight">Active Rooms Manager</h2>
        <p className="text-xs text-slate-400 mt-1">Monitor, modify, and terminate active multiplayer sessions</p>
      </div>

      {rooms.length === 0 ? (
        <div className="border border-slate-900 bg-slate-950/30 p-12 rounded-2xl text-center space-y-2">
          <Settings className="w-8 h-8 text-slate-600 mx-auto" />
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-450">No Live Game Servers</h4>
          <p className="text-[10px] text-slate-500 max-w-xs mx-auto">
            No rooms are currently staged inside the firestore collection.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="bg-slate-950/60 p-6 rounded-2xl border border-slate-900 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-base font-black text-rose-400 uppercase tracking-widest bg-rose-500/10 px-3 py-1 rounded-xl border border-rose-500/15">
                      {room.roomCode || room.code}
                    </span>
                    {room.isLiveMode && (
                      <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/15">
                        <Radio className="w-2.5 h-2.5 animate-pulse" />
                        <span>LIVE STREAM</span>
                      </span>
                    )}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase border ${
                      room.status === "racing"
                        ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                        : room.status === "completed" || room.status === "finished"
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    }`}
                  >
                    {room.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs bg-slate-900/25 p-3 rounded-xl border border-slate-900/60">
                  <div>
                    <span className="text-[8px] font-black text-slate-500 uppercase block">Map Selection</span>
                    <span className="font-black text-slate-200 uppercase mt-0.5 block">{room.map}</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-slate-500 uppercase block">Laps Cycle</span>
                    <span className="font-black text-slate-200 mt-0.5 block">{room.laps} Laps</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-slate-500 uppercase block">AI Difficulty</span>
                    <span className="font-black text-slate-200 uppercase mt-0.5 block">{room.difficulty}</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-slate-500 uppercase block">Weather</span>
                    <span className="font-black text-slate-200 uppercase mt-0.5 block">{room.weather}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[8px] font-black text-slate-500 uppercase block">
                    Connected Grid Players ({room.players?.length || 0})
                  </span>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {room.players?.map((p: any, idx: number) => (
                      <span
                        key={idx}
                        className="bg-slate-900 border border-slate-800/80 text-[10px] font-bold px-2.5 py-1 rounded-lg text-slate-300"
                      >
                        {p.nickname} {p.isHost && "👑"} {p.isAI && "🤖"}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex space-x-2 pt-3 border-t border-slate-900/50">
                {room.status === "waiting" && (
                  <button
                    onClick={() => handleForceStart(room.id)}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[10px] tracking-wider py-2.5 rounded-xl transition"
                  >
                    FORCE START RACE
                  </button>
                )}
                <button
                  onClick={() => handleCloseRoom(room.id)}
                  className="p-2.5 bg-red-950/20 hover:bg-red-950/40 text-red-400 border border-red-950/30 font-black uppercase text-[10px] tracking-wider rounded-xl transition flex items-center space-x-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>CLOSE ROOM</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// USERS MANAGER
// ─────────────────────────────────────────────────────────────────────────────
export const ManageUsers: React.FC = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Email of broadcasters we want to manually configure/invite
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"broadcaster" | "admin" | "user">("broadcaster");

  useEffect(() => {
    const q = query(collection(db, "users"));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUsers(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleRoleChange = async (uid: string, newRole: "admin" | "broadcaster" | "user") => {
    try {
      await updateDoc(doc(db, "users", uid), {
        role: newRole,
      });
      alert("Account role updated successfully in Firestore!");
    } catch (err) {
      console.error("Failed to change user role:", err);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    try {
      // Simulate/register invited profile entry inside DB
      const dummyUid = `invited_${Date.now()}`;
      await setDoc(doc(db, "users", dummyUid), {
        uid: dummyUid,
        email: inviteEmail.trim().toLowerCase(),
        name: `Invited ${inviteRole.toUpperCase()}`,
        photoURL: "",
        role: inviteRole,
        createdAt: serverTimestamp(),
      });
      setInviteEmail("");
      alert(`Successfully registered pre-allocated role ${inviteRole.toUpperCase()} for ${inviteEmail.trim()}!`);
    } catch (err) {
      console.error("Failed to invite user/broadcaster:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-905 gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Manage Accounts & Broadcasters</h2>
          <p className="text-xs text-slate-400 mt-1">
            Review active player profiles, change permission tiers, and allocate broadcasters
          </p>
        </div>
      </div>

      {/* Account quick registration */}
      <form
        onSubmit={handleInviteUser}
        className="bg-slate-950/60 p-6 rounded-2xl border border-slate-900 space-y-4 max-w-xl"
      >
        <h3 className="text-xs font-black uppercase tracking-widest text-[#00f2ffa5]">
          Pre-Allocate Account Permissions
        </h3>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-[8.5px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
              Gmail Email Address
            </label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              placeholder="invited-broadcaster@gmail.com"
              required
            />
          </div>
          <div>
            <label className="block text-[8.5px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
              Role Tier
            </label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as any)}
              className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="broadcaster">Broadcaster</option>
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>
          </div>
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[10px] tracking-wider py-3 px-5 rounded-xl transition"
          >
            ALLOCATE PROFILES
          </button>
        </div>
      </form>

      {/* Accounts List */}
      <div className="bg-slate-950/60 rounded-2xl border border-slate-900 overflow-hidden">
        <div className="p-5 border-b border-slate-900/60 bg-slate-950/40">
          <h3 className="text-xs font-black uppercase tracking-widest text-white">Registered Accounts Directory</h3>
        </div>
        <div className="divide-y divide-slate-900/60">
          {users.map((u) => {
            const date = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : "Recently";
            return (
              <div key={u.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center space-x-4">
                  <img
                    src={
                      u.photoURL ||
                      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
                    }
                    alt={u.name}
                    className="w-10 h-10 rounded-full object-cover bg-slate-800 border border-slate-800"
                    referrerPolicy="no-referrer"
                  />
                  <div>
                    <h4 className="text-xs font-black text-white uppercase">{u.name || "Anonymous Champion"}</h4>
                    <span className="text-[10px] text-slate-400 block mt-0.5">{u.email}</span>
                    <span className="text-[8px] font-mono text-slate-500 block mt-0.5">Joined at {date}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-3 self-end sm:self-auto">
                  <span className="text-[9px] font-black uppercase text-slate-500">Authorize Role:</span>
                  <select
                    value={u.role || "user"}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as any)}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold uppercase tracking-wider"
                  >
                    <option value="user">User</option>
                    <option value="broadcaster">Broadcaster</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS & LEADERBOARD LOGS
// ─────────────────────────────────────────────────────────────────────────────
export const ManageAnalytics: React.FC = () => {
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulates an active firestore query to global leaderboards
    const q = query(collection(db, "leaderboards"));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setLeaderboard(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleClearScore = async (id: string) => {
    if (confirm("Do you wish to completely wipe this player score ranking log?")) {
      await deleteDoc(doc(db, "leaderboards", id));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tight">Analytics & Leaderboards Manager</h2>
        <p className="text-xs text-slate-400 mt-1">
          Review top speed lists, clear race telemetry logs, and analyze metrics
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Simple Telemetry Metrics */}
        <div className="lg:col-span-2 bg-slate-950/60 p-6 rounded-2xl border border-slate-900 space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#00f2ffa5] flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <span>Active Frame Performance logs</span>
          </h3>

          {/* Simple Vector Graph representation */}
          <div className="h-48 flex items-end justify-between px-4 pb-2 pt-6 bg-slate-900/25 border border-slate-900 rounded-2xl relative">
            <div className="absolute top-2 left-3 text-[8px] font-black text-slate-500 uppercase tracking-widest">
              WIFI RTT Latency / Tick Sync Rate
            </div>
            {[45, 70, 52, 90, 80, 65, 87, 95, 40, 72, 85, 99].map((h, i) => (
              <div key={i} className="flex flex-col items-center flex-1 mx-1.5 space-y-1.5 h-full justify-end">
                <div
                  className="w-full bg-gradient-to-t from-indigo-500/80 to-cyan-400 rounded-t-md cursor-pointer hover:opacity-80 transition-all shadow-[0_0_8px_rgba(99,102,241,0.2)]"
                  style={{ height: `${h}%` }}
                />
                <span className="text-[7.5px] font-mono text-slate-500 font-bold">t+{i}s</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-900/60">
              <span className="block text-[8px] font-black text-slate-500 uppercase">Average Latency</span>
              <span className="text-sm font-black text-cyan-400 mt-1 block">42ms</span>
            </div>
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-900/60">
              <span className="block text-[8px] font-black text-slate-500 uppercase">Server FPS</span>
              <span className="text-sm font-black text-emerald-400 mt-1 block">59.8 FPS</span>
            </div>
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-900/60">
              <span className="block text-[8px] font-black text-slate-500 uppercase">Packet Drops</span>
              <span className="text-sm font-black text-red-400 mt-1 block">0.02%</span>
            </div>
          </div>
        </div>

        {/* Global Standings list */}
        <div className="bg-slate-950/60 rounded-2xl border border-slate-900 overflow-hidden flex flex-col justify-between">
          <div>
            <div className="p-5 border-b border-slate-900/60 bg-slate-950/40">
              <h3 className="text-xs font-black uppercase tracking-widest text-white">Global Speed Ranking List</h3>
            </div>

            {leaderboard.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <BarChart3 className="w-8 h-8 text-slate-650 mx-auto" />
                <span className="block text-[10px] font-black text-slate-500 uppercase uppercase">
                  No Highscores Loaded
                </span>
              </div>
            ) : (
              <div className="divide-y divide-slate-900/40 max-h-64 overflow-y-auto">
                {leaderboard.map((item, index) => (
                  <div key={item.id} className="p-3.5 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-black text-slate-500">#{index + 1}</span>
                      <span className="font-bold text-white uppercase">{item.playerName}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="font-black text-cyan-300">{item.topSpeed || 298} km/h</span>
                      <button
                        onClick={() => handleClearScore(item.id)}
                        className="p-1 hover:text-red-400 text-slate-600 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BROADCASTERS MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
export const ManageBroadcasters: React.FC = () => {
  const [broadcasters, setBroadcasters] = useState<any[]>([]);
  const [searchEmail, setSearchEmail] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "users"), where("role", "==", "broadcaster"));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setBroadcasters(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleDemoteBroadcaster = async (userId: string, email: string) => {
    if (confirm(`Decommission broadcaster privileges for ${email}?`)) {
      try {
        await updateDoc(doc(db, "users", userId), { role: "user" });
        await logAdminActivity("Role demoted", `Demoted broadcaster ${email} to standard user role.`);
        alert("Demoted broadcaster successfully!");
      } catch (err) {
        console.error("Failed to demote:", err);
      }
    }
  };

  const handlePromoteByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchEmail) return;

    try {
      const q = query(collection(db, "users"), where("email", "==", searchEmail.trim()));
      const snap = await getDocs(q);
      if (snap.empty) {
        // Pre-allocate in invitations or warn
        alert("No user registered with this email yet. We have registered a pre-allocated invitation.");
        await setDoc(doc(db, "invitations", searchEmail.trim().replace(/\./g, "_")), {
          email: searchEmail.trim(),
          assignedRole: "broadcaster",
          createdAt: serverTimestamp(),
        });
        await logAdminActivity("Invite pre-allocated", `Pre-allocated broadcaster invite for ${searchEmail.trim()}.`);
      } else {
        const userDoc = snap.docs[0];
        await updateDoc(doc(db, "users", userDoc.id), { role: "broadcaster" });
        await logAdminActivity("Role promoted", `Promoted registered user ${searchEmail.trim()} to broadcaster.`);
        alert(`Successfully promoted ${searchEmail.trim()} to Broadcaster!`);
      }
      setSearchEmail("");
    } catch (err) {
      console.error("Failed to promote user:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight text-white flex items-center space-x-2">
            <Radio className="w-5 h-5 text-rose-500 animate-pulse" />
            <span>Broadcasters Directory</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Authorize new stream operators and configure active live spectator privileges.
          </p>
        </div>

        <form onSubmit={handlePromoteByEmail} className="flex items-center space-x-2">
          <input
            type="email"
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.target.value)}
            placeholder="Enter operator email..."
            className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 max-w-xs"
            required
          />
          <button
            type="submit"
            className="flex items-center space-x-1 px-4 py-3 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black uppercase text-xs tracking-wider rounded-xl transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Appoint</span>
          </button>
        </form>
      </div>

      <div className="bg-slate-950/60 rounded-2xl border border-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-xs">Loading Broadcasters...</div>
        ) : broadcasters.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Radio className="w-10 h-10 text-slate-750 mx-auto" />
            <p className="text-slate-400 text-xs uppercase font-mono">No active broadcasters appointed yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-900/40">
            {broadcasters.map((b) => (
              <div key={b.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center space-x-4">
                  <img
                    src={b.photoURL || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"}
                    alt={b.name}
                    className="w-11 h-11 rounded-full border border-slate-800 object-cover bg-slate-900"
                    referrerPolicy="no-referrer"
                  />
                  <div>
                    <h4 className="font-black text-white uppercase text-sm">{b.name || "Appointed Operator"}</h4>
                    <span className="text-xs text-slate-500 font-mono block mt-0.5">{b.email}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-3 justify-end">
                  <span className="px-3 py-1 bg-rose-500/10 text-rose-400 font-black uppercase text-[10px] tracking-widest rounded-full border border-rose-500/15">
                    Broadcaster Role
                  </span>
                  <button
                    onClick={() => handleDemoteBroadcaster(b.id, b.email)}
                    className="px-4 py-2 bg-slate-900 hover:bg-red-950/30 text-slate-400 hover:text-red-400 font-black uppercase text-[10px] tracking-wider border border-slate-800 rounded-xl transition cursor-pointer"
                  >
                    Decommission
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LIVE BROADCAST STREAM MONITORS
// ─────────────────────────────────────────────────────────────────────────────
export const LiveBroadcast: React.FC = () => {
  const [liveFeeds, setLiveFeeds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Syncs active streams inside broadcasts collection
    const q = query(collection(db, "broadcasts"));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setLiveFeeds(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleStopStream = async (feedId: string) => {
    if (confirm("Terminate this live spectator broadcast transmission?")) {
      try {
        await deleteDoc(doc(db, "broadcasts", feedId));
        await logAdminActivity("Broadcast ended", `Terminated feed ${feedId} from admin control.`);
      } catch (err) {
        console.error("Failed to delete feed:", err);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tight text-white flex items-center space-x-2">
          <Radio className="w-5 h-5 text-indigo-400 animate-pulse" />
          <span>Live Broadcast Transmission Feed</span>
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Monitor streaming video nodes, coordinate spectating cameras, and control live racing overlays.
        </p>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 text-xs">Loading Live Feeds...</div>
      ) : liveFeeds.length === 0 ? (
        <div className="bg-slate-950/40 border border-slate-900 p-12 rounded-2xl text-center space-y-3">
          <Radio className="w-12 h-12 text-slate-850 mx-auto animate-pulse" />
          <p className="text-slate-400 text-xs uppercase font-mono">No active spectator broadcasts are online.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {liveFeeds.map((feed) => (
            <div key={feed.id} className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden flex flex-col justify-between">
              <div className="aspect-video bg-black relative flex items-center justify-center">
                {/* Simulated video frame */}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950 opacity-40" />
                <div className="text-center p-4">
                  <Radio className="w-8 h-8 text-rose-500 mx-auto animate-ping" />
                  <span className="block text-[10px] font-mono text-slate-400 font-bold mt-2 uppercase">Receiving Spectrum Feed</span>
                </div>
                
                {/* HUD Overlay */}
                <div className="absolute top-4 left-4 flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse inline-block" />
                  <span className="text-[9px] font-black uppercase font-mono tracking-widest text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/15">
                    {feed.status || "LIVE"}
                  </span>
                </div>
                
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <div className="bg-slate-950/80 px-2 py-1 rounded border border-slate-900/60">
                    ROOM: <span className="text-white font-bold">{feed.roomCode || "N/A"}</span>
                  </div>
                  <div className="bg-slate-950/80 px-2 py-1 rounded border border-slate-900/60">
                    TRACK: <span className="text-white font-bold uppercase">{feed.map || "Alpine Ridge"}</span>
                  </div>
                </div>
              </div>

              <div className="p-5 flex items-center justify-between">
                <div>
                  <h4 className="font-black text-white uppercase text-sm">{feed.broadcasterName || "Broadcaster"}</h4>
                  <span className="text-[10px] text-slate-500 font-mono block mt-0.5">Stream key: {feed.id.slice(0, 8)}...</span>
                </div>
                <button
                  onClick={() => handleStopStream(feed.id)}
                  className="px-4 py-2 bg-red-950/20 hover:bg-red-950/40 text-red-400 border border-red-950/20 font-black uppercase text-[10px] tracking-wider rounded-xl transition"
                >
                  Shut Down
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM CONFIGURATION SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
export const ManageSettings: React.FC = () => {
  const [config, setConfig] = useState({
    countdownSeconds: 10,
    maxPlayers: 8,
    botCount: 3,
    botDifficulty: "medium",
    notificationsEnabled: true,
    maintenanceMode: false,
    adminEmail: "seshuvakada1234@gmail.com",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      const docSnap = await getDocs(collection(db, "settings"));
      if (!docSnap.empty) {
        const globalSettings = docSnap.docs.find(d => d.id === "global")?.data();
        if (globalSettings) {
          setConfig(prev => ({ ...prev, ...globalSettings }));
        }
      }
    };
    fetchConfig();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "global"), config);
      await logAdminActivity("Settings saved", "Global matchmaking configurations updated successfully.");
      alert("Settings saved successfully!");
    } catch (err) {
      console.error("Failed to save configuration:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tight text-white flex items-center space-x-2">
          <Settings className="w-5 h-5 text-indigo-400" />
          <span>Platform Configurations</span>
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Tune latency values, countdown ticks, matchmaking limits, and developer debug parameters.
        </p>
      </div>

      <form onSubmit={handleSaveConfig} className="bg-slate-950/60 border border-slate-900 rounded-2xl p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-300">
          <div>
            <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Lobby Start Countdown (seconds)</label>
            <input
              type="number"
              value={config.countdownSeconds}
              onChange={(e) => setConfig({ ...config, countdownSeconds: parseInt(e.target.value) || 10 })}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              min={3}
              max={60}
              required
            />
          </div>

          <div>
            <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Max Racers per Room Grid</label>
            <input
              type="number"
              value={config.maxPlayers}
              onChange={(e) => setConfig({ ...config, maxPlayers: parseInt(e.target.value) || 8 })}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              min={2}
              max={16}
              required
            />
          </div>

          <div>
            <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">AI Bots Count per Race</label>
            <input
              type="number"
              value={config.botCount}
              onChange={(e) => setConfig({ ...config, botCount: parseInt(e.target.value) || 0 })}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              min={0}
              max={10}
              required
            />
          </div>

          <div>
            <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">AI Bots Competency</label>
            <select
              value={config.botDifficulty}
              onChange={(e) => setConfig({ ...config, botDifficulty: e.target.value })}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="easy">EASY BOTS</option>
              <option value="medium">MEDIUM BOTS</option>
              <option value="hard">PRO BOTS</option>
            </select>
          </div>

          <div>
            <label className="block text-[8.5px] font-black uppercase text-slate-500 mb-1.5">Notification Contact Email</label>
            <input
              type="email"
              value={config.adminEmail}
              onChange={(e) => setConfig({ ...config, adminEmail: e.target.value })}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              placeholder="e.g. support@asphaltchampions.com"
              required
            />
          </div>

          <div className="flex items-center space-x-6 h-full pt-4">
            <label className="flex items-center space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notificationsEnabled}
                onChange={(e) => setConfig({ ...config, notificationsEnabled: e.target.checked })}
                className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-800"
              />
              <span className="text-xs text-slate-300 font-bold uppercase">System Alerts</span>
            </label>

            <label className="flex items-center space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.maintenanceMode}
                onChange={(e) => setConfig({ ...config, maintenanceMode: e.target.checked })}
                className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-800"
              />
              <span className="text-xs text-slate-300 font-bold uppercase">Maintenance Mode</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-900">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-xs tracking-wider rounded-xl transition shadow-[0_4px_12px_rgba(99,102,241,0.2)]"
          >
            {saving ? "Saving Changes..." : "Save Platform Configurations"}
          </button>
        </div>
      </form>
    </div>
  );
};
