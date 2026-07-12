/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GraphicsSettingsPanel
 * Professional graphics settings overlay inspired by PUBG Mobile / Free Fire.
 *
 * Purely presentational: stores selections in localStorage under
 * `race:graphicsSettings` and emits a `race:graphicsSettingsChanged`
 * CustomEvent so engine systems can react if/when they choose to.
 * Does NOT modify gameplay, physics, AI, multiplayer, controls, or the map.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Cpu, Gauge, Monitor, Smartphone, Tablet, Info } from "lucide-react";
import { getDeviceProfile } from "../systems/GraphicsConfig";

export type GraphicsPreset = "Low" | "Medium" | "High" | "Ultra" | "Extreme";
export type FpsOption = 30 | 60 | 90 | 120 | 0; // 0 = Unlimited
export type RenderScale = 50 | 75 | 100 | 125;

export interface GraphicsSettings {
  preset: GraphicsPreset;
  fps: FpsOption;
  renderScale: RenderScale;
  // Sub-quality (auto from preset, but exposed)
  shadowQuality: "Off" | "Low" | "Medium" | "High" | "Ultra";
  textureQuality: "Low" | "Medium" | "High" | "Ultra";
  antiAliasing: "Off" | "FXAA" | "SMAA" | "TAA";
  reflectionQuality: "Off" | "Low" | "Medium" | "High";
  postProcessing: "Off" | "Low" | "Medium" | "High";
  drawDistance: number; // 0..100
  lodDistance: number; // 0..100
  grassDensity: number; // 0..100
  treeDensity: number; // 0..100
  effectsQuality: "Low" | "Medium" | "High" | "Ultra";
  // Toggles
  dynamicResolution: boolean;
  vsync: boolean;
  hdr: boolean;
  bloom: boolean;
  motionBlur: boolean;
  ambientOcclusion: boolean;
  reflections: boolean;
  screenSpaceShadows: boolean;
  highQualitySky: boolean;
  tireSmoke: boolean;
  driftEffects: boolean;
  weatherEffects: boolean;
}

const STORAGE_KEY = "race:graphicsSettings";

const PRESET_CONFIG: Record<GraphicsPreset, Partial<GraphicsSettings>> = {
  Low: {
    shadowQuality: "Off",
    textureQuality: "Low",
    antiAliasing: "Off",
    reflectionQuality: "Off",
    postProcessing: "Off",
    drawDistance: 30,
    lodDistance: 30,
    grassDensity: 10,
    treeDensity: 25,
    effectsQuality: "Low",
    dynamicResolution: true,
    vsync: false,
    hdr: false,
    bloom: false,
    motionBlur: false,
    ambientOcclusion: false,
    reflections: false,
    screenSpaceShadows: false,
    highQualitySky: false,
    tireSmoke: false,
    driftEffects: false,
    weatherEffects: false,
  },
  Medium: {
    shadowQuality: "Low",
    textureQuality: "Medium",
    antiAliasing: "FXAA",
    reflectionQuality: "Low",
    postProcessing: "Low",
    drawDistance: 50,
    lodDistance: 50,
    grassDensity: 35,
    treeDensity: 50,
    effectsQuality: "Medium",
    dynamicResolution: true,
    vsync: false,
    hdr: false,
    bloom: true,
    motionBlur: false,
    ambientOcclusion: false,
    reflections: false,
    screenSpaceShadows: false,
    highQualitySky: false,
    tireSmoke: true,
    driftEffects: true,
    weatherEffects: false,
  },
  High: {
    shadowQuality: "Medium",
    textureQuality: "High",
    antiAliasing: "SMAA",
    reflectionQuality: "Medium",
    postProcessing: "Medium",
    drawDistance: 70,
    lodDistance: 70,
    grassDensity: 60,
    treeDensity: 70,
    effectsQuality: "High",
    dynamicResolution: false,
    vsync: true,
    hdr: false,
    bloom: true,
    motionBlur: true,
    ambientOcclusion: true,
    reflections: true,
    screenSpaceShadows: false,
    highQualitySky: true,
    tireSmoke: true,
    driftEffects: true,
    weatherEffects: true,
  },
  Ultra: {
    shadowQuality: "High",
    textureQuality: "Ultra",
    antiAliasing: "TAA",
    reflectionQuality: "High",
    postProcessing: "High",
    drawDistance: 90,
    lodDistance: 90,
    grassDensity: 85,
    treeDensity: 90,
    effectsQuality: "Ultra",
    dynamicResolution: false,
    vsync: true,
    hdr: true,
    bloom: true,
    motionBlur: true,
    ambientOcclusion: true,
    reflections: true,
    screenSpaceShadows: true,
    highQualitySky: true,
    tireSmoke: true,
    driftEffects: true,
    weatherEffects: true,
  },
  Extreme: {
    shadowQuality: "Ultra",
    textureQuality: "Ultra",
    antiAliasing: "TAA",
    reflectionQuality: "High",
    postProcessing: "High",
    drawDistance: 100,
    lodDistance: 100,
    grassDensity: 100,
    treeDensity: 100,
    effectsQuality: "Ultra",
    dynamicResolution: false,
    vsync: true,
    hdr: true,
    bloom: true,
    motionBlur: true,
    ambientOcclusion: true,
    reflections: true,
    screenSpaceShadows: true,
    highQualitySky: true,
    tireSmoke: true,
    driftEffects: true,
    weatherEffects: true,
  },
};

type DeviceKind = "Android" | "iPhone" | "iPad" | "Desktop" | "Unknown";

function detectDevice(): DeviceKind {
  if (typeof navigator === "undefined") return "Unknown";
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "Android";
  if (/iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return "iPad";
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/Mobi|Mobile/i.test(ua)) return "Android";
  return "Desktop";
}

function recommendPreset(_device: DeviceKind): GraphicsPreset {
  try {
    return getDeviceProfile().tier;
  } catch {
    return "Medium";
  }
}

function supportsHighFps(): boolean {
  // Browsers cap rAF to display refresh — we can detect by sampling.
  return typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";
}

const DEFAULTS: GraphicsSettings = {
  preset: "High",
  fps: 60,
  renderScale: 100,
  ...PRESET_CONFIG.High,
} as GraphicsSettings;

function loadSettings(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: GraphicsSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("race:graphicsSettingsChanged", { detail: s }));
  } catch {
    /* ignore */
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const GraphicsSettingsPanel: React.FC<Props> = ({ open, onClose }) => {
  const [settings, setSettings] = useState<GraphicsSettings>(() => loadSettings());
  const [device] = useState<DeviceKind>(() => detectDevice());
  const [recommended] = useState<GraphicsPreset>(() => recommendPreset(detectDevice()));
  const [tab, setTab] = useState<"quality" | "advanced" | "performance">("quality");

  // FPS sampler for live perf info + refresh-rate detection
  const [fpsNow, setFpsNow] = useState(0);
  const [fpsAvg, setFpsAvg] = useState(0);
  const [frameTime, setFrameTime] = useState(0);
  const [maxRefresh, setMaxRefresh] = useState(60);
  const samplesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      const fps = 1000 / Math.max(0.0001, dt);
      samplesRef.current.push(fps);
      if (samplesRef.current.length > 120) samplesRef.current.shift();
      setFpsNow(Math.round(fps));
      setFrameTime(Math.round(dt * 10) / 10);
      const avg =
        samplesRef.current.reduce((a, b) => a + b, 0) / Math.max(1, samplesRef.current.length);
      setFpsAvg(Math.round(avg));
      setMaxRefresh((m) => Math.max(m, Math.round(fps)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Persist on every change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Emit settings on mount so listeners get current state
  useEffect(() => {
    saveSettings(loadSettings());
  }, []);

  const applyPreset = (preset: GraphicsPreset) => {
    setSettings((s) => ({ ...s, ...PRESET_CONFIG[preset], preset }));
  };

  const memUsage = useMemo(() => {
    const perfMem = (performance as any).memory;
    if (!perfMem) return null;
    return {
      used: Math.round(perfMem.usedJSHeapSize / 1048576),
      total: Math.round(perfMem.totalJSHeapSize / 1048576),
      limit: Math.round(perfMem.jsHeapSizeLimit / 1048576),
    };
  }, [fpsNow]);

  const fpsOptions: { value: FpsOption; label: string; supported: boolean; reason?: string }[] =
    useMemo(() => {
      const high = supportsHighFps();
      const canHigh = maxRefresh >= 80; // sampled
      const can120 = maxRefresh >= 110;
      return [
        { value: 30, label: "30 FPS", supported: true },
        { value: 60, label: "60 FPS", supported: true },
        {
          value: 90,
          label: "90 FPS",
          supported: high && canHigh,
          reason: canHigh ? undefined : "Display does not appear to support ≥90Hz",
        },
        {
          value: 120,
          label: "120 FPS",
          supported: high && can120,
          reason: can120 ? undefined : "Display does not appear to support ≥120Hz",
        },
        { value: 0, label: "Unlimited", supported: high },
      ];
    }, [maxRefresh]);

  const fpsWarning =
    settings.fps > 0 && fpsAvg > 0 && fpsAvg < settings.fps - 8
      ? `Your device is averaging ${fpsAvg} FPS. Consider a lower FPS cap or preset.`
      : null;

  if (!open) return null;

  const DeviceIcon = device === "Desktop" ? Monitor : device === "iPad" ? Tablet : Smartphone;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-2xl border border-yellow-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-[0_0_60px_rgba(234,179,8,0.15)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-yellow-500/20 bg-gradient-to-r from-yellow-500/10 via-transparent to-yellow-500/10">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-yellow-400" />
            <h2 className="text-white font-bold tracking-wide text-sm sm:text-base">
              GRAPHICS SETTINGS
            </h2>
          </div>
          <div className="flex items-center gap-3 text-[10px] sm:text-xs text-slate-300">
            <span className="flex items-center gap-1">
              <DeviceIcon className="w-3.5 h-3.5 text-yellow-400" />
              {device}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/5 bg-slate-950/60 text-xs sm:text-sm">
          {(["quality", "advanced", "performance"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-2.5 font-semibold uppercase tracking-wider transition ${
                tab === t
                  ? "text-yellow-400 border-b-2 border-yellow-400 bg-yellow-500/5"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-3 sm:p-5 space-y-5 text-sm">
          {tab === "quality" && (
            <>
              {/* Auto detect banner */}
              <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-100/90">
                <Cpu className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  Recommended for your {device}:{" "}
                  <span className="font-bold text-yellow-300">{recommended}</span>
                  <button
                    onClick={() => applyPreset(recommended)}
                    className="ml-2 underline text-yellow-300 hover:text-white"
                  >
                    Apply
                  </button>
                </div>
              </div>

              {/* Presets */}
              <div>
                <Label>Graphics Quality</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {(["Low", "Medium", "High", "Ultra", "Extreme"] as GraphicsPreset[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => applyPreset(p)}
                      className={`py-2 rounded-md text-[11px] sm:text-xs font-bold uppercase tracking-wider transition border ${
                        settings.preset === p
                          ? "bg-yellow-500 text-black border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.5)]"
                          : "bg-slate-800/60 text-slate-300 border-white/10 hover:bg-slate-700"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* FPS */}
              <div>
                <Label>FPS Limit</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {fpsOptions.map((o) => (
                    <button
                      key={o.value}
                      disabled={!o.supported}
                      title={o.reason}
                      onClick={() => setSettings((s) => ({ ...s, fps: o.value }))}
                      className={`py-2 rounded-md text-[11px] sm:text-xs font-bold transition border ${
                        settings.fps === o.value
                          ? "bg-yellow-500 text-black border-yellow-400"
                          : o.supported
                            ? "bg-slate-800/60 text-slate-300 border-white/10 hover:bg-slate-700"
                            : "bg-slate-900/40 text-slate-600 border-white/5 cursor-not-allowed line-through"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {fpsWarning && (
                  <p className="mt-2 text-[11px] text-orange-400 flex items-start gap-1">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {fpsWarning}
                  </p>
                )}
              </div>

              {/* Render scale */}
              <div>
                <Label>Render Scale</Label>
                <div className="grid grid-cols-4 gap-1.5">
                  {([50, 75, 100, 125] as RenderScale[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setSettings((s) => ({ ...s, renderScale: r }))}
                      className={`py-2 rounded-md text-xs font-bold transition border ${
                        settings.renderScale === r
                          ? "bg-yellow-500 text-black border-yellow-400"
                          : "bg-slate-800/60 text-slate-300 border-white/10 hover:bg-slate-700"
                      }`}
                    >
                      {r}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto-derived sub-quality readout */}
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/5 bg-slate-900/60 p-3 text-xs">
                <Readout label="Shadows" value={settings.shadowQuality} />
                <Readout label="Textures" value={settings.textureQuality} />
                <Readout label="Anti-Aliasing" value={settings.antiAliasing} />
                <Readout label="Reflections" value={settings.reflectionQuality} />
                <Readout label="Post-FX" value={settings.postProcessing} />
                <Readout label="Effects" value={settings.effectsQuality} />
                <Readout label="Draw Distance" value={`${settings.drawDistance}%`} />
                <Readout label="LOD Distance" value={`${settings.lodDistance}%`} />
                <Readout label="Grass Density" value={`${settings.grassDensity}%`} />
                <Readout label="Tree Density" value={`${settings.treeDensity}%`} />
              </div>
            </>
          )}

          {tab === "advanced" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  ["dynamicResolution", "Dynamic Resolution"],
                  ["vsync", "VSync"],
                  ["hdr", "HDR Rendering"],
                  ["bloom", "Bloom"],
                  ["motionBlur", "Motion Blur"],
                  ["ambientOcclusion", "Ambient Occlusion"],
                  ["reflections", "Reflections"],
                  ["screenSpaceShadows", "Screen Space Shadows"],
                  ["highQualitySky", "High Quality Sky"],
                  ["tireSmoke", "Tire Smoke"],
                  ["driftEffects", "Drift Effects"],
                  ["weatherEffects", "Weather Effects"],
                ] as [keyof GraphicsSettings, string][]
              ).map(([key, label]) => (
                <Toggle
                  key={key as string}
                  label={label}
                  checked={Boolean(settings[key])}
                  onChange={(v) => setSettings((s) => ({ ...s, [key]: v }) as GraphicsSettings)}
                />
              ))}
            </div>
          )}

          {tab === "performance" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Stat label="Current FPS" value={`${fpsNow}`} />
                <Stat label="Average FPS" value={`${fpsAvg}`} />
                <Stat label="Frame Time" value={`${frameTime} ms`} />
                <Stat label="Detected Refresh" value={`~${maxRefresh} Hz`} />
                <Stat
                  label="Memory"
                  value={memUsage ? `${memUsage.used} / ${memUsage.limit} MB` : "N/A"}
                />
                <Stat
                  label="GPU Load"
                  value={"N/A"}
                  hint="Not exposed by browser"
                />
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Browsers cap frame rate to the display's refresh interval, so 90/120 FPS only apply
                on high-refresh screens. We don't fake higher rates — unsupported options are
                disabled automatically.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-slate-950/80">
          <button
            onClick={() => {
              setSettings({ ...DEFAULTS, preset: recommended, ...PRESET_CONFIG[recommended] });
            }}
            className="text-xs text-slate-400 hover:text-white underline"
          >
            Reset to Recommended
          </button>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-md bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-bold tracking-wide transition shadow-[0_0_20px_rgba(234,179,8,0.4)]"
          >
            DONE
          </button>
        </div>
      </div>
    </div>
  );
};

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 mb-1.5">
    {children}
  </div>
);

const Readout: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-slate-400">{label}</span>
    <span className="text-yellow-300 font-semibold">{value}</span>
  </div>
);

const Stat: React.FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="rounded-lg border border-white/5 bg-slate-900/60 p-3">
    <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
    <div className="text-lg font-bold text-yellow-300">{value}</div>
    {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
  </div>
);

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <button
    onClick={() => onChange(!checked)}
    className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition text-left ${
      checked
        ? "bg-yellow-500/10 border-yellow-500/40 text-white"
        : "bg-slate-900/60 border-white/5 text-slate-300 hover:bg-slate-800/60"
    }`}
  >
    <span className="text-xs font-semibold">{label}</span>
    <span
      className={`relative w-9 h-5 rounded-full transition ${
        checked ? "bg-yellow-500" : "bg-slate-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </span>
  </button>
);

export default GraphicsSettingsPanel;
