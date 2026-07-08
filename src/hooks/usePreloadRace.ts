/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import * as THREE from "three";
import { RaceLoader, RaceLoaderProgress } from "../services/RaceLoader";

export function usePreloadRace() {
  const [preloading, setPreloading] = useState(false);
  const [progState, setProgState] = useState<RaceLoaderProgress | null>(null);

  const triggerPreload = async (
    carId: string,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) => {
    setPreloading(true);
    try {
      await RaceLoader.loadRaceEnvironment(carId, renderer, scene, camera, (prog) => {
        setProgState(prog);
      });
    } catch (e) {
      console.error("Race Preloader Error:", e);
    } finally {
      setPreloading(false);
    }
  };

  return { preloading, progState, triggerPreload };
}
