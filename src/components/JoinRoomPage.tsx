import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { NormalRoomService } from "../multiplayer/NormalRoomService";
import { Compass, Users, Sparkles, Loader2, ArrowLeft } from "lucide-react";

export const JoinRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    const normalizedCode = roomCode.trim().toUpperCase();
    if (normalizedCode.length < 4) {
      setError("Room code must be at least 4 characters.");
      return;
    }

    setLoading(true);
    setError(null);

    let attempts = 0;
    const maxAttempts = 3;
    let success = false;
    let finalError: any = null;

    while (attempts < maxAttempts && !success) {
      try {
        attempts++;
        console.log(`Join room attempt ${attempts} of ${maxAttempts} for code: ${normalizedCode}`);
        await NormalRoomService.joinRoom(normalizedCode, profile.uid, profile.name || "Racer", profile.photoURL || "");
        success = true;
      } catch (err: any) {
        console.error(`Attempt ${attempts} failed:`, err);
        finalError = err;
        if (attempts < maxAttempts) {
          // brief delay between retries of 500ms
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    if (success) {
      // Navigate to Waiting Lobby
      navigate(`/room/${normalizedCode}`);
    } else {
      setError(finalError?.message || "Room code not found or lobby list full.");
    }
    setLoading(false);
  };

  return (
    <div id="join-room-view" className="min-h-[80vh] flex flex-col items-center justify-center text-white px-4">
      <div className="absolute w-[450px] h-[450px] bg-purple-600/5 rounded-full blur-[140px] pointer-events-none top-20" />

      <div className="bg-slate-950/80 border border-slate-900 backdrop-blur-md p-8 sm:p-10 rounded-3xl max-w-md w-full text-center space-y-6 shadow-2xl relative overflow-hidden">
        {/* Neon top highlights */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 via-indigo-400 to-cyan-500" />

        <div className="flex items-center justify-between border-b border-slate-900 pb-4 text-left">
          <button
            onClick={() => navigate("/garage")}
            className="text-slate-500 hover:text-slate-200 transition p-1 rounded-lg hover:bg-slate-900/60"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono font-black">
            LOBBY GATEWAY
          </span>
          <div className="w-5" /> {/* Spacer */}
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center space-x-1.5 bg-purple-500/10 text-purple-400 font-extrabold uppercase text-[9px] tracking-widest px-3 py-1 rounded-full border border-purple-500/20">
            <Users className="w-3.5 h-3.5 text-purple-400" />
            <span>Enter Multiplayer Grid</span>
          </div>
          <h2 className="text-2xl font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400">
            JOIN ROOM
          </h2>
          <p className="text-xs text-slate-400 max-w-xs mx-auto leading-normal">
            Paste order code or type invitation letters and connect straight to live peer racer grids.
          </p>
        </div>

        <form onSubmit={handleJoin} className="space-y-4">
          <div className="flex flex-col text-left space-y-1.5">
            <label className="text-[9px] uppercase font-bold tracking-widest text-slate-500">
              room code (e.g. DRAGON123)
            </label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => {
                setRoomCode(e.target.value.toUpperCase().slice(0, 15));
                setError(null);
              }}
              placeholder="DRAGON123"
              className="bg-slate-950/80 border border-slate-800 focus:border-purple-500 text-slate-100 font-black text-center text-xl tracking-[4px] p-3 rounded-2xl outline-none transition uppercase w-full font-mono"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-xl font-medium leading-relaxed">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || roomCode.length < 4}
            className="w-full bg-gradient-to-r from-purple-600 to-indigo-500 hover:brightness-115 text-white font-extrabold uppercase text-xs tracking-widest py-4 rounded-xl shadow-lg active:scale-[0.98] transition cursor-pointer flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>CONNECTING MATCH...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-white fill-current animate-pulse" />
                <span>CONFIRM & REGISTER</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
