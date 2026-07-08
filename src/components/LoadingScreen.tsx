/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Sparkles, Compass, Gauge } from "lucide-react";

interface LoadingScreenProps {
  progress?: number;
  message?: string;
  subMessage?: string;
}

const RACING_TIPS = [
  "NITRO COMPRESSION: Slide and drift on corners to charge your custom nitro tank instantly!",
  "DRIFT MECHANICS: Tap and hold the Drift button while turning to lock into perfect high-speed slide arcs.",
  "VEHICLE REPAIR: Keep your chassis in peak shape. Low compression decreases maximum top velocities.",
  "GRID CLIMATE: Racing in wet weather decreases wheel grip by 20%. Adjust steering responsiveness!",
  "AI OPPONENTS: Computer adversaries dynamically optimize their driving line. Block them strategically!",
];

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  progress = 0,
  message = "Calibrating systems...",
  subMessage = "Retrieving engine details",
}) => {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const tipInterval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % RACING_TIPS.length);
    }, 4000);

    return () => clearInterval(tipInterval);
  }, []);

  return (
    <div
      id="cinematic-loader"
      className="fixed inset-0 w-screen h-[100dvh] bg-black text-white select-none overflow-hidden flex flex-col justify-between p-12 z-[9990]"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        background: "#040712",
      }}
    >
      {/* Dynamic light glows */}
      <div className="absolute right-0 bottom-0 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-[200px] pointer-events-none animate-pulse" />
      <div className="absolute left-0 top-0 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Grid overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(0,242,255,0.015)_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none opacity-50" />

      {/* Top section: HUD loading labels */}
      <div className="w-full flex justify-between items-end border-b border-white/5 pb-3.5 z-10 font-mono">
        <div className="flex items-center space-x-2.5">
          <Compass className="w-5 h-5 text-cyan-400 rotate-45" />
          <div>
            <span className="text-[10px] font-black tracking-widest text-cyan-400 block leading-none">
              ASPHALT NETWORK
            </span>
            <span className="text-xs uppercase font-light text-slate-400">LOADING CIRCUIT STALKER</span>
          </div>
        </div>
        <div className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          ESTIMATED DELAY: {Math.max(1, Math.ceil((100 - progress) / 20))}S
        </div>
      </div>

      {/* Middle section: Tip block */}
      <div className="flex-1 flex flex-col justify-center items-center z-10 max-w-2xl mx-auto space-y-6">
        <div
          className="p-3 bg-gradient-to-tr from-cyan-500/10 to-indigo-500/10 border border-cyan-500/20 rounded-2xl flex items-center justify-center animate-spin"
          style={{ animationDuration: "4s" }}
        >
          <Gauge className="w-8 h-8 text-cyan-400" />
        </div>

        <div className="text-center space-y-2">
          <div className="flex items-center justify-center space-x-1 text-[9px] uppercase font-black text-rose-400 tracking-[3px]">
            <Sparkles className="w-3 h-3 text-rose-400" />
            <span>PRO RACER HANDBOOK TIP</span>
          </div>
          <p className="text-sm font-bold text-slate-200 uppercase font-sans tracking-wide leading-relaxed p-4 bg-slate-950/45 border border-white/5 rounded-2xl max-w-xl text-center">
            &ldquo;{RACING_TIPS[tipIndex]}&rdquo;
          </p>
        </div>
      </div>

      {/* Bottom section: Progress bar */}
      <div className="w-full max-w-xl mx-auto z-10 space-y-3 pb-4">
        <div className="flex justify-between items-end text-xs font-mono">
          <div className="text-left space-y-0.5">
            <span className="text-[9px] text-[#00f2ff]/60 uppercase block font-black tracking-widest">
              LOADING STATUS
            </span>
            <span className="text-white font-extrabold text-[13px] uppercase tracking-wide">{message}</span>
          </div>
          <span className="text-[#00f2ff] text-base font-black font-mono">{progress}%</span>
        </div>

        <div className="w-full h-2 bg-black/60 rounded-full border border-white/5 shadow-inner overflow-hidden">
          <motion.div
            layout
            className="h-full rounded-full bg-gradient-to-r from-cyan-600 via-cyan-400 to-[#00f2ff] shadow-[0_0_12px_#00f2ff]"
            style={{ width: `${progress}%` }}
            transition={{ duration: 0.15 }}
          />
        </div>
        <p className="text-[9px] text-slate-500 font-mono text-center uppercase tracking-wider">{subMessage}</p>
      </div>
    </div>
  );
};
