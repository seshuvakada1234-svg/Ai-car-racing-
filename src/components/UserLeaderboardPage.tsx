import React, { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, onSnapshot, query, limit, getDocs } from "firebase/firestore";
import { Trophy, Compass, Sparkles, Star, Shield, ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import { handleFirestoreError, OperationType } from "../lib/firestoreError";

export const UserLeaderboardPage: React.FC = () => {
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Queries firestore leaderboards collection
    const q = query(collection(db, "leaderboards"), limit(50));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as any);
        // Sort client-side if no direct indexes are created yet
        list.sort((a, b) => (b.topSpeed || 0) - (a.topSpeed || 0));
        setLeaderboard(list);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "leaderboards");
      },
    );
    return () => unsubscribe();
  }, []);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tight flex items-center space-x-2">
          <Trophy className="w-6 h-6 text-amber-400 fill-current" />
          <span>Global Speed Standings</span>
        </h2>
        <p className="text-xs text-slate-400 mt-1">Review the all-time high speed scores from racers worldwide</p>
      </div>

      <div className="bg-slate-950/60 rounded-3xl border border-slate-900 overflow-hidden shadow-2xl">
        <div className="p-6 bg-slate-950/40 border-b border-slate-900/60 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#00f2ffa5] flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>Top Speeds Leaderboard</span>
          </h3>
          <span className="text-[10px] text-indigo-400 font-black uppercase tracking-wider">AUTO REFRESHING LIVE</span>
        </div>

        {leaderboard.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <Trophy className="w-12 h-12 text-slate-700 mx-auto" />
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-500">Grid is Stimm</h4>
            <p className="text-[10px] text-slate-600 max-w-xs mx-auto">
              No telemetry lists recorded inside highscore logs yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-900/60 bg-slate-950/20 text-[10.5px] font-black uppercase tracking-wider text-slate-500 font-mono">
                  <th className="p-4 pl-6 w-16 text-center">Rank</th>
                  <th className="p-4">Driver Racer</th>
                  <th className="p-4">Chassis Spec</th>
                  <th className="p-4">Session Date</th>
                  <th className="p-4 pr-6 text-right">Top Velocity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/30">
                {leaderboard.map((item, idx) => {
                  const date = item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString() : "Active Session";

                  // Top 3 medals styles
                  const getMedalStyle = (rank: number) => {
                    if (rank === 0) return "bg-amber-400/10 border-amber-400/20 text-amber-400";
                    if (rank === 1) return "bg-slate-300/10 border-slate-300/20 text-slate-300";
                    if (rank === 2) return "bg-amber-600/10 border-amber-600/20 text-amber-650";
                    return "bg-slate-900 border-slate-800 text-slate-405";
                  };

                  return (
                    <tr key={item.id || idx} className="hover:bg-slate-900/20 transition-colors">
                      <td className="p-4 pl-6 text-center">
                        <span
                          className={`w-8 h-8 rounded-full border inline-flex items-center justify-center font-mono font-black text-xs ${getMedalStyle(idx)}`}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="font-black text-xs text-white uppercase tracking-wider">
                          {item.playerName || "Racer Anonymous"}
                        </div>
                      </td>
                      <td className="p-4 text-xs font-semibold text-slate-400 uppercase font-mono">
                        {item.selectedCar || "ferrari"}
                      </td>
                      <td className="p-4 text-[10.5px] text-slate-500 uppercase font-mono">{date}</td>
                      <td className="p-4 pr-6 text-right">
                        <div>
                          <span className="text-xs font-black text-cyan-400 font-mono tracking-wide">
                            {item.topSpeed || 320} <span className="text-[9px] font-normal text-slate-500">KM/H</span>
                          </span>
                          <span className="text-[8px] text-emerald-400 font-black flex items-center justify-end space-x-0.5 uppercase mt-0.5">
                            <ArrowUp className="w-2.5 h-2.5 shrink-0" />
                            <span>RECORD</span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
