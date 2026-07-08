import * as THREE from "three";
import { TrackGeometryHelper } from "../utils/track";

/**
 * Cliff/hairpin rock walls disabled for the Dragon Track forest map.
 * Forest map is a flat open forest landscape — no cliffs, canyon walls, or steep rocks.
 * Kept as a no-op so existing callers continue to compile.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildHairpins(_scene: THREE.Scene, _trackHelper: TrackGeometryHelper): void {
  // intentionally empty
}
