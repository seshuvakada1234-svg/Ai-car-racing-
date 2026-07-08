/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { motion } from "motion/react";
import { Cpu } from "lucide-react";

interface ShaderCompileScreenProps {
  progress: number;
}

export const ShaderCompileScreen: React.FC<ShaderCompileScreenProps> = ({ progress }) => {
  return (
    <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center text-white z-50 p-6">
      <motion.div
        animate={{ scale: [1, 1.05, 1], rotate: [0, 5, -5, 0] }}
        transition={{ repeat: Infinity, duration: 2.2 }}
        className="w-16 h-16 bg-rose-500/10 text-rose-400 rounded-3xl border border-rose-500/20 flex items-center justify-center mb-6 shadow-xl shadow-rose-500/5"
      >
        <Cpu className="w-8 h-8" />
      </motion.div>
      <h3 className="text-xl font-black uppercase tracking-wider mb-2">Compiling Shaders</h3>
      <p className="text-slate-400 text-xs font-mono max-w-xs text-center leading-relaxed">
        Bypassing runtime micro-stutter by compiling GLSL vertex and fragment pipelines ahead of race launch sequence.
      </p>

      <div className="w-full max-w-xs space-y-2 mt-6">
        <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
          <div
            className="h-full bg-rose-500 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-slate-500">
          <span>PROGRAMS PRE-WARMED</span>
          <span>{progress}%</span>
        </div>
      </div>
    </div>
  );
};
