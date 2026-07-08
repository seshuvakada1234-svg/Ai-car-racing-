import * as THREE from "three";

export class LightingSystem {
  private scene: THREE.Scene;

  public sunLight: THREE.DirectionalLight | null = null;
  public ambLight: THREE.HemisphereLight | null = null;

  // Reusable spatial variables (Zero allocations during update!)
  private _sunPos = new THREE.Vector3();
  private _sunColor = new THREE.Color();
  private _ambSkyColor = new THREE.Color();
  private _ambGroundColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initializeLights();
  }

  private initializeLights(): void {
    // 1. Setup high-fidelity Hemisphere Light for realistic sky-ground environmental bounce
    this.ambLight = new THREE.HemisphereLight("#cbd6e2", "#4c4235", 1.0);
    this.scene.add(this.ambLight);

    // 2. Setup Directional Sun/Moon Light with rich high-precision shadows
    this.sunLight = new THREE.DirectionalLight("#ffffff", 3.5);
    this.sunLight.castShadow = true;

    // Enhance shadow qualities
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 1000;

    const shadowFrustumSize = 180;
    this.sunLight.shadow.camera.left = -shadowFrustumSize;
    this.sunLight.shadow.camera.right = shadowFrustumSize;
    this.sunLight.shadow.camera.top = shadowFrustumSize;
    this.sunLight.shadow.camera.bottom = -shadowFrustumSize;
    this.sunLight.shadow.bias = -0.0003;

    this.scene.add(this.sunLight);
  }

  /**
   * Smoothly updates sky sun positional coordinates, ambient hemisphere colors,
   * intensities, and transitions.
   */
  public update(
    weather: "sunny" | "cloudy" | "foggy" | "rain",
    timeOfDay: "morning" | "noon" | "sunset" | "night",
    elapsedSec: number,
  ): void {
    if (!this.sunLight || !this.ambLight) return;

    // 1. Calculate baseline target vectors and parameters for the specific time of day
    let sunPosTarget = new THREE.Vector3(0, 480, 0);
    let sunColorHex = "#ffffff";
    let sunIntensity = 3.8;
    let ambSkyHex = "#dceafd";
    let ambGroundHex = "#5c5643";
    let ambIntensity = 1.5;

    switch (timeOfDay) {
      case "morning":
        sunPosTarget.set(120, 160, -220);
        sunColorHex = "#ffd9b3";
        sunIntensity = 2.4;
        ambSkyHex = "#a9bce0";
        ambGroundHex = "#4d3d34";
        ambIntensity = 1.1;
        break;
      case "noon":
        sunPosTarget.set(0, 480, 0);
        sunColorHex = "#ffffff";
        sunIntensity = 3.8;
        ambSkyHex = "#dceafd";
        ambGroundHex = "#5c5643";
        ambIntensity = 1.5;
        break;
      case "sunset":
        sunPosTarget.set(120, 50, 450);
        sunColorHex = "#ffa64d";
        sunIntensity = 3.2;
        ambSkyHex = "#54208a";
        ambGroundHex = "#3b1a03";
        ambIntensity = 1.1;
        break;
      case "night":
        sunPosTarget.set(0, -300, 0);
        sunColorHex = "#0a1122";
        sunIntensity = 0.15;
        ambSkyHex = "#030614";
        ambGroundHex = "#010204";
        ambIntensity = 0.25;
        break;
    }

    // 2. Diffuse intensities based on active weather obstruction conditions
    switch (weather) {
      case "cloudy":
        sunIntensity *= 0.35;
        ambIntensity *= 0.72;
        break;
      case "foggy":
        sunIntensity *= 0.08;
        ambIntensity *= 0.45;
        break;
      case "rain":
        sunIntensity *= 0.22;
        ambIntensity *= 0.6;
        break;
      case "sunny":
      default:
        break;
    }

    // 3. Smoothly interpolate colors, coordinates, and intensities (Zero allocations!)
    this._sunPos.lerp(sunPosTarget, 5.0 * elapsedSec);
    this._sunColor.set(sunColorHex);
    this._ambSkyColor.set(ambSkyHex);
    this._ambGroundColor.set(ambGroundHex);

    // Apply interpolated values to directional and ambient light nodes
    this.sunLight.position.copy(this._sunPos);
    this.sunLight.color.lerp(this._sunColor, 5.0 * elapsedSec);
    this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, sunIntensity, 5.0 * elapsedSec);

    this.ambLight.color.lerp(this._ambSkyColor, 5.0 * elapsedSec);
    this.ambLight.groundColor.lerp(this._ambGroundColor, 5.0 * elapsedSec);
    this.ambLight.intensity = THREE.MathUtils.lerp(this.ambLight.intensity, ambIntensity, 5.0 * elapsedSec);
  }
}
