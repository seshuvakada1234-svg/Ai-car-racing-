import { proxyAsset } from "../src/services/assetProxy";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
  return proxyAsset(request, process.env.ASSET_ALLOWED_HOSTS || "");
}
