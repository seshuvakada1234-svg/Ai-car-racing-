// @ts-nocheck
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { CarState, ControlsState } from "../types";
import { GamePhysicsService } from "../physics/GamePhysics";
import { TrafficAIService } from "../ai/TrafficAI";
import { TrackGeometryHelper } from "../utils/track";
import { preloadGLTFAssets } from "../world/procedural";
import { ShaderPreloader } from "../services/ShaderPreloader";
import { ShaderCompileScreen } from "./ShaderCompileScreen";
import { DragonTrackWorld } from "../world/DragonTrackWorld";
import { CoastalSunsetTrackWorld } from "../world/CoastalSunsetTrackWorld";
import { Racing2World } from "../world/Racing2World";
import { lodManager } from "../world/lodManager";
import { terrainManager, TerrainManager } from "../world/TerrainManager";
import { forestSystem, ForestSystem } from "../world/forest";
import { RoadHeightSampler } from "../services/RoadHeightSampler";
import { MemoryPool } from "../utils/memoryPool";

// Dynamic modular systems integration
import { VehicleRenderer } from "../systems/VehicleRenderer";
import { CameraController } from "../systems/CameraController";
import { WeatherSystem } from "../systems/WeatherSystem";
import { LightingSystem } from "../systems/LightingSystem";
import { SkySystem } from "../systems/SkySystem";
import { RainSystem } from "../systems/RainSystem";
import { ParticleSystem } from "../systems/ParticleSystem";
import { TrailSystem } from "../systems/TrailSystem";
import { AudioSystem } from "../systems/AudioSystem";
import { VehicleEffects } from "../systems/VehicleEffects";
import {
  applyConfigToRenderer,
  applyConfigToScene,
  getEngineConfig,
  onConfigChanged,
  upgradeTextures,
  type EngineConfig,
} from "../systems/GraphicsConfig";

interface GameCanvasProps {
  cars: CarState[];
  playerControls: ControlsState;
  physicsService: GamePhysicsService;
  trackHelper: TrackGeometryHelper;
  isPaused: boolean;
  gameState: string;
  onFinishRace: () => void;
  onTick: (updatedCars: CarState[]) => void;
  soundEnabled?: boolean;
  timeOfDay?: "morning" | "noon" | "sunset" | "night";
  weather?: "sunny" | "cloudy" | "foggy" | "rain";
  cameraMode?: string;
  raceSettings?: any;
}

// Shared global instances to preserve WebGL context and loaded GPU memory across React mount/unmount lifecycles
let globalRenderer: THREE.WebGLRenderer | null = null;
let globalCanvas: HTMLCanvasElement | null = null;

const GameCanvasComponent: React.FC<GameCanvasProps> = ({
  cars,
  playerControls,
  physicsService,
  trackHelper,
  isPaused,
  gameState,
  onFinishRace,
  onTick,
  soundEnabled = true,
  timeOfDay = "sunset",
  weather = "sunny",
  cameraMode = "third-person",
  raceSettings,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const flareRef = useRef<HTMLDivElement>(null);
  const speedVignetteRef = useRef<HTMLDivElement>(null);

  const [warming, setWarming] = React.useState(true);
  const [warmProgress, setWarmProgress] = React.useState(15);
  const [contextKey, setContextKey] = React.useState(0);

  useEffect(() => {
    let timer = setInterval(() => {
      if ((window as any).shadersCompiled) {
        setWarmProgress(100);
        clearInterval(timer);
        setTimeout(() => {
          setWarming(false);
        }, 850);
      } else {
        setWarmProgress((prev) => {
          if (prev >= 95) return 95;
          return prev + 10;
        });
      }
    }, 200);

    return () => clearInterval(timer);
  }, []);

  const carsRef = useRef<CarState[]>(cars);
  const controlsRef = useRef<ControlsState>(playerControls);
  const gameStateRef = useRef<string>(gameState);
  const isPausedRef = useRef<boolean>(isPaused);
  const onFinishRaceRef = useRef<() => void>(onFinishRace);
  const onTickRef = useRef<(updatedCars: CarState[]) => void>(onTick);
  const soundEnabledRef = useRef<boolean>(soundEnabled);

  const timeOfDayRef = useRef<"morning" | "noon" | "sunset" | "night">(timeOfDay);
  const weatherRef = useRef<"sunny" | "cloudy" | "foggy" | "rain">(weather);
  const cameraModeRef = useRef<string>(cameraMode);

  // Directly assign references inside the render function body to keep them 100% synchronized
  carsRef.current = cars;
  controlsRef.current = playerControls;
  gameStateRef.current = gameState;
  isPausedRef.current = isPaused;
  onFinishRaceRef.current = onFinishRace;
  onTickRef.current = onTick;
  soundEnabledRef.current = soundEnabled;
  timeOfDayRef.current = timeOfDay;
  weatherRef.current = weather;
  cameraModeRef.current = cameraMode;

  // Expose physics service to window for debug actions like teleporting
  (window as any).physicsService = physicsService;

  useEffect(() => {
    if (!containerRef.current) return;

    let isUnmounted = false;

    // --- 1. DOM RE-PARENTING FOR INSTANT LIFECYCLE RECOVERY & ZERO CONTEXT LOSS ---
    if (!globalCanvas) {
      globalCanvas = document.createElement("canvas");
      globalCanvas.className = "block focus:outline-none";
      globalCanvas.style.position = "fixed";
      globalCanvas.style.inset = "0";
      globalCanvas.style.width = "100vw";
      globalCanvas.style.height = "100dvh";
      globalCanvas.style.display = "block";
      globalCanvas.style.margin = "0";
      globalCanvas.style.padding = "0";
      globalCanvas.style.borderRadius = "0";
      globalCanvas.style.maxWidth = "none";
      globalCanvas.style.outline = "none";
      globalCanvas.style.border = "none";
    }

    if (containerRef.current && globalCanvas.parentNode !== containerRef.current) {
      containerRef.current.appendChild(globalCanvas);
    }




    // User-driven engine config (from GraphicsSettingsPanel). Falls back to
    // sensible defaults based on device when no settings stored yet.
    let engineCfg: EngineConfig = getEngineConfig();
    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (!globalRenderer) {
      globalRenderer = new THREE.WebGLRenderer({
        canvas: globalCanvas,
        antialias: true,
        powerPreference: "high-performance",
        alpha: false,
        depth: true,
        stencil: false,
        precision: "highp",
      });
    }

    const renderer = globalRenderer;
    (window as any).__renderer = renderer;
    let renderScale = engineCfg.renderScale;
    applyConfigToRenderer(renderer, engineCfg);
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    (window as any).qualityTier = engineCfg.preset.toUpperCase();
    (window as any).renderScale = renderScale;

    // React live to user changes from the GraphicsSettingsPanel.
    const unsubscribeCfg = onConfigChanged((cfg) => {
      engineCfg = cfg;
      renderScale = cfg.renderScale;
      applyConfigToRenderer(renderer, cfg);
      try {
        applyConfigToScene(scene, camera, cfg);
      } catch {}
      (window as any).qualityTier = cfg.preset.toUpperCase();
      (window as any).renderScale = renderScale;
      // Re-anisotropy car textures already in scene
      try {
        const vr = (window as any).__vehicleRenderer;
        if (vr?.carGroupMap) {
          vr.carGroupMap.forEach((g: THREE.Object3D) => upgradeTextures(g, renderer, cfg.anisotropy));
        }
      } catch {}
    });



    // --- 1B. CONTEXT LOSS RECOVERY HANDLING ---
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn("GameCanvas: WebGL Context Lost detected! Halting render buffer ticks...");
    };

    const handleContextRestored = () => {
      console.log("GameCanvas: WebGL Context Restored! Reinitializing materials and world systems.");
      try {
        if (globalRenderer) {
          globalRenderer.dispose();
        }
      } catch (err) {
        console.error("Error disposing globalRenderer on lost/restored:", err);
      }
      globalRenderer = null;
      globalCanvas = null;

      // Force state flags reset to rebuild objects
      DragonTrackWorld.initialized = false;
      CoastalSunsetTrackWorld.initialized = false;
      Racing2World.initialized = false;
      ForestSystem.initialized = false;
      TerrainManager.initialized = false;
      ShaderPreloader.initialized = false;
      ParticleSystem.initialized = false;
      VehicleRenderer.initialized = false;
      WeatherSystem.initialized = false;
      AudioSystem.initialized = false;

      // Trigger re-mount/re-initialization of WebGL context and assets
      setContextKey((prev) => prev + 1);
    };

    globalCanvas.addEventListener("webglcontextlost", handleContextLost, false);
    globalCanvas.addEventListener("webglcontextrestored", handleContextRestored, false);

    // Reset window loading and compilation tracking flags for the new race
    (window as any).carLoaded = false;
    (window as any).playerCarAddedToScene = false;
    (window as any).mapLoaded = false;
    (window as any).shadersCompiled = false;
    (window as any).worldReady = false;

    // --- 1C. SCENE & CAMERA CONFIGURATION ---
    const scene = new THREE.Scene();
    // Tighter far plane on low/mid tier saves enormous fillrate & culling cost.
    const farPlane = engineCfg.farPlane;
    const camera = new THREE.PerspectiveCamera(62, 1, 0.4, farPlane);
    console.log("Camera active", camera);


    // --- 2. ENVIRONMENT COLOR MAP FOR REFLECTIONS ---
    const createReflectionMap = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0.0, "#0a1d37");
        grad.addColorStop(0.35, "#2e114d");
        grad.addColorStop(0.65, "#f3501a");
        grad.addColorStop(0.82, "#ffcc00");
        grad.addColorStop(1.0, "#4a2503");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      return tex;
    };
    const reflectionTex = createReflectionMap();

    // --- 3. DYNAMIC WORLD GEOMETRIES ---
    const mt = trackHelper.mapType;
    const isMap2 = mt === "map2";
    const isRacing2 = mt === "racing2";
    const dragonWorld = isRacing2
      ? new Racing2World(scene, trackHelper)
      : isMap2
        ? new CoastalSunsetTrackWorld(scene, trackHelper)
        : new DragonTrackWorld(scene, trackHelper);

    if (isRacing2 && dragonWorld?.readyPromise) {
      dragonWorld.readyPromise
        .then((world: any) => {
          const existingCars = carsRef.current || [];
          let roadLineup = existingCars.length > 0 ? existingCars.map((c) => ({ ...c, position: { ...c.position }, velocity: { ...c.velocity } })) : [];

          if (roadLineup.length === 0) {
            const playerName = raceSettings?.playerName || "Player";
            const difficulty = raceSettings?.difficulty || "hard";
            const carColor = raceSettings?.carColor || "#0062ff";
            roadLineup = physicsService.initializeCars(playerName, difficulty, carColor);
          }

          const curveLength = trackHelper.curve.getLength();
          const wheelClearance = 0.35;
          const spawnPos = (world?.startPosition as THREE.Vector3) || new THREE.Vector3();
          const spawnYaw = (window as any).racing2SpawnHeading ?? 0;
          const gridSpawns: Array<{ position: THREE.Vector3; headingY: number }> = world?.gridSpawns || [];

          // StartSpawn is NOT a vehicle spawn. Every car (player + AI) uses a Grid_XX slot.
          // Player → Grid_01, AI_01 → Grid_02, ... AI_05 → Grid_06.
          if (gridSpawns.length === 0) {
            throw new Error("Racing 2 spawn failed: no Grid_XX markers found in GLB.");
          }
          roadLineup.forEach((car, idx) => {
            const g = gridSpawns[idx];
            if (g) {
              car.position.x = g.position.x;
              car.position.y = g.position.y;
              car.position.z = g.position.z;
              car.angle = g.headingY;
              car.lastValidY = g.position.y - wheelClearance;
            } else {
              // More cars than grid slots — stagger behind along the track curve, snapped to road.
              const overflow = idx - gridSpawns.length + 1;
              const side = overflow % 2 === 0 ? -1 : 1;
              const spacing = 15.0 + overflow * 8.0;
              const progress = (((1.0 - spacing / curveLength) % 1.0) + 1.0) % 1.0;
              const pt = trackHelper.curve.getPointAt(progress);
              const tangent = trackHelper.curve.getTangentAt(progress).normalize();
              const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
              const requested = pt.clone().addScaledVector(normal, side * 2.5);
              const road = terrainManager.resolveRoadSurfacePosition(requested, 240) || terrainManager.findNearestRoadSurface(requested, 600);
              if (!road) throw new Error("Racing 2 spawn failed: no nearby road surface found for overflow car.");
              car.position.x = road.x;
              car.position.y = road.y + wheelClearance;
              car.position.z = road.z;
              car.lastValidY = road.y;
              car.angle = Math.atan2(tangent.x, tangent.z);
            }
            car.velocity.x = 0;
            car.velocity.y = 0;
            car.velocity.z = 0;
            car.speed = 0;
            car.angularVelocity = 0;
            car.driftFactor = 0;
            car.isDrifting = false;
            car.currentCheckpointIndex = 0;
          });
          void spawnPos; void spawnYaw;

          // Validation gate — refuse to enable the camera / controls if anything critical is off.
          const v = (window as any).racing2Validation || {};
          const player = roadLineup[0];
          const spawnValid =
            v.spawnOnRoad !== false &&
            v.aboveRoad !== false &&
            v.withinBounds !== false &&
            Number.isFinite(player?.position?.x) &&
            Number.isFinite(player?.position?.y) &&
            Number.isFinite(player?.position?.z);
          if (!spawnValid) {
            console.warn("Racing2: spawn validation failed, holding camera + controls.", v);
          }

          carsRef.current = roadLineup;
          onTickRef.current(roadLineup);
          // Only now activate the chase camera – it will snap to the freshly-placed player.
          window.dispatchEvent(new Event("reset-camera"));
        })
        .catch((err: any) => {
          console.error("Racing 2 startup blocked:", err);
          (window as any).racing2Ready = false;
          (window as any).racing2Error =
            (err && err.message) || "Racing 2 startup blocked: no valid road spawn was found.";
        });
    }


    // Cache Watermill Wheels from the scene once at spawn to completely eliminate scene.traverse()
    const cachedWatermillWheels: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (obj.name === "watermill_wheel") {
        cachedWatermillWheels.push(obj);
      }
    });

    // --- 4. INITIALIZE MODULAR ARCHITECTURE SYSTEMS ---
    const weatherSystem = new WeatherSystem(scene);
    weatherSystem.setRenderer(renderer);

    const lightingSystem = new LightingSystem(scene);
    const skySystem = new SkySystem(scene);
    const rainSystem = new RainSystem(scene);
    const particleSystemWrapper = new ParticleSystem(scene);
    const trailSystem = new TrailSystem(scene);
    const audioSystem = new AudioSystem();
    const vehicleEffects = new VehicleEffects(scene);
    const cameraController = new CameraController(camera, 62, scene);
    const vehicleRenderer = new VehicleRenderer(scene, reflectionTex);
    (window as any).__vehicleRenderer = vehicleRenderer;
    const trafficAIService = new TrafficAIService(trackHelper);

    // Mark the world build and configuration phase complete. Racing 2 sets this
    // only after GLB, textures, road BVH, path and spawn are all valid.
    if (!isRacing2) {
      (window as any).worldReady = true;
    }

    // Warm up WebGL shader context on the fly
    (window as any).shadersCompiled = false;
    (async () => {
      try {
        await preloadGLTFAssets();
        await ShaderPreloader.preloadShaders(renderer, scene, camera);
      } catch (err) {
        console.warn("Shader warming error, proceeding standard:", err);
      } finally {
        (window as any).shadersCompiled = true;
      }
    })();

    // Spawn trackside street light glow elements (Preallocated geometry & batched color material cache)
    const bulbGeometry = new THREE.SphereGeometry(0.3, 8, 8);
    const bulbMaterialCache = new Map<string, THREE.MeshBasicMaterial>();

    trackHelper.lights.forEach((lite) => {
      let mat = bulbMaterialCache.get(lite.color);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({ color: lite.color });
        bulbMaterialCache.set(lite.color, mat);
      }
      const bulb = new THREE.Mesh(bulbGeometry, mat);
      bulb.position.copy(lite.position);
      scene.add(bulb);

      const pl = new THREE.PointLight(lite.color, lite.intensity, 22, 0.5);
      pl.position.copy(lite.position);
      scene.add(pl);
    });

    // --- 5. CAMERA SPEED LINES IMPACT ---
    const speedLinesCount = 35;
    const linesGroup = new THREE.Group();
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -4], 3));
    const lMat = new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0 });
    const linesPool: THREE.Line[] = [];
    for (let i = 0; i < speedLinesCount; i++) {
      const lineMesh = new THREE.Line(lGeo, lMat.clone());
      linesGroup.add(lineMesh);
      linesPool.push(lineMesh);
    }
    camera.add(linesGroup);
    scene.add(camera);

    // --- 6. TICK RENDER LOOPS WITH ROLLING ADAPTIVE QUALITY ENGINE ---
    let animationId = 0;
    let oldTime = performance.now();
    let accumulatedTime = 0;
    const fixedDt = 1 / 60;
    let runningTime = 0;
    let physicsStepCount = 0;

    // Rolling FPS statistics + tiered adaptive quality engine.
    // Quality ladder mirrors GraphicsConfig presets: 4=Extreme, 3=Ultra, 2=High, 1=Medium, 0=Low.
    let lastFrameTime = performance.now();
    const fpsSamples: number[] = [];
    const presetToQ: Record<string, number> = { Low: 0, Medium: 1, High: 2, Ultra: 3, Extreme: 4 };
    const qToPreset = ["Low", "Medium", "High", "Ultra", "Extreme"] as const;
    let currentQuality = presetToQ[engineCfg.preset] ?? 2;
    const userQualityCeiling = currentQuality; // adaptive scaler never raises above user choice
    let lastAdjustTime = performance.now();
    let cpuFrameMs = 0;
    let gpuFrameMs = 0;
    let debugFrameCount = 0;

    // FPS cap gating (rAF throttle). 0 = unlimited.
    let lastRenderTime = 0;
    const getFrameInterval = () => (engineCfg.fpsCap > 0 ? 1000 / engineCfg.fpsCap - 0.5 : 0);

    const applyQuality = (q: number) => {
      currentQuality = Math.max(0, Math.min(userQualityCeiling, q));
      const presetName = qToPreset[currentQuality];
      // Persist & broadcast — GraphicsSettingsPanel listeners will reflect it.
      try {
        const raw = localStorage.getItem("race:graphicsSettings");
        const cur = raw ? JSON.parse(raw) : {};
        cur.preset = presetName;
        localStorage.setItem("race:graphicsSettings", JSON.stringify(cur));
        window.dispatchEvent(
          new CustomEvent("race:graphicsSettingsChanged", { detail: cur }),
        );
        window.dispatchEvent(
          new CustomEvent("race:autoDowngrade", {
            detail: { preset: presetName, reason: "low_fps" },
          }),
        );
      } catch {}
      console.warn(`[Perf] Adaptive scaler → ${presetName}`);
    };

    const tick = () => {
      if (isUnmounted) return;
      animationId = requestAnimationFrame(tick);
      const cpuStart = performance.now();

      // FPS cap — skip render if not enough time elapsed
      const interval = getFrameInterval();
      if (interval > 0 && cpuStart - lastRenderTime < interval) return;
      lastRenderTime = cpuStart;

      const currentTime = cpuStart;
      let elapsedSec = (currentTime - oldTime) / 1000;
      elapsedSec = Math.min(elapsedSec, 0.05);
      oldTime = currentTime;

      // Adaptive quality calculation
      const frameDelta = currentTime - lastFrameTime;
      lastFrameTime = currentTime;
      if (frameDelta > 0) {
        const instantFps = 1000 / frameDelta;
        fpsSamples.push(instantFps);
        if (fpsSamples.length > 60) fpsSamples.shift();
        if (fpsSamples.length >= 45 && currentTime - lastAdjustTime > 4000) {
          const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
          const target = engineCfg.fpsCap > 0 ? engineCfg.fpsCap : 60;
          // Downgrade if sustained <70% of target and we can still step down
          if (avgFps < target * 0.6 && currentQuality > 0) {
            applyQuality(currentQuality - 1);
            lastAdjustTime = currentTime;
            if (currentQuality === 0) particleSystemWrapper.destroy();
          } else if (avgFps < target * 0.8 && currentQuality > 1) {
            applyQuality(currentQuality - 1);
            lastAdjustTime = currentTime;
          }
        }
      }


      const currentCars = carsRef.current ? [...carsRef.current] : [];
      if (currentCars.length === 0) return;

      if (isRacing2 && !(window as any).racing2Ready) {
        renderer.render(scene, camera);
        return;
      }

      const player = currentCars.find((c) => c.id === "player");

      // Expose metrics to window for the HUD debug console + perf overlay
      const win = window as any;
      win.racingCars = currentCars;
      if (frameDelta > 0) win.currentFPS = 1000 / frameDelta;
      win.aiCount = currentCars.filter((c) => c.isAI && !c.id.startsWith("traffic")).length;
      win.forestTreeCount = (window as any).forestTreeCount || 1200;
      win.gpuMemory = {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs.length,
      };
      win.drawCalls = renderer.info.render.calls;
      win.triangles = renderer.info.render.triangles;
      win.activeMeshes = scene.children.length;
      win.cpuFrameMs = cpuFrameMs;
      win.gpuFrameMs = gpuFrameMs;


      // Add continuous debugging logs as requested
      debugFrameCount++;
      if (player && debugFrameCount % 60 === 0) {
        const delta = elapsedSec;
        const controls = { throttle: player.throttle, steering: player.steering };
        const vehicle = { velocity: player.velocity };
        const playerCar = player;
        const rigidBody = { isSleeping: () => false };
        console.log("useFrame running");
        console.log("delta", delta);
        console.log("throttle", controls.throttle);
        console.log("steering", controls.steering);
        console.log("velocity", vehicle.velocity);
        console.log("playerCar", playerCar);
        console.log("physics awake", !rigidBody.isSleeping());
        console.log("Camera active", camera);
      }

      const activeWeather = weatherRef.current;
      const activeTimeOfDay = timeOfDayRef.current;

      // Update weather, skies and lighting environments
      weatherSystem.update(activeWeather, activeTimeOfDay, elapsedSec);
      if (weatherSystem.currentFogColor) {
        // Reuse-oriented fog allocation to completely bypass O(N) GC thrashing
        if (!scene.fog || !(scene.fog instanceof THREE.FogExp2)) {
          scene.fog = new THREE.FogExp2(weatherSystem.currentFogColor, weatherSystem.currentFogDensity);
        } else {
          scene.fog.color.set(weatherSystem.currentFogColor);
          scene.fog.density = weatherSystem.currentFogDensity;
        }
        renderer.setClearColor(weatherSystem.currentFogColor);
      }
      lightingSystem.update(activeWeather, activeTimeOfDay, elapsedSec);
      skySystem.update(activeWeather, activeTimeOfDay, elapsedSec);

      // Align sun light shadowing target relative to client car
      if (player && player.position && lightingSystem.sunLight) {
        lightingSystem.sunLight.position.set(player.position.x + 80, player.position.y + 220, player.position.z + 80);
        const playerGroup = vehicleRenderer.carGroupMap.get("player");
        if (playerGroup) {
          lightingSystem.sunLight.target = playerGroup;
        }
      }

      if (!isPausedRef.current && gameStateRef.current !== "completed") {
        runningTime += elapsedSec;
        accumulatedTime += elapsedSec;

        while (accumulatedTime >= fixedDt) {
          physicsStepCount++;
          const isAITick = physicsStepCount % 3 === 0;
          const isRaceLocked = gameStateRef.current === "countdown" || gameStateRef.current === "menu";
          const playerCar = currentCars.find((c) => c.id === "player");
          if (playerCar && playerCar.position && playerCar.velocity) {
            physicsService.updateCar(playerCar, fixedDt, controlsRef.current, isRaceLocked);
            physicsService.generateExhaustParticles(playerCar, fixedDt);
          }

          currentCars.forEach((c) => {
            if (c && c.position && c.velocity && c.isAI) {
              // Freeze all AI while race is locked (countdown/menu). No navigation,
              // no throttle, no steering — hard-clamp velocity to zero every tick.
              if (isRaceLocked) {
                c.velocity.x = 0; c.velocity.y = 0; c.velocity.z = 0;
                c.speed = 0;
                c.angularVelocity = 0;
                c.throttle = 0;
                c.brake = 1;
                (c as any).handbrakeActive = true;
                (c as any).engineTorque = 0;
                return;
              }

              // Skip updates when far away (> 200m) from player to save CPU
              if (playerCar && playerCar.position) {
                const dx = c.position.x - playerCar.position.x;
                const dy = c.position.y - playerCar.position.y;
                const dz = c.position.z - playerCar.position.z;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq > 200 * 200) {
                  return; // Skip completely if far away
                }
              }

              // Update AI physics at 20Hz
              if (isAITick) {
                trafficAIService.updateAICar(c, fixedDt * 3, currentCars, physicsService);
                physicsService.generateExhaustParticles(c, fixedDt * 3);
              }
            }
          });

          physicsService.evaluatePositionsRanks(currentCars);
          particleSystemWrapper.update(physicsService, fixedDt);
          accumulatedTime -= fixedDt;
        }

        onTickRef.current(currentCars);

        // End the race as soon as the FIRST car (player or AI) crosses Finish
        // after completing 3 laps. GameOver then ranks everyone by finishTime,
        // falling back to distance for cars still on-track.
        if (gameStateRef.current === "racing" && currentCars.some((c) => c.isFinished)) {
          onFinishRaceRef.current();
        }
      }

      // Live animated waterfall scrolls and spectator dynamics
      if (player && player.position) {
        const isFinished = player ? player.isFinished : false;
        const rank = player ? player.racePosition : 1;
        dragonWorld.update(elapsedSec, trackHelper, rank, isFinished, activeWeather);
      }

      // Interpolate remote players' cars towards their network targets (smooth movement)
      currentCars.forEach((c) => {
        if (c.id !== "player" && !c.isAI) {
          if (c.targetPosition) {
            // Apply frame-rate independent lerp
            const lerpFactor = 1 - Math.exp(-elapsedSec * 12); // ~83ms time constant for responsive, smooth tracking
            c.position.x += (c.targetPosition.x - c.position.x) * lerpFactor;
            c.position.y += (c.targetPosition.y - c.position.y) * lerpFactor;
            c.position.z += (c.targetPosition.z - c.position.z) * lerpFactor;

            if (c.targetVelocity) {
              c.velocity.x += (c.targetVelocity.x - c.velocity.x) * lerpFactor;
              c.velocity.y += (c.targetVelocity.y - c.velocity.y) * lerpFactor;
              c.velocity.z += (c.targetVelocity.z - c.velocity.z) * lerpFactor;
            }
          }

          if (typeof c.targetAngle === "number") {
            // Find shortest angular difference for slerp-like angle transition (avoids 360 flip-snaps)
            let diff = c.targetAngle - c.angle;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            const lerpFactor = 1 - Math.exp(-elapsedSec * 12);
            c.angle += diff * lerpFactor;
          }

          if (typeof c.targetSpeed === "number") {
            const lerpFactor = 1 - Math.exp(-elapsedSec * 12);
            c.speed += (c.targetSpeed - c.speed) * lerpFactor;
          }
        }
      });

      // Animate Vehicles and Wheels
      vehicleRenderer.update(
        currentCars,
        controlsRef.current,
        elapsedSec,
        runningTime,
        terrainManager,
        activeWeather,
        activeTimeOfDay,
      );

      // Animate vehicle effects (flames, light trails)
      vehicleEffects.update(currentCars, vehicleRenderer.carGroupMap);
      trailSystem.update(currentCars, elapsedSec);

      // Animate environmental features
      rainSystem.update(player, activeWeather, elapsedSec);

      // Animate cached Watermill Wheels (zero scene.traverse)
      cachedWatermillWheels.forEach((obj) => {
        if (obj.userData && obj.userData.isRotating) {
          obj.rotation.z += elapsedSec * obj.userData.rotationSpeed;
        }
      });

      if (player && player.position) {
        const velocityMagnitude = player.velocity ? Math.sqrt(player.velocity.x ** 2 + player.velocity.z ** 2) : 0;

        // Level Of Detail dynamic geometry culling around player's position
        const pPos = MemoryPool.getVector().set(player.position.x, player.position.y, player.position.z);
        terrainManager.playerPos.copy(pPos);
        lodManager.update(pPos);

        // Update Camera Controller and shake rumble
        cameraController.update(player, elapsedSec, controlsRef.current, cameraModeRef.current);

        // Render Speed lines
        const shouldShowSpeedLines = velocityMagnitude > 40;
        linesPool.forEach((lineMesh) => {
          const lMatInst = lineMesh.material as THREE.LineBasicMaterial;
          if (shouldShowSpeedLines) {
            lMatInst.opacity = THREE.MathUtils.lerp(lMatInst.opacity, 0.44, 4 * elapsedSec);
            if (lineMesh.position.z > 0 || lMatInst.opacity === 0) {
              lineMesh.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, -12 - Math.random() * 20);
            }
            lineMesh.position.z += elapsedSec * 60;
          } else {
            lMatInst.opacity = THREE.MathUtils.lerp(lMatInst.opacity, 0, 10 * elapsedSec);
          }
        });

        // Speed Vignette UI Overlay
        if (speedVignetteRef.current) {
          const speedFactor = THREE.MathUtils.clamp((velocityMagnitude - 32) / 36, 0, 1);
          speedVignetteRef.current.style.opacity = String(speedFactor * (player.isNitroActive ? 0.92 : 0.65));
        }

        // --- 7. DYNAMIC CINEMATIC LENS FLARE SHIFTING ---
        if (flareRef.current && skySystem.sunDisk) {
          // Zero runtime vector allocating via MemoryPool
          const sunWorldPos = MemoryPool.getVector().copy(skySystem.sunDisk.position);
          const screenPos = sunWorldPos.project(camera);

          if (screenPos.z < 1) {
            // Check that sun is in front of camera frustum
            const flareX = (screenPos.x * 0.5 + 0.5) * containerRef.current!.clientWidth;
            const flareY = (-screenPos.y * 0.5 + 0.5) * containerRef.current!.clientHeight;

            const buffer = 45;
            const w = containerRef.current!.clientWidth;
            const h = containerRef.current!.clientHeight;
            const isOutOfEdges = flareX < -buffer || flareX > w + buffer || flareY < -buffer || flareY > h + buffer;
            const isObscured = activeTimeOfDay === "night" || activeWeather === "foggy" || activeWeather === "rain";

            if (!isOutOfEdges && !isObscured) {
              flareRef.current.style.opacity = "1";
              const kids = flareRef.current.children;
              if (kids.length >= 6) {
                const screenCenterX = w / 2;
                const screenCenterY = h / 2;
                const dx = flareX - screenCenterX;
                const dy = flareY - screenCenterY;

                (kids[0] as HTMLElement).style.transform = `translate(${flareX - 56}px, ${flareY - 56}px)`;
                (kids[1] as HTMLElement).style.transform =
                  `translate(${screenCenterX + dx * 0.44 - 28}px, ${screenCenterY + dy * 0.44 - 28}px)`;
                (kids[2] as HTMLElement).style.transform =
                  `translate(${screenCenterX - dx * 0.28 - 16}px, ${screenCenterY - dy * 0.28 - 16}px)`;
                (kids[3] as HTMLElement).style.transform =
                  `translate(${screenCenterX - dx * 0.62 - 36}px, ${screenCenterY - dy * 0.62 - 36}px)`;
                (kids[4] as HTMLElement).style.transform =
                  `translate(${screenCenterX - dx * 1.15 - 48}px, ${screenCenterY - dy * 1.15 - 48}px)`;
                (kids[5] as HTMLElement).style.transform =
                  `translate(${screenCenterX - dx * 1.8 - 80}px, ${screenCenterY - dy * 1.8 - 80}px)`;
              }
            } else {
              flareRef.current.style.opacity = "0";
            }
          }
        }

        // --- 8. AUDIO UPDATE SYSTEMS ---
        const isDrifting = player.isDrifting || false;
        audioSystem.update(
          player.speed,
          player.isNitroActive,
          isDrifting,
          isPausedRef.current,
          soundEnabledRef.current,
          gameStateRef.current,
        );
      }

      renderer.info.reset();
      const renderStart = performance.now();
      renderer.render(scene, camera);
      const renderEnd = performance.now();
      // CPU = pre-render work; GPU ≈ render submission + driver time
      cpuFrameMs = renderStart - cpuStart;
      gpuFrameMs = renderEnd - renderStart;
    };


    tick();

    // Observer resize handling
    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObs = new ResizeObserver(() => handleResize());
    resizeObs.observe(containerRef.current);

    return () => {
      isUnmounted = true;
      cancelAnimationFrame(animationId);
      resizeObs.disconnect();
      try { unsubscribeCfg(); } catch {}
      console.log("Scene disposed");


      // Clean up event listeners on our persistent canvas
      if (globalCanvas) {
        globalCanvas.removeEventListener("webglcontextlost", handleContextLost);
        globalCanvas.removeEventListener("webglcontextrestored", handleContextRestored);

        // Dynamic DOM re-parenting: swap out canvas elegantly
        if (globalCanvas.parentNode === containerRef.current) {
          containerRef.current.removeChild(globalCanvas);
        }
      }

      reflectionTex.dispose();

      // System Disposals representing clean lifecycle hooks
      weatherSystem.setRenderer(null as any);
      lightingSystem.sunLight?.dispose();
      lightingSystem.ambLight?.dispose();
      skySystem.skyDome?.geometry.dispose();
      (skySystem.skyDome?.material as THREE.Material)?.dispose();
      skySystem.sunDisk?.geometry.dispose();
      (skySystem.sunDisk?.material as THREE.Material)?.dispose();
      skySystem.sunGlow?.geometry.dispose();
      (skySystem.sunGlow?.material as THREE.Material)?.dispose();

      rainSystem.destroy();
      particleSystemWrapper.destroy();
      trailSystem.destroy();
      audioSystem.destroy();
      vehicleEffects.destroy();
      vehicleRenderer.destroy();
      forestSystem.destroy();

      // Geometry and materials from speed lines
      lGeo.dispose();
      lMat.dispose();

      // Clear cached streetlight resources to avoid memory leaks
      bulbGeometry.dispose();
      bulbMaterialCache.forEach((mat) => mat.dispose());

      // Clear static singletons to prevent memory leaks and recreate cleanly next time
      lodManager.clear();
      terrainManager.clear();

      // Reset static initialization flags completely to allow a clean second mount
      DragonTrackWorld.initialized = false;
      CoastalSunsetTrackWorld.initialized = false;
      Racing2World.initialized = false;
      ForestSystem.initialized = false;
      TerrainManager.initialized = false;
      ShaderPreloader.initialized = false;
      ParticleSystem.initialized = false;
      VehicleRenderer.initialized = false;
      WeatherSystem.initialized = false;
      AudioSystem.initialized = false;

      (window as any).carLoaded = false;
      (window as any).playerCarAddedToScene = false;
      (window as any).mapLoaded = false;
      (window as any).shadersCompiled = false;
      (window as any).worldReady = false;
    };
  }, [physicsService, trackHelper, contextKey]);

  return (
    <div
      ref={containerRef}
      id="canvas-container"
      className="m-0 p-0 rounded-none max-w-none border-none outline-none overflow-hidden"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100dvh",
        zIndex: 0,
        margin: 0,
        padding: 0,
        borderRadius: 0,
        maxWidth: "none",
        outline: "none",
        border: "none",
      }}
    >
      {/* Cinematic Sunset Lens flares */}
      <div
        ref={flareRef}
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300 opacity-0"
      >
        <div className="absolute w-28 h-28 rounded-full bg-amber-400/30 blur-xl filter" />
        <div className="absolute w-14 h-14 rounded-full border border-orange-500/25 bg-orange-500/10 blur-sm filter" />
        <div className="absolute w-8 h-8 rounded-full bg-rose-600/20 blur-xs filter" />
        <div className="absolute w-18 h-18 rounded-full border border-indigo-400/20 bg-indigo-500/5 blur-md filter" />
        <div className="absolute w-24 h-24 rounded-full bg-cyan-400/15 blur-lg filter" />
        <div className="absolute w-40 h-40 rounded-full border border-yellow-300/10 bg-yellow-400/4 blur-xl filter" />
      </div>

      <div
        ref={speedVignetteRef}
        className="pointer-events-none absolute inset-0 z-20 mix-blend-multiply opacity-0 transition-opacity duration-150"
        style={{
          background: "radial-gradient(circle, transparent 52%, rgba(240, 10, 10, 0.12) 80%, rgba(0, 0, 0, 0.72) 100%)",
        }}
      />

      {warming && <ShaderCompileScreen progress={warmProgress} />}
    </div>
  );
};

export const GameCanvas = React.memo(GameCanvasComponent, (prevProps, nextProps) => {
  // Re-render when controls, active car states, or environment parameters change
  return (
    prevProps.trackHelper === nextProps.trackHelper &&
    prevProps.physicsService === nextProps.physicsService &&
    prevProps.soundEnabled === nextProps.soundEnabled &&
    prevProps.timeOfDay === nextProps.timeOfDay &&
    prevProps.weather === nextProps.weather &&
    prevProps.raceSettings === nextProps.raceSettings &&
    prevProps.gameState === nextProps.gameState &&
    prevProps.isPaused === nextProps.isPaused &&
    prevProps.playerControls === nextProps.playerControls &&
    prevProps.cars === nextProps.cars
  );
});