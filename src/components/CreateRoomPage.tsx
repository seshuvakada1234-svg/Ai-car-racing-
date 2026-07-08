import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { NormalRoomService } from "../multiplayer/NormalRoomService";
import { Compass, Sparkles, Loader2 } from "lucide-react";

export const CreateRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // Retrieve parameters passed from Garage Menu if any
  const state = location.state as { selectedCar?: string; selectedMap?: string } | null;
  const car = state?.selectedCar || "ferrari";
  const map = state?.selectedMap || "map1";

  useEffect(() => {
    let active = true;

    const performRoomCreation = async () => {
      if (!profile) return;
      try {
        const generatedCode = await NormalRoomService.createRoom(
          profile.uid,
          profile.name || "Anonymous Racer",
          profile.photoURL || "",
          car,
          map,
        );
        if (active) {
          // Navigate to Waiting Lobby
          navigate(`/room/${generatedCode}`);
        }
      } catch (err: any) {
        console.error("Failed to create room:", err);
        if (active) {
          setError(err.message || "Unknown error occurred while creating room.");
        }
      }
    };

    performRoomCreation();

    return () => {
      active = false;
    };
  }, [profile, car, map, navigate]);

  return (
    <div id="create-room-view" className="min-h-[80vh] flex flex-col items-center justify-center text-white px-4">
      <div className="absolute w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none -top-10" />

      <div className="bg-slate-950/80 border border-slate-900 backdrop-blur-md p-8 sm:p-10 rounded-3xl max-w-md w-full text-center space-y-6 shadow-2xl relative overflow-hidden">
        {/* Neon top highlights */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-cyan-400 to-indigo-500" />

        {error ? (
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto text-red-500">
              <Compass className="w-8 h-8 animate-pulse" />
            </div>
            <h3 className="text-xl font-black uppercase tracking-wider text-red-400">Creation Failed</h3>
            <p className="text-xs text-slate-400 leading-normal">{error}</p>
            <button
              onClick={() => navigate("/garage")}
              className="px-6 py-2.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white font-bold uppercase text-[10px] tracking-widest rounded-xl transition cursor-pointer"
            >
              Return to Garage
            </button>
          </div>
        ) : (
          <>
            <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
              <Loader2 className="w-16 h-16 text-cyan-400 animate-spin absolute" />
              <Compass className="w-8 h-8 text-blue-400 rotate-45" />
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center space-x-1.5 bg-cyan-500/10 text-cyan-400 font-extrabold uppercase text-[9px] tracking-widest px-3 py-1 rounded-full border border-cyan-500/20">
                <Sparkles className="w-3 h-3 text-cyan-400 animate-pulse" />
                <span>Generating secure room</span>
              </div>
              <h2 className="text-2xl font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400">
                STAGING ARENA
              </h2>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-normal">
                Reserving a unique channel code, spinning up real-time listener hooks and mapping your sportcar
                configs...
              </p>
            </div>

            {/* Quick Specs visualization */}
            <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-900 flex justify-around text-left font-mono">
              <div className="flex flex-col">
                <span className="text-[8px] uppercase tracking-wider text-slate-500">Selected Car</span>
                <span className="text-[11px] font-black uppercase text-cyan-400 mt-1">{car}</span>
              </div>
              <div className="w-[1px] bg-slate-900" />
              <div className="flex flex-col">
                <span className="text-[8px] uppercase tracking-wider text-slate-500">Track Circuit</span>
                <span className="text-[11px] font-black uppercase text-blue-400 mt-1">
                  {map === "map1" ? "Map 1 (Dragon)" : "Map 2 (Coastal)"}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
