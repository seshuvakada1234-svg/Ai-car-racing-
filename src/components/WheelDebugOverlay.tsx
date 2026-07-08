import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Real-time wheel diagnostics overlay.
 *
 * Press the backtick key ( ` ) to toggle. Reads the live WheelSystem off of
 * `window.__vehicleRenderer` (set in GameCanvas) and prints, per wheel:
 *  - omega (rad/s) — instantaneous spin rate derived from frame-to-frame
 *    rotation; cross-check against vehicle speed / radius.
 *  - steer angle (deg) — yaw of the steer pivot.
 *  - pivot axis (x,y,z) — the local axle direction the hub spins around.
 *  - alignment delta (m) — distance from each wheel mesh world position to
 *    its steer-pivot world position, exposing collider/mesh drift.
 *
 * Pure presentational, read-only. Adds zero scene-graph state.
 */

type WheelKey = "fl" | "fr" | "rl" | "rr";

interface WheelRow {
  key: WheelKey;
  label: string;
  detected: boolean;
  radius: number;
  omega: number;
  steerDeg: number;
  axis: [number, number, number];
  alignment: number;
}

const KEYS: { key: WheelKey; label: string; field: "frontLeft" | "frontRight" | "rearLeft" | "rearRight" }[] = [
  { key: "fl", label: "Front L", field: "frontLeft" },
  { key: "fr", label: "Front R", field: "frontRight" },
  { key: "rl", label: "Rear  L", field: "rearLeft" },
  { key: "rr", label: "Rear  R", field: "rearRight" },
];

export const WheelDebugOverlay = () => {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return (window as any).__wheelDebug === true;
  });
  const [rows, setRows] = useState<WheelRow[]>([]);
  const [speed, setSpeed] = useState<number>(0);
  const prevAnglesRef = useRef<Record<WheelKey, number>>({ fl: 0, fr: 0, rl: 0, rr: 0 });
  const prevTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" || e.key === "~") {
        setVisible((v) => {
          const next = !v;
          (window as any).__wheelDebug = next;
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;

    const meshWorld = new THREE.Vector3();
    const pivotWorld = new THREE.Vector3();

    const tick = () => {
      const renderer: any = (window as any).__vehicleRenderer;
      const ws = renderer?.gltfAssetMap?.get?.("player")?.wheelSystem;
      const cars: any[] = (window as any).gameCars || (window as any).__gameCars || [];
      const player = cars.find((c) => c?.id === "player");
      const now = performance.now();
      const dt = Math.max(0.001, (now - prevTimeRef.current) / 1000);
      prevTimeRef.current = now;

      if (ws) {
        const next: WheelRow[] = KEYS.map(({ key, label, field }) => {
          const a = ws[field];
          if (!a) {
            return {
              key,
              label,
              detected: false,
              radius: 0,
              omega: 0,
              steerDeg: 0,
              axis: [0, 0, 0],
              alignment: 0,
            };
          }
          const curAngle: number = ws.spinAngles?.[key] ?? 0;
          const prev = prevAnglesRef.current[key];
          let delta = curAngle - prev;
          if (delta > Math.PI) delta -= Math.PI * 2;
          else if (delta < -Math.PI) delta += Math.PI * 2;
          prevAnglesRef.current[key] = curAngle;
          const omega = delta / dt;

          const steerY = new THREE.Euler().setFromQuaternion(a.steerPivot.quaternion, "YXZ").y;

          a.node.getWorldPosition(meshWorld);
          a.steerPivot.getWorldPosition(pivotWorld);
          const alignment = meshWorld.distanceTo(pivotWorld);

          return {
            key,
            label,
            detected: true,
            radius: a.wheelRadius,
            omega,
            steerDeg: THREE.MathUtils.radToDeg(steerY),
            axis: [a.spinAxis.x, a.spinAxis.y, a.spinAxis.z],
            alignment,
          };
        });
        setRows(next);
      } else {
        setRows([]);
      }
      setSpeed(player?.speed ?? 0);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible) return null;

  const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.78)",
        color: "#9bffb1",
        font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "10px 12px",
        border: "1px solid #1f5b32",
        borderRadius: 6,
        minWidth: 360,
        pointerEvents: "none",
        whiteSpace: "pre",
      }}
    >
      <div style={{ color: "#ffd166", marginBottom: 6 }}>
        WHEEL DEBUG  (press ` to hide)   speed={fmt(speed, 1)} m/s
      </div>
      <div style={{ color: "#8aa", marginBottom: 4 }}>
        wheel    omega(rad/s)  steer(°)   axis(x,y,z)              align(m)   r(m)
      </div>
      {rows.length === 0 ? (
        <div style={{ color: "#ff6b6b" }}>No WheelSystem on player (GLTF not loaded).</div>
      ) : (
        rows.map((r) => {
          const expected = r.radius > 0.05 ? speed / r.radius : 0;
          const drift = Math.abs(r.omega - expected);
          const omegaColor = drift > 3 ? "#ff6b6b" : "#9bffb1";
          const alignColor = r.alignment > 0.02 ? "#ff6b6b" : "#9bffb1";
          if (!r.detected) {
            return (
              <div key={r.key} style={{ color: "#ff6b6b" }}>
                {r.label}  NOT DETECTED
              </div>
            );
          }
          return (
            <div key={r.key}>
              {r.label}  <span style={{ color: omegaColor }}>{fmt(r.omega).padStart(8)}</span>
              {"   "}
              {fmt(r.steerDeg).padStart(6)}
              {"   "}({fmt(r.axis[0])},{fmt(r.axis[1])},{fmt(r.axis[2])})
              {"   "}
              <span style={{ color: alignColor }}>{fmt(r.alignment, 3)}</span>
              {"   "}
              {fmt(r.radius, 2)}
            </div>
          );
        })
      )}
      <div style={{ marginTop: 6, color: "#8aa" }}>
        omega target = speed / radius. Red = drift &gt; 3 rad/s or align &gt; 2 cm.
      </div>
    </div>
  );
};

export default WheelDebugOverlay;
