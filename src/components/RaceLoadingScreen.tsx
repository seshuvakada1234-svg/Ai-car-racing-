/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Cpu, Layers, Flame } from "lucide-react";
import { usePreloadRace } from "../hooks/usePreloadRace";
import * as THREE from "three";

interface RaceLoadingScreenProps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  selectedCarId: string;
  onReady: () => void;
}

export const RaceLoadingScreen: React.FC<RaceLoadingScreenProps> = ({
  scene,
  camera,
  renderer,
  selectedCarId,
  onReady,
}) => {
  const { preloading, progState, triggerPreload } = usePreloadRace();
  const [dots, setDots] = useState("");

  useEffect(() => {
    // Start game environment assets initialization & pre-compiling
    triggerPreload(selectedCarId, renderer, scene, camera);
  }, []);

  useEffect(() => {
    const int = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => clearInterval(int);
  }, []);

  // Monitor when progress reaches 100% and triggering preload completes
  useEffect(() => {
    if (!preloading && progState && progState.percent >= 100) {
      const waitT = setTimeout(() => {
        onReady();
      }, 1000);
      return () => clearTimeout(waitT);
    }
  }, [preloading, progState]);

  const getStageIcon = () => {
    if (!progState) return <Cpu className="w-6 h-6 text-emerald-400 rotate-12" />;
    if (progState.percent < 40) return <Layers className="w-6 h-6 text-cyan-400 animate-pulse" />;
    if (progState.percent < 80) return <Sparkles className="w-6 h-6 text-amber-400 animate-spin" />;
    return <Flame className="w-6 h-6 text-rose-500 animate-bounce" />;
  };

  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-50">
      {/* Decorative cybernetic overlay lines */}
      <div className="absolute inset-x-0 top-0 h-40 bg-linear-to-b from-blue-500/5 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-emerald-500/5 to-transparent pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md p-8 text-center space-y-6"
      >
        <div className="mx-auto w-14 h-14 bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-center shadow-lg">
          {getStageIcon()}
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-linear-to-r from-emerald-400 to-teal-300">
            Engine Warm Up
          </h2>
          <p className="text-xs font-mono text-slate-400 uppercase tracking-widest min-h-6">
            {progState?.stage || "Initializing rendering context"}
            {dots}
          </p>
        </div>

        <div className="space-y-2">
          {/* Main progress bar */}
          <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800/60 p-[1px]">
            <motion.div
              className="h-full bg-linear-to-r from-emerald-500 to-cyan-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progState?.percent || 15}%` }}
              transition={{ duration: 0.2 }}
            />
          </div>

          <div className="flex justify-between font-mono text-[10px] text-slate-500">
            <span>WARMING SHADERS</span>
            <span className="font-bold text-emerald-400">{progState?.percent || 15}%</span>
          </div>
        </div>

        <div className="text-[9px] uppercase font-mono tracking-widest text-slate-600">
          Asphalt Champions • PWA Ultra Asset Stream
        </div>
      </motion.div>
    </div>
  );
};
