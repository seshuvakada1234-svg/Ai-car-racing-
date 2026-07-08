/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Gamepad2, Radio, Play } from "lucide-react";

interface SplashScreenProps {
  onComplete: () => void;
}

const SPLASH_TIPS = [
  "Retrieving regional drift server metrics...",
  "Syncing volumetric showroom HDR pipelines...",
  "Calibrating active suspension torque rates...",
  "Allocating high-fidelity physics collision grids...",
  "Authenticating secure racer satellite links...",
];

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Progress increment timer (simulating asset loading)
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        // Simulated progress steps
        const increment = Math.floor(Math.random() * 8) + 5;
        return Math.min(100, prev + increment);
      });
    }, 100);

    // Dynamic tips interval
    const tipInterval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % SPLASH_TIPS.length);
    }, 1200);

    return () => {
      clearInterval(progressInterval);
      clearInterval(tipInterval);
    };
  }, []);

  useEffect(() => {
    if (progress === 100) {
      const waitTimeout = setTimeout(() => {
        setLoaded(true);
      }, 400);
      return () => clearTimeout(waitTimeout);
    }
  }, [progress]);

  const handleStartEngagement = async () => {
    // Standard User Gesture triggered fullscreen request
    const docEl = document.documentElement;
    try {
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if ((docEl as any).webkitRequestFullscreen) {
        await (docEl as any).webkitRequestFullscreen();
      } else if ((docEl as any).msRequestFullscreen) {
        await (docEl as any).msRequestFullscreen();
      }
    } catch (fErr) {
      console.warn("Fullscreen request denied: ", fErr);
    }

    // Lock landscape mode
    const orientation = window.screen && (window.screen.orientation as any);
    if (orientation && orientation.lock) {
      try {
        await orientation.lock("landscape");
      } catch (oErr) {
        console.warn("Screen landscape lock denied: ", oErr);
      }
    } else if ((window.screen as any).lockOrientation) {
      try {
        (window.screen as any).lockOrientation("landscape");
      } catch (e) {
        // Safe skip
      }
    }

    // Call completion
    onComplete();
  };

  return (
    <div
      id="splash-screen-root"
      onClick={loaded ? handleStartEngagement : undefined}
      className={`fixed inset-0 w-screen h-[100dvh] bg-black text-white select-none overflow-hidden flex flex-col items-center justify-between p-10 z-[99999] ${
        loaded ? "cursor-pointer hover:brightness-110 active:scale-[0.99] transition-all" : ""
      }`}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        background: "#010204",
      }}
    >
      {/* Immersive cinematic background particles & neon glows */}
      <div className="absolute inset-0 bg-gradient-to-tr from-blue-950/30 via-slate-950 to-cyan-950/20 z-0 pointer-events-none" />

      {/* High-speed track grid lines of Cyberpunk Arena */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,242,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(0,242,255,0.015)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none z-0 opacity-50" />

      {/* Floating blurred ambient neon orbs resembling Free Fire lobby */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-cyan-500/5 rounded-full blur-[140px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Top HUD: Low-Latency Satellite telemetry links */}
      <div className="w-full flex justify-between items-center z-10 font-mono text-[9px] text-cyan-400/50 tracking-widest px-2">
        <div className="flex items-center space-x-2">
          <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
          <span className="uppercase">LATENCY: 12MS | SERVER: AI-ARENA-S1</span>
        </div>
        <div className="flex items-center space-x-4">
          <span className="uppercase">CORE NODE VER: 1.2</span>
          <span className="uppercase font-black text-emerald-400">FPS: 60.00</span>
        </div>
      </div>

      {/* Middle Section: Elevated Garenas Style Steel Badge with Neon glow */}
      <div className="flex flex-col items-center text-center z-10 space-y-5">
        {/* Animated Brand Game Shield */}
        <motion.div
          animate={{
            scale: loaded ? [1, 1.05, 1] : 1,
            boxShadow: loaded
              ? [
                  "0 0 30px rgba(0, 242, 255, 0.2)",
                  "0 0 60px rgba(0, 242, 255, 0.45)",
                  "0 0 30px rgba(0, 242, 255, 0.2)",
                ]
              : "0 0 30px rgba(0, 242, 255, 0.15)",
          }}
          transition={{
            repeat: Infinity,
            duration: 2.2,
            ease: "easeInOut",
          }}
          className="relative p-6 rounded-3xl bg-gradient-to-br from-cyan-950/20 to-blue-900/10 border border-cyan-500/30"
        >
          <Gamepad2 className="w-14 h-14 text-cyan-400 drop-shadow-[0_0_15px_#00f2ff]" />
          <div
            className="absolute inset-0 rounded-3xl border border-dashed border-cyan-500/20 scale-110 animate-spin"
            style={{ animationDuration: "15s" }}
          />
        </motion.div>

        {/* Title Group: Free Fire Style Cyber font treatment */}
        <div className="space-y-1">
          <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-[#00f2ff] leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
            AI RACE ARENA
          </h1>
          <p className="text-[10px] tracking-[10px] font-black text-cyan-400 uppercase font-sans mr-[-10px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
            HYPER DRIFT CHAMPIONS
          </p>
        </div>

        {/* Status Label */}
        <div className="inline-flex items-center space-x-2 bg-cyan-950/40 border border-cyan-400/20 px-4 py-1.5 rounded-full text-[9px] text-[#00f2ff] font-mono tracking-wider font-bold">
          <Radio className="w-3 h-3 text-cyan-400 animate-pulse shrink-0" />
          <span>MATCHMAKER NODE ACTIVE</span>
        </div>
      </div>

      {/* Footer Section: Interactive Loading / Tap Action */}
      <div className="w-full max-w-lg flex flex-col items-center z-10 space-y-6">
        <AnimatePresence mode="wait">
          {!loaded ? (
            <motion.div
              key="loading-mode"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full flex flex-col items-center space-y-3"
            >
              {/* Dynamic Loading tips message switching */}
              <p className="text-xs font-semibold text-cyan-300 font-mono tracking-wide text-center uppercase min-h-[16px]">
                {SPLASH_TIPS[tipIndex]}
              </p>

              {/* The high contrast loading bar container */}
              <div className="w-full space-y-2">
                <div className="w-full h-2.5 bg-black/60 rounded-full p-[2px] border border-cyan-500/10 shadow-inner overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-blue-700 via-cyan-400 to-emerald-400 shadow-[0_0_15px_#00f2ff]"
                    style={{ width: `${progress}%` }}
                    transition={{ ease: "easeOut" }}
                  />
                </div>
                <div className="flex justify-between items-center text-[9px] font-mono text-slate-500 font-bold px-1 select-none">
                  <span>PREPARING ENVIRONMENT CIRCUITS</span>
                  <span className="text-cyan-400 text-xs font-black">{progress}%</span>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="tap-to-start-mode"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: [1, 1.04, 1], opacity: 1 }}
              transition={{
                scale: {
                  repeat: Infinity,
                  duration: 1.5,
                  ease: "easeInOut",
                },
                opacity: { duration: 0.4 },
              }}
              className="w-full flex flex-col items-center py-4 cursor-pointer"
            >
              <div className="flex items-center space-x-3 bg-gradient-to-r from-cyan-500/10 via-cyan-500/30 to-cyan-500/10 border-y border-cyan-400/40 px-10 py-4.5 rounded-2xl w-full justify-center shadow-[0_0_30px_rgba(0,242,255,0.15)] backdrop-blur-sm">
                <Play className="w-5 h-5 text-cyan-300 fill-cyan-300 animate-ping" />
                <span className="text-xl font-sans font-black tracking-[6px] uppercase text-transparent bg-clip-text bg-gradient-to-r from-white via-[#7bf2ff] to-white pl-1 select-none">
                  TAP TO START
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-400 text-center uppercase mt-3 tracking-widest animate-pulse">
                Click anywhere to lock landscape & maximize game
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Disclaimer / Credits */}
        <p className="text-[9px] text-slate-600 font-mono text-center max-w-xs leading-none">
          AI RACE ARENA &copy; 2026. SECURE LOGS INSTANTIATED. NATIVE EXPERIENCE OVERRIDE.
        </p>
      </div>
    </div>
  );
};
