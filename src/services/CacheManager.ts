/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class CacheManager {
  private static CACHE_NAME = "ai-race-arena-cache-v1";

  public static async hasCache(url: string): Promise<boolean> {
    if (!("caches" in window)) return false;
    const cache = await caches.open(this.CACHE_NAME);
    const response = await cache.match(url);
    return !!response;
  }

  public static async putCache(url: string, response: Response): Promise<void> {
    if (!("caches" in window)) return;
    const cache = await caches.open(this.CACHE_NAME);
    await cache.put(url, response);
  }

  public static async getCacheResponse(url: string): Promise<Response | null> {
    if (!("caches" in window)) return null;
    const cache = await caches.open(this.CACHE_NAME);
    const response = await cache.match(url);
    return response || null;
  }

  public static async deleteCache(url: string): Promise<boolean> {
    if (!("caches" in window)) return false;
    const cache = await caches.open(this.CACHE_NAME);
    return await cache.delete(url);
  }

  public static async clear(): Promise<boolean> {
    if (!("caches" in window)) return false;
    return await caches.delete(this.CACHE_NAME);
  }
}
