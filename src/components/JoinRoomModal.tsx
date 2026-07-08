import React, { useState } from "react";
import { useRoom } from "../hooks/useRoom";

interface Props {
  onJoined: () => void;
  onClose: () => void;
  availableCars: string[];
}

export const JoinRoomModal: React.FC<Props> = ({ onJoined, onClose, availableCars }) => {
  const { joinRoom, loading, error } = useRoom();

  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [carId, setCarId] = useState(availableCars[0] ?? "");

  async function handleJoin() {
    if (!code.trim() || !nickname.trim()) return;
    try {
      await joinRoom(code.trim(), nickname.trim(), carId);
      onJoined();
    } catch {
      /* shown via hook */
    }
  }

  return (
    <div style={overlay}>
      <div style={modal}>
        <h2 style={title}>Join Room</h2>

        <label style={label}>Room Code</label>
        <input
          style={input}
          maxLength={6}
          placeholder="A7K9X2"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />

        <label style={label}>Nickname</label>
        <input
          style={input}
          maxLength={18}
          placeholder="RacerKing"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />

        <label style={label}>Car</label>
        <select style={select} value={carId} onChange={(e) => setCarId(e.target.value)}>
          {availableCars.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>

        {error && <p style={errorStyle}>{error}</p>}

        <div style={row}>
          <button style={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button style={btnPrimary} onClick={handleJoin} disabled={loading || !code || !nickname}>
            {loading ? "Joining..." : "Join Room"}
          </button>
        </div>
      </div>
    </div>
  );
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.75)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const modal: React.CSSProperties = {
  background: "#1a1a2e",
  border: "1px solid #444",
  borderRadius: 12,
  padding: 28,
  width: 360,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};
const title: React.CSSProperties = {
  margin: 0,
  color: "#fff",
  fontSize: 20,
  fontWeight: 600,
  textAlign: "center",
};
const label: React.CSSProperties = { color: "#aaa", fontSize: 12, marginBottom: -8 };
const input: React.CSSProperties = {
  background: "#0d0d1a",
  color: "#fff",
  border: "1px solid #555",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 16,
  letterSpacing: 3,
  textTransform: "uppercase",
};
const select: React.CSSProperties = {
  background: "#0d0d1a",
  color: "#fff",
  border: "1px solid #555",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 14,
};
const row: React.CSSProperties = { display: "flex", gap: 8 };
const btnPrimary: React.CSSProperties = {
  flex: 1,
  background: "#4f46e5",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 0",
  fontSize: 15,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  flex: 1,
  background: "#2a2a40",
  color: "#aaa",
  border: "1px solid #444",
  borderRadius: 8,
  padding: "10px 0",
  fontSize: 15,
  cursor: "pointer",
};
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 13, margin: 0 };
