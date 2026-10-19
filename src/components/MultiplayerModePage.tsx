import React from "react";
import { useNavigate } from "react-router-dom";
import { Wifi, Globe2, ArrowRight } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export const MultiplayerModePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const goOnline = () => {
    if (user && profile) {
      navigate("/rooms");
      return;
    }
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-8 md:px-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight">Multiplayer Mode</h1>
          <p className="text-sm text-slate-400">
            Choose your session type. Online mode keeps your existing cloud multiplayer flow. Offline LAN mode runs only
            inside your local network.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <button
            onClick={goOnline}
            className="text-left p-6 rounded-3xl border border-cyan-500/30 bg-cyan-950/10 hover:bg-cyan-900/20 transition cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <Globe2 className="w-7 h-7 text-cyan-300" />
              <ArrowRight className="w-5 h-5 text-cyan-200" />
            </div>
            <h2 className="mt-5 text-xl font-black">Online Multiplayer</h2>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
              Existing cloud-backed matchmaking and race sync. Uses your current authentication and online room services.
            </p>
          </button>

          <button
            onClick={() => navigate("/lan")}
            className="text-left p-6 rounded-3xl border border-emerald-500/30 bg-emerald-950/10 hover:bg-emerald-900/20 transition cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <Wifi className="w-7 h-7 text-emerald-300" />
              <ArrowRight className="w-5 h-5 text-emerald-200" />
            </div>
            <h2 className="mt-5 text-xl font-black">Offline LAN Multiplayer</h2>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
              Host races on a Windows machine and connect from nearby devices over Wi-Fi or mobile hotspot without cloud
              dependencies.
            </p>
          </button>
        </div>

        <div>
          <button
            onClick={() => navigate(user && profile ? "/garage" : "/login")}
            className="px-4 py-2 rounded-xl border border-slate-700 text-xs font-bold tracking-wide uppercase text-slate-300 hover:text-white hover:border-slate-500 transition cursor-pointer"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
};
