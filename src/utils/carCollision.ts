import * as THREE from "three";
import { CarState } from "../types";
import { SpatialGrid } from "./spatialGrid";
import { MemoryPool } from "./memoryPool";

export class CarCollisionSystem {
  private static readonly COLLISION_RADIUS = 1.85; // realistic bumper bounds (width 1.95m, length 4.5m sphere footprint equivalent)
  private static readonly COLLISION_RADIUS_SQ =
    CarCollisionSystem.COLLISION_RADIUS * CarCollisionSystem.COLLISION_RADIUS;
  private static readonly RESTITUTION_VEHICLE = 0.15; // low restitution (0.1 - 0.2) for heavy, realistic inelastic contacts
  private static readonly RESTITUTION_WALL = 0.18; // rebound off guardrails

  /**
   * Resolves elastic, momentum-preserving collisions between all active vehicles using spatial partitioning.
   */
  public static resolveVehicleCollisions(cars: CarState[], spawnParticle: Function): void {
    const size = cars.length;
    if (size <= 1) return;

    // 1. Build spatial hash grid for performance
    const grid = new SpatialGrid(18); // adjusted grid size matching tighter collision footprints
    for (let i = 0; i < size; i++) {
      const a = cars[i];
      if (a && a.position && !a.isFinished) {
        grid.insert(a);
      }
    }

    const resolvedPairs = new Set<string>();

    for (let i = 0; i < size; i++) {
      const a = cars[i];
      if (!a || !a.position || !a.velocity || a.isFinished) continue;

      const nearby = grid.getNearby(a);
      for (const b of nearby) {
        if (!b || !b.position || !b.velocity || b.isFinished || a.id === b.id) continue;

        // Order IDs consistently to prevent duplicate pair processing
        const pairId = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if (resolvedPairs.has(pairId)) continue;
        resolvedPairs.add(pairId);

        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        let distSq = dx * dx + dz * dz;

        if (distSq < this.COLLISION_RADIUS_SQ) {
          let dist = Math.sqrt(distSq);

          // Secure guard against overlap at identical coordinate locations
          if (dist < 0.001) {
            dist = 0.01;
            distSq = 0.0001;
          }

          const overlap = this.COLLISION_RADIUS - dist;

          // Unit normal direction of collision
          let nx = dx / dist;
          let nz = dz / dist;

          // Handle indeterminate normal cases
          if (Math.abs(nx) < 0.001 && Math.abs(nz) < 0.001) {
            nx = Math.cos(a.angle + Math.PI / 2);
            nz = Math.sin(a.angle + Math.PI / 2);
          }

          // 2. Resolve overlap instantly with push (half way) to prevent vehicles from clipping/teleporting
          const pushX = nx * overlap * 0.505;
          const pushZ = nz * overlap * 0.505;

          a.position.x -= pushX;
          a.position.z -= pushZ;
          b.position.x += pushX;
          b.position.z += pushZ;

          // Ensure Y heights stay relative to roads, locking flat-plane displacement only
          // This absolutely prevents climbing or stacking!

          // 3. Relative velocity difference
          const rvx = b.velocity.x - a.velocity.x;
          const rvz = b.velocity.z - a.velocity.z;

          // Dot product along normal
          const velAlongNormal = rvx * nx + rvz * nz;

          if (velAlongNormal < 0) {
            // they are approaching
            // Approximate equal mass for race vehicles: momentum redistribution with inelastic collision damping
            const impulseScalar = -(1 + this.RESTITUTION_VEHICLE) * velAlongNormal * 0.5;

            a.velocity.x -= impulseScalar * nx;
            a.velocity.z -= impulseScalar * nz;
            b.velocity.x += impulseScalar * nx;
            b.velocity.z += impulseScalar * nz;

            // Apply direct energy damping after heavy impacts
            a.velocity.x *= 0.82;
            a.velocity.z *= 0.82;
            b.velocity.x *= 0.82;
            b.velocity.z *= 0.82;

            // Re-sync speed values based on final post-impulse translation velocity
            a.speed = Math.sign(a.speed) * Math.sqrt(a.velocity.x * a.velocity.x + a.velocity.z * a.velocity.z);
            b.speed = Math.sign(b.speed) * Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.z * b.velocity.z);

            // Contact friction speed loss on both side-swiped hulls for realistic heavy feeling
            a.speed *= 0.78;
            b.speed *= 0.78;

            // 4. Spawn brilliant contact sparks at contact midpoint
            const contactX = a.position.x + nx * (this.COLLISION_RADIUS * 0.5);
            const contactY = (a.position.y + b.position.y) * 0.5 + 0.3;
            const contactZ = a.position.z + nz * (this.COLLISION_RADIUS * 0.5);

            this.generateContactSparks(contactX, contactY, contactZ, nx, nz, spawnParticle);
          }
        }
      }
    }
  }

  /**
   * Continuous solid guardrail barrier constraint with elastic bouncing and friction speed attenuation.
   */
  public static resolveWallCollision(
    car: CarState,
    trackInfo: {
      nearestPoint: THREE.Vector3;
      tangent: THREE.Vector3;
      normal: THREE.Vector3;
      width: number;
      sideOffset: number;
    },
    spawnParticle: Function,
    dt: number,
  ): void {
    const allowedOffset = trackInfo.width / 2 - 1.5;
    if (Math.abs(trackInfo.sideOffset) > allowedOffset) {
      const sign = Math.sign(trackInfo.sideOffset);

      // Instantly constrain position to boundary margin to prevent clipping through rails
      car.position.x = trackInfo.nearestPoint.x + trackInfo.normal.x * allowedOffset * sign;
      car.position.z = trackInfo.nearestPoint.z + trackInfo.normal.z * allowedOffset * sign;

      // Soft Elastic Ricochet Rebound opposite to boundary normal vector
      const velVec = MemoryPool.getVector().set(car.velocity.x, 0, car.velocity.z);
      const normalVec = MemoryPool.getVector().set(trackInfo.normal.x, 0, trackInfo.normal.z).multiplyScalar(sign);

      const vNormalDot = velVec.dot(normalVec);
      if (vNormalDot > 0) {
        // moving towards the wall boundary
        velVec.addScaledVector(normalVec, -(1 + this.RESTITUTION_WALL) * vNormalDot);

        // Reduce velocity magnitude from friction scrape
        car.speed *= Math.max(0.4, 1.0 - (vNormalDot / 78) * 0.42);

        car.velocity.x = velVec.x;
        car.velocity.z = velVec.z;
      }

      // Generate spark trails along the guardrail
      this.generateBoundarySparks(car.position, trackInfo.normal, sign, spawnParticle);
    }
  }

  /**
   * Helper that spawns bright friction sparks upon guardrail hits
   */
  private static generateBoundarySparks(
    carPos: { x: number; y: number; z: number },
    normal: THREE.Vector3,
    pushSign: number,
    spawnParticle: Function,
  ) {
    if (Math.random() > 0.4) return; // limit frequency for visual optimization

    for (let i = 0; i < 3; i++) {
      const vx = normal.x * -pushSign * (4 + Math.random() * 8) + (Math.random() * 3 - 1.5);
      const vy = 2 + Math.random() * 5;
      const vz = normal.z * -pushSign * (4 + Math.random() * 8) + (Math.random() * 3 - 1.5);

      spawnParticle(
        carPos.x,
        carPos.y + 0.3,
        carPos.z,
        vx,
        vy,
        vz,
        Math.random() > 0.4 ? "#ff7c00" : "#ffa600",
        0.18 + Math.random() * 0.16,
        1.8 + Math.random() * 2.2,
        false,
        true,
      );
    }
  }

  /**
   * Helper that spawns contact collision sparks upon vehicle-to-vehicle hits
   */
  private static generateContactSparks(
    x: number,
    y: number,
    z: number,
    nx: number,
    nz: number,
    spawnParticle: Function,
  ) {
    for (let i = 0; i < 5; i++) {
      const vx = nx * (5 + Math.random() * 10) + (Math.random() * 4 - 2);
      const vy = 1.5 + Math.random() * 6;
      const vz = nz * (5 + Math.random() * 10) + (Math.random() * 4 - 2);

      spawnParticle(
        x,
        y,
        z,
        vx,
        vy,
        vz,
        Math.random() > 0.5 ? "#ffff00" : "#ffa200",
        0.2 + Math.random() * 0.2,
        1.5 + Math.random() * 2.0,
        false,
        true,
      );
    }
  }
}
