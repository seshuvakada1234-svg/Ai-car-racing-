import * as THREE from "three";
import { MemoryPool } from "../utils/memoryPool";

export interface Particle {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  life: number;
  decay: number;
  type: "nitro" | "exhaust" | "smoke" | "spark" | "dust";
}

export class ParticleSystem {
  private static instance: ParticleSystem | null = null;
  private particles: Particle[] = [];
  private poolIndex = 0;
  private maxParticles = 200; // Limited to 200 max to optimize performance on mobile/low-end GPUs

  private instancedMesh: THREE.InstancedMesh | null = null;
  private dummy = new THREE.Object3D();
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  private constructor() {
    // Pre-allocate all particle models to ensure zero allocation in loop
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        color: new THREE.Color(),
        size: 1.0,
        life: 0.0,
        decay: 1.0,
        type: "exhaust",
      });
    }
  }

  public static getInstance(): ParticleSystem {
    if (!ParticleSystem.instance) {
      ParticleSystem.instance = new ParticleSystem();
    }
    return ParticleSystem.instance;
  }

  /**
   * Initializes the single shared InstancedMesh in the scene
   */
  public initialize(scene: THREE.Scene): void {
    if (this.instancedMesh) {
      if (this.instancedMesh.parent) {
        this.instancedMesh.parent.remove(this.instancedMesh);
      }
      this.instancedMesh.dispose();
    }

    // High fidelity faceted particle geometry
    const geometry = new THREE.DodecahedronGeometry(0.24, 0);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
    this.instancedMesh.castShadow = false;
    this.instancedMesh.receiveShadow = false;

    // Warm up instance colors with pure white
    const white = new THREE.Color("#ffffff");
    for (let i = 0; i < this.maxParticles; i++) {
      this.instancedMesh.setMatrixAt(i, this.zeroMatrix);
      this.instancedMesh.setColorAt(i, white);
    }

    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    scene.add(this.instancedMesh);
  }

  /**
   * Spawns a particle in O(1) time by overriding the oldest pooled element
   */
  public spawn(
    type: "nitro" | "exhaust" | "smoke" | "spark" | "dust",
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: string,
    size: number,
    decay: number,
  ): void {
    const p = this.particles[this.poolIndex];
    p.active = true;
    p.type = type;
    p.position.set(x, y, z);
    p.velocity.set(vx, vy, vz);
    p.color.set(colorHex);
    p.size = size;
    p.life = 1.0;
    p.decay = decay;

    this.poolIndex = (this.poolIndex + 1) % this.maxParticles;
  }

  /**
   * Physics updates of active particles
   */
  public update(dt: number): void {
    if (!this.instancedMesh) return;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (!p.active) {
        this.instancedMesh.setMatrixAt(i, this.zeroMatrix);
        continue;
      }

      // Physics integration
      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.position.z += p.velocity.z * dt;

      // Type-specific drift velocity drag
      if (p.type === "smoke" || p.type === "dust") {
        p.velocity.multiplyScalar(0.92); // rapid speed deceleration
        p.velocity.y += 0.4 * dt; // subtle upward rising heat drift
      } else if (p.type === "spark") {
        p.velocity.y -= 9.8 * dt; // gravity pull on sparks
      }

      p.life -= p.decay * dt;

      if (p.life <= 0.0) {
        p.active = false;
        this.instancedMesh.setMatrixAt(i, this.zeroMatrix);
      } else {
        // Compute current scale based on age
        let currentScale = p.size;
        if (p.type === "exhaust" || p.type === "smoke" || p.type === "dust") {
          // Grow and expand then fade
          currentScale = p.size * (0.3 + (1.0 - p.life) * 1.5);
        } else if (p.type === "nitro" || p.type === "spark") {
          // Shrink to zero quickly
          currentScale = p.size * p.life;
        }

        this.dummy.position.copy(p.position);
        this.dummy.scale.set(currentScale, currentScale, currentScale);

        // Face camera rotation is not required because we are using spherical dodecahedrons!
        this.dummy.updateMatrix();

        this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
        this.instancedMesh.setColorAt(i, p.color);
      }
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Cleanly disposes the InstancedMesh and frees WebGL memory buffers
   */
  public dispose(): void {
    if (this.instancedMesh) {
      if (this.instancedMesh.parent) {
        this.instancedMesh.parent.remove(this.instancedMesh);
      }
      this.instancedMesh.dispose();
      this.instancedMesh = null;
    }
  }
}

export const particleSystem = ParticleSystem.getInstance();
