/**
 * GraphicsConfig — bridges the GraphicsSettingsPanel (localStorage) to the
 * runtime renderer. Reads `race:graphicsSettings`, exposes derived engine
 * values, and re-applies them when the user changes settings.
 *
 * Purely additive — does not change UI, physics, controls, or gameplay.
 */
import * as THREE from "three";

export type Preset = "Low" | "Medium" | "High" | "Ultra" | "Extreme";
export type FpsCap = 30 | 60 | 90 | 120 | 0; // 0 = Unlimited

export interface EngineConfig {
  preset: Preset;
  fpsCap: FpsCap;
  pixelRatioCap: number;
  renderScale: number; // 0..1.25
  shadowsEnabled: boolean;
  shadowMapSize: number;
  shadowDistance: number;
  anisotropy: number;
  bloomEnabled: boolean;
  toneMappingExposure: number;
  farPlane: number;
  postFx: "none" | "fxaa" | "smaa+bloom";
  grassDensity: number;
  treeDensity: number;
  drawDistance: number; // metres
}

const STORAGE_KEY = "race:graphicsSettings";

const PRESET_TO_ENGINE: Record<Preset, Omit<EngineConfig, "preset" | "fpsCap" | "renderScale">> = {
  Low: {
    pixelRatioCap: 1.0,
    shadowsEnabled: false,
    shadowMapSize: 512,
    shadowDistance: 30,
    anisotropy: 1,
    bloomEnabled: false,
    toneMappingExposure: 1.0,
    farPlane: 700,
    postFx: "none",
    grassDensity: 0.1,
    treeDensity: 0.25,
    drawDistance: 400,
  },
  Medium: {
    pixelRatioCap: 1.25,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    shadowDistance: 60,
    anisotropy: 2,
    bloomEnabled: false,
    toneMappingExposure: 1.0,
    farPlane: 900,
    postFx: "none",
    grassDensity: 0.35,
    treeDensity: 0.5,
    drawDistance: 700,
  },
  High: {
    pixelRatioCap: 1.5,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    shadowDistance: 100,
    anisotropy: 8,
    bloomEnabled: true,
    toneMappingExposure: 1.05,
    farPlane: 1200,
    postFx: "fxaa",
    grassDensity: 0.6,
    treeDensity: 0.7,
    drawDistance: 1200,
  },
  Ultra: {
    pixelRatioCap: 2.0,
    shadowsEnabled: true,
    shadowMapSize: 4096,
    shadowDistance: 150,
    anisotropy: 16,
    bloomEnabled: true,
    toneMappingExposure: 1.1,
    farPlane: 1600,
    postFx: "smaa+bloom",
    grassDensity: 0.85,
    treeDensity: 0.9,
    drawDistance: 1600,
  },
  Extreme: {
    pixelRatioCap: 2.0,
    shadowsEnabled: true,
    shadowMapSize: 4096,
    shadowDistance: 200,
    anisotropy: 16,
    bloomEnabled: true,
    toneMappingExposure: 1.15,
    farPlane: 2000,
    postFx: "smaa+bloom",
    grassDensity: 1.0,
    treeDensity: 1.0,
    drawDistance: 2000,
  },
};

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function readStored(): { preset: Preset; fps: FpsCap; renderScale: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Pick a sane default based on device
      return {
        preset: isMobile() ? "Medium" : "High",
        fps: 60,
        renderScale: 1.0,
      };
    }
    const parsed = JSON.parse(raw);
    const preset = (parsed.preset ?? "High") as Preset;
    const fps = (parsed.fps ?? 60) as FpsCap;
    const renderScale = ((parsed.renderScale ?? 100) as number) / 100;
    return { preset, fps, renderScale };
  } catch {
    return { preset: "High", fps: 60, renderScale: 1.0 };
  }
}

export function getEngineConfig(): EngineConfig {
  const { preset, fps, renderScale } = readStored();
  // Mobile cap: never exceed High at the engine level even if user picks Extreme
  const effectivePreset: Preset =
    isMobile() && (preset === "Ultra" || preset === "Extreme") ? "High" : preset;
  return {
    preset: effectivePreset,
    fpsCap: fps,
    renderScale: Math.max(0.5, Math.min(1.25, renderScale)),
    ...PRESET_TO_ENGINE[effectivePreset],
  };
}

/** Apply current config to a renderer. Safe to call repeatedly. */
export function applyConfigToRenderer(
  renderer: THREE.WebGLRenderer,
  config: EngineConfig = getEngineConfig(),
): void {
  renderer.shadowMap.enabled = config.shadowsEnabled;
  renderer.shadowMap.type =
    config.preset === "Low" || config.preset === "Medium"
      ? THREE.BasicShadowMap
      : THREE.PCFSoftShadowMap;
  renderer.shadowMap.needsUpdate = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.toneMappingExposure;
  const dpr = Math.min(window.devicePixelRatio || 1, config.pixelRatioCap);
  renderer.setPixelRatio(dpr * config.renderScale);
}

/** Apply config to scene fog + camera far + light shadow maps. */
export function applyConfigToScene(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  config: EngineConfig = getEngineConfig(),
): void {
  camera.far = config.farPlane;
  camera.updateProjectionMatrix();
  const fog: any = scene.fog;
  if (fog && "far" in fog) fog.far = config.farPlane;
  if (fog && "density" in fog) {
    // Reduce fog density on higher tiers so draw distance actually reads farther
    fog.density = Math.max(0.00015, 0.0025 - config.drawDistance * 0.0000012);
  }
  scene.traverse((obj: any) => {
    if (!obj.isLight) return;
    if ("castShadow" in obj) obj.castShadow = config.shadowsEnabled && !!obj.shadow;
    const shadow = obj.shadow;
    if (shadow?.mapSize) {
      const size = config.shadowMapSize;
      if (shadow.mapSize.width !== size) {
        shadow.mapSize.set(size, size);
        if (shadow.map) {
          shadow.map.dispose?.();
          shadow.map = null;
        }
      }
      if (shadow.camera && "far" in shadow.camera) {
        shadow.camera.far = config.shadowDistance;
        shadow.camera.updateProjectionMatrix?.();
      }
    }
  });
}

export interface DeviceProfile {
  kind: "Desktop" | "Mobile" | "Tablet" | "Unknown";
  cores: number;
  memoryGB: number;
  screenW: number;
  screenH: number;
  dpr: number;
  gpu: string;
  tier: Preset;
}

/** Detect device capabilities (CPU, RAM, GPU, screen, DPR) and classify to a preset. */
export function classifyDevice(): DeviceProfile {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isTablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile = /iPhone|iPod|Android.*Mobile/i.test(ua);
  const kind: DeviceProfile["kind"] = isTablet ? "Tablet" : isMobile ? "Mobile" : "Desktop";
  const cores = (navigator as any)?.hardwareConcurrency || 4;
  const memoryGB = (navigator as any)?.deviceMemory || (isMobile ? 3 : 8);
  const screenW = typeof window !== "undefined" ? window.screen?.width || 1920 : 1920;
  const screenH = typeof window !== "undefined" ? window.screen?.height || 1080 : 1080;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  let gpu = "unknown";
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) gpu = String(gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL) || "");
    }
  } catch {}

  const g = gpu.toLowerCase();
  const isLowGpu = /mali-[gt]?[3-6]|adreno [45]|adreno 6[0-3]|powervr|intel.*(hd|uhd) graphics/i.test(g);
  const isHighGpu = /rtx|radeon rx [6-9]|adreno [78]|apple m[1-9]|apple a1[5-9]/i.test(g);

  let tier: Preset;
  if (kind === "Desktop") {
    if (isHighGpu && cores >= 12 && memoryGB >= 16) tier = "Extreme";
    else if (cores >= 8 && memoryGB >= 8 && !isLowGpu) tier = "Ultra";
    else if (cores >= 4 && memoryGB >= 4) tier = "High";
    else tier = "Medium";
  } else {
    if (isHighGpu && cores >= 8 && memoryGB >= 6) tier = "Ultra";
    else if (cores >= 8 && memoryGB >= 6 && !isLowGpu) tier = "High";
    else if (cores >= 6 && memoryGB >= 4 && !isLowGpu) tier = "Medium";
    else tier = "Low";
  }

  return { kind, cores, memoryGB, screenW, screenH, dpr, gpu, tier };
}

let _deviceProfile: DeviceProfile | null = null;
export function getDeviceProfile(): DeviceProfile {
  if (!_deviceProfile) _deviceProfile = classifyDevice();
  return _deviceProfile;
}

/** Subscribe to user-driven settings changes; returns unsubscribe fn. */
export function onConfigChanged(cb: (cfg: EngineConfig) => void): () => void {
  const handler = () => cb(getEngineConfig());
  window.addEventListener("race:graphicsSettingsChanged", handler);
  return () => window.removeEventListener("race:graphicsSettingsChanged", handler);
}

/** Walk an object tree and upgrade all textures with anisotropy + correct color space. */
export function upgradeTextures(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  anisotropy?: number,
): void {
  const maxAniso = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
  const aniso = Math.min(anisotropy ?? getEngineConfig().anisotropy, maxAniso);
  const seen = new WeakSet<THREE.Texture>();
  const visit = (tex: THREE.Texture | null | undefined, isColor: boolean) => {
    if (!tex || seen.has(tex)) return;
    seen.add(tex);
    tex.anisotropy = aniso;
    if (isColor && tex.colorSpace !== THREE.SRGBColorSpace) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    if (tex.magFilter === THREE.NearestFilter) tex.magFilter = THREE.LinearFilter;
    if (
      tex.minFilter === THREE.NearestFilter ||
      tex.minFilter === THREE.NearestMipmapNearestFilter
    ) {
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    }
    tex.needsUpdate = true;
  };
  root.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh) return;
    const mesh = node as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat: any) => {
      if (!mat) return;
      visit(mat.map, true);
      visit(mat.emissiveMap, true);
      visit(mat.normalMap, false);
      visit(mat.roughnessMap, false);
      visit(mat.metalnessMap, false);
      visit(mat.aoMap, false);
      visit(mat.bumpMap, false);
    });
  });
}
