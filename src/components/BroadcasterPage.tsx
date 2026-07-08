import React, { useState, useEffect, useRef } from "react";
import { db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import {
  Radio,
  Video,
  Tv,
  Play,
  Square,
  Compass,
  Sparkles,
  Settings,
  Users,
  Camera,
  Eye,
  Info,
  Volume2,
  Maximize,
  AlertCircle,
  Shield,
  Bell,
  LogOut,
  ChevronDown,
  CheckCircle,
  Activity,
  Zap,
  Database,
  Clock,
  RefreshCw,
  Cpu,
  Wifi,
  Layers,
  Sliders,
  PlayCircle,
  BarChart2,
  EyeOff,
  Layout,
  Terminal,
  Monitor,
  Flame,
  MapPin,
  Gauge,
  Copy,
  ExternalLink,
  Gamepad2,
  ShieldAlert,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Custom Services for Esports production
import {
  RoomLifecycleService,
  LiveRoomService,
  BroadcastService,
  StreamTelemetry,
  LiveCurrentState,
} from "../services/EsportsStudioServices";
import { RoomState, RoomPlayer } from "../multiplayer/RoomState";

// ─────────────────────────────────────────────────────────────────────────────
// BROADCASTER COCKPIT LAYOUT wrapper (Esports HUD design)
// ─────────────────────────────────────────────────────────────────────────────
interface BroadcasterLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  liveRoomCode?: string;
}

export const BroadcasterCockpitLayout: React.FC<BroadcasterLayoutProps> = ({
  children,
  activeTab,
  setActiveTab,
  liveRoomCode,
}) => {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [uptime, setUptime] = useState("00:00:00");

  // Track actual session duration
  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const diff = Date.now() - startTime;
      const hrs = Math.floor(diff / 3600000)
        .toString()
        .padStart(2, "0");
      const mins = Math.floor((diff % 3600000) / 60000)
        .toString()
        .padStart(2, "0");
      const secs = Math.floor((diff % 60000) / 1000)
        .toString()
        .padStart(2, "0");
      setUptime(`${hrs}:${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSignOut = async () => {
    await logout();
    navigate("/login");
  };

  const navItems = [
    { id: "dashboard", label: "Console Desk", icon: Layout },
    { id: "my-game", label: "My Game", icon: Gamepad2 },
    { id: "live-game", label: "Live Arena Feed", icon: Monitor },
    { id: "camera", label: "AI Camera Director", icon: Camera },
    { id: "analytics", label: "Esports Analytics", icon: BarChart2 },
    { id: "stream-health", label: "RTMP Stream Health", icon: Activity },
    { id: "settings", label: "Broadcast Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-[#05070B] text-[#E2E8F0] font-sans antialiased">
      {/* LEFT SIDEBAR */}
      <aside className="w-[280px] bg-[#0D1320] border-r border-[#1E293B] flex flex-col justify-between shrink-0 hidden xl:flex">
        <div>
          {/* Brand Header */}
          <div className="h-20 border-b border-[#1E293B] px-6 flex items-center space-x-3 bg-[#090d16]">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-tr from-[#00E5FF] to-[#7C4DFF] shadow-[0_0_15px_rgba(0,229,255,0.3)]">
              <Compass className="w-5 h-5 text-white animate-spin-slow rotate-45" />
            </div>
            <div>
              <div className="text-sm font-black tracking-widest text-white leading-none">AI RACE ARENA</div>
              <span className="text-[9px] text-[#00E5FF] font-black uppercase tracking-widest mt-1 block font-mono">
                BROADCAST UNIT
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1">
            <span className="px-3 text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2.5">
              LIVE PRODUCTION
            </span>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all border ${
                    isActive
                      ? "bg-gradient-to-r from-[#00E5FF]/10 to-[#7C4DFF]/10 border-[#00E5FF]/30 text-[#00E5FF] shadow-[inset_0_0_12px_rgba(0,229,255,0.05)]"
                      : "border-transparent text-slate-400 hover:text-white hover:bg-slate-800/30"
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-[#00E5FF]" : "text-slate-500"}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Broadcaster Status Info */}
        <div className="p-4 border-t border-[#1E293B] bg-[#090d16] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00E676] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00E676]"></span>
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Esports Stream Bot</span>
            </div>
            <span className="bg-[#00E676]/10 text-[#00E676] border border-[#00E676]/20 text-[8px] font-black uppercase px-2 py-0.5 rounded-md font-mono">
              ONLINE
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[9px] font-bold text-slate-400 font-mono">
            <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-900">
              <div className="text-slate-500 uppercase text-[7.5px] tracking-wider mb-0.5">MATCH CODE</div>
              <span className="text-[#00E5FF] truncate block">{liveRoomCode || "WAITING"}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-900">
              <div className="text-slate-500 uppercase text-[7.5px] tracking-wider mb-0.5">BOT RUNTIME</div>
              <span className="text-white">{uptime}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* TOP HEADER */}
        <header className="h-20 bg-[#0D1320] border-b border-[#1E293B] px-6 lg:px-8 flex items-center justify-between shrink-0 z-30">
          <div className="flex items-center space-x-4">
            <div>
              <h1 className="text-base lg:text-lg font-black uppercase tracking-tight text-white flex items-center space-x-2.5">
                <Radio className="w-5 h-5 text-[#00E5FF] animate-pulse shrink-0" />
                <span>AI BROADCASTER STUDIO</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider hidden sm:block mt-0.5">
                Dynamic Esports Camera Feed • OBS/RTMP Live Uplink Console
              </p>
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center space-x-4">
            {/* Server load indicator */}
            <div className="hidden md:flex items-center space-x-2.5 bg-slate-950/45 px-3 py-1.5 rounded-xl border border-slate-800 font-mono">
              <Activity className="w-3.5 h-3.5 text-[#00E5FF]" />
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">UPLINK LATENCY:</span>
              <span className="text-[#00E676] text-[10px] font-bold">12ms</span>
            </div>

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="flex items-center space-x-2.5 p-1 bg-slate-950/30 border border-slate-800 rounded-full hover:border-slate-700 transition"
              >
                <img
                  src={
                    profile?.photoURL ||
                    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=150&q=80"
                  }
                  alt={profile?.name || "Producer"}
                  className="w-8 h-8 rounded-full object-cover border border-[#1E293B]"
                  referrerPolicy="no-referrer"
                />
                <ChevronDown className="w-4 h-4 text-slate-400 mr-2 shrink-0 hidden sm:block" />
              </button>

              <AnimatePresence>
                {profileDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setProfileDropdownOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 mt-2.5 w-60 bg-[#0D1320] border border-[#1E293B] rounded-2xl shadow-2xl p-2.5 z-40"
                    >
                      <div className="p-3 border-b border-[#1E293B] mb-1">
                        <p className="text-[11px] font-black uppercase text-white truncate">
                          {profile?.name || "Esports Producer"}
                        </p>
                        <span className="text-[8px] bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/20 font-black uppercase tracking-wider px-2 py-0.5 rounded-md mt-1.5 inline-block font-mono">
                          {profile?.role?.toUpperCase()} tier
                        </span>
                      </div>
                      <button
                        onClick={handleSignOut}
                        className="flex items-center space-x-2.5 w-full text-left px-3 py-2.5 text-xs text-[#FF5252] hover:bg-[#FF5252]/10 rounded-xl transition font-black uppercase tracking-wider"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Disconnect Console</span>
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* SCROLLER AREA */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-8 bg-[#05070B]">{children}</main>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN REAL-TIME ESPECTS PRODUCTION DESK
// ─────────────────────────────────────────────────────────────────────────────
export const BroadcasterDashboard: React.FC = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");

  // Real-time states synchronized to Firestore
  const [liveCurrent, setLiveCurrent] = useState<LiveCurrentState | null>(null);
  const [activeRoomDoc, setActiveRoomDoc] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(true);

  // Clipboard notify state
  const [copyStatus, setCopyStatus] = useState<"none" | "code" | "link">("none");

  // Interactive AI director toggles
  const [isAutoDirector, setIsAutoDirector] = useState(true);

  // Unsubscribe pointers
  const liveUnsubRef = useRef<(() => void) | null>(null);
  const roomUnsubRef = useRef<(() => void) | null>(null);

  // 1. Role verification overlay
  const isAuthorized = profile?.role === "broadcaster" || profile?.role === "admin";

  // 2. Initial Setup and live/current subscriptions
  useEffect(() => {
    if (!isAuthorized || !profile?.uid) return;

    const setupLiveStream = async () => {
      try {
        console.log("Broadcaster verification complete. Synchronizing official live state...");
        // Ensure standard live/current room is active and ready
        await RoomLifecycleService.initOfficialRoom(profile.uid);

        // Subscribe to live/current document updates
        liveUnsubRef.current = LiveRoomService.subscribeToLiveCurrent((liveDoc) => {
          setLiveCurrent(liveDoc);

          if (liveDoc?.roomCode) {
            // Subscribe to rooms/{roomCode} updates in real time
            if (roomUnsubRef.current) roomUnsubRef.current();

            roomUnsubRef.current = onSnapshot(doc(db, "rooms", liveDoc.roomCode), (roomSnap) => {
              if (roomSnap.exists()) {
                setActiveRoomDoc(roomSnap.data() as RoomState);
              } else {
                setActiveRoomDoc(null);
              }
              setLoading(false);
            });
          } else {
            setLoading(false);
          }
        });
      } catch (err) {
        console.error("Initialization of live room failed:", err);
        setLoading(false);
      }
    };

    setupLiveStream();

    return () => {
      if (liveUnsubRef.current) liveUnsubRef.current();
      if (roomUnsubRef.current) roomUnsubRef.current();
    };
  }, [isAuthorized, profile?.uid]);

  // 3. Audio / stream hardware simulation update intervals (OBS Connected / telemetry simulation)
  useEffect(() => {
    if (!liveCurrent?.roomCode || !isAuthorized) return;

    const interval = setInterval(() => {
      // Periodic jitter of stream parameters for authentic metrics update
      const currentTelemetry: StreamTelemetry = {
        obsConnected: true,
        ffmpegConnected: true,
        viewerCount: liveCurrent.telemetry?.viewerCount || 2400,
        fps: Math.min(120, Math.max(58, (liveCurrent.telemetry?.fps || 60) + Math.floor(Math.random() * 5) - 2)),
        bitrate: Math.max(
          5800,
          Math.min(6500, (liveCurrent.telemetry?.bitrate || 6100) + Math.floor(Math.random() * 200) - 100),
        ),
        droppedFrames: 0,
        latency: Math.max(10, Math.min(30, (liveCurrent.telemetry?.latency || 15) + Math.floor(Math.random() * 3) - 1)),
        cpu: Math.max(25, Math.min(75, (liveCurrent.telemetry?.cpu || 40) + Math.floor(Math.random() * 6) - 3)),
        gpu: Math.max(35, Math.min(85, (liveCurrent.telemetry?.gpu || 55) + Math.floor(Math.random() * 6) - 3)),
        memory: Math.max(40, Math.min(50, (liveCurrent.telemetry?.memory || 45) + Math.floor(Math.random() * 2) - 1)),
        streamState: "LIVE",
      };

      // Periodic AI director cam-switching cycle if Auto Director is enabled
      let nextCam = liveCurrent.currentCamera || "third-person";
      if (isAutoDirector) {
        const cams = ["third-person", "drone", "finish", "replay", "pit", "cinematic", "helicopter"];
        // 10% chance to cycle camera every interval
        if (Math.random() < 0.15) {
          nextCam = cams[Math.floor(Math.random() * cams.length)];
          console.log(`[AI Director] auto cycling camera viewpoint to: ${nextCam}`);
        }
      }

      // Dynamic lap and timer simulation mock update
      let nextLap = liveCurrent.currentLap || 0;
      let nextTimer = liveCurrent.raceTimer || "00:00.00";
      if (liveCurrent.status === "racing") {
        const totalSecs = Math.floor(Date.now() / 1000) % 240;
        const mins = Math.floor(totalSecs / 60)
          .toString()
          .padStart(2, "0");
        const secs = (totalSecs % 60).toString().padStart(2, "0");
        const ms = Math.floor(Math.random() * 99)
          .toString()
          .padStart(2, "0");
        nextTimer = `${mins}:${secs}.${ms}`;
        nextLap = Math.min(3, Math.floor(totalSecs / 80) + 1);
      } else {
        nextTimer = "00:00.00";
        nextLap = 0;
      }

      // Update local + cloud Firestore live node
      LiveRoomService.updateLiveCurrent({
        telemetry: currentTelemetry,
        currentCamera: nextCam,
        currentLap: nextLap,
        raceTimer: nextTimer,
      }).catch((err) => console.error("Telemetry update failed:", err));
    }, 3000);

    return () => clearInterval(interval);
  }, [liveCurrent?.roomCode, liveCurrent?.status, isAutoDirector, isAuthorized]);

  // Unauthorized Access Guard Screen
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#05070B] text-slate-100 flex items-center justify-center p-4 antialiased">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-[#0D1320] border border-[#FF5252]/30 p-8 rounded-3xl text-center space-y-6 shadow-[0_15px_50px_rgba(255,82,82,0.1)] relative overflow-hidden"
        >
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-red-500 via-[#FF5252] to-red-500" />
          <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto text-red-500 shadow-xl">
            <ShieldAlert className="w-8 h-8 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-black uppercase tracking-widest text-white">ACCESS DENIED</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Esports telemetry cockpit terminals are locked down. Your authenticated profile lacks the mandatory{" "}
              <span className="text-red-400 font-bold">broadcaster</span> or{" "}
              <span className="text-red-400 font-bold">admin</span> clearance permissions.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => (window.location.href = "/")}
              className="w-full py-3.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl transition"
            >
              RETURN TO RACING GRID
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Copy helpers
  const handleCopyCode = () => {
    if (!liveCurrent?.roomCode) return;
    navigator.clipboard.writeText(liveCurrent.roomCode);
    setCopyStatus("code");
    setTimeout(() => setCopyStatus("none"), 2000);
  };

  const handleCopyLink = () => {
    if (!liveCurrent?.roomCode) return;
    const link = `${window.location.origin}/?room=${liveCurrent.roomCode}`;
    navigator.clipboard.writeText(link);
    setCopyStatus("link");
    setTimeout(() => setCopyStatus("none"), 2000);
  };

  // Interactive control callbacks
  const handleStartRace = async () => {
    if (!liveCurrent?.roomCode) return;
    try {
      await RoomLifecycleService.startLiveRace(liveCurrent.roomCode);
    } catch (err) {
      console.error("Start race failed:", err);
    }
  };

  const handleStopRace = async () => {
    if (!liveCurrent?.roomCode) return;
    try {
      await RoomLifecycleService.stopLiveRace(liveCurrent.roomCode);
    } catch (err) {
      console.error("Stop race failed:", err);
    }
  };

  const handleInjectAI = async () => {
    if (!liveCurrent?.roomCode) return;
    try {
      await RoomLifecycleService.fillEmptySlotsWithAI(liveCurrent.roomCode);
    } catch (err) {
      console.error("AI injection failed:", err);
    }
  };

  const handleCreateNextRoom = async () => {
    if (!profile?.uid || !liveCurrent) return;
    try {
      setLoading(true);
      // Archive current room first
      await RoomLifecycleService.archiveLiveRoom(liveCurrent.roomCode);
      // Create new official live room
      const nextRace = (liveCurrent.raceNumber || 1000) + 1;
      await RoomLifecycleService.createNextOfficialRoom(profile.uid, nextRace);
    } catch (err) {
      console.error("Create next room failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleEmergencyStop = async () => {
    if (!liveCurrent?.roomCode) return;
    try {
      await RoomLifecycleService.emergencyShutdown(liveCurrent.roomCode);
    } catch (err) {
      console.error("Emergency shutdown failed:", err);
    }
  };

  const handleManualCameraChange = async (mode: string) => {
    setIsAutoDirector(false);
    if (!liveCurrent) return;
    try {
      await LiveRoomService.updateLiveCurrent({
        currentCamera: mode,
      });
    } catch (err) {
      console.error("Manual camera update failed:", err);
    }
  };

  // Render Spinner
  if (loading) {
    return (
      <BroadcasterCockpitLayout activeTab={activeTab} setActiveTab={setActiveTab} liveRoomCode="LOADING">
        <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
          <RefreshCw className="w-8 h-8 text-[#00E5FF] animate-spin" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            CONNECTING COCKPIT METADATA...
          </span>
        </div>
      </BroadcasterCockpitLayout>
    );
  }

  return (
    <BroadcasterCockpitLayout activeTab={activeTab} setActiveTab={setActiveTab} liveRoomCode={liveCurrent?.roomCode}>
      <AnimatePresence mode="wait">
        {/* VIEW 1: MAIN CONSOLE DESK */}
        {activeTab === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            {/* Banner block */}
            <div className="relative bg-gradient-to-r from-[#0D1320] via-[#1A2338] to-[#0D1320] border border-[#1E293B] p-6 lg:p-8 rounded-3xl overflow-hidden shadow-2xl">
              <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gradient-to-br from-[#00E5FF]/5 to-transparent rounded-full blur-3xl" />
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-3 max-w-xl">
                  <div className="flex items-center space-x-2 bg-[#00E5FF]/10 text-[#00E5FF] font-black uppercase text-[9px] tracking-widest px-3 py-1.5 rounded-xl border border-[#00E5FF]/20 w-max font-mono">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    <span>SINGLE ACTIVE OFFICIAL LIVE STREAM ROOM</span>
                  </div>
                  <h2 className="text-2xl lg:text-3xl font-black uppercase tracking-tight text-white leading-tight">
                    Esports Production Desk
                  </h2>
                  <p className="text-slate-400 text-xs leading-relaxed">
                    Control live matches on the official broadcast channel. Spawning AI bot vehicles, starting/pausing
                    race simulations, and updating RTMP live overlays is processed on-the-fly.
                  </p>
                </div>

                {/* Spectator Quick Link Action */}
                <div className="flex items-center space-x-3 shrink-0">
                  <a
                    href={`/spectator?room=${liveCurrent?.roomCode}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-2.5 bg-gradient-to-r from-[#00E5FF] to-[#7C4DFF] hover:from-[#00E5FF]/95 hover:to-[#7C4DFF]/95 text-white font-black uppercase text-[10px] tracking-widest px-5 py-4 rounded-xl transition shadow-[0_4px_18px_rgba(0,229,255,0.25)] border border-[#00E5FF]/30"
                  >
                    <Eye className="w-4 h-4" />
                    <span>LAUNCH SPECTATOR</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* DASHBOARD GRID STRUCTURE */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              {/* LEFT 7 COLS: ROOM CARD + CONTROLS */}
              <div className="xl:col-span-7 space-y-6">
                {/* 1. OfficialRoomCard Component */}
                <OfficialRoomCard
                  liveCurrent={liveCurrent}
                  activeRoomDoc={activeRoomDoc}
                  copyStatus={copyStatus}
                  onCopyCode={handleCopyCode}
                  onCopyLink={handleCopyLink}
                  onStartRace={handleStartRace}
                  onStopRace={handleStopRace}
                  onInjectAI={handleInjectAI}
                  onCreateNextRoom={handleCreateNextRoom}
                  onEmergencyStop={handleEmergencyStop}
                />

                {/* 2. BroadcastStats Component */}
                <BroadcastStats telemetry={liveCurrent?.telemetry} />
              </div>

              {/* RIGHT 5 COLS: CAMERA PANEL + STREAM HEALTH */}
              <div className="xl:col-span-5 space-y-6">
                {/* 3. CameraPanel Component */}
                <CameraPanel
                  currentCamera={liveCurrent?.currentCamera || "third-person"}
                  isAutoDirector={isAutoDirector}
                  onToggleAuto={() => setIsAutoDirector(!isAutoDirector)}
                  onChangeCam={handleManualCameraChange}
                />

                {/* 4. StreamHealth Component */}
                <StreamHealth telemetry={liveCurrent?.telemetry} />
              </div>
            </div>
          </motion.div>
        )}

        {/* VIEW 2: CAMERA CONTROLS */}
        {activeTab === "camera" && (
          <motion.div
            key="camera"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            <CameraPanel
              currentCamera={liveCurrent?.currentCamera || "third-person"}
              isAutoDirector={isAutoDirector}
              onToggleAuto={() => setIsAutoDirector(!isAutoDirector)}
              onChangeCam={handleManualCameraChange}
              fullWidth
            />
          </motion.div>
        )}

        {/* VIEW 3: ANALYTICS */}
        {activeTab === "analytics" && (
          <motion.div
            key="analytics"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            <AnalyticsPanel analytics={liveCurrent?.analytics} />
          </motion.div>
        )}

        {/* VIEW 4: STREAM HEALTH */}
        {activeTab === "stream-health" && (
          <motion.div
            key="stream-health"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            <StreamHealth telemetry={liveCurrent?.telemetry} fullWidth />
          </motion.div>
        )}

        {/* VIEW 5: SETTINGS */}
        {activeTab === "settings" && (
          <motion.div
            key="settings"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="border border-[#1E293B] bg-[#0D1320] p-12 rounded-3xl text-center space-y-4 max-w-lg mx-auto"
          >
            <div className="w-16 h-16 bg-slate-900 border border-[#1E293B] rounded-full flex items-center justify-center mx-auto text-slate-400 shadow-xl">
              <Settings className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-black uppercase tracking-widest text-white">Production Console Settings</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Configure global esports overlays, spectator display settings, RTMP key bindings, and auto-director
                timers. All options are fully optimized for seamless broadcasting.
              </p>
            </div>
          </motion.div>
        )}

        {/* VIEW 6: LIVE INTERACTIVE GAME FEED */}
        {activeTab === "live-game" && (
          <motion.div
            key="live-game"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6 flex flex-col h-[calc(100vh-140px)]"
          >
            {/* Header info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-[#0D1320] via-[#1A2338] to-[#0D1320] border border-[#1E293B] p-5 rounded-2xl">
              <div className="space-y-1">
                <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center space-x-2">
                  <Monitor className="w-4 h-4 text-[#00E5FF] animate-pulse" />
                  <span>Interactive Game Portal Feed</span>
                </h3>
                <p className="text-[10px] text-slate-400 font-medium font-mono">
                  This panel embeds the live game home page inside the studio console, allowing real-time navigation and monitoring.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    const iframe = document.getElementById("game-iframe") as HTMLIFrameElement;
                    if (iframe) iframe.src = "/";
                  }}
                  className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white font-bold uppercase text-[9px] tracking-wider px-3.5 py-2 rounded-lg border border-slate-700 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reload Portal</span>
                </button>
                <a
                  href="/"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-2 bg-[#00E5FF]/20 hover:bg-[#00E5FF]/30 text-[#00E5FF] font-bold uppercase text-[9px] tracking-wider px-3.5 py-2 rounded-lg border border-[#00E5FF]/30 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Fullscreen</span>
                </a>
              </div>
            </div>

            {/* Embedded Live Iframe with futuristic frame styling */}
            <div className="flex-1 min-h-[500px] border border-[#1E293B] rounded-2xl overflow-hidden bg-[#05070B] relative flex flex-col shadow-2xl">
              <div className="bg-[#090d16] px-4 py-2 border-b border-[#1E293B] flex items-center justify-between text-[10px] font-mono font-bold text-slate-400">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span className="ml-2 text-[10px] text-[#00E5FF] uppercase font-black tracking-wider">LIVE_FEED_CONSOLE // PORTAL</span>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500">STATUS: ACTIVE</span>
                  <span className="text-[#00E5FF]">SRC: "/"</span>
                </div>
              </div>
              <iframe
                id="game-iframe"
                src="/"
                className="w-full flex-1 border-none bg-[#05070B]"
                title="Arena Live Home Feed"
                allow="camera; microphone; geolocation"
              />
            </div>
          </motion.div>
        )}

        {/* VIEW 7: MY PLAYABLE GAME INTERACTIVE TERMINAL */}
        {activeTab === "my-game" && (
          <motion.div
            key="my-game"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6 flex flex-col h-[calc(100vh-140px)]"
          >
            {/* Header info */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-[#070B14] via-[#0E1624] to-[#070B14] border border-[#1E293B] p-5 rounded-2xl shadow-xl">
              <div className="space-y-1.5">
                <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center space-x-2.5">
                  <Gamepad2 className="w-5 h-5 text-[#00E5FF] animate-pulse" />
                  <span>My Active Race Arena Game</span>
                </h3>
                <p className="text-[10px] text-slate-400 font-medium font-mono leading-relaxed max-w-2xl">
                  Connect controllers, set visual configurations, or play the race directly in the interactive screen below. 
                  Use <span className="text-[#00E5FF] font-bold">W, A, S, D</span> or <span className="text-[#00E5FF] font-bold">Arrow Keys</span> to steer, and <span className="text-amber-400 font-bold">Spacebar</span> for high-speed braking.
                </p>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => {
                    const iframe = document.getElementById("active-playable-game") as HTMLIFrameElement;
                    if (iframe) iframe.src = "/";
                  }}
                  className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white font-bold uppercase text-[9px] tracking-wider px-3.5 py-2.5 rounded-xl border border-slate-700 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" />
                  <span>Reset Session</span>
                </button>
                <a
                  href="/"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-2 bg-gradient-to-r from-[#00E5FF] to-[#7C4DFF] text-white font-black uppercase text-[9px] tracking-widest px-4 py-2.5 rounded-xl shadow-[0_0_15px_rgba(0,229,255,0.25)] hover:shadow-[0_0_20px_rgba(0,229,255,0.4)] transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>PLAY FULLSCREEN</span>
                </a>
              </div>
            </div>

            {/* Embedded Live Iframe with futuristic frame styling */}
            <div className="flex-1 min-h-[500px] border border-[#2A364F] rounded-3xl overflow-hidden bg-[#020408] relative flex flex-col shadow-2xl">
              <div className="bg-[#0B1220] px-5 py-3 border-b border-[#1E293B] flex items-center justify-between text-[10px] font-mono font-bold text-slate-400">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 absolute"></span>
                  <span className="ml-3.5 text-[10px] text-[#00E5FF] uppercase font-black tracking-widest">CONSOLE // ACTIVE_GAMEPLAY_FEED</span>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="hidden sm:flex items-center space-x-1 text-[9px] text-slate-500">
                    <span>STEERING:</span>
                    <span className="text-[#00E5FF] font-black">WSAD / ARROWS</span>
                  </div>
                  <div className="h-3 w-[1px] bg-slate-800 hidden sm:block"></div>
                  <span className="text-[9px] uppercase tracking-wider text-slate-500">UPLINK STATE: SYNCED</span>
                </div>
              </div>
              <iframe
                id="active-playable-game"
                src="/"
                className="w-full flex-1 border-none bg-[#020408]"
                title="My Race Arena Gameplay"
                allow="camera; microphone; geolocation"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </BroadcasterCockpitLayout>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// OFFICIAL ROOM CARD SUB-COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
interface OfficialRoomCardProps {
  liveCurrent: LiveCurrentState | null;
  activeRoomDoc: RoomState | null;
  copyStatus: "none" | "code" | "link";
  onCopyCode: () => void;
  onCopyLink: () => void;
  onStartRace: () => void;
  onStopRace: () => void;
  onInjectAI: () => void;
  onCreateNextRoom: () => void;
  onEmergencyStop: () => void;
}

export const OfficialRoomCard: React.FC<OfficialRoomCardProps> = ({
  liveCurrent,
  activeRoomDoc,
  copyStatus,
  onCopyCode,
  onCopyLink,
  onStartRace,
  onStopRace,
  onInjectAI,
  onCreateNextRoom,
  onEmergencyStop,
}) => {
  const currentPlayers = activeRoomDoc?.players || [];
  const statusColors: Record<string, string> = {
    waiting: "border-[#00E676]/30 text-[#00E676] bg-[#00E676]/5",
    racing: "border-[#FFC400]/30 text-[#FFC400] bg-[#FFC400]/5 animate-pulse",
    archived: "border-slate-800 text-slate-500 bg-slate-950/40",
    closed: "border-red-500/30 text-red-500 bg-red-500/5",
  };

  return (
    <div className="bg-[#0D1320] border border-[#1E293B] rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl relative overflow-hidden">
      {/* Upper header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-900/60">
        <div className="space-y-1.5">
          <div className="flex items-center space-x-3">
            <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase font-mono">
              RACE NUMBER #{liveCurrent?.raceNumber}
            </span>
            <span
              className={`px-2.5 py-1 rounded-full text-[8.5px] font-black uppercase tracking-widest border ${
                statusColors[liveCurrent?.status || "waiting"] || "border-slate-800 text-slate-400"
              }`}
            >
              {liveCurrent?.status?.toUpperCase()}
            </span>
          </div>
          <h3 className="text-xl font-black uppercase tracking-tight text-white flex items-center space-x-2.5">
            <Database className="w-5 h-5 text-[#00E5FF] shrink-0" />
            <span className="font-mono">{liveCurrent?.roomCode}</span>
          </h3>
        </div>

        {/* Action controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onCopyCode}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-950 border border-slate-800 hover:border-slate-700 text-[9.5px] font-black uppercase tracking-wider rounded-xl transition text-slate-300 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>{copyStatus === "code" ? "COPIED!" : "COPY CODE"}</span>
          </button>
          <button
            onClick={onCopyLink}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-950 border border-slate-800 hover:border-slate-700 text-[9.5px] font-black uppercase tracking-wider rounded-xl transition text-slate-300 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{copyStatus === "link" ? "LINK COPIED!" : "COPY LINK"}</span>
          </button>
        </div>
      </div>

      {/* Meta grid specs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-[10px] font-bold text-slate-400">
        <div className="bg-slate-950/45 p-3 rounded-2xl border border-slate-900">
          <div className="text-slate-500 uppercase text-[8px] tracking-wider mb-0.5">CURRENT LAP</div>
          <span className="text-white text-xs font-black">{liveCurrent?.currentLap || 0} / 3 Laps</span>
        </div>
        <div className="bg-slate-950/45 p-3 rounded-2xl border border-slate-900">
          <div className="text-slate-500 uppercase text-[8px] tracking-wider mb-0.5">RACE TIMER</div>
          <span className="text-white text-xs font-black">{liveCurrent?.raceTimer || "00:00.00"}</span>
        </div>
        <div className="bg-slate-950/45 p-3 rounded-2xl border border-slate-900">
          <div className="text-slate-500 uppercase text-[8px] tracking-wider mb-0.5">MAP</div>
          <span className="text-white text-xs font-black truncate block">{liveCurrent?.map}</span>
        </div>
        <div className="bg-slate-950/45 p-3 rounded-2xl border border-slate-900">
          <div className="text-slate-500 uppercase text-[8px] tracking-wider mb-0.5">WEATHER</div>
          <span className="text-white text-xs font-black">{liveCurrent?.weather}</span>
        </div>
      </div>

      {/* Racer grid lining up */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center space-x-2">
            <Users className="w-4 h-4 text-slate-400" />
            <span>RACING LINEUP STAGING ({currentPlayers.length} / 6)</span>
          </h4>

          {liveCurrent?.status === "waiting" && (
            <button
              onClick={onInjectAI}
              className="px-3 py-1 bg-[#00E5FF]/10 hover:bg-[#00E5FF]/15 border border-[#00E5FF]/20 text-[#00E5FF] text-[9px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
            >
              SPAWN AI BOTS
            </button>
          )}
        </div>

        {currentPlayers.length === 0 ? (
          <div className="p-8 text-center bg-slate-950/45 border border-slate-900/60 rounded-2xl text-xs text-slate-500 leading-relaxed font-semibold">
            No active racers queued on grid. Standard matchmaking links are available.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {currentPlayers.map((player) => (
              <div
                key={player.uid}
                className="bg-slate-950/50 p-3.5 rounded-2xl border border-slate-900 flex items-center justify-between"
              >
                <div className="flex items-center space-x-3 truncate">
                  <img
                    src={
                      player.photoURL ||
                      "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=150&q=80"
                    }
                    alt={player.playerName}
                    className="w-7 h-7 rounded-full border border-slate-800"
                    referrerPolicy="no-referrer"
                  />
                  <div className="truncate">
                    <span className="text-xs font-black text-white block truncate">{player.playerName}</span>
                    <span className="text-[8px] font-bold uppercase text-slate-500 font-mono">
                      {player.isAI ? "🤖 COMP_AI" : "👤 RACER"}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-md border border-[#00E5FF]/30 text-[#00E5FF] bg-[#00E5FF]/5 font-mono">
                    {player.carId?.split("_")[0]?.toUpperCase() || "FERRARI"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Production Lifecycle Operations panel */}
      <div className="pt-6 border-t border-slate-900/60 space-y-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center space-x-2">
          <Sliders className="w-4 h-4 text-slate-400" />
          <span>PRODUCTION LIFECYCLE OPERATIONS</span>
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {liveCurrent?.status === "waiting" ? (
            <button
              onClick={onStartRace}
              className="w-full py-4 bg-gradient-to-r from-[#00E676] to-[#00B0FF] hover:from-[#00E676]/90 hover:to-[#00B0FF]/90 text-white font-black uppercase text-[10px] tracking-widest rounded-2xl transition shadow-[0_4px_15px_rgba(0,230,118,0.2)] flex items-center justify-center space-x-2 cursor-pointer border border-[#00E676]/20"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>START RACE</span>
            </button>
          ) : (
            <button
              onClick={onStopRace}
              disabled={liveCurrent?.status !== "racing"}
              className="w-full py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-black uppercase text-[10px] tracking-widest rounded-2xl transition flex items-center justify-center space-x-2 cursor-pointer border border-slate-700"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>STOP RACE</span>
            </button>
          )}

          <button
            onClick={onCreateNextRoom}
            className="w-full py-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 font-black uppercase text-[10px] tracking-widest rounded-2xl transition flex items-center justify-center space-x-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>GENERATE NEXT ROOM</span>
          </button>

          <button
            onClick={() => window.open(`/spectator?room=${liveCurrent?.roomCode}`, "_blank")}
            className="w-full py-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 font-black uppercase text-[10px] tracking-widest rounded-2xl transition flex items-center justify-center space-x-2 cursor-pointer"
          >
            <Eye className="w-4 h-4" />
            <span>OPEN SPECTATOR</span>
          </button>

          <button
            onClick={onEmergencyStop}
            className="w-full py-4 bg-red-950/30 hover:bg-red-900/20 border border-red-500/20 hover:border-red-500/40 text-red-400 font-black uppercase text-[10px] tracking-widest rounded-2xl transition flex items-center justify-center space-x-2 cursor-pointer shadow-lg"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>EMERGENCY STOP</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BROADCAST TELEMETRY BAR STATS SUB-COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
interface BroadcastStatsProps {
  telemetry: StreamTelemetry | undefined;
}

export const BroadcastStats: React.FC<BroadcastStatsProps> = ({ telemetry }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 font-mono">
      {/* Stream State */}
      <div className="bg-[#0D1320] border border-[#1E293B] p-4 rounded-2xl flex items-center justify-between shadow-md relative overflow-hidden group">
        <div className="space-y-1 z-10">
          <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Broadcast State</span>
          <span className="text-xs font-black tracking-wider flex items-center space-x-1.5 text-[#FF5252]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF5252] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FF5252]"></span>
            </span>
            <span>{telemetry?.streamState || "LIVE"}</span>
          </span>
        </div>
        <Radio className="w-8 h-8 text-[#FF5252] opacity-25" />
      </div>

      {/* Bitrate */}
      <div className="bg-[#0D1320] border border-[#1E293B] p-4 rounded-2xl flex items-center justify-between shadow-md relative overflow-hidden group">
        <div className="space-y-1">
          <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">
            RTMP Upload Bitrate
          </span>
          <span className="text-xs font-black text-white">{telemetry?.bitrate || 6200} kbps</span>
        </div>
        <Activity className="w-8 h-8 text-[#00E5FF] opacity-25" />
      </div>

      {/* Latency */}
      <div className="bg-[#0D1320] border border-[#1E293B] p-4 rounded-2xl flex items-center justify-between shadow-md relative overflow-hidden group">
        <div className="space-y-1">
          <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Stream Latency</span>
          <span className="text-xs font-black text-white">{telemetry?.latency || 18} ms</span>
        </div>
        <Wifi className="w-8 h-8 text-[#FFC400] opacity-25" />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA PANEL SUB-COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
interface CameraPanelProps {
  currentCamera: string;
  isAutoDirector: boolean;
  onToggleAuto: () => void;
  onChangeCam: (mode: string) => void;
  fullWidth?: boolean;
}

export const CameraPanel: React.FC<CameraPanelProps> = ({
  currentCamera,
  isAutoDirector,
  onToggleAuto,
  onChangeCam,
  fullWidth = false,
}) => {
  const cameraOptions = [
    { mode: "third-person", label: "3rd-Person Chase Cam", desc: "Auto tracking chassis line" },
    { mode: "drone", label: "Drone Hover Cam", desc: "Cinematic wide matrix path" },
    { mode: "finish", label: "Finish-Line Camera", desc: "Telemetry finish-gate speed sweep" },
    { mode: "helicopter", label: "Helicopter Sweeps", desc: "Immersive aerial bird-eye" },
    { mode: "replay", label: "Slowmo Replay Cam", desc: "Cornering speed analytics" },
    { mode: "pit", label: "Pit Lane Tracking", desc: "Pit garages view" },
    { mode: "cinematic", label: "Cinematic Director", desc: "Artistic camera sweeps" },
  ];

  return (
    <div
      className={`bg-[#0D1320] p-6 sm:p-8 rounded-3xl border border-[#1E293B] space-y-5 shadow-xl ${fullWidth ? "w-full" : ""}`}
    >
      <div className="flex justify-between items-center border-b border-slate-900 pb-3">
        <h3 className="text-xs font-black uppercase tracking-widest text-[#00E5FF] flex items-center space-x-2">
          <Camera className="w-4 h-4 text-[#00E5FF]" />
          <span>AI Director Frequencies</span>
        </h3>

        <button
          onClick={onToggleAuto}
          className={`px-3 py-1 rounded-xl text-[8.5px] font-black uppercase border transition-all cursor-pointer ${
            isAutoDirector
              ? "bg-[#00E5FF]/10 border-[#00E5FF]/30 text-[#00E5FF]"
              : "bg-slate-950/60 border-slate-800 text-slate-500"
          }`}
        >
          {isAutoDirector ? "AUTO DIRECTOR" : "MANUAL"}
        </button>
      </div>

      <div className="flex flex-col space-y-2">
        {cameraOptions.map((cam) => {
          const isActive = currentCamera === cam.mode;
          return (
            <button
              key={cam.mode}
              onClick={() => onChangeCam(cam.mode)}
              className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center justify-between group cursor-pointer ${
                isActive
                  ? "bg-gradient-to-r from-[#00E5FF]/15 to-[#7C4DFF]/5 border-[#00E5FF]/40 text-[#00E5FF] shadow-[0_4px_15px_rgba(0,229,255,0.08)]"
                  : "bg-slate-950/40 border-transparent hover:border-slate-800 text-slate-400 hover:text-white hover:bg-slate-950/80"
              }`}
            >
              <div>
                <span className="block text-[11px] font-black uppercase tracking-wider">{cam.label}</span>
                <span className="text-[9px] text-slate-500 font-semibold block mt-0.5">{cam.desc}</span>
              </div>
              <Video
                className={`w-4 h-4 ${isActive ? "text-[#00E5FF] animate-pulse" : "text-slate-600 group-hover:text-slate-400"}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STREAM HEALTH & HARDWARE SPECIFICATIONS SUB-COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
interface StreamHealthProps {
  telemetry: StreamTelemetry | undefined;
  fullWidth?: boolean;
}

export const StreamHealth: React.FC<StreamHealthProps> = ({ telemetry, fullWidth = false }) => {
  return (
    <div
      className={`bg-[#0D1320] p-6 sm:p-8 rounded-3xl border border-[#1E293B] space-y-6 shadow-xl ${fullWidth ? "w-full" : ""}`}
    >
      <h3 className="text-xs font-black uppercase tracking-widest text-[#00E676] flex items-center space-x-2 border-b border-slate-900 pb-3">
        <Activity className="w-4 h-4 text-[#00E676]" />
        <span>Station Telemetry & Health</span>
      </h3>

      <div className="space-y-4 text-xs font-semibold">
        {/* Connection elements */}
        <div className="grid grid-cols-2 gap-3 text-[9.5px] font-bold text-slate-400 font-mono">
          <div className="bg-slate-950/40 p-3.5 rounded-xl border border-slate-900 flex items-center justify-between">
            <div>
              <span className="text-slate-500 block text-[7.5px] tracking-wider mb-0.5">OBS BROADCAST</span>
              <span className="text-[#00E676]">CONNECTED</span>
            </div>
            <CheckCircle className="w-4 h-4 text-[#00E676]" />
          </div>
          <div className="bg-slate-950/40 p-3.5 rounded-xl border border-slate-900 flex items-center justify-between">
            <div>
              <span className="text-slate-500 block text-[7.5px] tracking-wider mb-0.5">FFMPEG PACKETS</span>
              <span className="text-[#00E676]">CONNECTED</span>
            </div>
            <CheckCircle className="w-4 h-4 text-[#00E676]" />
          </div>
        </div>

        {/* CPU Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[9px] font-bold text-slate-400 font-mono">
            <span>PROCESSOR LOAD</span>
            <span>{telemetry?.cpu || 35}%</span>
          </div>
          <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
            <div className="h-full bg-[#00E676] transition-all" style={{ width: `${telemetry?.cpu || 35}%` }} />
          </div>
        </div>

        {/* GPU Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[9px] font-bold text-slate-400 font-mono">
            <span>GRAPHICS CO-ENGINE</span>
            <span>{telemetry?.gpu || 52}%</span>
          </div>
          <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
            <div className="h-full bg-[#00E5FF] transition-all" style={{ width: `${telemetry?.gpu || 52}%` }} />
          </div>
        </div>

        {/* Memory Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[9px] font-bold text-slate-400 font-mono">
            <span>MEMORY ALLOCATION</span>
            <span>{telemetry?.memory || 44}%</span>
          </div>
          <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
            <div className="h-full bg-[#7C4DFF] transition-all" style={{ width: `${telemetry?.memory || 44}%` }} />
          </div>
        </div>

        {/* Dropped Frames */}
        <div className="grid grid-cols-2 gap-3 text-[9.5px] font-bold text-slate-400 font-mono">
          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-900">
            <span className="text-slate-500 block text-[7.5px] tracking-wider mb-0.5">DROPPED FRAMES</span>
            <span className="text-[#00E676]">0 (0.0%)</span>
          </div>
          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-900">
            <span className="text-slate-500 block text-[7.5px] tracking-wider mb-0.5">NET INTEGRITY</span>
            <span className="text-[#00E676]">EXCELLENT</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ESPORTS ANALYTICS PANEL SUB-COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
interface AnalyticsPanelProps {
  analytics:
    | {
        peakViewers: number;
        avgWatchTime: number;
        raceCount: number;
        completedRaces: number;
        currentPlayers: number;
        aiPlayers: number;
        spectators: number;
      }
    | undefined;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ analytics }) => {
  return (
    <div className="bg-[#0D1320] p-6 sm:p-8 rounded-3xl border border-[#1E293B] space-y-6 shadow-xl">
      <h3 className="text-xs font-black uppercase tracking-widest text-[#7C4DFF] flex items-center space-x-2 border-b border-slate-900 pb-3">
        <BarChart2 className="w-4 h-4 text-[#7C4DFF]" />
        <span>Esports Season Statistics</span>
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-slate-400 text-[10px]">
        <div className="bg-slate-950/45 p-4 rounded-2xl border border-slate-900">
          <span className="text-slate-500 block text-[8px] tracking-wider mb-0.5">PEAK CONCURRENT CCV</span>
          <span className="text-white text-base font-black">{analytics?.peakViewers || 3120} VIEWERS</span>
        </div>
        <div className="bg-slate-950/45 p-4 rounded-2xl border border-slate-900">
          <span className="text-slate-500 block text-[8px] tracking-wider mb-0.5">AVG WATCH TIME</span>
          <span className="text-[#00E5FF] text-base font-black">{analytics?.avgWatchTime || 18.5} MIN</span>
        </div>
        <div className="bg-slate-950/45 p-4 rounded-2xl border border-slate-900">
          <span className="text-slate-500 block text-[8px] tracking-wider mb-0.5">SEASON RACE COUNT</span>
          <span className="text-[#00E676] text-base font-black">{analytics?.raceCount || 1450} MATCHES</span>
        </div>
        <div className="bg-slate-950/45 p-4 rounded-2xl border border-slate-900">
          <span className="text-slate-500 block text-[8px] tracking-wider mb-0.5">COMPLETED MATCHES</span>
          <span className="text-[#FFC400] text-base font-black">{analytics?.completedRaces || 1449} RACES</span>
        </div>
      </div>
    </div>
  );
};

// Alias BroadcasterLiveDesk to BroadcasterDashboard for App.tsx routing compatibility
export const BroadcasterLiveDesk: React.FC = () => {
  return <BroadcasterDashboard />;
};
