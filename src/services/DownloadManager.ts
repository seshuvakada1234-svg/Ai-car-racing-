// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CacheManager } from "./CacheManager";

export interface DownloadProgress {
  id: string;
  name: string;
  bytesLoaded: number;
  bytesTotal: number;
  percentage: number;
}

export class DownloadManager {
  public static async downloadWithProgress(
    id: string,
    name: string,
    url: string,
    onProgress: (progress: DownloadProgress) => void,
  ): Promise<Blob> {
    // Check cache first
    const cachedResponse = await CacheManager.getCacheResponse(url);
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      onProgress({
        id,
        name,
        bytesLoaded: blob.size,
        bytesTotal: blob.size,
        percentage: 100,
      });
      return blob;
    }

    const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    let response;
    try {
      response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Proxy status: ${response.status}`);
      }
    } catch (proxyErr) {
      console.warn(`[DownloadManager] Proxy download failed, falling back to direct CDN fetch:`, proxyErr);
      response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download asset: ${name}`);
      }
    }

    // Keep Response cloned for Cache API
    const cacheClone = response.clone();

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || response.status === 404) {
      throw new Error(`Asset not found or returned HTML: ${name}`);
    }

    const reader = response.body?.getReader();
    const contentLength = +(response.headers.get("content-length") || "0");

    if (!reader) {
      const blob = await response.blob();
      onProgress({
        id,
        name,
        bytesLoaded: blob.size,
        bytesTotal: blob.size,
        percentage: 100,
      });
      await CacheManager.putCache(url, cacheClone);
      return blob;
    }

    let loaded = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
        loaded += value.length;
        const total = contentLength || loaded;

        onProgress({
          id,
          name,
          bytesLoaded: loaded,
          bytesTotal: total,
          percentage: total > 0 ? Math.floor((loaded / total) * 100) : 100,
        });
      }
    }

    const compiledBlob = new Blob(chunks);
    await CacheManager.putCache(
      url,
      new Response(compiledBlob, {
        headers: {
          "content-type": cacheClone.headers.get("content-type") || "application/octet-stream",
          "content-length": compiledBlob.size.toString(),
        },
      }),
    );

    return compiledBlob;
  }
}