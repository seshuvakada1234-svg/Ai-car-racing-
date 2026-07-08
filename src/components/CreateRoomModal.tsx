// @ts-nocheck
import React, { useState } from "react";
import { useRoom } from "../hooks/useRoom";

interface Props {
  onRoomCreated: (code: string) => void;
  onClose: () => void;
  availableMaps: string[];
  availableCars: string[];
  playerNickname: string;
  defaultCarId: string;
}

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const LAP_OPTIONS = [1, 2, 3, 5, 7, 10];
const WEATHER_OPTIONS = ["clear", "rain", "fog", "night"];

export const CreateRoomModal: React.FC<Props> = ({
  onRoomCreated,
  onClose,
  availableMaps,
  availableCars,
  playerNickname,
  defaultCarId,
}) => {
  const { createRoom, loading, error } = useRoom();

  const [map, setMap] = useState(availableMaps[0] ?? "");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [laps, setLaps] = useState(3);
  const [weather, setWeather] = useState("clear");
  const [carId, setCarId] = useState(defaultCarId);

  async function handleCreate() {
    try {
      const code = await createRoom(playerNickname, carId, map, difficulty, laps, weather);
      onRoomCreated(code);
    } catch {
      // error shown via hook state
    }
  }

  return (
    <div style={overlay}>
      <div style={modal}>
        <h2 style={title}>Create Room</h2>

        <label style={label}>Map</label>
        <select style={select} value={map} onChange={(e) => setMap(e.target.value)}>
          {availableMaps.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>

        <label style={label}>Car</label>
        <select style={select} value={carId} onChange={(e) => setCarId(e.target.value)}>
          {availableCars.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>

        <label style={label}>Difficulty</label>
        <div style={row}>
          {DIFFICULTIES.map((d) => (
            <button key={d} style={chip(difficulty === d)} onClick={() => setDifficulty(d)}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>

        <label style={label}>Laps</label>
        <div style={row}>
          {LAP_OPTIONS.map((n) => (
            <button key={n} style={chip(laps === n)} onClick={() => setLaps(n)}>
              {n}
            </button>
          ))}
        </div>

        <label style={label}>Weather</label>
        <div style={row}>
          {WEATHER_OPTIONS.map((w) => (
            <button key={w} style={chip(weather === w)} onClick={() => setWeather(w)}>
              {w.charAt(0).toUpperCase() + w.slice(1)}
            </button>
          ))}
        </div>

        {error && <p style={errorStyle}>{error}</p>}

        <div style={row}>
          <button style={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button style={btnPrimary} onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create Room"}
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
  width: 380,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};
const title: React.CSSProperties = {
  margin: 0,
  color: "#fff",
  fontSize: 20,
  fontWeight: 600,
  textAlign: "center",
};
const label: React.CSSProperties = { color: "#aaa", fontSize: 12, marginBottom: -8 };
const select: React.CSSProperties = {
  background: "#0d0d1a",
  color: "#fff",
  border: "1px solid #555",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 14,
};
const row: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const chip = (active: boolean): React.CSSProperties => ({
  background: active ? "#4f46e5" : "#2a2a40",
  color: "#fff",
  border: `1px solid ${active ? "#6366f1" : "#444"}`,
  borderRadius: 8,
  padding: "6px 14px",
  fontSize: 13,
  cursor: "pointer",
});
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