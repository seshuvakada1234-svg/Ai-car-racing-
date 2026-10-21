import racing2Asset from "../assets/racing2.glb.asset.json";
import { getAssetProxyUrl, resolveAssetUrl, R2_ASSET_ORIGIN } from "./assetCdn";
import { fetchGlbAsset, validateGlb, type AssetProgress, type GlbAsset } from "./glbAsset";

export const RACING_MAP_URL = import.meta.env?.VITE_RACING_MAP_URL || `${R2_ASSET_ORIGIN}/map/Untitled12.glb`;
const CACHE_NAME = "map-assets-cache";
let loaded: GlbAsset | null = null;
let pending: Promise<GlbAsset> | null = null;
let lastProgress: AssetProgress | null = null;
const progressListeners = new Set<(progress: AssetProgress) => void>();

function report(progress: AssetProgress) {
  lastProgress = progress;
  progressListeners.forEach((listener) => listener(progress));
}

async function readMap(): Promise<GlbAsset> {
  let cache: Cache | undefined;
  try {
    if (typeof caches !== "undefined") {
      cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(RACING_MAP_URL);
      if (cached) {
        try {
          const buffer = await cached.arrayBuffer();
          validateGlb(buffer);
          report({ source: RACING_MAP_URL, bytesLoaded: buffer.byteLength, bytesTotal: buffer.byteLength, percentage: 100, stage: "cache" });
          return { buffer, sourceUrl: RACING_MAP_URL };
        } catch (error) {
          console.warn("[Racing Map] Discarding invalid cached GLB:", error);
          await cache.delete(RACING_MAP_URL);
        }
      }
    }
  } catch (error) {
    console.warn("[Racing Map] Cache Storage unavailable; loading from network:", error);
  }

  const customUrl = !!import.meta.env?.VITE_RACING_MAP_URL;
  const remotes = customUrl ? [RACING_MAP_URL] : [RACING_MAP_URL, resolveAssetUrl(racing2Asset.url)];
  const asset = await fetchGlbAsset([
    ...(!customUrl ? ["/assets/racing2.glb"] : []),
    ...remotes,
    ...remotes.filter((url) => /^https?:\/\//.test(url)).map((url) => getAssetProxyUrl(url, import.meta.env?.VITE_ASSET_PROXY_URL || undefined)),
  ], { onProgress: report });
  if (cache) {
    try {
      await cache.put(RACING_MAP_URL, new Response(asset.buffer, { headers: {
        "content-type": "model/gltf-binary", "content-length": String(asset.buffer.byteLength),
      } }));
    } catch (error) {
      // Quota/private-mode restrictions must not discard a valid downloaded map.
      console.warn("[Racing Map] Could not persist the verified GLB:", error);
    }
  }
  return asset;
}

/** Lobby, race setup and Racing2World share the same verified bytes and download. */
export async function loadRacingMap(onProgress?: (progress: AssetProgress) => void): Promise<GlbAsset> {
  if (onProgress) {
    progressListeners.add(onProgress);
    if (lastProgress) onProgress(lastProgress);
  }
  try {
    if (loaded) return loaded;
    if (!pending) {
      pending = readMap().then((asset) => { loaded = asset; return asset; }).finally(() => { pending = null; });
    }
    return await pending;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

export async function invalidateRacingMap(): Promise<void> {
  loaded = null;
  lastProgress = null;
  try {
    if (typeof caches !== "undefined") await (await caches.open(CACHE_NAME)).delete(RACING_MAP_URL);
  } catch (error) {
    console.warn("[Racing Map] Could not invalidate cache:", error);
  }
}
