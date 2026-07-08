/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { CarState } from "../types";
import { Award, RotateCcw, Home, Clock, Sparkles } from "lucide-react";

interface GameOverProps {
  player: CarState;
  opponents: CarState[];
  elapsedTime: number;
  onRestart: () => void;
  onHome: () => void;
  onNextRace?: () => void;
}

export const GameOver: React.FC<GameOverProps> = ({
  player,
  opponents,
  elapsedTime,
  onRestart,
  onHome,
  onNextRace,
}) => {
  // Rank by: (1) finished cars first, ordered by finishTime; then (2) unfinished
  // cars by distance covered. racePosition is used only as a final tiebreaker.
  const fullLeaderboard = [player, ...opponents].slice().sort((a, b) => {
    const aFin = a.isFinished, bFin = b.isFinished;
    if (aFin && !bFin) return -1;
    if (!aFin && bFin) return 1;
    if (aFin && bFin) {
      const at = a.finishTime ?? Number.POSITIVE_INFINITY;
      const bt = b.finishTime ?? Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
    } else {
      const ad = a.totalDistanceTraveled ?? 0;
      const bd = b.totalDistanceTraveled ?? 0;
      if (ad !== bd) return bd - ad;
    }
    return (a.racePosition ?? 99) - (b.racePosition ?? 99);
  });
  // Reassign display positions from the sort so 1..N is authoritative here.
  fullLeaderboard.forEach((c, i) => { (c as any)._displayPos = i + 1; });

  const winner = fullLeaderboard[0];
  const playerRank = (player as any)._displayPos ?? player.racePosition;
  const isVictory = playerRank === 1;

  // Format race timers helper
  const formatTime = (timeSec: number) => {
    if (!isFinite(timeSec) || timeSec <= 0) return "--:--.--";
    const mins = Math.floor(timeSec / 60);
    const secs = Math.floor(timeSec % 60);
    const centis = Math.floor((timeSec % 1) * 100);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${centis.toString().padStart(2, "0")}`;
  };

  return (
    <div
      id="game-over"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/95 text-white font-sans overflow-y-auto p-4 md:p-8"
    >
      {/* Background cinematic visuals spacer / glow card */}
      <div
        className={`absolute w-[360px] h-[360px] rounded-full blur-[110px] pointer-events-none ${isVictory ? "bg-amber-500/10" : "bg-rose-500/10"}`}
      />

      <div className="relative w-full max-w-md p-6 rounded-3xl bg-slate-900 border border-slate-800/80 backdrop-blur-md shadow-2xl text-center space-y-6">
        {/* Banner Headers (Victory vs Defeat badges) */}
        <div className="space-y-2">
          <div className="inline-flex justify-center mx-auto p-4 rounded-full bg-slate-950/80 border border-slate-800 shadow-inner">
            <Award
              className={`w-12 h-12 ${isVictory ? "text-amber-400 fill-current animate-pulse" : "text-slate-400"}`}
            />
          </div>

          <h2 className="text-3xl font-black tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400">
            {isVictory ? "Victory Podium!" : "Race Complete!"}
          </h2>

          <p className="text-xs text-slate-400 font-medium">
            {isVictory
              ? `${winner.name} took the checkered flag after 3 laps!`
              : `${winner.name} won — you finished ${playerRank}${playerRank === 2 ? "nd" : playerRank === 3 ? "rd" : "th"}.`}
          </p>

          {/* Winner banner — first to cross Finish after all 3 laps */}
          <div className="mt-3 mx-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-amber-500/20 via-amber-400/15 to-amber-500/20 border border-amber-400/40">
            <Award className="w-4 h-4 text-amber-300 fill-current" />
            <span className="text-[10px] uppercase tracking-widest font-black text-amber-200">Winner</span>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: winner.color }} />
            <span className="text-xs font-extrabold text-white">{winner.name}</span>
            {winner.isFinished && winner.finishTime !== undefined && (
              <span className="text-[10px] font-mono text-amber-100/90">{formatTime(winner.finishTime)}</span>
            )}
          </div>
        </div>

        {/* Dynamic Race timing box */}
        <div className="flex border border-slate-800 rounded-2xl bg-slate-950/65 divide-x divide-slate-800 text-left">
          <div className="flex-1 p-4 flex flex-col justify-center">
            <span className="text-[9px] uppercase font-bold tracking-widest text-[#00f2ffa5] flex items-center space-x-1">
              <Clock className="w-3 h-3 text-[#00f2ffa5]" />
              <span>Your Total Time</span>
            </span>
            <span className="text-xl font-mono font-bold mt-1 text-teal-300">{formatTime(elapsedTime)}</span>
          </div>

          <div className="flex-1 p-4 flex flex-col justify-center">
            <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400 flex items-center space-x-1">
              <Sparkles className="w-3 h-3 text-slate-400" />
              <span>Race Class</span>
            </span>
            <span className="text-sm font-extrabold uppercase mt-1.5 text-slate-200">
              {player.difficulty || "Normal"} AI
            </span>
          </div>
        </div>

        {/* Global Standings list */}
        <div className="text-left space-y-1.5">
          <h3 className="text-[10px] uppercase font-extrabold tracking-widest text-slate-400 px-1">
            Official Lineup Rankings
          </h3>

          <div className="flex flex-col space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {fullLeaderboard.map((car) => {
              const isPlayer = car.id === "player";
              const pos = (car as any)._displayPos as number;
              const timeLabel = car.isFinished && car.finishTime !== undefined
                ? formatTime(car.finishTime)
                : `Lap ${Math.max(1, car.currentLap ?? 1)}/3`;
              return (
                <div
                  key={car.id}
                  className={`flex items-center justify-between p-2.5 rounded-xl border transition-all duration-150 ${
                    isPlayer ? "bg-blue-600/20 border-blue-500/50 shadow-inner" : "bg-slate-950 border-slate-800"
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                        pos === 1
                          ? "bg-amber-400 text-amber-950"
                          : pos === 2
                            ? "bg-slate-300 text-slate-900"
                            : pos === 3
                              ? "bg-amber-700/80 text-amber-50"
                              : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {pos}
                    </span>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: car.color }} />
                    <span className={`text-xs ${isPlayer ? "font-black text-white" : "font-medium text-slate-300"}`}>
                      {car.name} {isPlayer && "(You)"}
                    </span>
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase font-mono tracking-wider bg-slate-900 border border-slate-800 text-slate-400">
                      {isPlayer || car.id.startsWith("remote_") ? "HUMAN" : "AI"}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] font-mono font-bold tracking-wider ${
                      car.isFinished ? "text-amber-300" : "text-slate-500"
                    }`}
                    title={car.isFinished ? "Finish time" : "Race ended before this car finished"}
                  >
                    {timeLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Buttons Action items */}
        <div className="flex flex-col space-y-2.5 pt-2">
          {onNextRace && (
            <button
              onClick={onNextRace}
              className="w-full bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-600 hover:brightness-105 text-white font-extrabold uppercase text-xs tracking-widest py-4 rounded-xl border border-cyan-400/25 shadow-lg shadow-cyan-500/10 transition duration-150 flex items-center justify-center space-x-2 cursor-pointer"
            >
              <Award className="w-4 h-4 text-white fill-current animate-bounce" />
              <span>Continue to Next Track</span>
            </button>
          )}

          <div className="flex space-x-3">
            <button
              onClick={onHome}
              className="flex-1 bg-slate-950 hover:bg-slate-850 text-slate-300 font-bold uppercase text-xs tracking-wider py-3.5 rounded-xl border border-slate-800 transition duration-150 flex items-center justify-center space-x-2 cursor-pointer"
            >
              <Home className="w-4 h-4" />
              <span>Garage Menu</span>
            </button>

            <button
              onClick={onRestart}
              className="flex-1 bg-slate-900 hover:bg-slate-800 text-slate-250 font-bold uppercase text-xs tracking-widest py-3.5 rounded-xl border border-slate-800 transition duration-150 flex items-center justify-center space-x-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retry Race</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
