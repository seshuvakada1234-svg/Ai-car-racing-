import * as THREE from "three";

export class SkySystem {
  private scene: THREE.Scene;

  public skyDome: THREE.Mesh | null = null;
  public sunDisk: THREE.Mesh | null = null;
  public sunGlow: THREE.Mesh | null = null;

  // Pre-allocated objects for zero-allocation updates
  private _sunPosVector = new THREE.Vector3();
  private _originVector = new THREE.Vector3(0, 0, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createSkyAndSun();
  }

  private createSkyAndSun(): void {
    // 1. Create realistic sunset/night sky dome sphere
    const skyGeo = new THREE.SphereGeometry(1400, 32, 15);
    skyGeo.scale(-1, 1, 1); // Point normals inwards

    const skyColors: number[] = [];
    const skyPos = skyGeo.attributes.position;
    for (let i = 0; i < skyPos.count; i++) {
      const y = skyPos.getY(i);
      const ratio = (y + 1400) / 2800; // Factor 0..1
      const col = new THREE.Color().lerpColors(new THREE.Color("#ffa600"), new THREE.Color("#ff0055"), ratio);
      skyColors.push(col.r, col.g, col.b);
    }
    skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(skyColors, 3));

    const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);

    // 2. Glowing Lens Sun Disk
    const sunDiskGeo = new THREE.CircleGeometry(42, 16);
    const sunDiskMat = new THREE.MeshBasicMaterial({
      color: "#fffdf6",
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
    });
    this.sunDisk = new THREE.Mesh(sunDiskGeo, sunDiskMat);
    this.scene.add(this.sunDisk);

    const glowDiskGeo = new THREE.CircleGeometry(110, 16);
    const glowDiskMat = new THREE.MeshBasicMaterial({
      color: "#ff7700",
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.sunGlow = new THREE.Mesh(glowDiskGeo, glowDiskMat);
    this.scene.add(this.sunGlow);

    this._sunPosVector.set(120, 50, 450).normalize().multiplyScalar(1350);
    this.sunDisk.position.copy(this._sunPosVector);
    this.sunDisk.lookAt(this._originVector);
    this.sunGlow.position.copy(this._sunPosVector);
    this.sunGlow.lookAt(this._originVector);
  }

  /**
   * Updates skydome gradients as sun moves based on the current weather and speed settings,
   * avoiding runtime memory allocations.
   */
  public update(
    weather: "sunny" | "cloudy" | "foggy" | "rain",
    timeOfDay: "morning" | "noon" | "sunset" | "night",
    elapsedSec: number,
  ): void {
    if (!this.skyDome || !this.sunDisk || !this.sunGlow) return;

    // Determine target colors and position vector based on the time of day
    let sunPosTarget = new THREE.Vector3(0, 480, 0);
    let skyColor1Str = "#ffcaa8";
    let skyColor2Str = "#4fa1eb";

    switch (timeOfDay) {
      case "morning":
        sunPosTarget.set(120, 160, -220);
        skyColor1Str = "#ffcaa8";
        skyColor2Str = "#4fa1eb";
        break;
      case "noon":
        sunPosTarget.set(0, 480, 0);
        skyColor1Str = "#ebf6ff";
        skyColor2Str = "#1b5cc2";
        break;
      case "sunset":
        sunPosTarget.set(120, 50, 450);
        skyColor1Str = "#ff4d00";
        skyColor2Str = "#08081a";
        break;
      case "night":
        sunPosTarget.set(0, -300, 0);
        skyColor1Str = "#090e24";
        skyColor2Str = "#010206";
        break;
    }

    // Apply weather adjustments to sky-coloring aesthetics
    switch (weather) {
      case "cloudy":
        skyColor1Str = "#7c8b99";
        skyColor2Str = "#3a444c";
        break;
      case "foggy":
        skyColor1Str = "#475569";
        skyColor2Str = "#1e293b";
        break;
      case "rain":
        skyColor1Str = "#1e293b";
        skyColor2Str = "#0f172a";
        break;
    }

    // Smoothly seek target sun positioning coordinates
    this._sunPosVector
      .lerp(sunPosTarget, 5.0 * elapsedSec)
      .normalize()
      .multiplyScalar(1350);

    this.sunDisk.position.copy(this._sunPosVector);
    this.sunDisk.lookAt(this._originVector);
    this.sunGlow.position.copy(this._sunPosVector);
    this.sunGlow.lookAt(this._originVector);

    // Hide sun element under cloudy, heavy rainy, foggy, or dark night environments
    const isSunHidden = timeOfDay === "night" || weather === "foggy" || weather === "rain";
    this.sunDisk.visible = !isSunHidden;
    this.sunGlow.visible = !isSunHidden;

    // Smoothly redraw skydome vertex coloring gradients
    const geometry = this.skyDome.geometry;
    const colorsAttr = geometry.attributes.color;
    if (colorsAttr) {
      const positionsAttr = geometry.attributes.position;
      const count = positionsAttr.count;
      const c1 = new THREE.Color(skyColor1Str);
      const c2 = new THREE.Color(skyColor2Str);

      const array = colorsAttr.array as Float32Array;
      const tempColor = new THREE.Color();

      for (let i = 0; i < count; i++) {
        const y = positionsAttr.getY(i);
        const ratio = (y + 1400) / 2800; // Base 0..1 scale factor
        tempColor.lerpColors(c1, c2, ratio);

        array[i * 3] = tempColor.r;
        array[i * 3 + 1] = tempColor.g;
        array[i * 3 + 2] = tempColor.b;
      }
      colorsAttr.needsUpdate = true;
    }
  }
}
export default SkySystem;
