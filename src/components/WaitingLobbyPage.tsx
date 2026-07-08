import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/firestoreError";
import { NormalRoomService, NormalRoom, NormalPlayer } from "../multiplayer/NormalRoomService";
import { Compass, Users, Sparkles, Copy, Trash2, LogOut, Loader2, Play } from "lucide-react";

export const WaitingLobbyPage: React.FC = () => {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [room, setRoom] = useState<NormalRoom | null>(null);
  const [players, setPlayers] = useState<NormalPlayer[]>([]);
  const [activeMaps, setActiveMaps] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [localSecondsLeft, setLocalSecondsLeft] = useState<number | null>(null);
  const [countdownMsg, setCountdownMsg] = useState("ALL PLAYERS READY");
  const [loading, setLoading] = useState(true);

  // Load maps from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "maps"), (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const active = list.filter((m: any) => m.status !== "Disabled");
      setActiveMaps(active);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "maps");
    });
    return () => unsub();
  }, []);

  const normalizedCode = (roomCode || "").toUpperCase().trim();

  // 1. Real-time Firestore Subscriptions
  useEffect(() => {
    if (!normalizedCode) return;

    setLoading(true);
    const unsubRoom = NormalRoomService.listenToRoom(normalizedCode, (updatedRoom) => {
      setRoom(updatedRoom);
      setLoading(false);
    });

    const unsubPlayers = NormalRoomService.listenToPlayers(normalizedCode, (updatedPlayers) => {
      setPlayers(updatedPlayers);
    });

    return () => {
      unsubRoom();
      unsubPlayers();
    };
  }, [normalizedCode]);

  // 2. Automounter or Status Sync logic
  const isHost = room && profile ? room.ownerUid === profile.uid : false;

  useEffect(() => {
    if (!room) return;

    // Check if player is actually registered in the subcollection. If not, auto-join or handle gracefully
    const isPlayerIn = players.some((p) => p.uid === profile?.uid);
    if (!loading && players.length > 0 && !isPlayerIn && profile) {
      // Auto-join if user has roomCode but is not registered yet
      NormalRoomService.joinRoom(normalizedCode, profile.uid, profile.name, profile.photoURL).catch(() => {});
    }

    // Auto trigger countdown status transition when max players have successfully joined
    const maxLimit = room.maxPlayers || 3;
    if (room.status === "waiting" && players.length >= maxLimit) {
      if (isHost) {
        NormalRoomService.setRoomStatus(normalizedCode, "countdown");
      }
    }
  }, [room?.status, players.length, isHost, profile, loading, normalizedCode]);

  // 3. Local countdown ticker when status becomes 'countdown'
  useEffect(() => {
    if (!room || room.status !== "countdown") {
      setLocalSecondsLeft(null);
      return;
    }

    // Set countdown initial
    if (localSecondsLeft === null) {
      setLocalSecondsLeft(5);
    }

    const interval = setInterval(() => {
      setLocalSecondsLeft((prev) => {
        if (prev === null) return 5;
        if (prev <= 1) {
          clearInterval(interval);
          setCountdownMsg("GO!");

          // Complete transition to race scene
          setTimeout(() => {
            if (isHost) {
              NormalRoomService.setRoomStatus(normalizedCode, "racing");
            }
            navigate(`/race/${normalizedCode}`);
          }, 600);

          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [room?.status, isHost, navigate, normalizedCode]);

  // Handle client-side remote redirection to race once status is 'racing'
  useEffect(() => {
    if (room?.status === "racing") {
      navigate(`/race/${normalizedCode}`);
    }
  }, [room?.status, navigate, normalizedCode]);

  // Copy code helper
  const handleCopy = () => {
    navigator.clipboard.writeText(normalizedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Leave room triggers
  const handleLeave = async () => {
    if (!profile) return;
    try {
      await NormalRoomService.leaveOrCancelRoom(normalizedCode, profile.uid);
      navigate("/garage");
    } catch (err) {
      console.error(err);
    }
  };

  // Host dropdown modifications
  const handleMapChange = async (map: string) => {
    if (!profile) return;
    try {
      await NormalRoomService.updateRoomSettings(normalizedCode, profile.uid, { mapId: map });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCarChange = async (car: string) => {
    if (!profile) return;
    try {
      await NormalRoomService.updateRoomSettings(normalizedCode, profile.uid, { selectedCar: car });
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[85vh] flex flex-col items-center justify-center text-white space-y-4">
        <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
        <span className="text-xs tracking-widest text-slate-500 uppercase font-mono font-bold">
          Synchronizing Grid Sync...
        </span>
      </div>
    );
  }

  // If room is canceled or deleted, return back
  if (!room) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center text-white space-y-6 px-4">
        <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
          <Compass className="w-8 h-8" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-black uppercase tracking-widest text-slate-300">Room is no longer active</h3>
          <p className="text-xs text-slate-500 max-w-xs mx-auto leading-normal">
            The Host has disbanded the matched channel or connection was terminated.
          </p>
        </div>
        <button
          onClick={() => navigate("/garage")}
          className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-extrabold uppercase text-[10px] tracking-widest rounded-xl transition cursor-pointer"
        >
          Back to Garage
        </button>
      </div>
    );
  }

  return (
    <div id="room-waiting-lobby" className="w-full max-w-5xl mx-auto py-8 px-4 text-white space-y-8 flex flex-col">
      <div className="absolute w-[500px] h-[500px] bg-cyan-600/5 rounded-full blur-[140px] pointer-events-none top-10 right-10" />

      {/* HEADER CONTROLLER BANNER */}
      <div className="flex flex-col md:flex-row items-center md:items-start justify-between bg-slate-950/40 border border-slate-900/60 p-6 rounded-3xl backdrop-blur-md gap-6 select-none relative">
        <div className="space-y-2 text-center md:text-left">
          <span className="text-[9px] uppercase font-black text-cyan-400 tracking-widest bg-cyan-400/10 border border-cyan-400/20 px-3 py-1 rounded-full">
            REAL-TIME MATCH LOBBY {room.status === "countdown" ? "• COUNTDOWN" : "• WAITING"}
          </span>
          <h2 className="text-3xl font-black uppercase tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400">
            Waiting Arena
          </h2>
          <p className="text-xs text-slate-400 font-medium">
            Owner/Host: <b className="text-white">{room.ownerName}</b> &nbsp;·&nbsp; Ready up custom racing setups!
          </p>
        </div>

        {/* COPY ROOM CODE MODULE */}
        <div className="flex flex-col items-center bg-slate-950/80 p-4 border border-slate-805 rounded-2xl min-w-[220px]">
          <span className="text-[9px] font-bold text-slate-550 uppercase tracking-widest">Share Room Code</span>
          <div className="flex items-center space-x-3 mt-1.5">
            <span className="text-3xl font-black font-mono tracking-wider text-pink-500">{normalizedCode}</span>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800 text-slate-300 hover:text-white transition"
              title="Copy Room Code"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <span className="text-[9px] text-slate-500 font-mono mt-1 uppercase text-center">
            {copied ? "✓ Copy success!" : `Send code to ${room.maxPlayers || 3} friends`}
          </span>
        </div>
      </div>

      {/* CENTRAL GRID */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* LEFT COLUMN: ACTIVE PLAYER LIST */}
        <div className="md:col-span-2 bg-slate-950/40 border border-slate-900/60 p-6 rounded-3xl backdrop-blur-md space-y-4">
          <div className="flex justify-between items-center border-b border-slate-900 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Users className="w-4 h-4 text-cyan-400" />
              <span>Players Joined ({players.length} / {room.maxPlayers || 3})</span>
            </h3>
            <span className="text-[10px] font-mono text-cyan-400 font-bold">
              {players.length >= (room.maxPlayers || 3) ? "CHENG REGION SECURED" : "WAITING FOR OPPA..."}
            </span>
          </div>

          <div className="flex flex-col md:flex-row gap-3 md:space-y-0">
            {players.map((plr, idx) => {
              const isOwner = plr.uid === room.ownerUid;
              return (
                <div
                  key={plr.uid}
                  className="flex flex-row md:flex-col items-center justify-between md:justify-center p-4 rounded-2xl bg-slate-1000 border border-slate-900/80 transition md:min-h-48 md:flex-1 md:items-center gap-4"
                >
                  <div className="flex flex-row md:flex-col items-center space-x-3 md:space-x-0 md:space-y-3 text-left md:text-center w-full md:w-auto">
                    <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 overflow-hidden flex items-center justify-center text-slate-400 shrink-0 mx-auto">
                      {plr.photoURL ? (
                        <img src={plr.photoURL} alt={plr.playerName} className="w-full h-full object-cover" />
                      ) : (
                        <Compass className="w-5 h-5 text-indigo-400 rotate-45" />
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-extrabold text-white flex items-center md:justify-center space-x-1.5 md:space-x-1">
                        <span className="truncate max-w-[100px] md:max-w-none">{plr.playerName}</span>
                        {isOwner && (
                          <span className="bg-amber-500/10 text-amber-500 font-mono font-black text-[7px] tracking-wider px-1.5 py-0.5 rounded uppercase border border-amber-500/20 shrink-0">
                            Host
                          </span>
                        )}
                      </span>
                      <span className="text-[9px] font-mono text-slate-500 mt-0.5">
                        Joined:{" "}
                        {new Date(plr.joinedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>

                  <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0">
                    Ready
                  </span>
                </div>
              );
            })}

            {/* Empty placeholders to fill up slots */}
            {Array.from({ length: Math.max(0, (room.maxPlayers || 3) - players.length) }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="flex flex-row md:flex-col items-center justify-between md:justify-center p-4 rounded-2xl bg-slate-900/20 border border-dashed border-slate-905 text-slate-600 font-mono text-[10px] text-center md:min-h-48 md:flex-1 gap-4"
              >
                <span className="text-left md:text-center">
                  Waiting for slot #{players.length + i + 1} to register...
                </span>
                <span className="animate-pulse">●</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: ACTION AND CALIBRATION CONTROLLERS */}
        <div className="bg-slate-950/40 border border-slate-900/60 p-6 rounded-3xl backdrop-blur-md flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#7ee1fc] border-b border-slate-900 pb-3">
              Room Parameters
            </h3>

            {/* Custom Dropdown/Selector components */}
            <div className="space-y-4">
              {/* Map selection */}
              <div className="flex flex-col text-left space-y-1.5">
                <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">
                  Arena Track Circuit
                </span>
                {isHost ? (
                  <select
                    value={room.mapId}
                    onChange={(e) => handleMapChange(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-slate-100 font-bold text-xs p-2.5 rounded-xl outline-none cursor-pointer w-full transition"
                  >
                    {activeMaps.length > 0 ? (
                      activeMaps.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.difficulty})
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="map1">Dragon Mountain Pass (Map 1)</option>
                        <option value="map2">Coastal Sunset Circuit (Map 2)</option>
                      </>
                    )}
                  </select>
                ) : (
                  <div className="bg-slate-950 border border-slate-900 p-2.5 rounded-xl text-xs font-sans font-black text-cyan-400">
                    {activeMaps.find((m) => m.id === room.mapId)?.name || (room.mapId === "map1" ? "Dragon Mountain Pass (Map 1)" : room.mapId === "map2" ? "Coastal Sunset Circuit (Map 2)" : room.mapId === "racing2" ? "Racing 2" : room.mapId)}
                  </div>
                )}
              </div>

              {/* Car selection for the host */}
              <div className="flex flex-col text-left space-y-1.5">
                <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">
                  Host Selection Spec
                </span>
                {isHost ? (
                  <select
                    value={room.selectedCar}
                    onChange={(e) => handleCarChange(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-slate-100 font-bold text-xs p-2.5 rounded-xl outline-none cursor-pointer w-full transition"
                  >
                    <option value="ferrari">Ferrari Purosangue</option>
                    <option value="bugatti">Bugatti Chiron</option>
                    <option value="porsche">Porsche 911 GT3</option>
                  </select>
                ) : (
                  <div className="bg-slate-950 border border-slate-900 p-2.5 rounded-xl text-xs font-sans font-black text-purple-400 capitalize">
                    {room.selectedCar}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DYNAMIC TIMERS OR TRIGGER ACTIONS */}
          <div className="space-y-4">
            {room.status === "countdown" && localSecondsLeft !== null ? (
              <div className="bg-slate-950/80 border border-pink-500/40 p-4 rounded-2xl text-center space-y-1 animate-pulse">
                <span className="text-[8px] font-black uppercase tracking-widest text-pink-400">{countdownMsg}</span>
                <div className="text-4xl font-black font-mono text-white text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-rose-400">
                  {localSecondsLeft > 0 ? localSecondsLeft : "GO!"}
                </div>
                <span className="text-[8px] text-slate-500 font-mono block">AUTOMATIC ENGAGING</span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-slate-950 border border-slate-900 rounded-xl text-center">
                  <span className="text-[8px] uppercase tracking-wider text-slate-500 block">Players Joined</span>
                  <div className="text-xl font-bold text-slate-400 mt-1">{players.length} / {room.maxPlayers || 3} Joined</div>
                </div>
                {isHost && (
                  <button
                    onClick={() => {
                      NormalRoomService.setRoomStatus(normalizedCode, "countdown");
                    }}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-fuchsia-500 hover:brightness-110 text-white font-extrabold uppercase text-[10px] tracking-widest rounded-xl transition cursor-pointer flex items-center justify-center space-x-1.5 shadow-lg shadow-purple-500/20 active:scale-[0.98]"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>START THE RACE</span>
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleLeave}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-red-400 hover:text-red-300 font-bold uppercase text-[9px] tracking-widest rounded-xl transition cursor-pointer flex items-center justify-center space-x-1.5"
              >
                {isHost ? (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>CANCEL ROOM</span>
                  </>
                ) : (
                  <>
                    <LogOut className="w-3.5 h-3.5" />
                    <span>LEAVE ROOM</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
