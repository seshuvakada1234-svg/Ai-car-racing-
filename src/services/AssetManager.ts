import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { StorageManager } from "./StorageManager";
import { DownloadManager, DownloadProgress } from "./DownloadManager";
import { AssetVerifier } from "./AssetVerifier";
import { resolveAssetUrl } from "./assetCdn";

// 1. Conforming offline installation types and definitions
export interface AssetInfo {
  id: string;
  name: string;
  url: string;
  size: number;
  category: "cars" | "textures" | "audio";
}

export class AssetManager {
  private static assets: AssetInfo[] = [
    {
      id: "ferrari_purosangue",
      name: "Ferrari Purosangue SUV",
      url: resolveAssetUrl("/__l5e/assets-v1/739ced4e-0592-4e92-a92f-12a25c0fa39d/ferrari_purosangue.glb"),
      size: 19540648,
      category: "cars",
    },
    {
      id: "bugatti_chiron_top_edition",
      name: "Bugatti Chiron Apex Edition",
      url: resolveAssetUrl("/__l5e/assets-v1/8a7d6d83-517d-4dbd-baa7-7a1388d90160/bugatti_chiron.glb"),
      size: 16468544,
      category: "cars",
    },
    {
      id: "porsche_911_gt3",
      name: "Porsche 911 GT3 RS",
      url: resolveAssetUrl("/__l5e/assets-v1/579644d1-cc65-47dc-9f73-87e81379d172/porsche_911_gt3.glb"),
      size: 17589288,
      category: "cars",
    },
  ];

  public static async init(): Promise<void> {
    await StorageManager.init();
  }

  public static getAssets(): AssetInfo[] {
    return this.assets;
  }

  public static async isAssetReady(id: string): Promise<boolean> {
    const asset = this.assets.find((a) => a.id === id);
    if (!asset) return false;
    const blob = await StorageManager.getAsset(id);
    if (!blob) return false;
    return await AssetVerifier.verifyBlob(blob, asset.size);
  }

  public static async getVerifiedBlob(id: string): Promise<Blob | null> {
    const asset = this.assets.find((a) => a.id === id);
    const blob = await StorageManager.getAsset(id);
    if (!blob) return null;
    const ok = await AssetVerifier.verifyBlob(blob, asset?.size);
    return ok ? blob : null;
  }

  public static async downloadAsset(id: string, onProgress: (progress: DownloadProgress) => void): Promise<Blob> {
    const asset = this.assets.find((a) => a.id === id);
    if (!asset) throw new Error(`Asset ${id} not found configured`);
    const blob = await DownloadManager.downloadWithProgress(id, asset.name, asset.url, onProgress);
    await StorageManager.saveAsset(id, blob);
    return blob;
  }
}

// Dedicated Cache Manager for preventing duplicate GLTF downloads and mapping asset paths
export class AssetCacheManager {
  private static cache = new Map<string, Promise<any>>();

  public static get(url: string): Promise<any> | undefined {
    return this.cache.get(url);
  }

  public static set(url: string, promise: Promise<any>): void {
    this.cache.set(url, promise);
  }

  public static has(url: string): boolean {
    return this.cache.has(url);
  }

  public static remapUrl(url: string): string {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    let p = url;
    if (p.startsWith("/")) {
      p = p.substring(1);
    }
    if (p.startsWith("nature/trees/")) {
      return `https://pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/Trees/${p.substring("nature/trees/".length)}`;
    }
    if (p.startsWith("nature/rocks/")) {
      return `https://pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/Rocks/${p.substring("nature/rocks/".length)}`;
    }
    if (p.startsWith("environment/")) {
      return `https://pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/Environment/${p.substring("environment/".length)}`;
    }
    return `https://pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/${p}`;
  }
}

// 2. High-performance Three.js caching module to prevent duplicate browser downloads
export class ThreeAssetLoader {
  private static instance: ThreeAssetLoader | null = null;
  private textureCache = new Map<string, THREE.Texture>();
  private materialCache = new Map<string, THREE.Material>();
  private audioCache = new Map<string, any>();

  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader | null = null;
  private textureLoader: THREE.TextureLoader;

  private constructor() {
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();

    try {
      const draco = new DRACOLoader();
      draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
      this.gltfLoader.setDRACOLoader(draco);
      this.dracoLoader = draco;
    } catch (e) {
      console.warn("DRACOLoader initialization failed:", e);
    }
  }

  public static getInstance(): ThreeAssetLoader {
    if (!ThreeAssetLoader.instance) {
      ThreeAssetLoader.instance = new ThreeAssetLoader();
    }
    return ThreeAssetLoader.instance;
  }

  public async loadGLTF(url: string): Promise<any> {
    const finalUrl = AssetCacheManager.remapUrl(url);

    if (AssetCacheManager.has(finalUrl)) {
      return AssetCacheManager.get(finalUrl)!;
    }

    const promise = (async () => {
      try {
        console.log(`Preflight fetching GLTF asset via proxy: ${finalUrl}`);
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(finalUrl)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) {
          console.error(`Asset missing: ${finalUrl} failed with status ${response.status}`);
          throw new Error("Asset missing");
        }
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          console.error(`Asset missing: ${finalUrl} returned HTML page instead of a binary GLTF file.`);
          throw new Error("Asset missing");
        }

        return await new Promise<any>((resolve, reject) => {
          this.gltfLoader.load(
            proxyUrl,
            (gltf) => {
              resolve(gltf);
            },
            undefined,
            (err) => {
              console.error(`GLTFLoader parsing error on ${finalUrl}:`, err);
              reject(err);
            },
          );
        });
      } catch (err) {
        console.error(`GLTF Preflight check failed for ${finalUrl}:`, err);
        throw err;
      }
    })();

    AssetCacheManager.set(finalUrl, promise);
    return promise;
  }

  public getTexture(url: string, colorSpace?: THREE.ColorSpace): THREE.Texture {
    if (this.textureCache.has(url)) {
      return this.textureCache.get(url)!;
    }

    const texture = this.textureLoader.load(url);
    if (colorSpace) {
      texture.colorSpace = colorSpace;
    }
    this.textureCache.set(url, texture);
    return texture;
  }

  public getMaterial(key: string, creator: () => THREE.Material): THREE.Material {
    if (this.materialCache.has(key)) {
      return this.materialCache.get(key)!;
    }
    const mat = creator();
    this.materialCache.set(key, mat);
    return mat;
  }

  public getAudio(url: string): any {
    if (this.audioCache.has(url)) {
      return this.audioCache.get(url)!;
    }
    const audio = new Audio(url);
    this.audioCache.set(url, audio);
    return audio;
  }
}

export const assetManager = ThreeAssetLoader.getInstance();
