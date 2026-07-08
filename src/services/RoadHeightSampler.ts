import * as THREE from "three";
import { TrackGeometryHelper } from "../utils/track";

export class RoadHeightSampler {
  /**
   * Samples the nearest spline coordinate on the track to obtain the road elevation
   */
  public static getRoadHeightAt(pos: THREE.Vector3, trackHelper: TrackGeometryHelper): number {
    if (!pos || !trackHelper) return 0;
    try {
      if (typeof trackHelper.getNearestTrackInfo === "function") {
        const query = trackHelper.getNearestTrackInfo(pos);
        if (query && query.nearestPoint) {
          return query.nearestPoint.y;
        }
      }
    } catch (e) {
      console.warn("[RoadHeightSampler] Failed sampling nearest spline point height:", e);
    }
    return pos.y; // fallback
  }
}
