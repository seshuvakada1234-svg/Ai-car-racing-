/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { AssetManager } from "../services/AssetManager";

export function useAssetStatus() {
  const [checking, setChecking] = useState(true);
  const [allReady, setAllReady] = useState(false);
  const [readyMap, setReadyMap] = useState<Record<string, boolean>>({});

  const checkStatus = async () => {
    // Detect installed app (APK / Installed PWA / Standalone mode)
    const isStandalone =
      typeof window !== "undefined" &&
      (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true);
    const isAndroidWebView = typeof navigator !== "undefined" && navigator.userAgent.includes("wv");
    const shouldShowAssetInstaller = isStandalone || isAndroidWebView;

    if (!shouldShowAssetInstaller) {
      // Normal website user: stream from CDN immediately with no download UI
      setReadyMap({});
      setAllReady(true);
      setChecking(false);
      return;
    }

    setChecking(true);
    await AssetManager.init();
    const assets = AssetManager.getAssets();
    const map: Record<string, boolean> = {};
    let ok = true;

    for (const asset of assets) {
      const ready = await AssetManager.isAssetReady(asset.id);
      map[asset.id] = ready;
      // We only require a single car or fundamental textures to launch nicely,
      // but let's check overall matching so we inform user about missing ones
      if (!ready && (asset.category === "textures" || asset.category === "audio")) {
        ok = false;
      }
    }

    // Check if at least one car is fully cached
    const carKeys = ["ferrari_purosangue", "bugatti_chiron_top_edition", "porsche_911_gt3"];
    const hasCar = carKeys.some((k) => map[k]);
    if (!hasCar) ok = false;

    setReadyMap(map);
    setAllReady(ok);
    setChecking(false);
  };

  useEffect(() => {
    checkStatus();
  }, []);

  return { checking, allReady, readyMap, checkStatus };
}
