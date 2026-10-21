export interface AssetProgress {
  source: string;
  bytesLoaded: number;
  bytesTotal: number | null;
  percentage: number;
  stage: "cache" | "downloading" | "validating" | "ready";
}

export interface GlbAsset {
  buffer: ArrayBuffer;
  sourceUrl: string;
}

export function validateGlb(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 20) throw new Error(`GLB is truncated (${buffer.byteLength} bytes)`);
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x46546c67) throw new Error("Expected a binary GLB (glTF header); received HTML, text, or invalid data");
  if (header.getUint32(4, true) !== 2) throw new Error("Unsupported GLB version; expected version 2");
  const declaredLength = header.getUint32(8, true);
  if (declaredLength !== buffer.byteLength) {
    throw new Error(`GLB is incomplete: header declares ${declaredLength} bytes, received ${buffer.byteLength}`);
  }
  const jsonLength = header.getUint32(12, true);
  if (header.getUint32(16, true) !== 0x4e4f534a || jsonLength === 0 || 20 + jsonLength > buffer.byteLength) {
    throw new Error("GLB has an invalid JSON chunk");
  }
  JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
}

export async function fetchGlbAsset(
  sources: string[],
  options: { onProgress?: (progress: AssetProgress) => void; signal?: AbortSignal; idleTimeoutMs?: number } = {},
): Promise<GlbAsset> {
  const failures: Error[] = [];
  for (const source of [...new Set(sources.filter(Boolean))]) {
    if (options.signal?.aborted) throw new DOMException("Asset request cancelled", "AbortError");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let response: Response | undefined;
    let stage = "request";
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const resetDeadline = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.idleTimeoutMs ?? 30000);
    };
    try {
      options.onProgress?.({ source, bytesLoaded: 0, bytesTotal: null, percentage: 0, stage: "downloading" });
      resetDeadline();
      response = await fetch(source, { signal: controller.signal, credentials: "omit" });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      if (/text\/|application\/(?:json|xml)/i.test(contentType)) {
        throw new Error(`HTTP ${response.status} returned ${contentType}, not a binary GLB`);
      }

      stage = "download";
      let buffer: ArrayBuffer;
      if (!response.body) {
        buffer = await response.arrayBuffer();
      } else {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        let total = Number(response.headers.get("content-length")) || null;
        const header = new Uint8Array(12);
        let headerLength = 0;
        try {
          while (true) {
            resetDeadline();
            const { value, done } = await reader.read();
            if (done) break;
            if (!value) continue;
            chunks.push(value);
            loaded += value.byteLength;
            if (headerLength < 12) {
              const part = value.subarray(0, 12 - headerLength);
              header.set(part, headerLength);
              headerLength += part.byteLength;
              if (headerLength === 12 && new DataView(header.buffer).getUint32(0, true) === 0x46546c67) {
                // The GLB's own length is reliable even with chunked/gzipped HTTP.
                total = new DataView(header.buffer).getUint32(8, true);
              }
            }
            options.onProgress?.({ source, bytesLoaded: loaded, bytesTotal: total,
              percentage: total ? Math.min(99, Math.floor(loaded / total * 100)) : 0, stage: "downloading" });
          }
        } finally {
          reader.releaseLock();
        }
        const combined = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
        buffer = combined.buffer;
      }
      clearTimeout(timer);
      stage = "validation";
      options.onProgress?.({ source, bytesLoaded: buffer.byteLength, bytesTotal: buffer.byteLength, percentage: 99, stage: "validating" });
      validateGlb(buffer);
      options.onProgress?.({ source, bytesLoaded: buffer.byteLength, bytesTotal: buffer.byteLength, percentage: 100, stage: "ready" });
      return { buffer, sourceUrl: source };
    } catch (cause) {
      controller.abort();
      if (options.signal?.aborted) throw new DOMException("Asset request cancelled", "AbortError");
      const detail = timedOut ? "Timed out waiting for asset data"
        : cause instanceof Error ? cause.message : String(cause);
      const error = new Error(`${source}: ${detail}${!response && !timedOut ? " (network/CORS; no HTTP status available)" : ""}`, { cause });
      console.error("[GLB Asset] Source failed", { source, stage, status: response?.status, contentType: response?.headers.get("content-type") }, cause);
      failures.push(error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  throw new AggregateError(failures, `Asset loading failed. ${failures.map((error) => error.message).join("; ")}`);
}
