/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { Flag, Trees, Droplets, Construction, Waves, ChevronsRight, Mountain, Compass, MapPin } from "lucide-react";
import { TRACK_SECTIONS, type TrackSection } from "../utils/track";

const ICONS: Record<TrackSection["icon"], React.ComponentType<{ className?: string }>> = {
  start: Flag,
  forest: Trees,
  waterfall: Droplets,
  bridge: Construction,
  lake: Waves,
  straight: ChevronsRight,
  river: Waves,
  sweep: Compass,
  trail: Mountain,
  finish: Flag,
};

interface Props {
  /** ms before the overlay auto-dismisses. Default 6000. */
  autoDismissMs?: number;
}

export const SectionPreviewOverlay: React.FC<Props> = ({ autoDismissMs = 6000 }) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(false), autoDismissMs);
    return () => window.clearTimeout(t);
  }, [autoDismissMs]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200"
      onClick={() => setVisible(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Dragon Track section preview"
    >
      <div
        className="relative w-[min(95vw,1100px)] max-h-[92vh] overflow-auto rounded-2xl border border-sky-500/30 bg-gradient-to-b from-slate-900/95 to-slate-950/95 shadow-2xl p-5 md:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-[10px] tracking-[0.35em] text-sky-400 font-semibold uppercase">AI Race Arena · Live</div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">Dragon Track — Sections</h1>
            <p className="text-xs md:text-sm text-slate-400 mt-1">10.00 KM · 24 turns · 10 sections</p>
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="px-3 py-2 text-xs rounded-lg bg-sky-500/90 hover:bg-sky-400 text-slate-950 font-bold tracking-wide shadow-md"
            aria-label="Dismiss section preview"
          >
            START RACE
          </button>
        </div>

        <ol className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {TRACK_SECTIONS.map((s) => {
            const Icon = ICONS[s.icon] ?? MapPin;
            return (
              <li
                key={s.id}
                className="group rounded-xl border border-slate-700/60 bg-slate-900/70 p-3 hover:border-sky-500/60 transition-colors"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono text-sky-400 tracking-widest">
                    {s.kmStart.toFixed(2)}–{s.kmEnd.toFixed(2)} KM
                  </span>
                  <Icon className="w-3.5 h-3.5 text-sky-300/80" aria-hidden="true" />
                </div>
                <div className="text-[11px] text-slate-500 font-mono">#{s.id.toString().padStart(2, "0")} · {s.turns}</div>
                <h3 className="text-sm font-bold text-white leading-tight mt-0.5">{s.name}</h3>
                <ul className="mt-2 space-y-0.5">
                  {s.tips.slice(0, 3).map((t) => (
                    <li key={t} className="text-[10px] text-slate-400 leading-snug">• {t}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>

        <p className="text-center text-[10px] text-slate-500 mt-4 tracking-wider uppercase">
          Tap anywhere to dismiss · auto-hides in a few seconds
        </p>
      </div>
    </div>
  );
};
