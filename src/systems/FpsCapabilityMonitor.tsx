/**
 * FpsCapabilityMonitor
 *
 * Background rAF sampler that continuously checks whether the device can
 * sustain the user-selected FPS cap from GraphicsSettingsPanel. If the
 * rolling average FPS stays meaningfully below the selected cap for a
 * sustained window, it automatically downgrades to the next lower
 * supported option and surfaces a sonner toast explaining the change
 * plus the recommended setting.
 *
 * Purely presentational/runtime — does not touch gameplay, physics, AI,
 * multiplayer, controls, or the map. It only mutates the same
 * localStorage key (`race:graphicsSettings`) the panel uses and emits
 * the existing `race:graphicsSettingsChanged` CustomEvent.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const STORAGE_KEY = "race:graphicsSettings";

type FpsOption = 30 | 60 | 90 | 120 | 0;
const LADDER: FpsOption[] = [120, 90, 60, 30]; // descending, excludes Unlimited

// How far below the cap we tolerate (FPS).
const TOLERANCE = 8;
// Sustained window before we act (ms).
const SUSTAIN_MS = 6000;
// Cooldown between auto-downgrades (ms).
const COOLDOWN_MS = 20000;
// Rolling sample window size (frames).
const WINDOW = 180;

function readSettings(): any {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSettings(s: any) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("race:graphicsSettingsChanged", { detail: s }));
  } catch {
    /* ignore */
  }
}

function nextLower(current: FpsOption, sustainedAvg: number): FpsOption {
  // From the ladder, pick the highest option that the device can comfortably hit.
  // "Comfortably" = sustainedAvg >= option - TOLERANCE.
  // Always strictly lower than `current` (or unlimited -> highest ladder rung).
  const ceiling = current === 0 ? LADDER[0] : current;
  for (const opt of LADDER) {
    if (opt >= ceiling) continue;
    if (sustainedAvg >= opt - TOLERANCE) return opt;
  }
  return 30;
}

export const FpsCapabilityMonitor: React.FC = () => {
  const samplesRef = useRef<number[]>([]);
  const belowSinceRef = useRef<number | null>(null);
  const lastDowngradeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let last = performance.now();

    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      const fps = 1000 / Math.max(0.0001, dt);
      const arr = samplesRef.current;
      arr.push(fps);
      if (arr.length > WINDOW) arr.shift();

      // Need enough samples to make a call.
      if (arr.length >= 60) {
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const settings = readSettings();
        const cap: FpsOption = settings?.fps ?? 60;
        // Unlimited or 30 → nothing to downgrade meaningfully.
        const target = cap === 0 ? 60 : cap;

        const isBelow = cap !== 30 && avg < target - TOLERANCE;

        if (isBelow) {
          if (belowSinceRef.current == null) belowSinceRef.current = t;
          const sustained = t - (belowSinceRef.current ?? t);
          const sinceLast = t - lastDowngradeRef.current;
          if (sustained >= SUSTAIN_MS && sinceLast >= COOLDOWN_MS) {
            const recommended = nextLower(cap, avg);
            if (recommended !== cap && settings) {
              writeSettings({ ...settings, fps: recommended });
              lastDowngradeRef.current = t;
              belowSinceRef.current = null;
              samplesRef.current = [];
              toast.warning(
                `Performance dropped — FPS cap lowered to ${recommended} FPS`,
                {
                  description: `Average was ${Math.round(avg)} FPS (target ${cap === 0 ? "Unlimited" : cap}). Recommended: ${recommended} FPS for smooth gameplay.`,
                  duration: 7000,
                },
              );
            }
          }
        } else {
          belowSinceRef.current = null;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    // Engine-side adaptive quality scaler emits this when it steps the preset down.
    const onAutoDowngrade = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const preset = detail.preset || "Medium";
      toast.warning(`Graphics auto-reduced to ${preset}`, {
        description: `Frame rate was below target — switched to ${preset} for stable performance.`,
        duration: 7000,
      });
    };
    window.addEventListener("race:autoDowngrade", onAutoDowngrade);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("race:autoDowngrade", onAutoDowngrade);
    };
  }, []);

  return null;
};

export default FpsCapabilityMonitor;
