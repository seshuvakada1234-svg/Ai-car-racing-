import * as THREE from "three";
import { CarState } from "../types";

export class RainSystem {
  private scene: THREE.Scene;
  public rainMesh: THREE.LineSegments | null = null;
  private readonly rainCount = 600;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createRainGeometry();
  }

  private createRainGeometry(): void {
    const rainGeo = new THREE.BufferGeometry();
    const rainPositions = new Float32Array(this.rainCount * 6);

    for (let r = 0; r < this.rainCount; r++) {
      const idx = r * 6;
      const rx = Math.random() * 120.0 - 60.0;
      const ry = Math.random() * 70.0;
      const rz = Math.random() * 120.0 - 60.0;

      // Start line vertex
      rainPositions[idx] = rx;
      rainPositions[idx + 1] = ry;
      rainPositions[idx + 2] = rz;

      // End line vertex
      rainPositions[idx + 3] = rx - 0.5;
      rainPositions[idx + 4] = ry - 3.5;
      rainPositions[idx + 5] = rz;
    }

    rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    const rainMat = new THREE.LineBasicMaterial({ color: "#cffafe", transparent: true, opacity: 0.38 });
    this.rainMesh = new THREE.LineSegments(rainGeo, rainMat);
    this.rainMesh.visible = false;
    this.scene.add(this.rainMesh);
  }

  /**
   * Translates the rain pillar relative to the player car's deck
   * to create an immersive dynamic weather environment.
   */
  public update(player: CarState | null, weather: string, elapsedSec: number): void {
    if (!this.rainMesh) return;

    if (weather === "rain" && player && player.position) {
      this.rainMesh.visible = true;
      this.rainMesh.position.set(player.position.x, 0, player.position.z);

      const rGeo = this.rainMesh.geometry;
      const posAttr = rGeo.getAttribute("position") as THREE.BufferAttribute;
      const array = posAttr.array as Float32Array;

      for (let r = 0; r < this.rainCount; r++) {
        const idx = r * 6;
        // Move raindrop downwards
        array[idx + 1] -= elapsedSec * 62.0;
        array[idx + 4] -= elapsedSec * 62.0;

        // Reset drop height if it falls below the player
        if (array[idx + 1] < player.position.y - 12.0) {
          const rx = Math.random() * 120.0 - 60.0;
          const ry = player.position.y + 50.0 + Math.random() * 20.0;
          const rz = Math.random() * 120.0 - 60.0;

          array[idx] = rx;
          array[idx + 1] = ry;
          array[idx + 2] = rz;

          array[idx + 3] = rx - 0.4;
          array[idx + 4] = ry - 3.2;
          array[idx + 5] = rz;
        }
      }
      posAttr.needsUpdate = true;
    } else {
      this.rainMesh.visible = false;
    }
  }

  public destroy(): void {
    if (this.rainMesh) {
      this.scene.remove(this.rainMesh);
      this.rainMesh.geometry.dispose();
      if (Array.isArray(this.rainMesh.material)) {
        this.rainMesh.material.forEach((m) => m.dispose());
      } else {
        this.rainMesh.material.dispose();
      }
      this.rainMesh = null;
    }
  }
}
export default RainSystem;
