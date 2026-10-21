import { LOVABLE_ASSET_ORIGIN, R2_ASSET_ORIGIN } from "./assetCdn";

/** Public assets only; shared by Express, Vercel Edge and the Cloudflare worker. */
export async function proxyAsset(request: Request, extraHosts = ""): Promise<Response> {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Range, Accept-Ranges, ETag, Last-Modified",
  });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const fail = (status: number, message: string) => new Response(message, { status, headers });
  if (!["GET", "HEAD"].includes(request.method)) return fail(405, "Only GET and HEAD are supported");
  let target: URL;
  try {
    target = new URL(new URL(request.url).searchParams.get("url") || "");
  } catch {
    return fail(400, "A valid asset URL is required");
  }
  const allowedHosts = new Set([
    new URL(R2_ASSET_ORIGIN).hostname, new URL(LOVABLE_ASSET_ORIGIN).hostname,
    ...extraHosts.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
  ]);
  if (target.protocol !== "https:" || target.username || target.password || target.port || !allowedHosts.has(target.hostname)) {
    return fail(403, "Asset host is not allowed");
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("Range");
  if (range) upstreamHeaders.set("Range", range);
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  // Vercel Edge must send headers within 25 seconds; do not time-limit the body.
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetch(target, { method: request.method, headers: upstreamHeaders, redirect: "error", signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      await response.body?.cancel();
      return fail(response.status, `Asset upstream returned HTTP ${response.status} ${response.statusText}`);
    }
    for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Node fetch decompresses automatically. A compressed byte count would truncate
    // the decoded response when forwarded by Express.
    if (response.headers.get("content-encoding")) headers.delete("Content-Length");
    headers.set("Cache-Control", response.headers.get("cache-control") || "public, max-age=3600");
    return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
  } catch (error) {
    console.error(`[Asset Proxy] Upstream failed for ${target.origin}${target.pathname}:`, error);
    return fail(controller.signal.aborted ? 504 : 502, "Asset upstream request failed");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
}
