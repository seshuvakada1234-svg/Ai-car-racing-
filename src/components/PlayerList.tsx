import React from "react";
import { GridEntry } from "../multiplayer/PlayerManager";

interface Props {
  grid: GridEntry[];
  hostId: string;
}

export const PlayerList: React.FC<Props> = ({ grid, hostId }) => (
  <div style={container}>
    {grid.map((entry) => (
      <div key={entry.player.id} style={row(entry.player.isAI)}>
        <span style={pos}>{entry.position}</span>
        <span style={name}>{entry.displayName}</span>
        <span style={badge(entry.isHuman)}>{entry.isHuman ? "Human" : "AI"}</span>
        {entry.isHuman && <span style={ready(entry.player.isReady)}>{entry.player.isReady ? "✓" : "…"}</span>}
      </div>
    ))}
  </div>
);

const container: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const row = (isAI: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: isAI ? "#111122" : "#1a1a2e",
  border: `1px solid ${isAI ? "#222" : "#333"}`,
  borderRadius: 8,
  padding: "8px 14px",
});
const pos: React.CSSProperties = {
  color: "#555",
  fontSize: 13,
  width: 20,
  textAlign: "right",
  flexShrink: 0,
};
const name: React.CSSProperties = {
  color: "#ddd",
  fontSize: 14,
  flex: 1,
  fontWeight: 500,
};
const badge = (isHuman: boolean): React.CSSProperties => ({
  background: isHuman ? "#1e3a5f" : "#2a1a3a",
  color: isHuman ? "#60a5fa" : "#a78bfa",
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 5,
  fontWeight: 600,
});
const ready = (isReady: boolean): React.CSSProperties => ({
  color: isReady ? "#34d399" : "#555",
  fontSize: 16,
  width: 20,
  textAlign: "center",
});
