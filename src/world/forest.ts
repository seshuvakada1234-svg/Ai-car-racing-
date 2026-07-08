// Legacy procedural/R2 forest system has been fully removed.
// All vegetation must come from the loaded GLB map (e.g. Racing 2).
// This stub keeps existing imports compiling without spawning any trees,
// billboards, fallbacks, or remote asset loads.
//
// Removed:
//  - Procedural trunk/leaf placeholder trees (white & black trunk fallbacks)
//  - Random/Perlin-clustered tree spawning
//  - Billboard / cross-quad trees
//  - R2-hosted GLB tree loaders (sakura, tree_gn, stylized pack)
//  - Duplicated trackside vegetation outside the GLB

import * as THREE from "three";
import { TrackGeometryHelper } from "../utils/track";

export class ForestSystem {
  public static initialized = false;

  public init(_scene: THREE.Scene, _trackHelper: TrackGeometryHelper): void {
    ForestSystem.initialized = true;
  }

  public update(_playerPos?: THREE.Vector3): void {
    /* no-op: vegetation comes from GLB only */
  }

  public destroy(): void {
    ForestSystem.initialized = false;
  }
}

export const forestSystem = new ForestSystem();

export function buildForest(scene: THREE.Scene, trackHelper: TrackGeometryHelper): void {
  forestSystem.init(scene, trackHelper);
}
