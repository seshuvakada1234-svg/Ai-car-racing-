// Waterfall scenery removed. This stub keeps existing imports compiling
// without spawning any waterfall mesh, mist, or audio.
import * as THREE from "three";
import { TrackGeometryHelper } from "../utils/track";

export interface WaterfallController {
  waterfallMesh: THREE.Object3D | null;
  update: (elapsedSec: number) => void;
  dispose: () => void;
}

export function buildWaterfall(_scene: THREE.Scene, _trackHelper: TrackGeometryHelper): WaterfallController {
  return {
    waterfallMesh: null,
    update: () => {},
    dispose: () => {},
  };
}
