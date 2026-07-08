import * as THREE from "three";

export class WeatherSystem {
  public static initialized = false;
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer | null = null;

  public currentFogColor = new THREE.Color("#cbdbe7");
  public currentFogDensity = 0.0008;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    WeatherSystem.initialized = true;
  }

  public setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  /**
   * Refreshes the environmental and weather-dependent fog densities smoothly.
   */
  public update(
    weather: "sunny" | "cloudy" | "foggy" | "rain",
    timeOfDay: "morning" | "noon" | "sunset" | "night",
    elapsedSec: number,
  ): void {
    // 1. Get baseline fog parameters based on the current time of day
    let baseFogColorStr = "#cbdbe7";
    let baseFogDensity = 0.0008;

    switch (timeOfDay) {
      case "morning":
        baseFogColorStr = "#cbd2db";
        baseFogDensity = 0.0022;
        break;
      case "noon":
        baseFogColorStr = "#cbdbe7";
        baseFogDensity = 0.0008;
        break;
      case "sunset":
        baseFogColorStr = "#e0420f";
        baseFogDensity = 0.0015;
        break;
      case "night":
        baseFogColorStr = "#010205";
        baseFogDensity = 0.0045;
        break;
    }

    let finalFogColorStr = baseFogColorStr;
    let finalFogDensity = baseFogDensity;

    // 2. Adjust fog density and color based on the current weather condition
    switch (weather) {
      case "cloudy":
        finalFogDensity *= 1.8;
        finalFogColorStr = "#5e6b75";
        break;
      case "foggy":
        finalFogDensity *= 4.5;
        finalFogColorStr = "#334155";
        break;
      case "rain":
        finalFogDensity *= 2.2;
        finalFogColorStr = "#1e293b";
        break;
      case "sunny":
      default:
        break;
    }

    // 3. Smoothly interpolate fog color and density configurations
    const targetColor = new THREE.Color(finalFogColorStr);
    this.currentFogColor.lerp(targetColor, 5.0 * elapsedSec);
    this.currentFogDensity = THREE.MathUtils.lerp(this.currentFogDensity, finalFogDensity, 5.0 * elapsedSec);

    // Apply the fog update to the active scene
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.currentFogColor);
      this.scene.fog.density = this.currentFogDensity;
    } else {
      this.scene.fog = new THREE.FogExp2(this.currentFogColor, this.currentFogDensity);
    }

    // Keep clear color in sync with fog colors
    if (this.renderer) {
      this.renderer.setClearColor(this.currentFogColor);
    }
  }
}
