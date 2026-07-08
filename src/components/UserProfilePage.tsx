import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { User, Shield, Key, Compass, Camera, Sparkles, CheckCircle } from "lucide-react";
import { motion } from "motion/react";

export const UserProfilePage: React.FC = () => {
  const { profile, setProfileField } = useAuth();
  const [name, setName] = useState(profile?.name || "");
  const [photoURL, setPhotoURL] = useState(profile?.photoURL || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setSaved(false);
    try {
      await setProfileField("name", name.trim());
      await setProfileField("photoURL", photoURL.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const getRoleTheme = () => {
    if (!profile) return { text: "text-slate-400", bg: "bg-slate-900 border-slate-800", label: "Racer" };
    if (profile.role === "admin")
      return { text: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20", label: "Admin Access" };
    if (profile.role === "broadcaster")
      return { text: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20", label: "Broadcaster Tier" };
    return { text: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20", label: "Pro Racer" };
  };

  const theme = getRoleTheme();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tight">Racer Profile ID</h2>
        <p className="text-xs text-slate-400 mt-1">Configure your competitive driver nickname and custom credentials</p>
      </div>

      <div className="bg-slate-950/60 p-6 sm:p-8 rounded-3xl border border-slate-900/80 space-y-6">
        <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-6 pb-6 border-b border-slate-900/60">
          <div className="relative group">
            <img
              src={
                photoURL ||
                "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
              }
              alt="Avatar Profile"
              className="w-20 h-20 rounded-full object-cover bg-slate-800 border-2 border-slate-800"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-black/60 rounded-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
              <Camera className="w-5 h-5 text-white" />
            </div>
          </div>

          <div className="text-center sm:text-left space-y-1.5 flex-1">
            <h3 className="text-lg font-black text-white uppercase tracking-tight">{profile?.name}</h3>
            <span className="text-xs text-slate-405 block">{profile?.email}</span>
            <div className="flex justify-center sm:justify-start pt-1.5">
              <span
                className={`px-3 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${theme.bg}`}
              >
                {theme.label}
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-[8.5px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
              DRIVER NICKNAME (visible in lobbies)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-800 rounded-2xl p-3.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold"
              placeholder="e.g. Apex_Speed"
              maxLength={20}
              required
            />
          </div>

          <div>
            <label className="block text-[8.5px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
              AVATAR IMAGE URL
            </label>
            <input
              type="url"
              value={photoURL}
              onChange={(e) => setPhotoURL(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-800 rounded-2xl p-3.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
              placeholder="https://images.unsplash.com/..."
            />
          </div>

          <div className="flex items-center space-x-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-indigo-650 hover:bg-indigo-600 text-white font-black uppercase text-[10px] tracking-widest rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              {saving ? "Updating..." : "SAVE CHANGES"}
            </button>
            {saved && (
              <span className="text-emerald-400 text-xs font-bold flex items-center space-x-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span>Racer profile synchronized with firestore cluster!</span>
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
