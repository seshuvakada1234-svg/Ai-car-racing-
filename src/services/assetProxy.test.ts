import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyAsset } from "./assetProxy";
import { R2_ASSET_ORIGIN } from "./assetCdn";

afterEach(() => vi.unstubAllGlobals());
const request = (url: string, init?: RequestInit) => new Request(`https://game.example/api/proxy?url=${encodeURIComponent(url)}`, init);

describe("deployed asset proxy contract", () => {
  it("streams binary responses and preserves range/CORS headers", async () => {
    let output: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { output = controller; } });
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 206, headers: { "content-length": "4", "content-range": "bytes 0-3/100", "content-type": "model/gltf-binary" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await proxyAsset(request(`${R2_ASSET_ORIGIN}/map/Untitled12.glb`, { headers: { Range: "bytes=0-3" } }));
    // The proxy returns before the upstream body finishes; it is not buffered.
    expect(response.status).toBe(206);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-3/100");
    expect(fetch.mock.calls[0][1].headers.get("Range")).toBe("bytes=0-3");
    output!.enqueue(new Uint8Array([103, 108, 84, 70]));
    output!.close();
    expect(await response.text()).toBe("glTF");
  });

  it.each(["http://127.0.0.1/private", "https://untrusted.example/asset.glb", "https://user:password@pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/map.glb"])("rejects unapproved targets: %s", async (url) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await proxyAsset(request(url))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves upstream HTTP errors and supports CORS preflight", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Missing", { status: 404 })));
    const response = await proxyAsset(request(`${R2_ASSET_ORIGIN}/missing.glb`));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("HTTP 404");
    expect((await proxyAsset(request(`${R2_ASSET_ORIGIN}/map.glb`, { method: "OPTIONS" }))).status).toBe(204);
  });
});
