import * as THREE from "three";
import { CarState } from "../types";

export interface SuspensionState {
  frontLeft: number; // compression from 0 (relaxed) to 1 (fully compressed)
  frontRight: number;
  rearLeft: number;
  rearRight: number;
  bodyRoll: number; // roll angle in radians (Z-axis)
  bodyPitch: number; // pitch angle in radians (X-axis)
}

export class SuspensionSystem {
  private static readonly SPRING_STIFFNESS = 35.0; // Spring stiffness coefficient
  private static readonly DAMPING_COEFFICIENT = 4.5; // Damping rate (critical damping)
  private static readonly ANTI_ROLL_BAR_FORCE = 12.0; // Stabilizing anti-roll stiffness
  private static readonly MAX_TRAVEL = 0.15; // Maximum travel in meters
  private static readonly HIGH_SPEED_DOWNFORCE = 0.08; // Downforce factor

  public static calculateSuspension(
    car: CarState,
    dt: number,
    controls: { forward: boolean; backward: boolean; left: boolean; right: boolean; handbrake?: boolean },
    steerAngle: number,
    turningRadius: number,
    currentRoll: number,
    currentPitch: number,
  ): SuspensionState {
    const speedRatio = Math.min(1.0, Math.abs(car.speed) / 78);

    // --- 1. LONGITUDINAL ACCELERATION (Pitch weight transfer: Dive or Squat) ---
    let accelForce = 0;
    if (controls.forward) {
      accelForce = 1.6 * (1.0 - speedRatio); // accelerating weight transfer rearward
    } else if (controls.backward || controls.handbrake) {
      accelForce = -2.8 * speedRatio; // braking nose dive forward
    }

    // --- 2. LATERAL YAW ACCELERATION (Roll weight transfer) ---
    const lateralG = car.angularVelocity * car.speed * 0.12;
    const rollForce = -lateralG;

    // --- 3. SUSPENSION COMPRESSION AT 4 WHEELS ---
    let flLoad = 1.0;
    let frLoad = 1.0;
    let rlLoad = 1.0;
    let rrLoad = 1.0;

    flLoad -= accelForce * 0.35;
    frLoad -= accelForce * 0.35;
    rlLoad += accelForce * 0.35;
    rrLoad += accelForce * 0.35;

    flLoad -= rollForce * 0.42;
    rlLoad -= rollForce * 0.42;
    frLoad += rollForce * 0.42;
    rrLoad += rollForce * 0.42;

    const downforce = speedRatio * speedRatio * this.HIGH_SPEED_DOWNFORCE;
    flLoad += downforce;
    frLoad += downforce;
    rlLoad += downforce * 1.5;
    rrLoad += downforce * 1.5;

    const vibe = Math.sin(Date.now() * 0.055) * 0.04 * speedRatio;
    flLoad += vibe;
    frLoad += -vibe;
    rlLoad += -vibe;
    rrLoad += vibe;

    const flCompression = THREE.MathUtils.clamp(flLoad / this.SPRING_STIFFNESS, 0, this.MAX_TRAVEL);
    const frCompression = THREE.MathUtils.clamp(frLoad / this.SPRING_STIFFNESS, 0, this.MAX_TRAVEL);
    const rlCompression = THREE.MathUtils.clamp(rlLoad / this.SPRING_STIFFNESS, 0, this.MAX_TRAVEL);
    const rrCompression = THREE.MathUtils.clamp(rrLoad / this.SPRING_STIFFNESS, 0, this.MAX_TRAVEL);

    // --- 4. BODY ROLL & PITCH TARGETS ---
    const targetRoll = THREE.MathUtils.clamp(rollForce * 0.04, -0.09, 0.09);
    const targetPitch = THREE.MathUtils.clamp(accelForce * 0.025, -0.05, 0.06);

    const rollSmoothing = Math.abs(currentRoll - targetRoll) > 0.01 ? 12.0 : 8.0;
    const pitchSmoothing = Math.abs(currentPitch - targetPitch) > 0.01 ? 10.0 : 7.0;

    const bodyRoll = THREE.MathUtils.lerp(currentRoll, targetRoll, rollSmoothing * dt);
    const bodyPitch = THREE.MathUtils.lerp(currentPitch, targetPitch, pitchSmoothing * dt);

    return {
      frontLeft: flCompression,
      frontRight: frCompression,
      rearLeft: rlCompression,
      rearRight: rrCompression,
      bodyRoll,
      bodyPitch,
    };
  }
}
