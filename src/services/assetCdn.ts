/**
 * Resolves a Lovable asset URL to an absolute CDN URL so it works on any host
 * (Vercel, custom domains, etc.) — not just the Lovable preview/published origin.
 *
 * The `/__l5e/assets-v1/...` path is served by Lovable infrastructure with
 * `Access-Control-Allow-Origin: *`, so the absolute origin can be safely used
 * cross-origin.
 */
const LOVABLE_ASSET_ORIGIN = "https://4b7da1fe-c92c-4725-9976-10cbed037ebf.lovableproject.com";

export function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/__l5e/")) return LOVABLE_ASSET_ORIGIN + url;
  return url;
}
