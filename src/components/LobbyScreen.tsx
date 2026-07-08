import React, { useEffect, useState } from "react";
import { useRoom } from "../hooks/useRoom";
import { useMultiplayer } from "../hooks/useMultiplayer";
import { LobbyManager, LobbySnapshot } from "../multiplayer/LobbyManager";
import { LiveModeManager } from "../multiplayer/LiveModeManager";
import { PlayerList } from "./PlayerList";

interface Props {
  onRaceStart: () => void;
  onLeave: () => void;
}

export const LobbyScreen: React.FC<Props> = ({ onRaceStart, onLeave }) => {
  const { room, roomCode, isHost, leaveRoom, updateSettings, setReady } = useRoom();
  const { grid, humanCount, aiCount, hudSummary } = useMultiplayer(room);

  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [copied, setCopied] = useState(false);

  // Boot LiveModeManager once room is ready
  useEffect(() => {
    if (!room) return;
    LiveModeManager.boot(room, isHost, ({ phase }) => {
      if (phase === "racing") onRaceStart();
    });
    if (isHost) {
      LobbyManager.startCountdown(room, setLobby, onRaceStart);
    }
    return () => LiveModeManager.teardown();
  }, []); // intentional: boot once

  // Refresh snapshot when room doc changes
  useEffect(() => {
    if (room) setLobby(LobbyManager.refreshSnapshot(room));
  }, [room]);

  function copyCode() {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!room || !roomCode) {
    return (
      <div style={center}>
        <p style={muted}>Loading room…</p>
      </div>
    );
  }

  return (
    <div style={container}>
      {/* Room code badge */}
      <div style={codeBadge}>
        <span style={codeLabel}>ROOM CODE</span>
        <span style={codeValue}>{roomCode}</span>
        <button style={copyBtn} onClick={copyCode}>
          {copied ? "✓ Copied" : "⧉ Share"}
        </button>
      </div>

      {/* Room settings (read-only for guests) */}
      <div style={settingsRow}>
        <Pill label="Map" value={room.map} />
        <Pill label="Difficulty" value={room.difficulty} />
        <Pill label="Laps" value={String(room.laps)} />
        <Pill label="Weather" value={room.weather} />
      </div>

      {/* Host controls */}
      {isHost && (
        <div style={settingsRow}>
          <label style={smallLabel}>Map</label>
          <select style={smallSelect} value={room.map} onChange={(e) => updateSettings({ map: e.target.value })}>
            {/* populate from your existing map list */}
            <option>Dragon Mountain Pass</option>
            <option>Coastal Sunset Track</option>
          </select>

          <label style={smallLabel}>Difficulty</label>
          <select
            style={smallSelect}
            value={room.difficulty}
            onChange={(e) =>
              updateSettings({
                difficulty: e.target.value as "easy" | "medium" | "hard",
              })
            }
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
      )}

      {/* Player list */}
      <PlayerList grid={grid} hostId={room.hostId} />

      <p style={muted}>
        Players: {humanCount}/6 &nbsp;·&nbsp; {aiCount} AI filling
      </p>

      {/* Countdown */}
      {lobby && (
        <div style={countdownBadge}>
          {lobby.state === "waiting" ? "Waiting for players…" : `Starting in ${lobby.countdown}s`}
        </div>
      )}

      {/* Actions */}
      <div style={actions}>
        {!isHost && (
          <button style={btnReady} onClick={setReady}>
            ✓ Ready
          </button>
        )}
        {isHost && (
          <button style={btnStart} onClick={() => LiveModeManager.forceStart()} disabled={!lobby?.canStart}>
            ▶ Start Race
          </button>
        )}
        <button
          style={btnLeave}
          onClick={async () => {
            await leaveRoom();
            onLeave();
          }}
        >
          Leave
        </button>
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────────
const Pill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={pillStyle}>
    <span style={{ color: "#888", fontSize: 10 }}>{label.toUpperCase()}</span>
    <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  </div>
);

// ── Styles ─────────────────────────────────────────────────────────────────────
const container: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#0d0d1a",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 20,
  padding: 24,
  zIndex: 900,
};
const center: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const codeBadge: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
};
const codeLabel: React.CSSProperties = {
  color: "#888",
  fontSize: 12,
  letterSpacing: 3,
};
const codeValue: React.CSSProperties = {
  color: "#7c3aed",
  fontSize: 40,
  fontWeight: 800,
  letterSpacing: 10,
  fontFamily: "monospace",
};
const copyBtn: React.CSSProperties = {
  background: "#2a2a40",
  color: "#aaa",
  border: "1px solid #444",
  borderRadius: 8,
  padding: "6px 16px",
  fontSize: 13,
  cursor: "pointer",
};
const settingsRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  justifyContent: "center",
};
const pillStyle: React.CSSProperties = {
  background: "#1e1e35",
  border: "1px solid #333",
  borderRadius: 10,
  padding: "6px 14px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
};
const smallLabel: React.CSSProperties = { color: "#aaa", fontSize: 11 };
const smallSelect: React.CSSProperties = {
  background: "#0d0d1a",
  color: "#fff",
  border: "1px solid #555",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
};
const muted: React.CSSProperties = { color: "#666", fontSize: 13, margin: 0 };
const countdownBadge: React.CSSProperties = {
  background: "#1e1e35",
  border: "1px solid #4f46e5",
  borderRadius: 10,
  padding: "10px 28px",
  color: "#a5b4fc",
  fontSize: 15,
  fontWeight: 600,
};
const actions: React.CSSProperties = { display: "flex", gap: 12 };
const btnReady: React.CSSProperties = {
  background: "#059669",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 28px",
  fontSize: 15,
  cursor: "pointer",
};
const btnStart: React.CSSProperties = {
  background: "#7c3aed",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 28px",
  fontSize: 15,
  cursor: "pointer",
};
const btnLeave: React.CSSProperties = {
  background: "#2a2a40",
  color: "#f87171",
  border: "1px solid #444",
  borderRadius: 8,
  padding: "10px 20px",
  fontSize: 15,
  cursor: "pointer",
};
