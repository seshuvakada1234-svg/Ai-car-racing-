/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CacheManager } from "./CacheManager";
import { getAssetProxyUrl } from "./assetCdn";
import { fetchGlbAsset, validateGlb } from "./glbAsset";

export interface DownloadProgress {
  id: string;
  name: string;
  bytesLoaded: number;
  bytesTotal: number;
  percentage: number;
}

export class DownloadManager {
  public static async downloadWithProgress(
    id: string, name: string, url: string, onProgress: (progress: DownloadProgress) => void,
  ): Promise<Blob> {
    const cached = await CacheManager.getCacheResponse(url);
    if (cached) {
      try {
        const buffer = await cached.arrayBuffer();
        validateGlb(buffer);
        onProgress({ id, name, bytesLoaded: buffer.byteLength, bytesTotal: buffer.byteLength, percentage: 100 });
        return new Blob([buffer], { type: "model/gltf-binary" });
      } catch (error) {
        console.warn(`[DownloadManager] Invalid cached ${id}:`, error);
        await CacheManager.deleteCache(url);
      }
    }
    const asset = await fetchGlbAsset([url, getAssetProxyUrl(url, import.meta.env?.VITE_ASSET_PROXY_URL || undefined)], {
      onProgress: (progress) => onProgress({
        id, name, bytesLoaded: progress.bytesLoaded, bytesTotal: progress.bytesTotal || 0, percentage: progress.percentage,
      }),
    });
    const blob = new Blob([asset.buffer], { type: "model/gltf-binary" });
    await CacheManager.putCache(url, new Response(blob, { headers: { "content-type": blob.type, "content-length": String(blob.size) } }));
    return blob;
  }
}
