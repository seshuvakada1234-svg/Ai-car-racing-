/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { AssetManager } from "./AssetManager";
import { ShaderPreloader } from "./ShaderPreloader";
import { gltfModelCache, GLTFMaterialsPBRSpecularGlossinessExtension } from "../world/procedural";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { applyGltfMaterialFix } from "../utils/gltfMaterialFix";

export interface RaceLoaderProgress {
  stage: string;
  percent: number;
}

export class RaceLoader {
  /**
   * Sequence that must fully complete before allowing race countdown to execute
   */
  public static async loadRaceEnvironment(
    selectedCarId: string,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    onProgress: (prog: RaceLoaderProgress) => void,
  ): Promise<void> {
    onProgress({ stage: "Checking downloaded files...", percent: 10 });
    await AssetManager.init();

    // 1. Load chosen car. Wait fully until loaded from direct storage verified files
    onProgress({ stage: "Loading selected high-end supercar model...", percent: 35 });

    let localCarId = selectedCarId;
    if (
      localCarId.includes("lamborghini") ||
      !localCarId ||
      (!localCarId.includes("porsche") && !localCarId.includes("ferrari") && !localCarId.includes("bugatti"))
    ) {
      console.warn("lamborghini_aventador.glb removed - using fallback car.");
      localCarId = "ferrari";
    }

    const carMapKey = localCarId.includes("porsche")
      ? "porsche_911_gt3"
      : localCarId.includes("ferrari")
        ? "ferrari_purosangue"
        : localCarId.includes("bugatti")
          ? "bugatti_chiron_top_edition"
          : "ferrari_purosangue";

    let localBlob = await AssetManager.getVerifiedBlob(carMapKey);
    if (!localBlob) {
      console.log(`RaceLoader: ${carMapKey} not stored locally, attempting to stream from CDN...`);
      const asset = AssetManager.getAssets().find((a) => a.id === carMapKey);
      if (asset?.url) {
        try {
          const proxyUrl = `/api/proxy?url=${encodeURIComponent(asset.url)}`;
          let res = await fetch(proxyUrl);
          const contentType = res.headers.get("content-type") || "";
          if (!res.ok || contentType.includes("text/html")) {
            console.warn(`RaceLoader: Proxy fetch failed or returned HTML, retrying direct CDN fetch...`);
            res = await fetch(asset.url);
          }
          if (res.ok) {
            localBlob = await res.blob();
            console.log(`RaceLoader: Streamed ${carMapKey} successfully from CDN.`);
          }
        } catch (err) {
          console.warn(`RaceLoader: Failed to stream ${carMapKey} via proxy, trying direct fallback...`, err);
          try {
            const res = await fetch(asset.url);
            if (res.ok) {
              localBlob = await res.blob();
              console.log(`RaceLoader: Direct fallback streamed ${carMapKey} successfully from CDN.`);
            }
          } catch (directErr) {
            console.error(`RaceLoader: Direct fallback fetch failed as well:`, directErr);
          }
        }
      }
    }

    if (localBlob) {
      try {
        const buffer = await localBlob.arrayBuffer();
        const loader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
        loader.setDRACOLoader(dracoLoader);
        loader.register((parser) => new GLTFMaterialsPBRSpecularGlossinessExtension(parser));

        await new Promise<void>((resolve, reject) => {
          loader.parse(
            buffer,
            "",
            (gltf) => {
              applyGltfMaterialFix(gltf.scene);
              (gltfModelCache as any)[carMapKey] = gltf.scene;
              gltfModelCache.isLoaded = true;
              dracoLoader.dispose();
              resolve();
            },
            (err) => {
              dracoLoader.dispose();
              reject(err);
            },
          );
        });
      } catch (err) {
        console.warn(
          `RaceLoader: Parsed stored model fail for ${carMapKey}, utilizing beautiful procedural backups:`,
          err,
        );
        gltfModelCache.isLoaded = true;
      }
    } else {
      console.warn(`RaceLoader: Car asset not stored locally and stream failed, utilizing procedural geometry.`);
      gltfModelCache.isLoaded = true;
    }

    onProgress({ stage: "Preparing track environment structures...", percent: 65 });
    await new Promise((resolve) => setTimeout(resolve, 300)); // Simulating map setup

    // 2. Pre-compile WebGL shaders to avoid compiler stalls
    onProgress({ stage: "Warming graphics cards & compiling shaders...", percent: 85 });
    await ShaderPreloader.preloadShaders(renderer, scene, camera);

    onProgress({ stage: "Calibrating active simulation frames...", percent: 100 });
  }
}
