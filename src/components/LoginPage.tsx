/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Sparkles, AlertCircle, LogIn, Compass, Key } from "lucide-react";
import { motion } from "motion/react";

export const LoginPage: React.FC = () => {
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await loginWithGoogle();
    } catch (e: any) {
      setError(e.message || "Google Auth authentication failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div
      id="login-page-root"
      className="fixed inset-0 w-screen h-[100dvh] bg-black text-white select-none overflow-hidden m-0 p-0 rounded-none max-w-none border-none outline-none font-sans"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        background: "#020306",
      }}
    >
      {/* Immersive high-fidelity grid road backdrop */}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(0,242,255,0.02)_1.5px,transparent_1.5px)] [background-size:24px_24px] pointer-events-none opacity-60 z-0" />

      {/* Glowing atmospheric dust/sparks */}
      <div className="absolute inset-x-0 bottom-0 top-1/2 bg-gradient-to-t from-cyan-950/25 to-transparent pointer-events-none z-0" />

      {/* Dynamic atmospheric orbs */}
      <div className="absolute top-10 left-10 w-[500px] h-[500px] bg-[#003cff]/10 rounded-full blur-[180px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[500px] h-[500px] bg-[#00f2ff]/10 rounded-full blur-[180px] pointer-events-none" />

      {/* TOP DECK STATUS INFO */}
      <div className="absolute top-4 inset-x-8 h-10 flex justify-between items-center z-20 font-mono text-[9px] text-[#00f2ff] tracking-widest pointer-events-none">
        <div className="flex items-center space-x-2">
          <span className="w-1.5 h-1.5 bg-[#00ff88] rounded-full animate-pulse" />
          <span className="uppercase">GRID SATELLITE INTERACTIVE AUTHENTICATOR</span>
        </div>
        <span className="uppercase text-slate-500">APAC-S1 SECURITY RAIL</span>
      </div>

      {/* DUAL CINEMATIC LANDSCAPE LAYOUT */}
      <div className="absolute inset-0 z-10 flex h-full items-center px-12 md:px-20">
        {/* Left Side: Heavy Brand & Title Layout */}
        <div className="flex-1 text-left flex flex-col justify-center space-y-5 max-w-xl">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="space-y-4"
          >
            {/* Branding badge */}
            <div className="inline-flex items-center space-x-2 bg-gradient-to-r from-blue-950/40 to-cyan-950/40 border border-[#00f2ff]/20 px-3.5 py-1.5 rounded-2xl">
              <Sparkles className="w-4 h-4 text-[#00f2ff] fill-[#00f2ff]/20 animate-pulse" />
              <span className="text-[10px] font-mono font-black tracking-widest text-[#00f2ff] uppercase">
                SYSTEM ENTRY MODULE
              </span>
            </div>

            {/* Core game title */}
            <div className="space-y-0.5">
              <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter text-white leading-none">
                ASPHALT CHAMPIONS
              </h1>
              <p className="text-sm font-light text-[#7ee1fc] uppercase tracking-[6px] font-sans">
                GRAND ARENA MATCHMAKER v5.8
              </p>
            </div>

            {/* Descriptive lines */}
            <p className="text-xs text-slate-400 font-medium leading-relaxed max-w-md bg-white/[0.02] border border-white/5 p-3 rounded-2xl backdrop-blur-sm">
              Connect via Google SSO to authenticate your active racing handle, retrieve custom hypercar chassis
              presets, and synchronize into peer-run staging grids immediately.
            </p>
          </motion.div>
        </div>

        {/* Right Side: Google Authenticator Action Panel */}
        <div className="w-96 max-w-full flex flex-col justify-center space-y-5 z-20">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: 50 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="bg-black/45 border border-white/10 p-6 md:p-8 rounded-3xl backdrop-blur-xl shadow-[0_24px_60px_rgba(0,0,0,0.8)] space-y-5 text-center relative overflow-hidden"
          >
            {/* Highlighted decoration */}
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-blue-600 via-cyan-400 to-[#00f2ff]" />

            <div className="space-y-1">
              <span className="text-[9px] uppercase font-black tracking-widest text-slate-400 font-mono">
                CONNECTION GATEWAY
              </span>
              <h3 className="text-lg font-black text-white uppercase tracking-tight">RACER SIGN IN</h3>
            </div>

            {/* Error notifications */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 p-3.5 rounded-2xl flex items-start space-x-2 text-left">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span className="text-[11px] text-red-400 font-bold leading-normal">{error}</span>
              </div>
            )}

            {/* Authentication primary button */}
            <button
              onClick={handleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center space-x-3.5 bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 hover:brightness-110 active:scale-[98] text-white font-extrabold uppercase text-xs tracking-widest py-4 px-6 rounded-2xl transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(0,242,255,0.25)]"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4.5 h-4.5 text-white stroke-[2.5px]" />
                  <span>SIGN IN WITH GOOGLE</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-center space-x-2 pt-1">
              <Key className="w-3.5 h-3.5 text-[#00f2ff]/60" />
              <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">
                SECURE AES-256 ENCRYPTED HANDSHAKES
              </span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* BOTTOM DISCLAIMER DECK */}
      <div className="absolute bottom-4 inset-x-8 flex justify-between items-center z-20 font-mono text-[8px] text-slate-600 pointer-events-none uppercase tracking-widest">
        <span>&copy; 2026 ASPHALT RACING PORTAL</span>
        <span>GOOGLE CLOUD SECURE ENDPOINT</span>
      </div>
    </div>
  );
};
