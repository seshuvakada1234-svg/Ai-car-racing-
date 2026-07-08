/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { AssetManager, AssetInfo } from "../services/AssetManager";
import { DownloadProgress } from "../services/DownloadManager";

export function useDownloadProgress() {
  const [downloading, setDownloading] = useState(false);
  const [activeTask, setActiveTask] = useState<string>("");
  const [progresses, setProgresses] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const startDownload = async (assetsToDownload: AssetInfo[]) => {
    setDownloading(true);
    setError(null);
    const initialProgs: Record<string, number> = {};
    assetsToDownload.forEach((a) => {
      initialProgs[a.id] = 0;
    });
    setProgresses(initialProgs);

    try {
      for (const asset of assetsToDownload) {
        setActiveTask(asset.name);
        await AssetManager.downloadAsset(asset.id, (pObj: DownloadProgress) => {
          setProgresses((prev) => ({
            ...prev,
            [asset.id]: pObj.percentage,
          }));
        });
      }
    } catch (e: any) {
      console.error("Download failed:", e);
      setError(e.message || "Error downloading game assets. Please verify connection.");
    } finally {
      setDownloading(false);
    }
  };

  return { downloading, activeTask, progresses, error, startDownload };
}
