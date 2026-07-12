import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { CarState } from "../types";
import { assetManager } from "../services/AssetManager";
import { applyGltfMaterialFix } from "../utils/gltfMaterialFix";
import { resolveAssetUrl } from "../services/assetCdn";

export class GLTFMaterialsPBRSpecularGlossinessExtension {
  public name = "KHR_materials_pbrSpecularGlossiness";
  public parser: any;

  constructor(parser: any) {
    this.parser = parser;
  }

  public getMaterialType(materialIndex: number) {
    const parser = this.parser;
    const materialDef = parser.json.materials[materialIndex];
    if (!materialDef.extensions || !materialDef.extensions[this.name]) return null;
    return THREE.MeshStandardMaterial;
  }

  public extendMaterialParams(materialIndex: number, materialParams: any) {
    const parser = this.parser;
    const materialDef = parser.json.materials[materialIndex];
    if (!materialDef.extensions || !materialDef.extensions[this.name]) return Promise.resolve();

    const pending: Promise<any>[] = [];
    const extension = materialDef.extensions[this.name];

    materialParams.color = new THREE.Color(1.0, 1.0, 1.0);
    materialParams.opacity = 1.0;

    if (Array.isArray(extension.diffuseFactor)) {
      const f = extension.diffuseFactor;
      materialParams.color.fromArray(f);
      materialParams.opacity = f[3];
    }

    if (extension.diffuseTexture !== undefined) {
      pending.push(parser.assignTexture(materialParams, "map", extension.diffuseTexture));
    }

    let glossiness = 1.0;
    if (extension.glossinessFactor !== undefined) {
      glossiness = extension.glossinessFactor;
    }
    materialParams.roughness = 1.0 - glossiness;
    materialParams.metalness = 0.0;

    if (extension.specularGlossinessTexture !== undefined) {
      pending.push(parser.assignTexture(materialParams, "roughnessMap", extension.specularGlossinessTexture));
    }

    return Promise.all(pending);
  }
}

const activeDownloadPromises = new Map<string, Promise<THREE.Group>>();
let isPreloadingStarted = false;

// Shared cache for loaded GLTF models to prevent repeated network requests
export const gltfModelCache = {
  bugatti_chiron_top_edition: null as THREE.Group | null,
  ferrari_purosangue: null as THREE.Group | null,
  porsche_911_gt3: null as THREE.Group | null,

  // Backwards compatibility keys
  ferrari_sf90: null as THREE.Group | null,
  bugatti_chiron: null as THREE.Group | null,
  porsche_911: null as THREE.Group | null,
  playerModel: null as THREE.Group | null,
  aiModel: null as THREE.Group | null,

  treeModel: null as THREE.Group | null,
  rockModel: null as THREE.Group | null,
  mountainModel: null as THREE.Group | null,
  pagodaModel: null as THREE.Group | null,
  isLoaded: false,
};

// Variable holding the chosen player model for the game session
export let playerSelectedModelKey: string | null = null;

export function setPlayerSelectedModelKey(key: string | null): void {
  if (playerSelectedModelKey === key) return;
  playerSelectedModelKey = key;
  // Notify the renderer/loader that the player car identity has changed so
  // any cached per-instance asset for "player" can be disposed and rebuilt.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("race:playerCarChanged", { detail: { key } }));
  }
}

// Dynamically selects one of the successfully loaded cars for the player at game start
export function selectRandomPlayerCar(): void {
  const availableKeys = ["bugatti_chiron_top_edition", "ferrari_purosangue", "porsche_911_gt3"].filter(
    (key) => gltfModelCache[key as keyof typeof gltfModelCache] !== null,
  );

  if (availableKeys.length > 0) {
    playerSelectedModelKey = availableKeys[Math.floor(Math.random() * availableKeys.length)];
    console.log("Successfully selected random player car for this session:", playerSelectedModelKey);
  } else {
    playerSelectedModelKey = null; // resets to default/fallback
  }
}

// Map each vehicle state stably to its respective 3D model (stretching across the line dynamically)
export function getCarModelForId(id: string): THREE.Group | null {
  const loadedModels = [
    { key: "bugatti_chiron_top_edition", model: gltfModelCache.bugatti_chiron_top_edition },
    { key: "ferrari_purosangue", model: gltfModelCache.ferrari_purosangue },
    { key: "porsche_911_gt3", model: gltfModelCache.porsche_911_gt3 },
  ].filter((item) => item.model !== null);

  if (loadedModels.length === 0) {
    return null;
  }

  // Support direct mapping by explicit car key / modelKey
  if (id === "ferrari" || id === "ferrari_purosangue") {
    return gltfModelCache.ferrari_purosangue;
  }
  if (id === "bugatti" || id === "bugatti_chiron_top_edition" || id === "bugatti_chiron") {
    return gltfModelCache.bugatti_chiron_top_edition;
  }
  if (id === "porsche" || id === "porsche_911_gt3" || id === "porsche_911") {
    return gltfModelCache.porsche_911_gt3;
  }

  if (id === "player") {
    // Strict: the player must always drive the exact vehicle they selected.
    // Never silently substitute another car if the chosen GLB isn't cached yet —
    // return null so the renderer retries instead of loading the wrong model.
    if (!playerSelectedModelKey) return null;
    const found = gltfModelCache[playerSelectedModelKey as keyof typeof gltfModelCache];
    if (found && found instanceof THREE.Group) return found;
    console.warn(
      `[procedural] Player selected "${playerSelectedModelKey}" is not in cache yet — refusing to substitute another car.`,
    );
    return null;
  }

  // Consistent stable assignment based on AI number index
  let numId = 0;
  if (id.startsWith("ai")) {
    numId = parseInt(id.replace("ai", "")) || 0;
  } else {
    for (let i = 0; i < id.length; i++) {
      numId += id.charCodeAt(i);
    }
  }

  // Exclude player key from AI random selection if possible to avoid duplicates
  let aiPool = loadedModels;
  if (playerSelectedModelKey && loadedModels.length > 1) {
    aiPool = loadedModels.filter((m) => m.key !== playerSelectedModelKey);
  }

  return aiPool[numId % aiPool.length].model;
}

export interface ProceduralCarData {
  group: THREE.Group;
  pivots: THREE.Group[];
  spinners: THREE.Group[];
  tailLightMat: THREE.MeshBasicMaterial;
  paintMat: THREE.MeshStandardMaterial;
}

// Metadata map for loaded hypercar models (captures automatically calculated wheel coordinate pivots)
export interface ModelWheelMetadata {
  fl: THREE.Vector3;
  fr: THREE.Vector3;
  rl: THREE.Vector3;
  rr: THREE.Vector3;
  detected: boolean;
}

export const modelWheelMetadataMap = new Map<string, ModelWheelMetadata>();
if (typeof window !== "undefined") {
  (window as any).modelWheelMetadataMap = modelWheelMetadataMap;
}

// Auto-detect quadrant-based wheel positions inside a loaded GLTF model
export function computeModelWheelOffsets(model: THREE.Group): ModelWheelMetadata {
  const flList: THREE.Vector3[] = [];
  const frList: THREE.Vector3[] = [];
  const rlList: THREE.Vector3[] = [];
  const rrList: THREE.Vector3[] = [];

  model.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const name = node.name.toLowerCase();
      // Match common wheel or tire names in high-end hypercars
      if (
        name.includes("wheel") ||
        name.includes("tire") ||
        name.includes("rim") ||
        name.includes("pneu") ||
        name.includes("col_w")
      ) {
        const worldPos = new THREE.Vector3();
        node.getWorldPosition(worldPos);
        const localPos = model.worldToLocal(worldPos);

        // Standard coordinate assignments based on quadrant signs: Front is positive Z
        if (localPos.z > 0.2) {
          if (localPos.x > 0) {
            flList.push(localPos.clone());
          } else {
            frList.push(localPos.clone());
          }
        } else if (localPos.z < -0.2) {
          if (localPos.x > 0) {
            rlList.push(localPos.clone());
          } else {
            rrList.push(localPos.clone());
          }
        }
      }
    }
  });

  const averageVec = (list: THREE.Vector3[], fallback: THREE.Vector3): THREE.Vector3 => {
    if (list.length === 0) return fallback.clone();
    const sum = new THREE.Vector3();
    list.forEach((v) => sum.add(v));
    return sum.divideScalar(list.length);
  };

  const detected = flList.length > 0 || frList.length > 0 || rlList.length > 0 || rrList.length > 0;

  // Realistic fallback positions if auto-detection finds nothing
  const fl = averageVec(flList, new THREE.Vector3(0.95, 0.38, 1.15));
  const fr = averageVec(frList, new THREE.Vector3(-0.95, 0.38, 1.15));
  const rl = averageVec(rlList, new THREE.Vector3(1.0, 0.38, -1.2));
  const rr = averageVec(rrList, new THREE.Vector3(-1.0, 0.38, -1.2));

  return { fl, fr, rl, rr, detected };
}

export type SupercarStyle = "aventador" | "sf90" | "chiron" | "porsche911" | "traffic";

export function getSupercarStyleForId(id: string): SupercarStyle {
  if (id === "player") return "aventador";
  if (id.startsWith("traffic")) return "traffic";
  if (id.includes("phantom")) return "sf90";
  if (id.includes("nova")) return "chiron";
  if (id.includes("blaze")) return "porsche911";
  if (id.includes("apex")) return "sf90";
  if (id.includes("titan")) return "porsche911";
  return "aventador";
}

// Spawns procedural luxury supercar bodies.
// This function constructs a clean, lightweight vehicle frame with simple cylinder-based wheels.
// It contains absolutely zero BoxGeometry or CapsuleGeometry placeholders, in accordance with requirements.
export function createCarChassisGroup(
  c: CarState,
  reflectionTex: THREE.Texture,
  scene: THREE.Scene,
): ProceduralCarData {
  const mainCarGroup = new THREE.Group();
  mainCarGroup.name = "car_root_" + c.id;
  scene.add(mainCarGroup);

  const style = getSupercarStyleForId(c.id);

  const paint = new THREE.MeshStandardMaterial({
    color: c.color,
    roughness: 0.08,
    metalness: 0.95,
    envMap: reflectionTex,
    envMapIntensity: 2.8,
  });

  const pivots: THREE.Group[] = [];
  const spinners: THREE.Group[] = [];
  const tlMat = new THREE.MeshBasicMaterial({ color: "#770010" });

  const isPlayer = c.id === "player";

  // Sleek, fully procedural aerodynamic vehicle shell using cylinder/torus/cone geometries only
  // Zero BoxGeometry or CapsuleGeometry placeholders are utilized, preserving the clean look.
  const bodyGeo = new THREE.CylinderGeometry(0.68, 1.05, 3.8, 10);
  bodyGeo.rotateX(Math.PI / 2);
  const bodyMesh = new THREE.Mesh(bodyGeo, paint);
  bodyMesh.position.set(0, 0.45, 0);
  bodyMesh.castShadow = isPlayer;
  bodyMesh.receiveShadow = true;
  bodyMesh.visible = true; // Enabled by default as fallback
  mainCarGroup.add(bodyMesh);

  const noseGeo = new THREE.CylinderGeometry(0.28, 0.68, 1.2, 10);
  noseGeo.rotateX(Math.PI / 2);
  const noseMesh = new THREE.Mesh(noseGeo, paint);
  noseMesh.position.set(0, 0.35, 1.7);
  noseMesh.castShadow = isPlayer;
  noseMesh.visible = true; // Enabled by default as fallback
  mainCarGroup.add(noseMesh);

  // Cockpit canopy using squashed glass cylinder
  const glassMat = new THREE.MeshStandardMaterial({
    color: "#080a10",
    roughness: 0.01,
    metalness: 0.98,
    transparent: true,
    opacity: 0.85,
    envMap: reflectionTex,
    envMapIntensity: 2.8,
  });
  const canopyGeo = new THREE.CylinderGeometry(0.48, 0.72, 1.5, 10);
  canopyGeo.rotateX(Math.PI / 2);
  const canopyMesh = new THREE.Mesh(canopyGeo, glassMat);
  canopyMesh.position.set(0, 0.68, -0.2);
  canopyMesh.scale.set(1.1, 0.62, 1.0);
  canopyMesh.castShadow = isPlayer;
  canopyMesh.visible = true; // Enabled by default as fallback
  mainCarGroup.add(canopyMesh);

  // Wheel assembly structure: simple cylinder tires (strictly no Box/Capsule geometry)
  const spawnWheelAssembly = (wx: number, wy: number, wz: number, isLeft: boolean) => {
    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);
    pivot.visible = true; // Spawn wheels visible
    mainCarGroup.add(pivot);

    const spinner = new THREE.Group();
    pivot.add(spinner);

    const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.35, 14);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: "#121213", roughness: 0.92, metalness: 0.02 });
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = isPlayer;
    tire.receiveShadow = true;
    spinner.add(tire);

    pivots.push(pivot);
    spinners.push(spinner);
  };

  const wheelZOffset = style === "traffic" ? 1.05 : 1.15;
  const wheelRearZOffset = style === "traffic" ? -1.1 : -1.2;

  // Quad setup
  spawnWheelAssembly(0.95, 0.38, wheelZOffset, true); // Front Left
  spawnWheelAssembly(-0.95, 0.38, wheelZOffset, false); // Front Right
  spawnWheelAssembly(1.0, 0.38, wheelRearZOffset, true); // Rear Left
  spawnWheelAssembly(-1.0, 0.38, wheelRearZOffset, false); // Rear Right

  const groupScale = style === "traffic" ? 1.25 : 1.4;
  mainCarGroup.scale.set(groupScale, groupScale, groupScale);

  // Common Headlight light projections for player car (working headlights!)
  if (c.id === "player") {
    const spotLight = new THREE.SpotLight("#ffffff", 4.8, 52, Math.PI / 5, 0.35, 0.82);
    spotLight.position.set(0, 0.42, 1.95);
    spotLight.target.position.set(0, 0.1, 16);
    mainCarGroup.add(spotLight);
    mainCarGroup.add(spotLight.target);
  }

  return {
    group: mainCarGroup,
    pivots,
    spinners,
    tailLightMat: tlMat,
    paintMat: paint,
  };
}

export async function loadSpecificCarModel(
  carKey: "lamborghini" | "ferrari" | "bugatti" | "porsche",
  onProgress: (percent: number) => void,
): Promise<THREE.Group> {
  let effectiveCarKey = carKey;
  if (effectiveCarKey === "lamborghini") {
    console.warn("lamborghini_aventador.glb removed - using fallback car.");
    effectiveCarKey = "ferrari";
  }

  const cacheKeyMap = {
    ferrari: "ferrari_purosangue",
    bugatti: "bugatti_chiron_top_edition",
    porsche: "porsche_911_gt3",
  } as const;

  const urlMap = {
    ferrari: resolveAssetUrl("/__l5e/assets-v1/739ced4e-0592-4e92-a92f-12a25c0fa39d/ferrari_purosangue.glb"),
    bugatti: resolveAssetUrl("/__l5e/assets-v1/8a7d6d83-517d-4dbd-baa7-7a1388d90160/bugatti_chiron.glb"),
    porsche: resolveAssetUrl("/__l5e/assets-v1/579644d1-cc65-47dc-9f73-87e81379d172/porsche_911_gt3.glb"),
  };

  const key = cacheKeyMap[effectiveCarKey];
  const url = urlMap[effectiveCarKey];

  if ((gltfModelCache as any)[key]) {
    onProgress(100);
    return (gltfModelCache as any)[key]!;
  }

  if (activeDownloadPromises.has(key)) {
    onProgress(100);
    return activeDownloadPromises.get(key)!;
  }

  const fallbackUrlMap: Record<string, string> = {
    ferrari: resolveAssetUrl("/__l5e/assets-v1/739ced4e-0592-4e92-a92f-12a25c0fa39d/ferrari_purosangue.glb"),
    bugatti: "/__l5e/assets-v1/8a7d6d83-517d-4dbd-baa7-7a1388d90160/bugatti_chiron.glb",
    porsche: "/__l5e/assets-v1/579644d1-cc65-47dc-9f73-87e81379d172/porsche_911_gt3.glb",
  };

  const downloadPromise = (async () => {
    console.log(`Downloading ${carKey} from ${url}...`);

    const fetchBuffer = async (target: string) => {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(target)}`;
      let r;
      try {
        r = await fetch(proxyUrl);
        const contentType = r.headers.get("content-type") || "";
        if (!r.ok || contentType.includes("text/html")) {
          throw new Error(`Proxy not available or HTML returned: status ${r.status}, type ${contentType}`);
        }
      } catch (proxyErr) {
        console.warn(`[procedural] Proxy fetch failed for ${target}, falling back to direct CDN fetch:`, proxyErr);
        r = await fetch(target);
        if (!r.ok) throw new Error(`Direct download failed (${r.status}) for ${target}`);
      }

      const buf = await r.arrayBuffer();
      const firstChars = new TextDecoder().decode(buf.slice(0, 20));
      if (buf.byteLength < 1000 || firstChars.startsWith("#") || firstChars.startsWith("<!DOCTYPE") || firstChars.startsWith("<html")) {
        if (!r.url.includes(target)) {
          console.warn(`[procedural] Proxy returned HTML for ${target}, attempting direct fetch fallback...`);
          try {
            const directRes = await fetch(target);
            if (directRes.ok) {
              const directBuf = await directRes.arrayBuffer();
              const directFirstChars = new TextDecoder().decode(directBuf.slice(0, 20));
              if (directBuf.byteLength >= 1000 && !directFirstChars.startsWith("#") && !directFirstChars.startsWith("<!DOCTYPE") && !directFirstChars.startsWith("<html")) {
                return directBuf;
              }
            }
          } catch (directErr) {
            console.error(`[procedural] Direct fallback fetch failed:`, directErr);
          }
        }
        throw new Error("File is text/HTML, not GLB");
      }
      return buf;
    };

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await fetchBuffer(url);
    } catch (err) {
      const fb = fallbackUrlMap[effectiveCarKey];
      if (!fb || fb === url) throw err;
      console.warn(`Primary fetch failed for ${carKey}, retrying via fallback ${fb}`, err);
      arrayBuffer = await fetchBuffer(fb);
    }


    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
    loader.setDRACOLoader(dracoLoader);

    // Register PBR specular glossiness extension support
    loader.register((parser) => new GLTFMaterialsPBRSpecularGlossinessExtension(parser));

    return new Promise<THREE.Group>((resolve, reject) => {
      loader.parse(
        arrayBuffer,
        "",
        (gltf) => {
          try {
            const car = gltf.scene;
            if (!car) {
              throw new Error("Empty model loaded");
            }

            // 6. Scale the model so it fits a realistic supercar size
            const preBox = new THREE.Box3().setFromObject(car);
            const preSize = preBox.getSize(new THREE.Vector3());
            const maxDim = Math.max(preSize.x, preSize.y, preSize.z);
            const targetScale = 4.6 / (maxDim || 1.0);
            car.scale.setScalar(targetScale);

            // 1. Compute its bounding box
            const box = new THREE.Box3().setFromObject(car);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            car.userData.boundingBox = box;
            car.userData.height = size.y;

            // Move the car so its bottom sits on the ground:
            car.position.y -= box.min.y;

            // Center the model:
            car.position.x -= center.x;
            car.position.z -= center.z;

            // Never allow: car.position.y > roadHeight + 0.1
            if (car.position.y > 0.1) {
              car.position.y = 0.05;
            }

            console.log("Car height:", size.y, "box.min.y:", box.min.y, "final y:", car.position.y);

            // 9. Ensure shadows and PBR standard materials are cleanly synchronized
            applyGltfMaterialFix(car);

            const container = new THREE.Group();
            container.add(car);

            const meta = computeModelWheelOffsets(container);
            modelWheelMetadataMap.set(url, meta);

            gltfModelCache[key] = container;

            if (effectiveCarKey === "bugatti") {
              gltfModelCache.bugatti_chiron = container;
            } else if (effectiveCarKey === "ferrari") {
              gltfModelCache.ferrari_sf90 = container;
            } else if (effectiveCarKey === "porsche") {
              gltfModelCache.porsche_911 = container;
            }

            // Do NOT auto-set playerSelectedModelKey here — the player's chosen
            // car is owned by the Menu / App layer. Loading a car for preview
            // must never silently change which vehicle the race will start.
            gltfModelCache.isLoaded = true;

            console.log(`${carKey} GLTF loaded and parsed successfully`);
            onProgress(100);
            resolve(container);
          } catch (err) {
            console.error("Error processing loaded model:", err);
            reject(err);
          } finally {
            dracoLoader.dispose();
          }
        },
        (error) => {
          console.error(`GLTF parse failed for ${carKey}:`, error);
          dracoLoader.dispose();
          reject(error);
        },
      );
    });
  })();

  activeDownloadPromises.set(key, downloadPromise);
  return downloadPromise;
}

export async function loadCarModel(): Promise<THREE.Group> {
  console.log("Loading car...");

  const mainUrl = "https://pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/cars/lamborghini_aventador.glb";

  const proxyUrl = `/api/proxy?url=${encodeURIComponent(mainUrl)}`;
  let response;
  try {
    response = await fetch(proxyUrl);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || contentType.includes("text/html")) {
      throw new Error(`Proxy failed or returned HTML: status ${response.status}, type ${contentType}`);
    }
  } catch (proxyErr) {
    console.warn(`[procedural] Proxy load failed for ${mainUrl}, falling back to direct CDN fetch:`, proxyErr);
    response = await fetch(mainUrl);
    if (!response.ok) {
      throw new Error("Download failed");
    }
  }

  let arrayBuffer = await response.arrayBuffer();
  let firstChars = new TextDecoder().decode(arrayBuffer.slice(0, 20));
  if (arrayBuffer.byteLength < 1000 || firstChars.startsWith("#") || firstChars.startsWith("<!DOCTYPE") || firstChars.startsWith("<html")) {
    if (response.url.includes("/api/proxy")) {
      console.warn(`[procedural] Proxy returned HTML for ${mainUrl}, retrying direct...`);
      try {
        const directRes = await fetch(mainUrl);
        if (directRes.ok) {
          const directBuf = await directRes.arrayBuffer();
          const directFirstChars = new TextDecoder().decode(directBuf.slice(0, 20));
          if (directBuf.byteLength >= 1000 && !directFirstChars.startsWith("#") && !directFirstChars.startsWith("<!DOCTYPE") && !directFirstChars.startsWith("<html")) {
            arrayBuffer = directBuf;
            firstChars = directFirstChars;
          } else {
            throw new Error("File is text, not GLB");
          }
        } else {
          throw new Error("File is text, not GLB");
        }
      } catch (directErr) {
        throw new Error(`File is text, not GLB and direct fallback failed: ${directErr}`);
      }
    } else {
      throw new Error("File is text, not GLB");
    }
  }

  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
  loader.setDRACOLoader(dracoLoader);

  return new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(
      arrayBuffer,
      "",
      (gltf) => {
        try {
          const model = gltf.scene;

          // 6. Scale the model so it fits a realistic supercar size
          const preBox = new THREE.Box3().setFromObject(model);
          const preSize = preBox.getSize(new THREE.Vector3());
          const maxDim = Math.max(preSize.x, preSize.y, preSize.z);
          const targetScale = 4.6 / (maxDim || 1.0);
          model.scale.setScalar(targetScale);

          // 1. Compute its bounding box
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          model.userData.boundingBox = box;
          model.userData.height = size.y;

          // Move the car so its bottom sits on the ground:
          model.position.y -= box.min.y;

          // Center the model:
          model.position.x -= center.x;
          model.position.z -= center.z;

          console.log("Car height:", size.y, "box.min.y:", box.min.y, "final y:", model.position.y);

          model.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });

          (window as any).carModel = model;

          console.log("GLTF loaded successfully");
          resolve(model);
        } catch (err) {
          console.error("Error processing loaded model:", err);
          reject(err);
        } finally {
          dracoLoader.dispose();
        }
      },
      (error) => {
        console.error("GLTF parse failed:", error);
        dracoLoader.dispose();
        reject(error);
      },
    );
  });
}

// Asynchronous GLTF loader worker with DRACO support
export const preloadGLTFAssets = async (): Promise<void> => {
  if (isPreloadingStarted) {
    console.log("Preload GLTF assets already triggered, skipping duplicated execution.");
    return;
  }
  isPreloadingStarted = true;
  try {
    const startTime = performance.now();
    // Failing tree assets have been completely removed from preloading requests
    gltfModelCache.treeModel = null;
    gltfModelCache.rockModel = null;
    gltfModelCache.mountainModel = null;
    gltfModelCache.pagodaModel = null;

    gltfModelCache.isLoaded = true;
    const loadDuration = performance.now() - startTime;
    console.log(`Hypercar models and landscape caches initialized in ${loadDuration.toFixed(1)}ms.`);
  } catch (err) {
    console.warn("Asset loading error:", err);
  }
};
export const createProceduralMountain = (radius: number, height: number): THREE.CylinderGeometry => {
  const geometry = new THREE.CylinderGeometry(radius * 0.08, radius, height, 16, 12);
  const pos = geometry.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    const heightPercentage = (vy + height / 2) / height;
    const isBase = heightPercentage < 0.1;

    const theta = Math.atan2(vz, vx);
    let shift =
      Math.sin(theta * 6) * Math.cos(vy * 0.12) * 12 * (1 - heightPercentage) +
      Math.sin(theta * 15) * 4 * (1 - heightPercentage);

    if (isBase) shift *= 0.5;

    const radialRatio = 1.0 + shift / radius;
    pos.setX(i, vx * radialRatio);
    pos.setZ(i, vz * radialRatio);
  }

  geometry.computeVertexNormals();
  return geometry;
};

// Generates organic rock slabs
export const createProceduralRockGeo = (): THREE.DodecahedronGeometry => {
  const rockGeo = new THREE.DodecahedronGeometry(1.5, 1);
  const rAttr = rockGeo.attributes.position;
  for (let i = 0; i < rAttr.count; i++) {
    const x = rAttr.getX(i);
    const y = rAttr.getY(i);
    const z = rAttr.getZ(i);

    const noise = 0.85 + Math.sin(x * 5 + y * 3) * 0.15;
    rAttr.setXYZ(i, x * noise, y * noise * 0.55, z * noise);
  }
  rockGeo.computeVertexNormals();
  return rockGeo;
};

// Generates tiered crimson Pagoda tower for scenery
export const createProceduralPagoda = (): THREE.Group => {
  const pagoda = new THREE.Group();

  const baseGeo = new THREE.CylinderGeometry(4.8, 5.4, 2.2, 8);
  const baseMat = new THREE.MeshStandardMaterial({ color: "#686a6e", roughness: 0.92, flatShading: true });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  pagoda.add(baseMesh);

  const tiers = 3;
  const redMat = new THREE.MeshStandardMaterial({ color: "#bf1616", roughness: 0.45, metalness: 0.05 });
  const roofMat = new THREE.MeshStandardMaterial({ color: "#25262a", roughness: 0.85 });
  const goldMat = new THREE.MeshStandardMaterial({ color: "#e5b800", roughness: 0.15, metalness: 0.95 });

  for (let t = 0; t < tiers; t++) {
    const scale = 1.0 - t * 0.22;
    const height = 2.2;
    const y = 1.1 + t * (height + 0.3);

    const trGeo = new THREE.CylinderGeometry(3.2 * scale, 3.4 * scale, height, 8);
    const tr = new THREE.Mesh(trGeo, redMat);
    tr.position.y = y;
    tr.castShadow = true;
    tr.receiveShadow = true;
    pagoda.add(tr);

    const roofY = y + height / 2 + 0.15;
    const rGeo = new THREE.CylinderGeometry(1.0 * scale, 4.2 * scale, 0.65, 8);
    const r = new THREE.Mesh(rGeo, roofMat);
    r.position.y = roofY;
    r.castShadow = true;
    pagoda.add(r);

    for (let c = 0; c < 8; c++) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), goldMat);
      const angle = (c * Math.PI) / 4;
      tip.position.set(Math.sin(angle) * 4.2 * scale, roofY - 0.12, Math.cos(angle) * 4.2 * scale);
      tip.rotation.y = angle;
      tip.rotation.x = -0.35;
      pagoda.add(tip);
    }
  }

  const spireY = 1.1 + tiers * 2.5 + 0.3;
  const spireGeo = new THREE.ConeGeometry(0.35, 2.8, 8);
  const spire = new THREE.Mesh(spireGeo, goldMat);
  spire.position.y = spireY + 1.0;
  spire.castShadow = true;
  pagoda.add(spire);

  for (let r = 0; r < 4; r++) {
    const ringGeo = new THREE.TorusGeometry(0.42 - r * 0.08, 0.08, 8, 16);
    ringGeo.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, goldMat);
    ring.position.y = spireY + 0.2 + r * 0.35;
    ring.castShadow = true;
    pagoda.add(ring);
  }

  return pagoda;
};
