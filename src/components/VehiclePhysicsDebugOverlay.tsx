import React, { useEffect, useState } from "react";

const STORAGE_KEY = "race:vehiclePhysicsDebug";

type DebugState = {
  speed?: number;
  speedKmh?: number;
  engineTorque?: number;
  brakeForce?: number;
  handbrake?: boolean;
  gear?: string;
  wheelContactCount?: number;
  wheelContact?: Record<string, { touching: boolean; compression: number; roadY: number }>;
  sleeping?: boolean;
  awake?: boolean;
  kinematic?: boolean;
  linearVelocity?: { x: number; y: number; z: number };
  angularVelocity?: number;
  linearDamping?: number;
  angularDamping?: number;
  friction?: number;
  mass?: number;
  centerOfGravity?: { x: number; y: number; z: number };
  staticCollision?: boolean;
  onRoad?: boolean;
};

export const VehiclePhysicsDebugOverlay: React.FC = () => {
  const [visible, setVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [debug, setDebug] = useState<DebugState | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F6") {
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
    let raf = 0;
    const tick = () => {
      setDebug((window as any).vehiclePhysicsDebug || null);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible) return null;

  const v = debug?.linearVelocity || { x: 0, y: 0, z: 0 };
  const contacts = debug?.wheelContact || {};
  const fmt = (n?: number, d = 2) => (Number.isFinite(n) ? Number(n).toFixed(d) : "—");
  const stateColor = debug?.sleeping || debug?.kinematic || debug?.staticCollision ? "#fb7185" : "#86efac";

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 100000,
        minWidth: 300,
        pointerEvents: "none",
        background: "rgba(2,6,23,0.84)",
        border: `1px solid ${stateColor}`,
        borderRadius: 6,
        color: "#e5e7eb",
        padding: "10px 12px",
        font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
        boxShadow: "0 10px 28px rgba(0,0,0,0.42)",
      }}
    >
      <div style={{ color: stateColor, fontWeight: 800, marginBottom: 6 }}>VEHICLE PHYSICS DEBUG · F6</div>
      {!debug ? (
        <div>Waiting for player physics…</div>
      ) : (
        <>
          <Row label="Speed" value={`${fmt(debug.speed)} m/s · ${fmt(debug.speedKmh, 0)} km/h`} />
          <Row label="Engine torque" value={fmt(debug.engineTorque, 1)} />
          <Row label="Brake force" value={fmt(debug.brakeForce, 1)} />
          <Row label="Handbrake" value={debug.handbrake ? "ON" : "off"} />
          <Row label="Gear" value={debug.gear || "—"} />
          <Row label="Wheel contact" value={`${debug.wheelContactCount ?? 0}/4`} />
          <Row label="Sleeping" value={debug.sleeping ? "YES" : "no"} />
          <Row label="Kinematic" value={debug.kinematic ? "YES" : "no"} />
          <Row label="Linear vel" value={`(${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)})`} />
          <Row label="Angular vel" value={fmt(debug.angularVelocity)} />
          <Row label="Damping" value={`lin ${fmt(debug.linearDamping, 3)} · ang ${fmt(debug.angularDamping, 2)}`} />
          <Row label="Friction" value={fmt(debug.friction, 3)} />
          <Row label="Mass" value={fmt(debug.mass, 0)} />
          <Row label="Static hit" value={debug.staticCollision ? "YES" : "no"} />
          <Row label="Road corridor" value={debug.onRoad ? "on" : "off"} />
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
            {(["frontLeft", "frontRight", "rearLeft", "rearRight"] as const).map((k) => {
              const c = contacts[k];
              return (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{k}</span>
                  <span style={{ color: c?.touching ? "#86efac" : "#fb7185" }}>
                    {c?.touching ? "contact" : "air"} · comp {fmt(c?.compression, 2)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
    <span style={{ color: "#94a3b8" }}>{label}</span>
    <span style={{ color: "#f8fafc", fontWeight: 700 }}>{value}</span>
  </div>
);

export default VehiclePhysicsDebugOverlay;