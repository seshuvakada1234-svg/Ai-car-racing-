/**
 * TrackDebugOverlay
 * -----------------
 * Press F4 (or visit with ?debug=track) to toggle a 3D debug visualization of:
 *  - Every road collider (green wireframe overlay)
 *  - The full waypoint loop (cyan tube)
 *  - Numbered checkpoints (orange spheres + index label)
 *  - AI intended path between checkpoints (magenta neon sequential path)
 *  - Active target line and vertical beacon for each AI car (color-coded to each racer)
 *  - A live HUD showing waypoint count, checkpoint count, loop length, last CP crossed,
 *    and telemetry state of all active AI racers.
 *
 * The overlay reads from `window.racing2World` and `window.racingCars` and
 * mounts/unmounts its own helper meshes inside that world's `root` Group so
 * nothing else in the scene is touched.
 */
import React, { useEffect, useState } from "react";
import * as THREE from "three";

const COLOR_PALETTE = [
  0xff3333, // Red
  0x33ff57, // Neon Green
  0x3357ff, // Neon Blue
  0xf3ff33, // Yellow
  0xff33f3, // Hot Pink
  0x33fff3, // Cyan
  0xff9900, // Vibrant Orange
  0xaa33ff, // Purple
];

interface AIStateInfo {
  id: string;
  name: string;
  speed: number;
  currentCp: number;
  targetCp: number;
  stuckTimer: number;
  isFinished: boolean;
}

export const TrackDebugOverlay: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("debug") === "track";
  });
  const [stats, setStats] = useState<{ wps: number; cps: number; len: number; lastCp: number } | null>(null);
  const [aiStates, setAiStates] = useState<AIStateInfo[]>([]);
  const [activeTab, setActiveTab] = useState<"checkpoints" | "ai">("checkpoints");
  const [playerCp, setPlayerCp] = useState<number>(-1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F4") {
        e.preventDefault();
        setEnabled((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const world: any = (window as any).racing2World;
    if (!world || !world.ready) return;

    const root: THREE.Group = world.root;
    const group = new THREE.Group();
    group.name = "Racing2_DebugOverlay";
    root.add(group);

    // 1) Road collider wireframes
    const colliderMat = new THREE.MeshBasicMaterial({
      color: 0x00ff66,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
    });
    (world.roadMeshes as THREE.Mesh[]).forEach((m) => {
      const clone = new THREE.Mesh(m.geometry, colliderMat);
      m.updateWorldMatrix(true, false);
      clone.applyMatrix4(m.matrixWorld);
      clone.renderOrder = 9990;
      group.add(clone);
    });

    // 2) Waypoint loop as a tube
    const helper = world.trackHelper || world.track;
    const points: THREE.Vector3[] = helper?.cachedPoints || [];
    if (points.length > 4) {
      const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone().add(new THREE.Vector3(0, 0.6, 0))), true, "centripetal");
      const tubeGeom = new THREE.TubeGeometry(curve, Math.min(800, points.length * 2), 0.45, 6, true);
      const tubeMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.45, depthTest: false });
      const tube = new THREE.Mesh(tubeGeom, tubeMat);
      tube.renderOrder = 9991;
      group.add(tube);
    }

    // 3) Checkpoint spheres with glowing index labels
    const cps: any[] = helper?.checkpoints || [];
    const cpGeom = new THREE.SphereGeometry(1.8, 16, 12);

    const createTextSprite = (text: string, isStart: boolean) => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Semi-transparent circle background with neon border
        ctx.fillStyle = isStart ? "rgba(0, 229, 255, 0.85)" : "rgba(25, 10, 5, 0.8)";
        ctx.beginPath();
        ctx.arc(64, 64, 46, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = isStart ? "#ffffff" : "#ffa600";
        ctx.lineWidth = 6;
        ctx.stroke();

        ctx.font = "bold 40px monospace";
        ctx.fillStyle = isStart ? "#000000" : "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 64, 64);
      }
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(4.0, 4.0, 1);
      return sprite;
    };

    cps.forEach((cp, i) => {
      const mat = new THREE.MeshBasicMaterial({
        color: i === 0 ? 0x00e5ff : 0xffaa00,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
      });
      const s = new THREE.Mesh(cpGeom, mat);
      s.position.set(cp.position.x, cp.position.y + 1.2, cp.position.z);
      s.renderOrder = 9992;
      group.add(s);

      // Add elegant 3D billboard number overlay above each checkpoint (1 to 55)
      const labelSprite = createTextSprite(`${i + 1}`, i === 0);
      labelSprite.position.set(cp.position.x, cp.position.y + 4.5, cp.position.z);
      labelSprite.renderOrder = 9999;
      group.add(labelSprite);
    });

    // 4) Intended AI Path connecting checkpoints sequentially
    if (cps.length > 1) {
      const pathPoints = cps.map((cp) => new THREE.Vector3(cp.position.x, cp.position.y + 1.0, cp.position.z));
      // Connect back to the first checkpoint to complete the loop
      pathPoints.push(new THREE.Vector3(cps[0].position.x, cps[0].position.y + 1.0, cps[0].position.z));

      const pathGeom = new THREE.BufferGeometry().setFromPoints(pathPoints);
      const pathMat = new THREE.LineBasicMaterial({
        color: 0xff00ff, // High contrast magenta neon path
        linewidth: 3,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      });
      const pathLine = new THREE.Line(pathGeom, pathMat);
      pathLine.renderOrder = 9993;
      group.add(pathLine);
    }

    // --- Dynamic Target Indicators for Active Cars ---
    const targetLinesGroup = new THREE.Group();
    group.add(targetLinesGroup);

    const carDebugMeshes = new Map<string, {
      line: THREE.Line;
      beacon: THREE.Mesh;
    }>();

    const createCarDebugMesh = (colorHex: number) => {
      // Dynamic line connecting car center to target checkpoint
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3()
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: colorHex,
        linewidth: 2,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      });
      const line = new THREE.Line(geom, mat);
      line.renderOrder = 9995;
      targetLinesGroup.add(line);

      // Targeted checkpoint neon cylinder beacon
      const beaconGeom = new THREE.CylinderGeometry(0.08, 0.35, 5.0, 6);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
      });
      const beacon = new THREE.Mesh(beaconGeom, beaconMat);
      beacon.renderOrder = 9994;
      targetLinesGroup.add(beacon);

      return { line, beacon };
    };

    // 5) Track stats
    let totalLen = 0;
    for (let i = 0; i < points.length; i++) {
      totalLen += points[i].distanceTo(points[(i + 1) % points.length]);
    }
    setStats({ wps: points.length, cps: cps.length, len: totalLen, lastCp: -1 });

    const onCheckpoint = (e: any) => {
      const idx = e?.detail?.checkpointIndex;
      if (Number.isFinite(idx)) setStats((s) => (s ? { ...s, lastCp: idx } : s));
    };
    window.addEventListener("race:checkpointPassed", onCheckpoint);

    // --- Core Animation Frame Loop for Live AI Tracking ---
    let frameId: number;
    let lastStateUpdate = 0;

    const tick = () => {
      const cars: any[] = (window as any).racingCars || [];
      const chpts: any[] = helper?.checkpoints || [];
      const numCps = chpts.length;

      if (numCps > 0) {
        const activeIds = new Set<string>();

        cars.forEach((car, index) => {
          if (!car.position) return;
          // Only show target lines for AI cars as requested
          if (!car.isAI) return;

          activeIds.add(car.id);

          let entry = carDebugMeshes.get(car.id);
          if (!entry) {
            const color = COLOR_PALETTE[index % COLOR_PALETTE.length];
            entry = createCarDebugMesh(color);
            carDebugMeshes.set(car.id, entry);
          }

          const carPos = new THREE.Vector3(car.position.x, car.position.y + 0.4, car.position.z);
          const targetIdx = ((car.currentCheckpointIndex || 0) + 1) % numCps;
          const targetCp = chpts[targetIdx];

          if (targetCp && targetCp.position) {
            const targetPos = new THREE.Vector3(targetCp.position.x, targetCp.position.y + 1.0, targetCp.position.z);
            
            // Set line vertices dynamically
            entry.line.geometry.setFromPoints([carPos, targetPos]);
            entry.line.geometry.attributes.position.needsUpdate = true;
            entry.line.visible = true;

            // Align vertical beacon on top of target CP
            entry.beacon.position.copy(targetPos).add(new THREE.Vector3(0, 2.5, 0));
            entry.beacon.visible = true;
          } else {
            entry.line.visible = false;
            entry.beacon.visible = false;
          }
        });

        // Hide markers for disconnected/disabled vehicles
        for (const [id, entry] of carDebugMeshes.entries()) {
          if (!activeIds.has(id)) {
            entry.line.visible = false;
            entry.beacon.visible = false;
          }
        }
      }

      // Throttle React state updates to guarantee constant 60fps game rendering performance
      const now = performance.now();
      if (now - lastStateUpdate > 150) {
        lastStateUpdate = now;

        const player = cars.find((c: any) => c.id === "player" || !c.isAI);
        if (player) {
          setPlayerCp(player.currentCheckpointIndex || 0);
        }

        const aiList = cars
          .filter((c) => c.isAI)
          .map((c) => ({
            id: c.id,
            name: c.playerName || `AI_${c.id.substring(0, 4)}`,
            speed: Math.abs(c.speed || 0) * 3.6,
            currentCp: c.currentCheckpointIndex || 0,
            targetCp: ((c.currentCheckpointIndex || 0) + 1) % (numCps || 1),
            stuckTimer: c.stuckTimer || 0,
            isFinished: !!c.isFinished
          }));
        setAiStates(aiList);
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("race:checkpointPassed", onCheckpoint);
      cancelAnimationFrame(frameId);
      root.remove(group);

      group.traverse((o: any) => {
        if (o.isMesh || (o as any).isLine) {
          if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose?.());
          else o.material?.dispose?.();
          if (o.geometry && o.geometry !== cpGeom) o.geometry.dispose?.();
        }
      });
      cpGeom.dispose();
    };
  }, [enabled]);

  const handleTeleport = (index: number) => {
    const cars: any[] = (window as any).racingCars || [];
    const player = cars.find((c: any) => c.id === "player" || !c.isAI);
    const world: any = (window as any).racing2World;
    const helper = world?.trackHelper || world?.track;
    const chpts = helper?.checkpoints || [];
    const chpt = chpts[index];
    if (player && chpt) {
      player.currentCheckpointIndex = index;
      player.position.x = chpt.position.x;
      player.position.y = chpt.position.y + 0.6;
      player.position.z = chpt.position.z;
      player.lastValidY = chpt.position.y;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      player.speed = 0;
      player.angularVelocity = 0;
      player.driftFactor = 0;
      player.isDrifting = false;
      if (player.steerValue !== undefined) player.steerValue = 0;
      player.angle = Math.atan2(chpt.direction.x, chpt.direction.z);
      
      // Force update stats and checkpoint crossed state
      setStats((s) => (s ? { ...s, lastCp: index } : s));
      setPlayerCp(index);
      
      // Dispatch pass checkpoint event to keep audio/UI/cam synchronized
      window.dispatchEvent(new CustomEvent("race:checkpointPassed", { detail: { checkpointIndex: index } }));
    }
  };

  if (!enabled) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        zIndex: 100000,
        padding: "14px 18px",
        background: "rgba(10, 10, 15, 0.92)",
        backdropFilter: "blur(6px)",
        color: "#a6ffcb",
        font: "500 11px/1.5 ui-monospace, monospace",
        border: "1px solid #ff00ff",
        borderRadius: 10,
        pointerEvents: "auto",
        width: "350px",
        maxHeight: "88vh",
        overflowY: "auto",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.6)",
        userSelect: "none"
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ color: "#ff00ff", fontWeight: 700, fontSize: "12px", borderBottom: "1px solid rgba(255,0,255,0.3)", paddingBottom: 6, marginBottom: 10, letterSpacing: "1px" }}>
        🏁 TRACK & AI DEBUG (F4)
      </div>

      {stats ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginBottom: 12, background: "rgba(255,255,255,0.02)", padding: "8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
          <div><span style={{ color: "#888" }}>Waypoints:</span> <span style={{ color: "#fff" }}>{stats.wps}</span></div>
          <div><span style={{ color: "#888" }}>Checkpoints:</span> <span style={{ color: "#fff" }}>{stats.cps}</span></div>
          <div style={{ gridColumn: "span 2" }}><span style={{ color: "#888" }}>Loop length:</span> <span style={{ color: "#fff" }}>{stats.len.toFixed(1)} m</span></div>
          <div style={{ gridColumn: "span 2" }}><span style={{ color: "#888" }}>Player Current CP:</span> <span style={{ color: "#00ff66", fontWeight: "bold" }}>{playerCp < 0 ? "—" : playerCp + 1}</span></div>
        </div>
      ) : (
        <div style={{ color: "#ffa500", marginBottom: 12 }}>Waiting for Racing 2 world…</div>
      )}

      {/* Tab Switcher */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab("checkpoints"); }}
          style={{
            flex: 1,
            background: activeTab === "checkpoints" ? "rgba(255, 0, 255, 0.2)" : "rgba(255,255,255,0.03)",
            border: activeTab === "checkpoints" ? "1px solid #ff00ff" : "1px solid rgba(255,255,255,0.12)",
            borderRadius: "6px",
            color: activeTab === "checkpoints" ? "#ff00ff" : "#888",
            padding: "6px 10px",
            cursor: "pointer",
            font: "bold 10px monospace",
            textAlign: "center",
            outline: "none"
          }}
        >
          📍 CHECKPOINTS
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab("ai"); }}
          style={{
            flex: 1,
            background: activeTab === "ai" ? "rgba(51, 255, 243, 0.15)" : "rgba(255,255,255,0.03)",
            border: activeTab === "ai" ? "1px solid #33fff3" : "1px solid rgba(255,255,255,0.12)",
            borderRadius: "6px",
            color: activeTab === "ai" ? "#33fff3" : "#888",
            padding: "6px 10px",
            cursor: "pointer",
            font: "bold 10px monospace",
            textAlign: "center",
            outline: "none"
          }}
        >
          🤖 AI TRACKER
        </button>
      </div>

      {activeTab === "checkpoints" && stats && (
        <div>
          <div style={{ color: "#ff8800", fontWeight: 700, marginBottom: 4, fontSize: "10px", letterSpacing: "0.5px" }}>
            PORTAL CHANNELS (1 TO {stats.cps})
          </div>
          <div style={{ color: "#888", fontSize: "9px", marginBottom: 10, lineHeight: "1.3" }}>
            Click any index to warp the player vehicle straight to that checkpoint zone on the racing line.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px", maxHeight: "250px", overflowY: "auto", paddingRight: "4px" }}>
            {Array.from({ length: stats.cps }).map((_, i) => {
              const isCurrent = playerCp === i;
              const isStart = i === 0;
              return (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTeleport(i);
                  }}
                  title={`Warp to Checkpoint ${i + 1}`}
                  style={{
                    background: isCurrent
                      ? "rgba(0, 255, 102, 0.3)"
                      : isStart
                      ? "rgba(0, 229, 255, 0.18)"
                      : "rgba(255, 255, 255, 0.05)",
                    border: isCurrent
                      ? "1px solid #00ff66"
                      : isStart
                      ? "1px solid #00e5ff"
                      : "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "6px",
                    color: isCurrent ? "#00ff66" : isStart ? "#00e5ff" : "#ffffff",
                    padding: "6px 0",
                    fontSize: "11px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    textAlign: "center",
                    fontFamily: "monospace",
                    boxShadow: isCurrent ? "0 0 6px rgba(0,255,102,0.4)" : "none",
                    outline: "none"
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "ai" && (
        <div>
          <div style={{ color: "#33fff3", fontWeight: 700, marginBottom: 8, fontSize: "10px", letterSpacing: "0.5px" }}>
            AI RACER TRACKING
          </div>
          {aiStates.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {aiStates.map((ai, index) => {
                const colorHex = COLOR_PALETTE[index % COLOR_PALETTE.length].toString(16).padStart(6, "0");
                return (
                  <div key={ai.id} style={{ background: "rgba(255,255,255,0.03)", padding: "4px 6px", borderRadius: 4, borderLeft: `3px solid #${colorHex}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                      <span style={{ color: "#fff" }}>{ai.name}</span>
                      <span style={{ color: ai.isFinished ? "#00ff66" : "#aaa" }}>
                        {ai.isFinished ? "FINISHED" : `${ai.speed.toFixed(0)} km/h`}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#888", fontSize: "10px", marginTop: 2 }}>
                      <span>Target CP: <span style={{ color: "#ff8800" }}>{ai.targetCp + 1}</span></span>
                      <span>Last CP: <span style={{ color: "#33fff3" }}>{ai.currentCp + 1}</span></span>
                      {ai.stuckTimer > 0.5 && (
                        <span style={{ color: "#ff3333", fontWeight: "bold" }}>
                          STUCK {ai.stuckTimer.toFixed(1)}s
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "#888", fontStyle: "italic" }}>No active AI racers to track.</div>
          )}
        </div>
      )}
    </div>
  );
};
