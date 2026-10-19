import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, Copy, Play, RefreshCw, Users } from "lucide-react";
import { fetchLanRoom, leaveLanRoom, reconnectLanSession, setLanReady, startLanRace } from "../lan/lanApi";
import { clearLanSession, loadLanSession, saveLanSession } from "../lan/localGuest";
import { LanRoom, LanSession } from "../lan/types";

const formatSeconds = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  return String(Math.max(0, Math.ceil(value)));
};

export const LanLobbyPage: React.FC = () => {
  const navigate = useNavigate();
  const { roomCode } = useParams<{ roomCode: string }>();
  const normalizedCode = (roomCode || "").toUpperCase().trim();

  const [session, setSession] = useState<LanSession | null>(() =>
    normalizedCode ? loadLanSession(normalizedCode) : null,
  );
  const [room, setRoom] = useState<LanRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"ready" | "start" | "leave" | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const transitioningRef = useRef(false);

  const me = useMemo(() => {
    if (!room || !session) return null;
    return room.players.find((player) => player.playerId === session.playerId) || null;
  }, [room, session]);

  const everyoneReady = useMemo(() => {
    if (!room) return false;
    if (room.players.length === 0) return false;
    return room.players.every((player) => player.ready || player.isHost);
  }, [room]);

  const isHost = !!session?.isHost;

  useEffect(() => {
    if (!normalizedCode) {
      navigate("/lan", { replace: true });
      return;
    }

    const localSession = loadLanSession(normalizedCode);
    if (!localSession) {
      setError("No LAN session found for this room. Join again from the LAN screen.");
      return;
    }

    let active = true;
    const hydrate = async () => {
      try {
        const recon = await reconnectLanSession(localSession);
        if (!active) return;
        saveLanSession(recon.session);
        setSession(recon.session);
        setRoom(recon.room);
        setServerOffset(recon.room.serverTime - Date.now());
      } catch (err: any) {
        if (!active) return;
        setError(err?.message || "Failed to reconnect LAN session.");
      }
    };

    hydrate();

    return () => {
      active = false;
    };
  }, [normalizedCode, navigate]);

  useEffect(() => {
    if (!session || !normalizedCode) return;

    let active = true;
    const poll = async () => {
      try {
        const nextRoom = await fetchLanRoom(session.baseUrl, normalizedCode);
        if (!active) return;
        setRoom(nextRoom);
        setServerOffset(nextRoom.serverTime - Date.now());

        if ((nextRoom.status === "countdown" || nextRoom.status === "racing") && !transitioningRef.current) {
          transitioningRef.current = true;
          navigate(`/lan/race/${normalizedCode}`);
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.message || "Unable to load LAN room status.");
      }
    };

    poll();
    const id = window.setInterval(poll, 800);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [session, normalizedCode, navigate]);

  useEffect(() => {
    if (!room?.raceStartTime || room.status !== "countdown") {
      setSecondsLeft(null);
      return;
    }

    const update = () => {
      const now = Date.now() + serverOffset;
      const seconds = (room.raceStartTime! - now) / 1000;
      setSecondsLeft(formatSeconds(seconds));
    };

    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [room?.raceStartTime, room?.status, serverOffset]);

  const toggleReady = async () => {
    if (!session || !me) return;
    setBusy("ready");
    setError(null);
    try {
      const updated = await setLanReady(session, !me.ready);
      setRoom(updated);
      setServerOffset(updated.serverTime - Date.now());
    } catch (err: any) {
      setError(err?.message || "Failed to update ready state.");
    } finally {
      setBusy(null);
    }
  };

  const startRace = async () => {
    if (!session) return;
    setBusy("start");
    setError(null);
    try {
      const updated = await startLanRace(session);
      setRoom(updated);
      setServerOffset(updated.serverTime - Date.now());
      navigate(`/lan/race/${normalizedCode}`);
    } catch (err: any) {
      setError(err?.message || "Failed to start LAN race.");
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    if (!session) {
      navigate("/lan");
      return;
    }

    setBusy("leave");
    try {
      await leaveLanRoom(session);
    } catch (err) {
      // Room may already be gone; still clear local session and exit.
    } finally {
      clearLanSession(normalizedCode);
      setBusy(null);
      navigate("/lan");
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(normalizedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  if (!session && !room) {
    return (
      <div className="min-h-screen bg-slate-950 text-white px-6 py-8 md:px-10">
        <div className="max-w-3xl mx-auto rounded-3xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
          <h1 className="text-2xl font-black">LAN Lobby</h1>
          <p className="text-sm text-slate-400">
            {error || "No LAN session found for this room. Return to LAN mode and join again."}
          </p>
          <button
            onClick={() => navigate("/lan")}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-black uppercase tracking-wider cursor-pointer"
          >
            Back To LAN Mode
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-8 md:px-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight">LAN Room {normalizedCode}</h1>
            <p className="text-sm text-slate-400">Host URL: {session?.baseUrl}</p>
          </div>

          <button
            onClick={copyCode}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-200 hover:text-white cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? "Copied" : "Copy Code"}
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 flex items-start gap-2 text-red-200 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <Users className="w-4 h-4 text-cyan-300" />
              <span>Players ({room?.players.length || 0}/{room?.maxPlayers || 0})</span>
            </div>
            {room?.status === "countdown" && secondsLeft !== null ? (
              <div className="text-xs uppercase tracking-widest text-amber-300">Starts In {secondsLeft}</div>
            ) : null}
          </div>

          <div className="space-y-2">
            {(room?.players || []).map((player) => (
              <div
                key={player.playerId}
                className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-100">{player.name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    {player.isHost ? "Host" : "Racer"}
                    {session?.playerId === player.playerId ? " • You" : ""}
                  </div>
                </div>
                <div
                  className={`text-[10px] uppercase tracking-wider font-bold ${
                    player.ready || player.isHost ? "text-emerald-300" : "text-amber-300"
                  }`}
                >
                  {player.ready || player.isHost ? "Ready" : "Not Ready"}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            {!isHost && (
              <button
                onClick={toggleReady}
                disabled={busy !== null || !me}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-xs font-black uppercase tracking-wider cursor-pointer"
              >
                {busy === "ready" ? "Updating..." : me?.ready ? "Set Not Ready" : "Set Ready"}
              </button>
            )}

            {isHost && (
              <button
                onClick={startRace}
                disabled={busy !== null || !everyoneReady}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-black uppercase tracking-wider cursor-pointer"
              >
                {busy === "start" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {busy === "start" ? "Starting..." : everyoneReady ? "Start Race" : "Waiting For Players"}
              </button>
            )}

            <button
              onClick={leave}
              disabled={busy !== null}
              className="px-4 py-2 rounded-xl border border-slate-700 text-xs font-black uppercase tracking-wider text-slate-300 hover:text-white disabled:opacity-50 cursor-pointer"
            >
              {busy === "leave" ? "Leaving..." : "Leave Room"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
