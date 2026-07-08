import * as THREE from "three";
import { CarState } from "../types";

export class VehicleEffects {
  private fileScene: THREE.Scene;

  // Cache nitrous flame meshes per car to avoid traversing the 3D trees inside render loops
  public flameCacheMap = new Map<string, THREE.Mesh[]>();

  constructor(scene: THREE.Scene) {
    this.fileScene = scene;
  }

  /**
   * Registers a vehicle group to scan and cache its available nitrous flame exhaust meshes.
   */
  public registerCarFlames(carId: string, carGroup: THREE.Group): THREE.Mesh[] {
    let cached = this.flameCacheMap.get(carId);
    if (cached) return cached;

    const flames: THREE.Mesh[] = [];
    carGroup.traverse((node) => {
      if (node.name === "nitro_flame" && node instanceof THREE.Mesh) {
        flames.push(node);
      }
    });

    this.flameCacheMap.set(carId, flames);
    return flames;
  }

  /**
   * Coordinates nitrous flame ignition states, dynamic color changes, and flickering animations.
   */
  public update(cars: CarState[], carGroupMap: Map<string, THREE.Group>): void {
    cars.forEach((c) => {
      const carGroup = carGroupMap.get(c.id);
      if (!carGroup) return;

      const flames = this.registerCarFlames(c.id, carGroup);
      if (flames.length === 0) return;

      const active = c.isNitroActive;

      flames.forEach((flame) => {
        const mat = flame.material as THREE.MeshBasicMaterial;
        if (active) {
          // Flickering flame length and additive colors
          flame.scale.set(1, 1, 1.2 + Math.random() * 0.9);
          if (mat) {
            mat.opacity = 0.88;
            mat.color.set(Math.random() > 0.45 ? "#00eaff" : "#6a00ff");
          }
        } else {
          flame.scale.set(1, 1, 0.1);
          if (mat) {
            mat.opacity = 0.0;
          }
        }
      });
    });
  }

  public destroy(): void {
    this.flameCacheMap.clear();
  }
}
export default VehicleEffects;
