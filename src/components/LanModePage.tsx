import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Router, Wifi } from "lucide-react";
import { createLanRoom, fetchLanHostInfo, joinLanRoom, normalizeLanBaseUrl } from "../lan/lanApi";
import { loadLanBaseUrl, loadLanGuestName, saveLanBaseUrl, saveLanGuestName, saveLanSession } from "../lan/localGuest";

export const LanModePage: React.FC = () => {
  const navigate = useNavigate();

  const defaultBaseUrl = useMemo(() => {
    if (typeof window === "undefined") return "http://localhost:3000";
    return window.location.origin;
  }, []);

  const [playerName, setPlayerName] = useState(loadLanGuestName());
  const [hostBaseUrl, setHostBaseUrl] = useState(loadLanBaseUrl() || defaultBaseUrl);
  const [joinBaseUrl, setJoinBaseUrl] = useState(loadLanBaseUrl() || "");
  const [joinRoomCode, setJoinRoomCode] = useState("");

  const [hostInfoLoading, setHostInfoLoading] = useState(false);
  const [hostInfoError, setHostInfoError] = useState<string | null>(null);
  const [hostInfo, setHostInfo] = useState<{ hostIps: string[]; suggestedUrls: string[] } | null>(null);

  const [busyAction, setBusyAction] = useState<"host" | "join" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    saveLanGuestName(playerName);
  }, [playerName]);

  useEffect(() => {
    const run = async () => {
      setHostInfoLoading(true);
      setHostInfoError(null);
      try {
        const info = await fetchLanHostInfo(defaultBaseUrl);
        setHostInfo({ hostIps: info.hostIps, suggestedUrls: info.suggestedUrls });
      } catch (err: any) {
        setHostInfoError(err?.message || "Unable to fetch LAN host information.");
      } finally {
        setHostInfoLoading(false);
      }
    };

    run();
  }, [defaultBaseUrl]);

  const handleHostCreate = async () => {
    setActionError(null);
    setBusyAction("host");

    try {
      const base = normalizeLanBaseUrl(hostBaseUrl || defaultBaseUrl);
      const result = await createLanRoom(base, playerName || "LAN Host", 6);
      saveLanBaseUrl(base);
      saveLanSession(result.session);
      navigate(`/lan/room/${result.room.roomCode}`);
    } catch (err: any) {
      setActionError(err?.message || "Failed to create LAN room.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleJoin = async () => {
    setActionError(null);
    setBusyAction("join");

    try {
      const roomCode = joinRoomCode.toUpperCase().trim();
      if (!roomCode) throw new Error("Enter a LAN room code.");

      const base = normalizeLanBaseUrl(joinBaseUrl);
      const result = await joinLanRoom(base, roomCode, playerName || "LAN Racer");
      saveLanBaseUrl(base);
      saveLanSession(result.session);
      navigate(`/lan/room/${result.room.roomCode}`);
    } catch (err: any) {
      setActionError(err?.message || "Failed to join LAN room.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-8 md:px-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight">Offline LAN Multiplayer</h1>
          <p className="text-sm text-slate-400">
            Host on Windows and join from nearby devices on the same Wi-Fi/mobile hotspot. No cloud services required.
          </p>
        </div>

        {actionError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 flex items-start gap-2 text-red-200 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
          <label className="text-xs uppercase tracking-wide text-slate-400">Guest Name</label>
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
            maxLength={24}
            placeholder="LAN Racer"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-950/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Router className="w-5 h-5 text-emerald-300" />
                <h2 className="font-black text-lg">Host LAN Room</h2>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-slate-400">Host Server URL</label>
              <input
                value={hostBaseUrl}
                onChange={(e) => setHostBaseUrl(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
                placeholder="http://192.168.1.10:3000"
              />
            </div>

            <button
              onClick={handleHostCreate}
              disabled={busyAction !== null}
              className="w-full rounded-2xl py-3 text-xs font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
            >
              {busyAction === "host" ? "Creating Room..." : "Create LAN Room"}
            </button>

            <div className="text-xs text-slate-300 space-y-1">
              <div className="font-semibold text-slate-200">Share These Host IPs:</div>
              {hostInfoLoading && <div className="text-slate-400">Detecting LAN IP...</div>}
              {hostInfoError && <div className="text-red-300">{hostInfoError}</div>}
              {!hostInfoLoading && !hostInfoError && hostInfo?.suggestedUrls?.length ? (
                hostInfo.suggestedUrls.map((url) => <div key={url}>{url}</div>)
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-cyan-500/30 bg-cyan-950/10 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Wifi className="w-5 h-5 text-cyan-300" />
              <h2 className="font-black text-lg">Join LAN Room</h2>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-slate-400">Host URL</label>
              <input
                value={joinBaseUrl}
                onChange={(e) => setJoinBaseUrl(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
                placeholder="http://192.168.1.10:3000"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-slate-400">Room Code</label>
              <input
                value={joinRoomCode}
                onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm uppercase"
                placeholder="LXXXXX"
              />
            </div>

            <button
              onClick={handleJoin}
              disabled={busyAction !== null}
              className="w-full rounded-2xl py-3 text-xs font-black uppercase tracking-wider bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 cursor-pointer"
            >
              {busyAction === "join" ? "Joining..." : "Join LAN Room"}
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => navigate("/multiplayer-mode")}
            className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-300 hover:text-white"
          >
            Back To Mode Select
          </button>
          <button
            onClick={() => navigate("/garage")}
            className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-300 hover:text-white flex items-center gap-1"
          >
            Garage <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
