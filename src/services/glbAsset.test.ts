import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGlbAsset, validateGlb, type AssetProgress } from "./glbAsset";
import { makeGlb } from "../test/glbFixture";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("verified GLB downloads", () => {
  it("rejects HTML masquerading as HTTP 200 and falls back to valid bytes", async () => {
    const buffer = makeGlb();
    const fetch = vi.fn().mockResolvedValueOnce(new Response("<html>SPA</html>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(buffer, { headers: { "content-type": "application/octet-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const result = await fetchGlbAsset(["/api/proxy", "https://assets.example/map.glb"]);
    expect(result.buffer).toEqual(buffer);
    expect(result.sourceUrl).toBe("https://assets.example/map.glb");
  });

  it("reports each HTTP/network failure without marking the asset ready", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch")));
    const progress = vi.fn();
    await expect(fetchGlbAsset(["/proxy", "https://assets.example/map.glb"], { onProgress: progress }))
      .rejects.toThrow(/HTTP 403.*Failed to fetch.*network\/CORS/);
    expect(progress.mock.calls.some(([p]) => p.stage === "ready")).toBe(false);
  });

  it("rejects truncated GLBs even when their HTTP response succeeds", async () => {
    const truncated = makeGlb().slice(0, -4);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(truncated)));
    await expect(fetchGlbAsset(["/map.glb"])).rejects.toThrow("GLB is incomplete");
    expect(() => validateGlb(new TextEncoder().encode("<!doctype html>wrong content").buffer)).toThrow("Expected a binary GLB");
  });

  it("uses the GLB header for progress when Content-Length is absent", async () => {
    const buffer = makeGlb();
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(buffer, 0, 12));
      controller.enqueue(new Uint8Array(buffer, 12));
      controller.close();
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    const progress: AssetProgress[] = [];
    await fetchGlbAsset(["/map.glb"], { onProgress: (p) => progress.push(p) });
    expect(progress.find((p) => p.bytesLoaded === 12)?.bytesTotal).toBe(buffer.byteLength);
    expect(progress.at(-1)).toMatchObject({ percentage: 100, stage: "ready" });
    expect(progress.every((p) => Number.isFinite(p.percentage))).toBe(true);
  });

  it("allows a progressing download to take longer than fifteen seconds", async () => {
    vi.useFakeTimers();
    const buffer = makeGlb();
    const stream = new ReadableStream({ start(controller) {
      setTimeout(() => controller.enqueue(new Uint8Array(buffer, 0, 12)), 16000);
      setTimeout(() => { controller.enqueue(new Uint8Array(buffer, 12)); controller.close(); }, 32000);
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    const promise = fetchGlbAsset(["/slow.glb"]);
    await vi.advanceTimersByTimeAsync(32000);
    expect((await promise).buffer).toEqual(buffer);
  });

  it("fails a stalled source with a timeout and a retryable error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const expectation = expect(fetchGlbAsset(["/stalled.glb"], { idleTimeoutMs: 100 })).rejects.toThrow("Timed out waiting for asset data");
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });
});
