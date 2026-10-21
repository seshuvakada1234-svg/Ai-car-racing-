import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRacingMap, invalidateRacingMap } from "./racingMapAsset";
import { makeGlb } from "../test/glbFixture";

beforeEach(async () => { await invalidateRacingMap(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("shared racing map cache", () => {
  it("shares a download between the lobby and world, then reuses the verified bytes", async () => {
    const buffer = makeGlb();
    const fetch = vi.fn().mockResolvedValue(new Response(buffer));
    vi.stubGlobal("fetch", fetch);
    const [lobby, world] = await Promise.all([loadRacingMap(), loadRacingMap()]);
    expect(lobby).toBe(world);
    expect(await loadRacingMap()).toBe(world);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("discards poisoned cached HTML and stores only a verified GLB", async () => {
    const cache = { match: vi.fn().mockResolvedValue(new Response("<html>cached error</html>")), delete: vi.fn(), put: vi.fn() };
    vi.stubGlobal("caches", { open: async () => cache });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(makeGlb())));
    await loadRacingMap();
    expect(cache.delete).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it("keeps working when Cache Storage is unavailable or full", async () => {
    vi.stubGlobal("caches", { open: async () => { throw new Error("Cache access denied"); } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(makeGlb())));
    await expect(loadRacingMap()).resolves.toHaveProperty("buffer");
    await invalidateRacingMap();
    vi.stubGlobal("caches", { open: async () => ({ match: async () => undefined, put: async () => { throw new Error("QuotaExceededError"); } }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(makeGlb())));
    await expect(loadRacingMap()).resolves.toHaveProperty("buffer");
  });

  it("does not retain a rejected download promise after failure", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    await expect(loadRacingMap()).rejects.toThrow("Asset loading failed");
    fetch.mockResolvedValue(new Response(makeGlb()));
    await expect(loadRacingMap()).resolves.toHaveProperty("buffer");
  });
});
