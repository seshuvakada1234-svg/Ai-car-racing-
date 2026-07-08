/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download, ShieldCheck, Gamepad2, Settings } from "lucide-react";
import { AssetManager, AssetInfo } from "../services/AssetManager";
import { useDownloadProgress } from "../hooks/useDownloadProgress";
import { DownloadProgress } from "./DownloadProgress";

interface AssetInstallScreenProps {
  onComplete: () => void;
}

export const AssetInstallScreen: React.FC<AssetInstallScreenProps> = ({ onComplete }) => {
  const [missingAssets, setMissingAssets] = useState<AssetInfo[]>([]);
  const [checking, setChecking] = useState(true);

  const { downloading, activeTask, progresses, error, startDownload } = useDownloadProgress();

  useEffect(() => {
    const fetchMissing = async () => {
      setChecking(true);
      await AssetManager.init();
      const assets = AssetManager.getAssets();
      const missing: AssetInfo[] = [];
      for (const a of assets) {
        const ready = await AssetManager.isAssetReady(a.id);
        if (!ready) {
          missing.push(a);
        }
      }
      setMissingAssets(missing);
      setChecking(false);
    };
    fetchMissing();
  }, []);

  const handleInstall = async () => {
    if (missingAssets.length === 0) {
      onComplete();
      return;
    }
    await startDownload(missingAssets);
    onComplete();
  };

  const calculateTotalSize = () => {
    const totalBytes = missingAssets.reduce((sum, a) => sum + a.size, 0);
    return `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (checking) {
    return (
      <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center font-sans text-white z-50">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
          className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full mb-4"
        />
        <p className="text-slate-400 font-mono tracking-wider text-xs uppercase animate-pulse">
          Validating local game database system...
        </p>
      </div>
    );
  }

  // If no assets are missing, allow bypassing
  if (missingAssets.length === 0) {
    return (
      <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center text-white z-50 p-6 text-center">
        <ShieldCheck className="w-14 h-14 text-emerald-400 mb-4 animate-bounce" />
        <h3 className="text-xl font-black uppercase tracking-wider mb-2">Assets Fully Verified!</h3>
        <p className="text-slate-400 text-sm max-w-sm mb-6">
          All high-resolution textures, models, map parameters, and loops are saved offline on this device.
        </p>
        <button
          onClick={onComplete}
          className="bg-emerald-600 hover:bg-emerald-700 font-black tracking-widest uppercase text-xs px-8 py-3.5 rounded-xl border border-emerald-500/20 active:scale-95 transition-all outline-hidden cursor-pointer"
        >
          Enter Lobby Setup
        </button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-md flex items-center justify-center font-sans text-white z-50 p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xl bg-slate-900/80 border border-slate-800/80 p-6 md:p-8 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl relative overflow-hidden"
      >
        {/* Subtle decorative glow */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-emerald-500/10 blur-3xl rounded-full" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-cyan-500/10 blur-3xl rounded-full" />

        <div className="relative space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
                <Gamepad2 className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h2 className="text-lg font-black uppercase tracking-wider">Asset Delivery Console</h2>
                <p className="text-[10px] uppercase font-mono text-slate-400 tracking-widest">
                  Platform Integrity Verifier
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono text-slate-400">Total Size:</span>
              <p className="text-sm font-black text-emerald-400 font-mono">{calculateTotalSize()}</p>
            </div>
          </div>

          {!downloading ? (
            <>
              <div className="space-y-3">
                <p className="text-slate-300 text-xs leading-relaxed">
                  To ensure uninterrupted 60 FPS performance, complete visual fidelity, and support offline play, the
                  following essential game files are required:
                </p>

                <div className="max-h-48 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                  {missingAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between p-2.5 bg-slate-950/50 rounded-xl border border-slate-800/40 text-xs font-mono"
                    >
                      <span className="text-slate-200 font-semibold truncate max-w-xs">{asset.name}</span>
                      <span className="text-[10px] text-emerald-400/80 bg-emerald-500/5 px-2 py-0.5 rounded-sm border border-emerald-500/10 uppercase">
                        Pending
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={handleInstall}
                  className="flex-1 flex items-center justify-center space-x-2 bg-emerald-500 hover:bg-emerald-600 active:scale-98 text-slate-950 font-black uppercase tracking-widest text-xs py-4 rounded-xl transition-all cursor-pointer shadow-[0_4px_20px_rgba(16,185,129,0.2)]"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Assets ({calculateTotalSize()})</span>
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800/60 flex items-center space-x-3">
                <div className="w-2.5 h-2.5 bg-cyan-400 rounded-full animate-ping" />
                <div className="truncate flex-1">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block tracking-widest">
                    Active Task
                  </span>
                  <span className="text-xs font-bold text-slate-100 truncate block font-mono">{activeTask}</span>
                </div>
              </div>

              <div className="space-y-4 max-h-44 overflow-y-auto pr-1">
                {missingAssets.map((asset) => (
                  <DownloadProgress key={asset.id} label={asset.name} percent={progresses[asset.id] || 0} />
                ))}
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-mono">
                  {error}
                </div>
              )}

              <div className="text-center font-mono text-[10px] text-slate-400 uppercase tracking-widest animate-pulse">
                Do not close your browser tab or app container...
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
