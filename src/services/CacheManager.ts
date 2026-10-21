/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class CacheManager {
  private static CACHE_NAME = "ai-race-arena-cache-v1";

  private static async open(): Promise<Cache | null> {
    try {
      return typeof caches !== "undefined" ? await caches.open(this.CACHE_NAME) : null;
    } catch (error) {
      console.warn("[CacheManager] Cache Storage unavailable:", error);
      return null;
    }
  }

  public static async hasCache(url: string): Promise<boolean> {
    return !!(await this.getCacheResponse(url));
  }

  public static async putCache(url: string, response: Response): Promise<void> {
    try { await (await this.open())?.put(url, response); }
    catch (error) { console.warn("[CacheManager] Could not persist downloaded asset:", error); }
  }

  public static async getCacheResponse(url: string): Promise<Response | null> {
    try { return await (await this.open())?.match(url) || null; }
    catch (error) { console.warn("[CacheManager] Cache read failed:", error); return null; }
  }

  public static async deleteCache(url: string): Promise<boolean> {
    try { return await (await this.open())?.delete(url) || false; }
    catch (error) { console.warn("[CacheManager] Cache delete failed:", error); return false; }
  }

  public static async clear(): Promise<boolean> {
    if (typeof caches === "undefined") return false;
    return caches.delete(this.CACHE_NAME);
  }
}
