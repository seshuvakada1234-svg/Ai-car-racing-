import React from "react";

interface Props {
  roomCode: string;
  playersCount: number;
  isLiveMode?: boolean;
}

export const RoomCodeHUD: React.FC<Props> = ({ roomCode, playersCount, isLiveMode }) => (
  <div style={wrapper}>
    {isLiveMode && <span style={liveBadge}>● LIVE</span>}
    <div style={item}>
      <span style={dimLabel}>ROOM</span>
      <span style={monoValue}>{roomCode}</span>
    </div>
    <div style={divider} />
    <div style={item}>
      <span style={dimLabel}>PLAYERS</span>
      <span style={value}>{playersCount} / 6</span>
    </div>
  </div>
);

const wrapper: React.CSSProperties = {
  position: "fixed",
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  gap: 16,
  alignItems: "center",
  background: "rgba(10,10,26,0.82)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(100,100,180,0.3)",
  borderRadius: 12,
  padding: "8px 20px",
  zIndex: 800,
  pointerEvents: "none",
};
const item: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
};
const dimLabel: React.CSSProperties = {
  color: "#555",
  fontSize: 9,
  letterSpacing: 2,
};
const monoValue: React.CSSProperties = {
  color: "#7c3aed",
  fontSize: 16,
  fontWeight: 800,
  letterSpacing: 4,
  fontFamily: "monospace",
};
const value: React.CSSProperties = {
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
};
const divider: React.CSSProperties = {
  width: 1,
  height: 28,
  background: "rgba(100,100,180,0.3)",
};
const liveBadge: React.CSSProperties = {
  color: "#ef4444",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 2,
};
