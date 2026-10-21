import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Check, 
  Loader2, 
  AlertTriangle, 
  Shield, 
  UserMinus, 
  ArrowLeft,
  Activity,
  Server,
  Database,
  Cpu
} from "lucide-react";

interface MultiplayerRaceLoadingScreenProps {
  roomCode: string;
  players: any[];
  currentUserId: string;
  isHost: boolean;
  onRemovePlayer: (pid: string) => void;
  
  // Local player states
  mapVerified: boolean;
  mapDownloadProgress: number;
  mapDownloadReady: boolean;
  carVerified: boolean;
  carDownloadProgress: number;
  carDownloadReady: boolean;
  glbParsing: boolean;
  glbParsed: boolean;
  vehicleInitProgress: number;
  vehicleInitReady: boolean;
  
  allPlayersReadyTriggered: boolean;
  onExit: () => void;

  // Real-time Countdown sync
  countdownRemaining?: number;
  countdownMsg?: string;
  countdownStatus?: string;
}

export const MultiplayerRaceLoadingScreen: React.FC<MultiplayerRaceLoadingScreenProps> = ({
  roomCode,
  players,
  currentUserId,
  isHost,
  onRemovePlayer,
  
  mapVerified,
  mapDownloadProgress,
  mapDownloadReady,
  carVerified,
  carDownloadProgress,
  carDownloadReady,
  glbParsing,
  glbParsed,
  vehicleInitProgress,
  vehicleInitReady,
  
  allPlayersReadyTriggered,
  onExit,

  countdownRemaining,
  countdownMsg,
  countdownStatus,
}) => {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const int = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => clearInterval(int);
  }, []);

  // Filter only human players for the lobby list
  const humanPlayers = players.filter((p) => !p.isAI);

  const getPlayerStatusLabel = (p: any) => {
    if (p.ready && p.mapReady && p.carReady && p.sceneReady) {
      return (
        <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
          <Check className="w-3.5 h-3.5" /> READY
        </span>
      );
    }
    
    if (p.vehicleInitialized) {
      return (
        <span className="flex items-center gap-1.5 text-cyan-400">
          <Check className="w-3.5 h-3.5" /> VEHICLE INITIALIZED
        </span>
      );
    }

    if (p.glbParsing) {
      return (
        <span className="flex items-center gap-1.5 text-fuchsia-400 animate-pulse">
          <Loader2 className="w-3 h-3 animate-spin" /> PARSING GLB
        </span>
      );
    }

    if (p.carReady) {
      return (
        <span className="flex items-center gap-1.5 text-amber-400">
          <Check className="w-3.5 h-3.5" /> CAR VERIFIED
        </span>
      );
    }

    if (p.mapReady) {
      const carProg = p.carProgress !== undefined ? p.carProgress : 0;
      return (
        <span className="flex items-center gap-1.5 text-amber-400">
          <Loader2 className="w-3 h-3 animate-spin" /> DOWNLOADING CAR ({carProg}%)
        </span>
      );
    }

    const mapProg = p.mapProgress !== undefined ? p.mapProgress : 0;
    return (
      <span className="flex items-center gap-1.5 text-cyan-400">
        <Loader2 className="w-3 h-3 animate-spin" /> DOWNLOADING MAP ({mapProg}%)
      </span>
    );
  };

  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center font-sans text-white z-50 select-none p-4 md:p-8">
      {/* Abstract Grid Mesh Background Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30 pointer-events-none" />
      
      {/* Core Interface Container */}
      <div className="w-full max-w-5xl bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden flex flex-col gap-6 md:gap-8 backdrop-blur-xl">
        
        {/* Top Header Row */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-5 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              <span className="text-[10px] uppercase font-mono tracking-widest text-cyan-400 font-bold">
                MULTIPLICATIVE ARENA FEED CONNECTED
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black uppercase tracking-wider text-white">
              PRE-RACE SYSTEM CALIBRATION
            </h1>
            <p className="text-xs text-slate-400 font-mono">
              ROOM CODE: <span className="text-cyan-400 font-bold">{roomCode}</span>
            </p>
          </div>
          
          <button
            onClick={onExit}
            className="flex items-center gap-2 px-4 py-2 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-rose-400 text-xs font-bold font-mono rounded-lg border border-slate-800 hover:border-rose-950 active:scale-95 transition-all duration-150 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> LEAVE FEED
          </button>
        </div>

        {/* Outer Grid of Loading Metrics and Player Statuses */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 items-stretch">
          
          {/* Left Column: Local Player Calibration Progress */}
          <div className="space-y-6 bg-slate-950/50 rounded-xl p-5 border border-slate-800/40">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h2 className="text-xs uppercase font-mono tracking-widest text-slate-400 font-bold flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" /> LOCAL CALIBRATION
              </h2>
              <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase animate-pulse">
                {allPlayersReadyTriggered ? "READY" : `SYNCING${dots}`}
              </span>
            </div>

            <div className="space-y-5">
              {/* 1. Map Verification & Download */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-slate-300 flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${mapDownloadReady ? "bg-emerald-400" : "bg-cyan-400 animate-pulse"}`} />
                    1. Map Verification
                  </span>
                  <span className={`font-bold ${mapDownloadReady ? "text-emerald-400" : "text-cyan-400"}`}>
                    {mapDownloadReady ? "VERIFIED ✅" : `${mapDownloadProgress}%`}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden p-[1px]">
                  <motion.div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-400 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${mapDownloadProgress}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
              </div>

              {/* 2. Car Verification & Download */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-slate-300 flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${carDownloadReady ? "bg-emerald-400" : mapDownloadReady ? "bg-amber-400 animate-pulse" : "bg-slate-700"}`} />
                    2. Vehicle GLB Verification
                  </span>
                  <span className={`font-bold ${carDownloadReady ? "text-emerald-400" : mapDownloadReady ? "text-amber-400" : "text-slate-500"}`}>
                    {!mapDownloadReady ? "WAITING" : carDownloadReady ? "VERIFIED ✅" : `${carDownloadProgress}%`}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden p-[1px]">
                  <motion.div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${mapDownloadReady ? carDownloadProgress : 0}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
              </div>

              {/* 3. GLB Parsing */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-slate-300 flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${glbParsed ? "bg-emerald-400" : glbParsing ? "bg-fuchsia-400 animate-pulse" : "bg-slate-700"}`} />
                    3. GLB Engine Parsing
                  </span>
                  <span className={`font-bold ${glbParsed ? "text-emerald-400" : glbParsing ? "text-fuchsia-400" : "text-slate-500"}`}>
                    {!carDownloadReady ? "WAITING" : glbParsed ? "PARSED ✅" : "PARSING..."}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden p-[1px]">
                  <motion.div
                    className="h-full bg-gradient-to-r from-fuchsia-500 to-pink-400 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${glbParsed ? 100 : glbParsing ? 50 : 0}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
              </div>

              {/* 4. Vehicle 3D Initialization */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-slate-300 flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${vehicleInitReady ? "bg-emerald-400" : glbParsed ? "bg-rose-400 animate-pulse" : "bg-slate-700"}`} />
                    4. Vehicle Initialization
                  </span>
                  <span className={`font-bold ${vehicleInitReady ? "text-emerald-400" : glbParsed ? "text-rose-400" : "text-slate-500"}`}>
                    {!glbParsed ? "WAITING" : vehicleInitReady ? "INITIALIZED ✅" : `${vehicleInitProgress}%`}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden p-[1px]">
                  <motion.div
                    className="h-full bg-gradient-to-r from-rose-500 to-red-400 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${glbParsed ? vehicleInitProgress : 0}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Arena Connection Sync Statuses (All Other Players) */}
          <div className="space-y-4 bg-slate-950/50 rounded-xl p-5 border border-slate-800/40 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                <h2 className="text-xs uppercase font-mono tracking-widest text-slate-400 font-bold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" /> ARENA TRANSMISSION
                </h2>
                <span className="text-[10px] font-mono text-cyan-400/80 uppercase font-semibold">
                  {humanPlayers.length} CONNECTIONS ACTIVE
                </span>
              </div>

              <div className="space-y-3 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                {humanPlayers.map((player) => {
                  const isMe = player.uid === currentUserId || player.id === currentUserId;
                  return (
                    <div 
                      key={player.uid || player.id} 
                      className={`flex justify-between items-center p-3 rounded-lg border font-mono text-xs ${
                        isMe 
                          ? "bg-cyan-500/5 border-cyan-500/20" 
                          : "bg-slate-900/60 border-slate-800/60 hover:bg-slate-900 hover:border-slate-800 transition-colors"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {player.isHost && (
                          <Shield className="w-3.5 h-3.5 text-cyan-400"><title>Host</title></Shield>
                        )}
                        <span className={`font-bold ${isMe ? "text-cyan-400" : "text-white"}`}>
                          {player.playerName || player.name || "Driver"} {isMe ? "(YOU)" : ""}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        {getPlayerStatusLabel(player)}
                        
                        {/* Host only player-removal mechanism */}
                        {isHost && !isMe && (
                          <button
                            onClick={() => onRemovePlayer(player.uid || player.id)}
                            className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/20 border border-transparent hover:border-rose-900/50 rounded transition-all active:scale-95 cursor-pointer"
                            title="Remove slow/disconnected player"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Mode / Server / DB Status Footer Lineup */}
            <div className="flex items-center gap-4 text-[9px] text-slate-500 font-mono border-t border-slate-900 pt-3">
              <span className="flex items-center gap-1">
                <Server className="w-3 h-3 text-cyan-500" />
                SYSTEM: STANDALONE_NODE
              </span>
              <span className="flex items-center gap-1">
                <Database className="w-3 h-3 text-emerald-500" />
                SYNC: CLOUD_FIRESTORE
              </span>
            </div>
          </div>

        </div>

        {/* Global Loading Bottom Status Bar */}
        <AnimatePresence mode="wait">
          {countdownStatus === "countdown" && countdownRemaining !== undefined ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center p-4 bg-pink-500/10 border border-pink-500/30 rounded-xl text-center space-y-1"
            >
              <div className="flex items-center gap-2 text-pink-400 font-bold text-[10px] uppercase tracking-widest font-mono">
                <span className="h-2 w-2 rounded-full bg-pink-500 animate-ping" />
                COUNTDOWN IN PROGRESS
              </div>
              <h3 className="text-4xl font-black font-mono tracking-wider text-pink-500">
                {countdownRemaining > 0 ? `${countdownRemaining}s` : "GO!"}
              </h3>
              <p className="text-[9px] text-slate-400 font-mono uppercase tracking-widest">
                Warming virtual engines. Race starts immediately upon calibration completion!
              </p>
            </motion.div>
          ) : allPlayersReadyTriggered ? (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col items-center justify-center p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center space-y-1.5"
            >
              <h3 className="text-sm font-black uppercase tracking-widest text-emerald-400">
                ALL PLAYERS READY
              </h3>
              <p className="text-[10px] text-emerald-500 font-mono animate-pulse uppercase tracking-widest">
                Starting race... warming engine core
              </p>
            </motion.div>
          ) : (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-center items-center gap-3 p-4 bg-slate-950/40 border border-slate-800/40 rounded-xl"
            >
              <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">
                WAITING FOR ALL GRID RACERS TO COMPLETE SYSTEM CALIBRATION
              </span>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};
