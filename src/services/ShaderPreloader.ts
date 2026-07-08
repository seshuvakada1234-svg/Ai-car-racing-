/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

export class ShaderPreloader {
  public static initialized = false;
  public static hasCompiled = false;
  public static compiled = false;
  private static warmedRenderers = new WeakSet<THREE.WebGLRenderer>();

  /**
   * Pre-compiles complex car and scenery materials so there are no WebGL compilation stalls
   */
  public static async preloadShaders(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): Promise<void> {
    if (this.compiled || this.warmedRenderers.has(renderer)) {
      console.log("ShaderPreloader: Already compiled once, skipping duplicate compilation.");
      return;
    }
    this.compiled = true;
    this.warmedRenderers.add(renderer);
    ShaderPreloader.initialized = true;
    ShaderPreloader.hasCompiled = true;
    console.log("ShaderPreloader: Initiating pre-compilation on background WebGL context...");

    // Create dummy materials replicating full paint, brake light and PBR glass shaders during the countdown
    const testMaterials = [
      new THREE.MeshStandardMaterial({ color: "#ff0000", roughness: 0.1, metalness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: "#00ff00", roughness: 0.5, metalness: 0.2 }),
      new THREE.MeshBasicMaterial({ color: "#ff1100" }), // Tail lights
      new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.95, flatShading: true }), // Asphalt
    ];

    const dummyGroup = new THREE.Group();
    const tempGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);

    testMaterials.forEach((mat, idx) => {
      const mesh = new THREE.Mesh(tempGeo, mat);
      mesh.position.set(0, -500 - idx, 0); // Hide far below terrain
      dummyGroup.add(mesh);
    });

    scene.add(dummyGroup);

    // Warm up the WebGL compiler
    await new Promise<void>((resolve) => {
      renderer.compile(scene, camera);
      setTimeout(() => {
        scene.remove(dummyGroup);
        tempGeo.dispose();
        testMaterials.forEach((m) => m.dispose());
        console.log("ShaderPreloader: Full WebGL compilation buffer warmed up successfully!");
        resolve();
      }, 300);
    });
  }
}
