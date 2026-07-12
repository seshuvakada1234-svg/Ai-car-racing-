// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { useAuth } from "../contexts/AuthContext";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/firestoreError";
import { Difficulty, GameSettings } from "../types";
import {
  Zap,
  Trophy,
  HelpCircle,
  Sparkles,
  Download,
  CheckCircle,
  AlertOctagon,
  Users,
  Radio,
  Key,
  Coins,
  Gem,
  Car,
  ArrowLeft,
  Plus,
  Paintbrush,
  Wrench,
  Play,
  X,
  Compass,
  ChevronRight,
  Star,
  Heart,
  Gauge,
  ShieldCheck,
  Gamepad2,
  Settings,
  LogOut,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { loadSpecificCarModel, gltfModelCache, setPlayerSelectedModelKey } from "../world/procedural";
import { NormalRoomService, NormalRoom, NormalPlayer } from "../multiplayer/NormalRoomService";
import { RoomCodeGenerator } from "../multiplayer/RoomCodeGenerator";

// Preview frames
import bugattiPreview from "../assets/images/bugatti_garage_1781251768295.jpg";
const ferrariPreview = bugattiPreview;
const porschePreview = bugattiPreview;

interface MenuProps {
  onStartGame: (settings: GameSettings) => void;
  onCreateRoom?: (settings: GameSettings, isLiveMode?: boolean) => void;
  onJoinRoom?: (settings: GameSettings) => void;
}

const CARS_GARAGE = [
  {
    id: "ferrari" as const,
    name: "Ferrari Purosangue",
    image: ferrariPreview,
    class: "A CLASS",
    topSpeed: 310,
    acceleration: "3.3s",
    handling: 90,
    power: "715 HP",
    stars: 4,
    xp: 41,
    oil: 40,
    engine: 85,
    chassis: 95,
    desc: "Supreme active-suspension SUV utilities delivering unmatched active stability.",
    colorPreset: "#ff003c",
    scale: 0.85,
  },
  {
    id: "bugatti" as const,
    name: "Bugatti Chiron",
    image: bugattiPreview,
    class: "HYPER CLASS",
    topSpeed: 420,
    acceleration: "2.4s",
    handling: 80,
    power: "1500 HP",
    stars: 5,
    xp: 95,
    oil: 15,
    engine: 95,
    chassis: 85,
    desc: "Unmatched continuous speed powered by a monstrous quad-turbo W16.",
    colorPreset: "#00ccff",
    scale: 0.82,
  },
  {
    id: "porsche" as const,
    name: "Porsche 911 GT3",
    image: porschePreview,
    class: "A CLASS",
    topSpeed: 320,
    acceleration: "3.2s",
    handling: 98,
    power: "502 HP",
    stars: 5,
    xp: 68,
    oil: 92,
    engine: 92,
    chassis: 60,
    desc: "Surgeon-like track precision crafted directly from pure GT motorsport heritage.",
    colorPreset: "#00ff3c",
    scale: 0.85,
  },
];

const MAPS_LIST = [
  { id: "racing2", name: "Racing 2", distance: "Custom GLB", icon: "🏁", gradient: "from-rose-500 via-red-700 to-zinc-950" },
  { id: "map1", name: "Dragon Forest", distance: "10 KM", icon: "🌲", gradient: "from-emerald-700 via-green-800 to-emerald-950" },
  { id: "map2", name: "Coastal Highway", distance: "10 KM", icon: "🌊", gradient: "from-cyan-600 via-sky-700 to-blue-950" },
  { id: "map3", name: "Desert Storm", distance: "10 KM", icon: "🏜️", gradient: "from-amber-500 via-orange-700 to-red-950" },
  { id: "map4", name: "Snow Valley", distance: "10 KM", icon: "❄️", gradient: "from-slate-200 via-sky-400 to-indigo-900" },
  { id: "map5", name: "Night City", distance: "10 KM", icon: "🌃", gradient: "from-fuchsia-700 via-purple-900 to-slate-950" },
  { id: "map6", name: "Mountain Pass", distance: "10 KM", icon: "⛰️", gradient: "from-stone-500 via-slate-700 to-zinc-950" },
];

const METALLIC_COLORS = [
  { name: "Rosso Red", hex: "#ff003c" },
  { name: "Nitro Green", hex: "#00ff3c" },
  { name: "Hyper Blue", hex: "#00ccff" },
  { name: "Giallo Yellow", hex: "#ffe600" },
  { name: "Viper Purple", hex: "#ab00ff" },
  { name: "Carbon Matte", hex: "#111111" },
  { name: "Titanium White", hex: "#f0f3ff" },
];

export const Menu: React.FC<MenuProps> = ({ onStartGame, onCreateRoom, onJoinRoom }) => {
  const { profile, logout, setProfileField } = useAuth();
  const navigate = useNavigate();

  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);

  // Selected vehicle settings
  const [selectedCar, setSelectedCar] = useState<"ferrari" | "bugatti" | "porsche">("ferrari");
  const [carColor, setCarColor] = useState("#ff003c");
  const [selectedMap, setSelectedMap] = useState<string>("racing2");
  const [availableMaps, setAvailableMaps] = useState<any[]>([]);
  const [playerName, setPlayerName] = useState(profile?.name || "Speedster");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "maps"), (snap) => {
      const dbMaps = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const activeDbMaps = dbMaps.filter((m: any) => m.status !== "Disabled");
      
      const mergedMaps = activeDbMaps.map((m: any) => {
        const style = MAPS_LIST.find((item) => item.id === m.id) || {
          distance: "10 KM",
          icon: "🏁",
          gradient: "from-indigo-600 via-blue-700 to-slate-950"
        };
        return {
          id: m.id,
          name: m.name,
          distance: style.distance,
          icon: style.icon,
          gradient: style.gradient,
          status: m.status || "Active"
        };
      });

      if (mergedMaps.length > 0) {
        setAvailableMaps(mergedMaps);
        if (mergedMaps.some(item => item.id === "racing2")) {
          // Keep racing2
        } else if (!mergedMaps.some(item => item.id === selectedMap)) {
          setSelectedMap(mergedMaps[0].id);
        }
      } else {
        setAvailableMaps(MAPS_LIST);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "maps");
    });
    return () => unsub();
  }, [selectedMap]);
  const [difficulty, setDifficulty] = useState<Difficulty>("hard");
  const [weather, setWeather] = useState<"sunny" | "rain" | "fog" | "snow">("sunny");
  const [timeOfDay, setTimeOfDay] = useState<"morning" | "noon" | "sunset" | "night">("morning");
  const [aiCount, setAiCount] = useState<number>(7);
  const [isLiveMode, setIsLiveMode] = useState(false);

  // Asset prepares status
  const [loadStatus, setLoadStatus] = useState<"idle" | "downloading" | "ready" | "failed">("idle");
  const [progress, setProgress] = useState(0);

  // Maintenance Restore State
  const [showMaintenanceSplash, setShowMaintenanceSplash] = useState(false);
  const [maintenanceLevels, setMaintenanceLevels] = useState<{ oil: number; engine: number; chassis: number }>({
    oil: 95,
    engine: 90,
    chassis: 75,
  });

  // Currency HUD state — sourced from profile, persisted to Firestore
  const trophicCount = profile?.trophies ?? 2450;
  const coinCount = profile?.coins ?? 18250;
  const keyCount = profile?.keys ?? 12;
  const [diamondCount, setDiamondCount] = useState(450);

  // Toggle HUD sub-menus to prevent vertical side panel clutter
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [presetsPanelOpen, setPresetsPanelOpen] = useState(false);

  // Matchmaker state HUD
  const [activePopup, setActivePopup] = useState<"none" | "create_room" | "join_room" | "lobby">("none");
  const [createdRoomName, setCreatedRoomName] = useState(`${playerName}'s Grid`);
  const [generatedCode, setGeneratedCode] = useState("");
  const [enteredJoinCode, setEnteredJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [maxPlayers, setMaxPlayers] = useState<number>(3);

  // Matchmaking real-time variables
  const [syncedRoom, setSyncedRoom] = useState<NormalRoom | null>(null);
  const [syncedPlayers, setSyncedPlayers] = useState<NormalPlayer[]>([]);
  const [countdownMsg, setCountdownMsg] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // WebGL Showroom rendering refs
  const showroomCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const carGroupRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  const currentVehicleMetadata = CARS_GARAGE.find((c) => c.id === selectedCar)!;

  // Sync color & performance specs on select
  useEffect(() => {
    setCarColor(currentVehicleMetadata.colorPreset);
    setMaintenanceLevels({
      oil: currentVehicleMetadata.oil,
      engine: currentVehicleMetadata.engine,
      chassis: currentVehicleMetadata.chassis,
    });
  }, [selectedCar]);

  // ============================================================
  // Mobile / small-viewport "fit-to-screen" scaling shell.
  // When the viewport is smaller than the desktop design size,
  // we force the desktop layout (via the `gd:` variant trigger)
  // and uniformly scale the whole UI to fit, like a console UI.
  // ============================================================
  useEffect(() => {
    // Wider design box than the visible 1366 so panels sit closer to the screen
    // edges on landscape phones (reduces empty left/right gutters by ~15-20%).
    const DESIGN_W = 1600;
    const DESIGN_H = 768;
    const html = document.documentElement;

    const apply = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const root = containerRef.current;
      if (!root) return;

      // True desktop: clear everything, let normal layout run.
      if (vw >= 1024 && vh >= 640) {
        html.classList.remove("force-garage-desktop");
        root.style.cssText = "";
        return;
      }

      // Small viewport: activate gd: utilities and scale to fit.
      html.classList.add("force-garage-desktop");
      const fit = Math.min(vw / DESIGN_W, vh / DESIGN_H);
      // Mild horizontal stretch (up to 12%) to eat residual side margins
      // without distorting the car (car lives in a separate full-screen canvas).
      const scaleY = fit;
      const scaleX = Math.min(fit * 1.12, vw / DESIGN_W);
      const scaledW = DESIGN_W * scaleX;
      const scaledH = DESIGN_H * scaleY;
      const offsetX = Math.max(0, (vw - scaledW) / 2);
      const offsetY = Math.max(0, (vh - scaledH) / 2);

      root.style.position = "fixed";
      root.style.top = "0";
      root.style.left = "0";
      root.style.width = `${DESIGN_W}px`;
      root.style.height = `${DESIGN_H}px`;
      root.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`;
      root.style.transformOrigin = "top left";
      root.style.overflow = "hidden";
      root.style.maxWidth = "none";
    };


    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      html.classList.remove("force-garage-desktop");
      if (containerRef.current) containerRef.current.style.cssText = "";
    };
  }, []);



  // Live download preloader
  useEffect(() => {
    let isCancelled = false;
    const triggerPreload = async () => {
      try {
        await loadSpecificCarModel(selectedCar, () => {});
        if (isCancelled) return;
        rebuildShowroomCar();
      } catch (err) {
        console.error("3D Showroom failing:", err);
      }
    };
    triggerPreload();
    return () => {
      isCancelled = true;
    };
  }, [selectedCar]);

  // ThreeJS Showroom scene pipeline
  useEffect(() => {
    if (!showroomCanvasRef.current) return;

    let animFrame: number;
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    scene.background = new THREE.Color("#010205");
    scene.fog = new THREE.FogExp2("#010205", 0.08);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.75, 4.8);

    const renderer = new THREE.WebGLRenderer({
      canvas: showroomCanvasRef.current,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const resizeHandler = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resizeHandler();
    window.addEventListener("resize", resizeHandler);

    // Reflective Metallic Flooring
    const floorGeo = new THREE.PlaneGeometry(50, 50);
    const floorMat = new THREE.MeshStandardMaterial({
      color: "#040712",
      roughness: 0.1,
      metalness: 0.95,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    scene.add(floor);

    // Neon Cyber Grid
    const gridHelper = new THREE.GridHelper(40, 40, "#00f2ff", "#121b3a");
    gridHelper.position.y = -0.11;
    (gridHelper.material as any).opacity = 0.14;
    (gridHelper.material as any).transparent = true;
    scene.add(gridHelper);

    // Standing Glow Tubes
    const neonMatCyan = new THREE.MeshBasicMaterial({ color: "#00f2ff" });
    const neonMatBlue = new THREE.MeshBasicMaterial({ color: "#0033ff" });
    const tubeGeo = new THREE.CylinderGeometry(0.015, 0.015, 6, 8);

    const tube1 = new THREE.Mesh(tubeGeo, neonMatCyan);
    tube1.position.set(-3.5, 2.5, -3.0);
    scene.add(tube1);

    const tube2 = new THREE.Mesh(tubeGeo, neonMatBlue);
    tube2.position.set(3.5, 2.5, -3.0);
    scene.add(tube2);

    const tube3 = new THREE.Mesh(tubeGeo, neonMatCyan);
    tube3.position.set(-4.5, 2.5, 1.0);
    scene.add(tube3);

    const tube4 = new THREE.Mesh(tubeGeo, neonMatBlue);
    tube4.position.set(4.5, 2.5, 1.0);
    scene.add(tube4);

    const rLightLeft = new THREE.PointLight("#00f2ff", 5.0, 15);
    rLightLeft.position.set(-3.5, 1.2, -1.0);
    scene.add(rLightLeft);

    const rLightRight = new THREE.PointLight("#0033ff", 5.0, 15);
    rLightRight.position.set(3.5, 1.2, -1.0);
    scene.add(rLightRight);

    const ambientLight = new THREE.AmbientLight("#080d1e", 1.4);
    scene.add(ambientLight);

    const mainSpot = new THREE.SpotLight("#ffffff", 18.0, 15, Math.PI / 4, 0.4, 1.0);
    mainSpot.position.set(0, 4.2, 1.8);
    mainSpot.castShadow = true;
    mainSpot.shadow.bias = -0.0002;
    mainSpot.shadow.mapSize.width = 1024;
    mainSpot.shadow.mapSize.height = 1024;
    scene.add(mainSpot);

    const backSpot = new THREE.DirectionalLight("#00f2ff", 2.5);
    backSpot.position.set(0, 2.5, -4.5);
    scene.add(backSpot);

    // Stardust Sparkles
    const particleCount = 100;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 10.0;
      positions[i * 3 + 1] = Math.random() * 4.0;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10.0;
    }
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: "#00f2ff",
      size: 0.02,
      transparent: true,
      opacity: 0.5,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Low angle rotation orbit
    let angle = 0;
    const renderLoop = () => {
      animFrame = requestAnimationFrame(renderLoop);
      angle += 0.0018;
      camera.position.x = 4.4 * Math.cos(angle);
      camera.position.z = 4.4 * Math.sin(angle);
      camera.lookAt(0, 0.2, 0);

      particles.rotation.y += 0.0008;
      renderer.render(scene, camera);
    };
    animFrame = requestAnimationFrame(renderLoop);

    return () => {
      window.removeEventListener("resize", resizeHandler);
      cancelAnimationFrame(animFrame);
      renderer.dispose();
    };
  }, []);

  // Sync paint color swaps immediately
  useEffect(() => {
    if (!carGroupRef.current) return;
    updateMaterialColors(carGroupRef.current, carColor);
  }, [carColor]);

  const updateMaterialColors = (model: THREE.Group, hex: string) => {
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const name = child.name.toLowerCase();
        if (
          name.includes("paint") ||
          name.includes("body") ||
          name.includes("car_paint") ||
          child.material.name?.toLowerCase().includes("paint") ||
          child.material.name?.toLowerCase().includes("car_paint") ||
          (child.material instanceof THREE.MeshStandardMaterial &&
            child.material.roughness < 0.15 &&
            child.material.metalness > 0.8)
        ) {
          if (child.material instanceof THREE.Material && "color" in child.material) {
            (child.material as any).color.set(hex);
          }
        }
      }
    });
  };

  const rebuildShowroomCar = () => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (carGroupRef.current) {
      scene.remove(carGroupRef.current);
      carGroupRef.current = null;
    }

    const modelKey =
      selectedCar === "ferrari"
        ? "ferrari_purosangue"
        : selectedCar === "bugatti"
          ? "bugatti_chiron_top_edition"
          : "porsche_911_gt3";

    const baseModel = gltfModelCache[modelKey];
    if (baseModel) {
      const cloned = baseModel.clone();
      cloned.position.set(0, -0.06, 0);
      cloned.rotation.y = 0;

      const s = currentVehicleMetadata.scale;
      cloned.scale.set(s, s, s);

      // Deep-clone materials per instance so colour swaps on the showroom car
      // never mutate the cached source group shared across cars.
      cloned.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (Array.isArray(c.material)) {
            c.material = c.material.map((m) => (m ? m.clone() : m));
          } else if (c.material) {
            c.material = c.material.clone();
          }
        }
      });

      updateMaterialColors(cloned, carColor);
      scene.add(cloned);
      carGroupRef.current = cloned;
    }
  };

  const handleStartProcess = async (action: "single" | "create" | "join") => {
    setLoadStatus("downloading");
    setProgress(0);

    try {
      await loadSpecificCarModel(selectedCar, (pct) => {
        setProgress(pct);
      });

      setProgress(100);
      setLoadStatus("ready");

      setTimeout(() => {
        const payload: GameSettings = {
          playerName: playerName.trim() || "Racer",
          difficulty,
          carColor,
          selectedCar,
          selectedMap,
        };

        const modelKey =
          selectedCar === "ferrari"
            ? "ferrari_purosangue"
            : selectedCar === "bugatti"
              ? "bugatti_chiron_top_edition"
              : "porsche_911_gt3";
        setPlayerSelectedModelKey(modelKey);

        if (action === "single") {
          onStartGame(payload);
          navigate("/race");
        }
      }, 1000);
    } catch (err) {
      console.error("Showroom loading errored:", err);
      setLoadStatus("failed");
    }
  };

  const handleCreateRoomClick = () => {
    const code = RoomCodeGenerator.generate();
    setGeneratedCode(code.toUpperCase());
    setCreatedRoomName(`${playerName}'s Grid`);
    setMaxPlayers(3);
    setActivePopup("create_room");
  };

  const handleConfirmCreateRoom = async () => {
    if (!profile) return;
    try {
      const finalCode = await NormalRoomService.createRoom(
        profile.uid,
        playerName || "Racer",
        profile.photoURL || "",
        selectedCar,
        "race2map",
        maxPlayers,
      );
      navigate(`/room/${finalCode}`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleJoinRoomClick = () => {
    setEnteredJoinCode("");
    setJoinError(null);
    setActivePopup("join_room");
  };

  const handleConfirmJoinRoom = async () => {
    if (!profile) return;
    const cleanCode = enteredJoinCode.trim().toUpperCase();
    if (cleanCode.length < 4) {
      setJoinError("Enter a valid room code!");
      return;
    }

    try {
      await NormalRoomService.joinRoom(cleanCode, profile.uid, playerName || "Racer", profile.photoURL || "");
      navigate(`/room/${cleanCode}`);
    } catch (err: any) {
      setJoinError(err.message || "Lobby full or invalid code.");
    }
  };

  const subscribeToRoomListeners = (code: string) => {
    const cleanCode = code.toUpperCase().trim();
    setGeneratedCode(cleanCode);

    const unsubRoom = NormalRoomService.listenToRoom(cleanCode, (room) => {
      if (!room) {
        setActivePopup("none");
        return;
      }
      setSyncedRoom(room);
      if (room.status === "racing") {
        navigate(`/race/${cleanCode}`);
      }
    });

    const unsubPlayers = NormalRoomService.listenToPlayers(cleanCode, (players) => {
      setSyncedPlayers(players);
    });

    (window as any).activeRoomUnsubscribers = [unsubRoom, unsubPlayers];
  };

  const cleanRoomListeners = () => {
    if ((window as any).activeRoomUnsubscribers) {
      (window as any).activeRoomUnsubscribers.forEach((fn: any) => fn());
      (window as any).activeRoomUnsubscribers = null;
    }
  };

  const handleLeaveLobby = async () => {
    if (!profile || !generatedCode) return;
    try {
      cleanRoomListeners();
      await NormalRoomService.leaveOrCancelRoom(generatedCode, profile.uid);
      setActivePopup("none");
      setSyncedRoom(null);
      setSyncedPlayers([]);
      setSecondsLeft(null);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!syncedRoom || syncedRoom.status !== "countdown") {
      setSecondsLeft(null);
      return;
    }
    if (secondsLeft === null) setSecondsLeft(5);

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null) return 5;
        if (prev <= 1) {
          clearInterval(interval);
          setCountdownMsg("GO!");
          setTimeout(() => {
            const isHost = syncedRoom && profile ? syncedRoom.ownerUid === profile.uid : false;
            if (isHost) {
              NormalRoomService.setRoomStatus(generatedCode, "racing");
            }
            navigate(`/race/${generatedCode}`);
          }, 800);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [syncedRoom?.status, secondsLeft]);

  const handleRestoreMaintenance = () => {
    setShowMaintenanceSplash(true);
    setMaintenanceLevels({ oil: 100, engine: 100, chassis: 100 });
    setTimeout(() => {
      setShowMaintenanceSplash(false);
    }, 1200);
  };

  const handleResourceAdd = (type: "trophy" | "key" | "coin" | "diamond") => {
    if (type === "trophy") setProfileField("trophies", trophicCount + 50);
    if (type === "key") setProfileField("keys", keyCount + 1);
    if (type === "coin") setProfileField("coins", coinCount + 1000);
    if (type === "diamond") setDiamondCount((prev) => prev + 100);
  };

  return (
    <div
      ref={containerRef}
      id="game-garage-root"
      className="relative w-full min-h-[100dvh] gd:h-[100dvh] overflow-x-hidden overflow-y-auto gd:overflow-hidden bg-[#020306] text-white select-none m-0 p-0 rounded-none max-w-none border-none outline-none font-sans flex flex-col gd:block gd:fixed gd:inset-0 gd:w-screen"
      style={{ overscrollBehavior: "contain" }}
    >
      {/* 3D WebGL Showroom background — fixed on mobile so it stays behind scrollable UI */}
      <canvas
        ref={showroomCanvasRef}
        className="fixed gd:absolute inset-0 z-0 w-full h-[100dvh] gd:h-full block pointer-events-none gd:pointer-events-auto"
      />

      {/* Atmospheric vignette overlays */}
      <div className="fixed gd:absolute inset-0 z-10 pointer-events-none bg-gradient-to-t from-[#010205] via-transparent to-black/35" />

      {/* Mobile-only car-preview viewport (reveals the fixed canvas behind it) */}
      <div className="gd:hidden order-2 w-full h-[38vh] min-h-[240px] pointer-events-none" aria-hidden="true" />

      {/* ==================== 1. TOP BAR HUD OVERLAY ==================== */}
      <div
        id="top-bar-hud"
        className="order-1 sticky gd:absolute top-0 left-0 right-0 z-30 gd:z-20 h-14 gd:h-18 px-3 gd:px-8 flex items-center justify-between gap-2 pointer-events-auto bg-gradient-to-b from-black/85 via-black/70 to-black/20 gd:from-black/60 gd:to-transparent backdrop-blur-md gd:backdrop-blur-0 pt-[env(safe-area-inset-top)]"
      >
        <div className="flex items-center space-x-2 gd:space-x-4 shrink-0 min-w-0">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 border border-white/10 rounded-xl hover:bg-white/10 active:scale-90 transition cursor-pointer flex items-center justify-center bg-black/40 shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-slate-350" />
          </button>
          <div className="hidden sm:block h-6 w-[1.5px] bg-white/10" />
          <div className="flex items-center space-x-2 gd:space-x-3 min-w-0">
            <div className="p-1.5 bg-gradient-to-r from-blue-700 to-cyan-500 rounded-lg shadow-lg shrink-0">
              <Car className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="hidden sm:block min-w-0">
              <span className="text-[8px] uppercase font-black tracking-widest text-[#00f2ff] block">GRID ARENA</span>
              <h2 className="text-base font-black uppercase tracking-tight text-white font-sans truncate">GARAGE SHOWROOM</h2>
            </div>
          </div>
        </div>

        {/* Center: Class Badge & Stars Floating */}
        <div className="hidden gd:flex items-center space-x-4 bg-black/65 border border-white/10 px-5 py-1.5 rounded-full select-none">
          <span className="text-[10px] font-black tracking-[3px] text-white bg-gradient-to-r from-red-630 to-amber-500 px-3 py-1 rounded-full text-center">
            {currentVehicleMetadata.class}
          </span>
          <div className="flex space-x-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`w-3.5 h-3.5 ${
                  i < currentVehicleMetadata.stars
                    ? "text-[#00f2ff] fill-[#00f2ff] drop-shadow-[0_0_6px_#00f2ffa5]"
                    : "text-white/20"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-1.5 gd:space-x-4 font-mono scale-[0.78] xs:scale-90 sm:scale-100 origin-right shrink-0">
          <div className="flex items-center space-x-2 bg-black/60 border border-white/5 rounded-xl px-3 py-1 relative">
            <Trophy className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span className="text-xs font-black text-white">{trophicCount.toLocaleString()}</span>
            <button
              onClick={() => handleResourceAdd("trophy")}
              className="bg-cyan-500 text-slate-950 font-black p-0.5 text-[8px] rounded transition ml-1 cursor-pointer"
            >
              <Plus className="w-2.5 h-2.5" />
            </button>
          </div>

          <div className="flex items-center space-x-2 bg-black/60 border border-white/5 rounded-xl px-3 py-1 relative">
            <Key className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-black text-white">{keyCount}</span>
            <button
              onClick={() => handleResourceAdd("key")}
              className="bg-cyan-500 text-slate-950 font-black p-0.5 text-[8px] rounded transition ml-1 cursor-pointer"
            >
              <Plus className="w-2.5 h-2.5" />
            </button>
          </div>

          <div className="flex items-center space-x-2 bg-black/60 border border-white/5 rounded-xl px-3 py-1 relative">
            <Coins className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
            <span className="text-xs font-black text-white">{coinCount.toLocaleString()}</span>
            <button
              onClick={() => handleResourceAdd("coin")}
              className="bg-cyan-500 text-slate-950 font-black p-0.5 text-[8px] rounded transition ml-1 cursor-pointer"
            >
              <Plus className="w-2.5 h-2.5" />
            </button>
          </div>

          <div className="h-6 w-[1.5px] bg-white/10 shrink-0" />

          {/* User Settings with Logout Dropdown */}
          <div className="relative pointer-events-auto flex items-center space-x-2">
            <button
              id="user-settings-trigger"
              onClick={() => setSettingsDropdownOpen(!settingsDropdownOpen)}
              className="p-1.5 bg-black/60 border border-white/10 hover:border-cyan-500/50 rounded-xl hover:bg-white/10 active:scale-90 transition cursor-pointer flex items-center justify-center text-slate-300 hover:text-[#00f2ff]"
              title="System Settings"
            >
              <Settings className="w-4 h-4 animate-[spin_10s_linear_infinite] hover:animate-[spin_2s_linear_infinite]" />
            </button>

            {/* Direct Logout Button */}
            <button
              id="direct-logout-button"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
              className="p-1.5 bg-rose-950/40 border border-rose-500/30 hover:border-rose-500 rounded-xl hover:bg-rose-900/60 active:scale-90 transition cursor-pointer flex items-center justify-center text-rose-300 hover:text-white"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>

            <AnimatePresence>
              {settingsDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40 cursor-default" onClick={() => setSettingsDropdownOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-56 bg-black/95 backdrop-blur-xl border border-white/15 rounded-xl p-3.5 z-50 shadow-[0_10px_30px_rgba(0,0,0,0.95)] space-y-3"
                  >
                    <div className="flex items-center space-x-2.5 pb-2.5 border-b border-white/5 font-sans">
                      <div className="w-8 h-8 rounded-full overflow-hidden border border-white/15 bg-slate-900 shrink-0">
                        <img
                          src={
                            profile?.photoURL ||
                            "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
                          }
                          alt={profile?.name || "Racer"}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase font-black tracking-wider text-[#00f2ff] truncate">
                          {profile?.name || "Racer"}
                        </p>
                        <p className="text-[8px] font-medium text-slate-400 truncate">
                          {profile?.email || "No email associated"}
                        </p>
                      </div>
                    </div>

                    <button
                      id="user-logout-btn"
                      onClick={async () => {
                        setSettingsDropdownOpen(false);
                        await logout();
                        navigate("/login");
                      }}
                      className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-rose-600/20 border border-rose-500/30 hover:bg-rose-600/35 hover:border-rose-500/50 text-rose-300 rounded-lg text-[9px] font-black uppercase tracking-wider transition cursor-pointer font-sans"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>SIGN OUT DRIVER</span>
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ==================== 2. FLOATING LEFT VECHILE SPECS & TUNING HUD ==================== */}
      <div className="order-3 gd:absolute gd:left-6 gd:top-22 z-20 w-full gd:w-72 px-4 gd:px-0 mt-4 gd:mt-0 flex flex-col space-y-4 pointer-events-auto">
        {/* Simple compact name and class display */}
        <div className="p-3 gd:p-4 rounded-2xl border border-white/15 bg-black/55 gd:bg-black/45 backdrop-blur-md">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-mono font-black text-[#00f2ff] tracking-widest uppercase">
              TUNING PRESET ACTIVE
            </span>
            <span className="text-[8px] font-mono px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-550/20 rounded-md font-bold uppercase">
              {selectedCar}
            </span>
          </div>
          <h1 className="text-xl gd:text-2xl font-black uppercase tracking-tighter text-white leading-none">
            {currentVehicleMetadata.name}
          </h1>
          <p className="text-[10px] text-slate-400 font-medium leading-tight mt-1.5">{currentVehicleMetadata.desc}</p>
        </div>
        {/* Specs card moved into the bottom-left chassis cockpit card to match the mock. */}
      </div>

      {/* ==================== 3. RACE PRESETS CONFIG DRAWER (FLOATS OVER CHASSIS LEFT) ==================== */}
      <AnimatePresence>
        {presetsPanelOpen && (
          <>
            <div className="fixed inset-0 z-20 pointer-events-auto" onClick={() => setPresetsPanelOpen(false)} />
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="absolute left-6 top-85 z-30 w-72 p-4 rounded-2xl border border-white/20 bg-black/80 backdrop-blur-xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="text-[9px] font-black uppercase text-cyan-400 tracking-widest font-mono">
                  MATCH REGISTRY
                </span>
                <button
                  onClick={() => setPresetsPanelOpen(false)}
                  className="text-slate-400 p-0.5 hover:bg-white/10 rounded-lg"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* License Name input */}
              <div className="space-y-1.5 text-left">
                <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest block font-mono">
                  Driver ID License Name
                </label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value.slice(0, 16))}
                  className="w-full bg-black/60 border border-white/10 focus:border-[#00f2ff] px-3 py-1.5 rounded-xl text-xs font-black text-white outline-none font-mono uppercase"
                />
              </div>

              {/* Race circuit dropdown */}
              <div className="space-y-1.5 text-left">
                <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest block font-mono">
                  Race Circuit Path
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSelectedMap("map1")}
                    className={`py-1.5 text-[9px] font-black uppercase rounded-lg border text-center transition cursor-pointer ${
                      selectedMap === "map1"
                        ? "bg-blue-600/20 border-blue-500 text-blue-300"
                        : "bg-black/60 border-white/5 text-slate-400"
                    }`}
                  >
                    🐲 DRAGON
                  </button>
                  <button
                    onClick={() => setSelectedMap("map2")}
                    className={`py-1.5 text-[9px] font-black uppercase rounded-lg border text-center transition cursor-pointer ${
                      selectedMap === "map2"
                        ? "bg-cyan-600/20 border-cyan-500 text-cyan-300"
                        : "bg-black/60 border-white/5 text-slate-400"
                    }`}
                  >
                    🌴 COASTAL
                  </button>
                </div>
              </div>

              {/* Bot Difficulty */}
              <div className="space-y-1.5 text-left">
                <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest block font-mono">
                  Enemy BOT Intensity
                </label>
                <div className="flex bg-black/60 p-1 rounded-xl border border-white/5">
                  {(["easy", "medium", "hard"] as Difficulty[]).map((l) => (
                    <button
                      key={l}
                      onClick={() => setDifficulty(l)}
                      className={`flex-1 py-1 text-[8px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                        difficulty === l
                          ? "bg-gradient-to-r from-blue-700 to-cyan-500 text-white font-black"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ==================== 4. RIGHT-SIDE RACE SETUP PANEL (matches mock) ==================== */}
      <div className="order-5 gd:absolute gd:right-6 gd:top-22 z-20 w-full gd:w-[26rem] gd:max-w-[calc(100vw-2rem)] px-4 gd:px-0 mt-4 gd:mt-0 pointer-events-auto">
        <div className="rounded-2xl gd:rounded-3xl border border-white/15 bg-black/65 gd:bg-black/55 backdrop-blur-md p-3 gd:p-5 space-y-3 gd:space-y-4">
          {/* Create / Join — 50/50 */}
          <div className="grid grid-cols-2 gap-2 gd:gap-3">
            <button
              onClick={handleCreateRoomClick}
              className="py-2.5 gd:py-3 rounded-xl gd:rounded-2xl bg-gradient-to-r from-purple-700 to-fuchsia-600 hover:brightness-110 text-white font-black text-[10px] gd:text-[11px] tracking-[2px] uppercase transition border border-purple-400/30 shadow-[0_0_20px_rgba(168,85,247,0.35)] cursor-pointer"
            >
              CREATE ROOM
            </button>
            <button
              onClick={handleJoinRoomClick}
              className="py-2.5 gd:py-3 rounded-xl gd:rounded-2xl bg-black/80 hover:bg-purple-950/40 text-[#cfbeff] font-black text-[10px] gd:text-[11px] tracking-[2px] uppercase transition border border-purple-700/40 cursor-pointer"
            >
              JOIN ROOM
            </button>
          </div>

          {/* Select Track — horizontal swipe on mobile (2 visible), grid on desktop */}
          <div className="space-y-2 pt-1">
            <label className="text-[9px] font-mono font-black text-slate-400 uppercase tracking-[3px] block">
              SELECT TRACK
            </label>
            <div className="flex gd:grid gd:grid-cols-4 gap-2.5 overflow-x-auto gd:overflow-visible snap-x snap-mandatory -mx-1 gd:mx-0 px-1 gd:px-0 pb-1 gd:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {availableMaps.map((m) => {
                const active = selectedMap === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMap(m.id)}
                    className={`group rounded-xl overflow-hidden border-2 transition cursor-pointer shrink-0 snap-start w-[calc(50%-0.3125rem)] gd:w-auto ${
                      active
                        ? "border-[#00ff88] shadow-[0_0_14px_#00ff88a0]"
                        : "border-white/10 opacity-80 hover:opacity-100"
                    }`}
                  >
                    <div className={`h-14 gd:h-16 relative bg-gradient-to-br ${m.gradient}`}>
                      <div className="absolute inset-0 bg-black/25" />
                      <div className="absolute top-1 left-1 text-lg drop-shadow">{m.icon}</div>
                    </div>
                    <div className="px-1.5 py-1.5 bg-black/85 text-center">
                      <div className="text-[9px] gd:text-[8px] font-black uppercase text-white truncate leading-tight">
                        {m.name}
                      </div>
                      <div
                        className={`text-[8px] font-mono mt-0.5 ${
                          active ? "text-emerald-400" : "text-slate-400"
                        }`}
                      >
                        {m.distance}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* START RACE — directly below Track Selection, same width as panel */}
          <motion.button
            id="btn-use-car"
            onClick={() => handleStartProcess("single")}
            disabled={!selectedCar || !selectedMap}
            whileHover={{ scale: 1.02, filter: "brightness(1.1)" }}
            whileTap={{ scale: 0.97 }}
            animate={{
              boxShadow: [
                "0 0 24px rgba(0,230,118,0.55), 0 0 48px rgba(0,200,83,0.3)",
                "0 0 38px rgba(0,230,118,0.85), 0 0 72px rgba(0,200,83,0.5)",
                "0 0 24px rgba(0,230,118,0.55), 0 0 48px rgba(0,200,83,0.3)",
              ],
            }}
            transition={{ boxShadow: { duration: 2.2, repeat: Infinity, ease: "easeInOut" } }}
            style={{ background: "linear-gradient(90deg, #00E676 0%, #00C853 100%)" }}
            className="relative overflow-hidden w-full mt-1 h-[60px] gd:h-[76px] rounded-[20px] disabled:opacity-40 disabled:cursor-not-allowed text-black font-black text-lg gd:text-2xl uppercase tracking-[3px] gd:tracking-[5px] border border-emerald-200/50 border-b-4 border-b-emerald-800 active:translate-y-[2px] active:border-b-0 flex items-center justify-center gap-3 cursor-pointer transition"
          >
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 via-transparent to-black/10" />
            <Play className="w-6 h-6 gd:w-8 gd:h-8 fill-current relative z-10 drop-shadow-[0_0_8px_rgba(0,0,0,0.4)]" />
            <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">START RACE</span>
          </motion.button>
        </div>
      </div>




      {/* ==================== 6. BOTTOM-LEFT SPECIFICATION COCKPIT (chassis + specs combined) ==================== */}
      <div
        id="bottom-showroom-carousel"
        className="order-4 gd:absolute gd:bottom-6 gd:left-6 z-20 w-full gd:w-[28rem] gd:max-w-[calc(100vw-2rem)] px-4 gd:px-0 mt-4 gd:mt-0 pointer-events-auto"
      >
        <div className="rounded-xl gd:rounded-3xl border border-white/15 bg-black/65 gd:bg-black/55 backdrop-blur-md p-2 gd:p-4 space-y-1.5 gd:space-y-3 max-w-full overflow-hidden">
          <div className="flex justify-between items-center pb-0.5 gd:pb-1 border-b border-white/5 gap-2">
            <span className="text-[8px] gd:text-[9px] font-black uppercase tracking-[2px] gd:tracking-[3px] text-[#00f2ff] font-mono truncate">
              SPECIFICATION COCKPIT
            </span>
            <span className="text-[7px] gd:text-[9px] font-mono text-emerald-400 font-bold uppercase tracking-widest truncate">
              CALIBRATION ONLINE
            </span>
          </div>

          {/* Chassis row — 3 cards evenly spaced, smaller on mobile */}
          <div>
            <span className="text-[7px] gd:text-[8px] font-black tracking-[2px] gd:tracking-[3px] text-white/50 uppercase font-mono block mb-1">
              CHOOSE CHASSIS COCKPIT
            </span>
            <div className="grid grid-cols-3 gap-1.5 gd:gap-3 w-full">
              {CARS_GARAGE.map((car) => {
                const isSelected = selectedCar === car.id;
                return (
                  <motion.div
                    key={car.id}
                    onClick={() => setSelectedCar(car.id)}
                    whileHover={{ scale: isSelected ? 1.06 : 1.03 }}
                    className={`min-w-0 cursor-pointer transition-all duration-300 rounded-lg gd:rounded-xl relative h-8 gd:h-16 overflow-hidden ${
                      isSelected
                        ? "shadow-[0_0_10px_#00ff88] border-[1.5px] gd:border-2 border-[#00ff88]"
                        : "opacity-65 border border-white/10 hover:opacity-100"
                    }`}
                  >
                    <img
                      src={car.image}
                      alt={car.name}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute bottom-0 right-0 px-1 py-[1px] bg-black/90 text-[5px] gd:text-[6px] font-sans font-black text-[#00f2ff] rounded-tl-md uppercase">
                      {car.class.split(" ")[0]}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Velocity */}
          <div className="space-y-0.5 gd:space-y-1 pt-0 gd:pt-1">
            <div className="flex justify-between items-end text-[8px] gd:text-[10px]">
              <span className="font-black text-slate-400 uppercase tracking-wider gd:tracking-widest">Top Velocity</span>
              <span className="font-mono font-black text-white">{currentVehicleMetadata.topSpeed} km/h</span>
            </div>
            <div className="w-full h-[3px] gd:h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_0_8px_#00f2ffa5]"
                style={{ width: `${(currentVehicleMetadata.topSpeed / 420) * 100}%` }}
              />
            </div>
          </div>

          {/* Grip handling */}
          <div className="space-y-0.5 gd:space-y-1">
            <div className="flex justify-between items-end text-[8px] gd:text-[10px]">
              <span className="font-black text-slate-400 uppercase tracking-wider gd:tracking-widest">Grip Handling</span>
              <span className="font-mono font-black text-white">
                {currentVehicleMetadata.handling} / 100
              </span>
            </div>
            <div className="w-full h-[3px] gd:h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_8px_#10b981a0]"
                style={{ width: `${currentVehicleMetadata.handling}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* PAINT button removed — START RACE lives inside the right RACE SETUP panel */}

      {/* ==================== SCREEN POPUPS & METALLIC CUSTOMIZERS ==================== */}

      {/* ==================== CUSTOMIZE METALLIC COLOR DRAWER ==================== */}
      <AnimatePresence>
        {customizerOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setCustomizerOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="absolute bottom-22 right-6 w-80 max-w-full z-40 rounded-2xl border border-white/10 p-4 shadow-2xl space-y-4"
              style={{
                background: "rgba(5, 5, 5, 0.85)",
                backdropFilter: "blur(24px)",
              }}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <div className="flex items-center space-x-2">
                  <Paintbrush className="w-3.5 h-3.5 text-[#00f2ff]" />
                  <span className="text-[10px] uppercase font-black tracking-widest text-[#00f2ff] font-mono">
                    Custom Paint picker
                  </span>
                </div>
                <button
                  onClick={() => setCustomizerOpen(false)}
                  className="p-1 hover:bg-white/10 rounded-lg text-slate-450"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {METALLIC_COLORS.map((col) => (
                  <button
                    key={col.hex}
                    onClick={() => setCarColor(col.hex)}
                    className={`h-9 rounded-lg flex items-center justify-center transition-all ${
                      carColor === col.hex
                        ? "ring-2 ring-[#00ff88] scale-105 shadow-lg"
                        : "opacity-85 hover:opacity-100"
                    }`}
                    style={{
                      backgroundColor: col.hex,
                      border: "2px solid rgba(255,255,255,0.15)",
                    }}
                    title={col.name}
                  >
                    {carColor === col.hex && <CheckCircle className="w-3.5 h-3.5 text-slate-900 fill-white" />}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ==================== CREATE MULTIPLAYER ROOM OVERLAY ==================== */}
      <AnimatePresence>
        {activePopup === "create_room" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              className="w-full max-w-sm p-6 rounded-3xl border border-white/10 shadow-3xl relative space-y-5"
              style={{
                background: "rgba(8, 10, 16, 0.9)",
                backdropFilter: "blur(30px)",
              }}
            >
              <div className="flex justify-between items-center border-b border-white/5 pb-2.5">
                <span className="text-xs font-black tracking-widest text-fuchsia-400 uppercase font-mono">
                  HOST STAGING GRID
                </span>
                <button
                  onClick={() => setActivePopup("none")}
                  className="p-1 hover:bg-white/10 rounded-lg text-slate-400"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="space-y-4 text-left font-sans">
                <div className="bg-purple-950/20 border border-purple-500/25 rounded-2xl p-4 text-center space-y-1">
                  <span className="text-[9px] uppercase tracking-widest font-black text-purple-300 font-mono">
                    INVITATION CODE
                  </span>
                  <p className="text-2xl font-mono font-black tracking-[4px] text-white select-all">{generatedCode}</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[8px] uppercase tracking-widest font-black text-slate-400 block font-mono">
                    Setup Room Label
                  </label>
                  <input
                    type="text"
                    value={createdRoomName}
                    onChange={(e) => setCreatedRoomName(e.target.value)}
                    className="w-full bg-black/60 border border-white/10 focus:border-purple-555 rounded-xl px-3 py-2 text-xs font-black text-white uppercase outline-none font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[8px] uppercase tracking-widest font-black text-slate-400 block font-mono">
                    Max Player Count
                  </label>
                  <div className="flex gap-2">
                    {[2, 3, 4].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setMaxPlayers(num)}
                        className={`flex-1 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider font-mono border transition-all cursor-pointer ${
                          maxPlayers === num
                            ? "bg-fuchsia-600/30 border-fuchsia-500 text-fuchsia-300 shadow-md shadow-fuchsia-500/10"
                            : "bg-black/40 border-white/5 hover:border-white/10 text-slate-400"
                        }`}
                      >
                        {num} Player{num > 1 ? "s" : ""}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between bg-black/40 border border-white/5 rounded-2xl p-3 text-xs font-mono">
                  <div className="flex flex-col">
                    <span className="text-[8px] text-slate-500 font-bold uppercase">MAX COUNT</span>
                    <span className="font-bold text-fuchsia-400">{maxPlayers} PLAYERS</span>
                  </div>
                  <div className="w-[1px] bg-white/5" />
                  <div className="flex flex-col text-right">
                    <span className="text-[8px] text-slate-500 font-bold uppercase">ENVIRONMENT CIRCUITS</span>
                    <span className="font-bold text-cyan-400 uppercase">
                      {selectedMap === "map1" ? "Dragon Pass" : "Coastal Beach"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setActivePopup("none")}
                  className="py-2.5 bg-white/5 hover:bg-white/10 text-slate-350 rounded-xl font-bold uppercase text-[9px] tracking-widest transition cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleConfirmCreateRoom}
                  className="py-2.5 bg-gradient-to-r from-purple-700 to-fuchsia-600 hover:brightness-110 text-white rounded-xl font-black uppercase text-[9px] tracking-widest transition shadow-lg shadow-purple-500/25 cursor-pointer animate-pulse"
                >
                  OPEN LOBBY
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==================== JOIN MULTIPLAYER ROOM OVERLAY ==================== */}
      <AnimatePresence>
        {activePopup === "join_room" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              className="w-full max-w-xs p-6 rounded-3xl border border-white/10 shadow-3xl relative space-y-5"
              style={{
                background: "rgba(8, 10, 16, 0.9)",
                backdropFilter: "blur(30px)",
              }}
            >
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-xs font-black tracking-widest text-cyan-400 uppercase font-mono">
                  PEER MATCHMAKER
                </span>
                <button
                  onClick={() => setActivePopup("none")}
                  className="p-1 hover:bg-white/10 rounded-lg text-slate-400"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="space-y-4 text-left">
                <div className="space-y-2">
                  <label className="text-[9px] uppercase tracking-widest font-black text-slate-400 block text-center font-mono">
                    Enter Active Room Code
                  </label>
                  <input
                    type="text"
                    value={enteredJoinCode}
                    onChange={(e) => {
                      setEnteredJoinCode(e.target.value.toUpperCase());
                      setJoinError(null);
                    }}
                    placeholder="DRAGON99"
                    className="w-full bg-black/70 border border-white/10 focus:border-cyan-500 rounded-xl px-4 py-3 text-xl font-mono font-black text-center text-[#00f2ff] outline-none tracking-[4px] transition-all uppercase"
                  />
                </div>

                {joinError && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] rounded-xl text-center font-bold font-mono">
                    {joinError}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setActivePopup("none")}
                  className="py-2.5 bg-white/5 hover:bg-white/10 text-slate-350 rounded-xl font-bold uppercase text-[9px] tracking-widest transition cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={handleConfirmJoinRoom}
                  className="py-2.5 bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 hover:brightness-110 text-white rounded-xl font-black uppercase text-[9px] tracking-widest transition shadow-lg cursor-pointer"
                >
                  JOIN GRID
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==================== ACTIVE MULTIPLAYER LOBBY SCREEN (HUD DESIGN!) ==================== */}
      <AnimatePresence>
        {activePopup === "lobby" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-2xl p-6 rounded-3xl border border-white/10 shadow-3xl flex flex-col justify-between space-y-6"
              style={{
                background: "rgba(5, 7, 10, 0.95)",
                backdropFilter: "blur(32px)",
              }}
            >
              <div className="flex justify-between items-center border-b border-white/5 pb-4">
                <div className="flex items-center space-x-3">
                  <Users className="w-5 h-5 text-purple-400" />
                  <div>
                    <span className="text-[8px] font-mono font-black text-purple-400 block tracking-widest">
                      SYNCHRONOUS MATCHMAKER STAGING
                    </span>
                    <h3 className="text-base font-black text-white uppercase">
                      {syncedRoom?.ownerName}'s Grid Staging
                    </h3>
                  </div>
                </div>

                <div className="bg-purple-950/30 border border-purple-500/20 rounded-2xl px-5 py-1.5 font-mono text-center">
                  <span className="text-[8px] text-purple-300 block font-bold leading-none mb-0.5 uppercase">
                    ROOM CODE
                  </span>
                  <span className="text-base font-black text-white tracking-[2px]">{generatedCode}</span>
                </div>
              </div>

              <div className="space-y-3.5 text-left flex-1">
                <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400 tracking-wider">
                  <span>ACTIVE RACER GRID ({syncedPlayers.length} / {syncedRoom?.maxPlayers || 3} SEATS FILLED)</span>
                  <span className="text-purple-400 animate-pulse font-mono flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-ping" />
                    <span>STAGING SATELLITE ACTIVE</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {Array.from({ length: syncedRoom?.maxPlayers || 3 }).map((_, idx) => {
                    const loadedPlayer = syncedPlayers[idx];
                    if (loadedPlayer) {
                      const isMe = profile && loadedPlayer.uid === profile.uid;
                      const currentCarId = syncedRoom?.selectedCar || "ferrari";
                      const details = CARS_GARAGE.find((c) => c.id === currentCarId);
                      return (
                        <div
                          key={loadedPlayer.uid}
                          className="flex items-center justify-between bg-white/5 border border-white/15 p-3 rounded-2xl shadow-lg relative overflow-hidden"
                        >
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-t from-purple-600 to-cyan-400" />
                          <div className="flex items-center space-x-3">
                            <img
                              src={
                                loadedPlayer.photoURL ||
                                "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
                              }
                              alt={loadedPlayer.playerName}
                              className="w-10 h-10 object-cover rounded-full border border-white/10 shrink-0"
                            />
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="text-xs font-black uppercase text-white truncate max-w-[120px]">
                                  {loadedPlayer.playerName}
                                </span>
                                {isMe && (
                                  <span className="bg-cyan-500 text-slate-950 text-[7px] font-black uppercase tracking-widest px-1 py-[0.5px] rounded">
                                    YOU
                                  </span>
                                )}
                              </div>
                              <span className="text-[8px] font-mono text-slate-400 uppercase leading-none font-bold">
                                ACTIVE CHASSIS: {details?.name || "Lamborghini"} ({details?.class})
                              </span>
                            </div>
                          </div>
                          <span className="text-[9px] font-black px-3 py-1 bg-black/60 border border-white/5 text-emerald-400 rounded-lg">
                            ★ STANDSTILL READY
                          </span>
                        </div>
                      );
                    } else {
                      return (
                        <div
                          key={`empty-${idx}`}
                          className="flex items-center justify-between bg-black/45 border border-dashed border-white/10 p-3 rounded-2xl h-[56px] opacity-40 relative"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 rounded-full border border-dashed border-white/20 flex items-center justify-center shrink-0">
                              <Users className="w-4 h-4 text-slate-500" />
                            </div>
                            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-505">
                              WAITING FOR RACER SLOT...
                            </span>
                          </div>
                          <span className="text-[8px] font-bold text-slate-500 font-mono">SEAT {idx + 1}</span>
                        </div>
                      );
                    }
                  })}
                </div>
              </div>

              <div className="bg-black/60 border border-white/5 rounded-xl p-3 flex justify-around text-center text-[10px] font-mono py-2.5">
                <div className="flex flex-col">
                  <span className="text-[8px] text-slate-500 font-bold uppercase block leading-none">
                    CIRCUIT CODES
                  </span>
                  <span className="font-bold text-cyan-400 uppercase mt-0.5">
                    {syncedRoom?.mapId === "map1" ? "Dragon Pass Circuit" : "Coastal Sunset Circuit"}
                  </span>
                </div>
                <div className="w-[1px] bg-white/5" />
                <div className="flex flex-col">
                  <span className="text-[8px] text-slate-500 font-bold uppercase block leading-none">
                    MATCH REGULATION
                  </span>
                  <span className="font-bold text-purple-400 uppercase mt-0.5">{syncedRoom?.maxPlayers || 3} RACERS LIMIT</span>
                </div>
              </div>

              <div className="space-y-2.5">
                {syncedPlayers.length < (syncedRoom?.maxPlayers || 3) ? (
                  <div className="text-[10px] font-black text-pink-500 font-mono tracking-widest text-center uppercase animate-pulse">
                    Waiting for {syncedPlayers.length}/{syncedRoom?.maxPlayers || 3} players
                  </div>
                ) : (
                  <div className="text-[10px] font-black text-emerald-400 font-mono tracking-widest text-center uppercase">
                    All Players Joined
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3.5 pt-1">
                  <button
                    onClick={handleLeaveLobby}
                    className="py-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-2xl font-black uppercase text-[10px] tracking-widest transition cursor-pointer"
                  >
                    ABANDON ASSEMBLY
                  </button>
                  {syncedRoom && profile && syncedRoom.ownerUid === profile.uid ? (
                    <button
                      disabled={syncedPlayers.length < (syncedRoom?.maxPlayers || 3)}
                      onClick={async () => {
                        if (syncedRoom && profile && syncedRoom.ownerUid === profile.uid) {
                          await NormalRoomService.setRoomStatus(generatedCode, "starting");
                        }
                      }}
                      className="py-3 bg-gradient-to-r from-purple-700 to-fuchsia-600 hover:brightness-110 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest transition shadow-lg shadow-purple-500/25 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      START RACE NOW
                    </button>
                  ) : (
                    <button
                      disabled
                      className="py-3 bg-slate-900 border border-white/5 text-slate-400 rounded-2xl font-black uppercase text-[10px] tracking-widest transition cursor-not-allowed animate-pulse"
                    >
                      Waiting for host to start race...
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==================== COUNTDOWN CINEMATIC OVERLAY ==================== */}
      <AnimatePresence>
        {secondsLeft !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 pointer-events-none">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: [0.8, 1.2, 1], opacity: 1 }}
              transition={{ duration: 0.5, type: "spring" }}
              className="px-12 py-10 rounded-full flex flex-col items-center bg-slate-950/80 border border-[#00f2ff]/40 shadow-[0_0_50px_#00f2ff33] relative"
            >
              <div className="absolute inset-0 rounded-full border-2 border-dashed border-[#00f2ff]/30 animate-spin" />
              <span className="text-[12px] font-black text-[#00f2ff] tracking-widest uppercase mb-1">
                GRID START POSITION LIGHTS
              </span>
              <span className="text-8xl font-black font-mono tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 drop-shadow-[0_0_20px_#00f2ffd5]">
                {secondsLeft === 0 ? "GO!" : secondsLeft}
              </span>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==================== REPAIR RESTORATION TOAST ==================== */}
      <AnimatePresence>
        {showMaintenanceSplash && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 border border-emerald-400 text-slate-950 px-8 py-3 rounded-2xl shadow-2xl flex items-center space-x-3 text-sm font-black uppercase"
          >
            <CheckCircle className="w-5 h-5 animate-spin fill-white text-emerald-500 shrink-0" />
            <span>DIAGNOSTICS UPDATED: ALL CHASSIS TUNED BACK TO 100%!</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Datacenter Preloader overlay */}
      <AnimatePresence>
        {loadStatus !== "idle" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#030612]/95 backdrop-blur-xl pointer-events-auto"
          >
            <div className="w-full max-w-md p-8 rounded-3xl bg-[#04091a] border border-white/5 shadow-2xl text-center flex flex-col items-center space-y-6 relative overflow-hidden">
              <div className="absolute w-80 h-80 bg-cyan-500/5 rounded-full blur-[80px]" />

              {loadStatus === "downloading" && (
                <>
                  <div className="w-16 h-16 rounded-full border-t-2 border-r-2 border-cyan-400 animate-spin flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.2)]">
                    <Download className="w-5 h-5 text-cyan-400 animate-pulse" />
                  </div>

                  <div className="space-y-1.50">
                    <h3 className="text-xl font-black uppercase tracking-widest text-slate-200">
                      Preparing vehicle...
                    </h3>
                    <p className="text-xs text-[#00f2ff] font-bold">
                      Configuring {CARS_GARAGE.find((c) => c.id === selectedCar)?.name}...
                    </p>
                  </div>

                  <div className="w-full space-y-2">
                    <div className="relative w-full h-2 bg-black rounded-full overflow-hidden border border-white/5">
                      <motion.div
                        className="absolute h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-teal-400 shadow-[0_0_10px_rgba(34,211,238,0.5)] animate-pulse"
                        style={{ width: `${progress}%` }}
                        transition={{ duration: 0.1 }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-mono text-cyan-400 font-bold">
                      <span>DATACENTER TELEMETRY RECON</span>
                      <span>{progress}%</span>
                    </div>
                  </div>
                </>
              )}

              {loadStatus === "ready" && (
                <>
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.25)] scale-110 transition duration-300">
                    <CheckCircle className="w-8 h-8 text-emerald-400" />
                  </div>

                  <div className="space-y-1.5 text-center">
                    <h3 className="text-2xl font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-350">
                      Vehicle Calibrated
                    </h3>
                    <p className="text-xs text-slate-400">Tuning profile loaded successfully. Transitioning...</p>
                  </div>
                </>
              )}

              {loadStatus === "failed" && (
                <>
                  <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.25)]">
                    <AlertOctagon className="w-8 h-8 text-red-500" />
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-xl font-black uppercase tracking-widest text-red-500">Vehicle unavailable</h3>
                    <p className="text-xs text-slate-400 leading-normal max-w-xs">
                      The selected vehicle is currently unavailable. Please choose another car or try again.
                    </p>
                  </div>

                  <div className="w-full flex space-x-3 mt-4">
                    <button
                      type="button"
                      onClick={() => setLoadStatus("idle")}
                      className="flex-1 py-3 bg-slate-950 border border-slate-850 hover:border-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider hover:text-white cursor-pointer"
                    >
                      Return
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartProcess("single")}
                      className="flex-1 py-3 bg-red-650 hover:bg-red-500 rounded-xl text-xs font-bold uppercase tracking-wider text-white shadow-lg cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};