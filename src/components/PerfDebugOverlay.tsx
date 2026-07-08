/**
 * Performance Debug Overlay
 *
 * Reads metrics published by GameCanvas on `window` each frame and renders
 * a compact panel showing FPS, draw calls, triangle count, active meshes,
 * GPU memory, CPU frame time, and GPU frame time.
 *
 * Toggle with F3, or via localStorage flag `race:perfOverlay = "1"`.
 * Purely presentational — never touches gameplay state.
 */

import React, { useEffect, useState } from "react";

const STORAGE_KEY = "race:perfOverlay";

export const PerfDebugOverlay: React.FC = () => {
  const [visible, setVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [, force] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F3" || (e.key === "f" && e.shiftKey && e.ctrlKey)) {
        e.preventDefault();
        setVisible((v) => {
          const next = !v;
          try {
            localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
          } catch {}
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => force((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const win = window as any;
  const fps = win.currentFPS ? Math.round(win.currentFPS) : 0;
  const calls = win.drawCalls ?? "—";
  const tris = win.triangles ? Math.round(win.triangles).toLocaleString() : "—";
  const meshes = win.activeMeshes ?? "—";
  const cpu = win.cpuFrameMs ? `${win.cpuFrameMs.toFixed(1)} ms` : "—";
  const gpu = win.gpuFrameMs ? `${win.gpuFrameMs.toFixed(1)} ms` : "—";
  const mem = win.gpuMemory
    ? `${win.gpuMemory.geometries}g · ${win.gpuMemory.textures}t · ${win.gpuMemory.programs}p`
    : "—";
  const tier = win.qualityTier ?? "—";
  const rs = win.renderScale ? win.renderScale.toFixed(2) : "—";

  const fpsColor =
    fps >= 55 ? "text-emerald-400" : fps >= 28 ? "text-amber-300" : "text-rose-400";

  return (
    <div className="pointer-events-none fixed top-2 right-2 z-[9999] font-mono text-[10px] leading-tight rounded-md bg-black/75 backdrop-blur-sm border border-white/15 text-white px-2.5 py-2 min-w-[170px] shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-1 mb-1">
        <span className="text-[9px] uppercase tracking-widest text-white/60">Perf</span>
        <span className={`font-black text-sm ${fpsColor}`}>{fps} fps</span>
      </div>
      <Row label="Draw Calls" value={calls} />
      <Row label="Triangles" value={tris} />
      <Row label="Meshes" value={meshes} />
      <Row label="CPU" value={cpu} />
      <Row label="GPU" value={gpu} />
      <Row label="GPU Mem" value={mem} />
      <Row label="Tier" value={tier} />
      <Row label="Render Scale" value={rs} />
      <div className="mt-1 pt-1 border-t border-white/10 text-[8px] text-white/40 uppercase tracking-wider">
        F3 to hide
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-white/55">{label}</span>
    <span className="text-white font-bold">{value}</span>
  </div>
);

export default PerfDebugOverlay;
