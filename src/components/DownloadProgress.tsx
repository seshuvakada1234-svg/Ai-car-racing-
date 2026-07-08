import React from "react";

interface DownloadProgressProps {
  label: string;
  percent: number;
}

export const DownloadProgress: React.FC<DownloadProgressProps> = ({ label, percent }) => {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#cbd5e1" }}>
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 6, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#22c55e", transition: "width 0.2s" }} />
      </div>
    </div>
  );
};

export default DownloadProgress;
