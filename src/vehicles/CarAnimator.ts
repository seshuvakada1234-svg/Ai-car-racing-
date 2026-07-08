import * as THREE from "three";
import { CarState } from "../types";
import { SuspensionSystem, SuspensionState } from "./SuspensionSystem";
import { WheelSystem } from "./WheelSystem";

export class CarAnimator {
  /**
   * Animates car chassis body roll, pitch, and micro-vibration, then delegates
   * steering yaw + wheel spin to WheelSystem.
   *
   * OWNERSHIP CONTRACT:
   *   carGroup.rotation.{x,z}  → owned here (roll + pitch + vibe)
   *   carGroup.position.y       → owned by VehicleRenderer ONLY
   *   suspensionPivot.position  → owned by VehicleRenderer ONLY
   *   car.position.y            → owned by physics engine ONLY
   */
  public static animateChassis(
    car: CarState,
    carGroup: THREE.Group,
    wheelSystem: WheelSystem | null,
    controls: { forward: boolean; backward: boolean; left: boolean; right: boolean; handbrake?: boolean },
    elapsedSec: number,
    runningTime: number,
  ): SuspensionState {
    if (!carGroup) {
      return { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0, bodyRoll: 0, bodyPitch: 0 };
    }

    const speedRatio = Math.min(1.0, Math.abs(car.speed) / 78);

    let steerOffset = 0;
    if (car.id === "player") {
      const sv = car.steerValue !== undefined ? car.steerValue : controls.left ? 1 : controls.right ? -1 : 0;
      steerOffset = sv * 0.36;
    } else {
      steerOffset = THREE.MathUtils.clamp(
        car.steerValue !== undefined ? car.steerValue : car.angularVelocity * 0.4,
        -0.36,
        0.36,
      );
    }

    const suspState: SuspensionState = SuspensionSystem.calculateSuspension(
      car,
      elapsedSec,
      controls,
      steerOffset,
      0,
      carGroup.rotation.z,
      carGroup.rotation.x,
    );

    // 1. Body roll (Z-axis)
    carGroup.rotation.z = suspState.bodyRoll;

    // 2. Body pitch (X-axis)
    carGroup.rotation.x = suspState.bodyPitch;

    // 3. Micro-vibration → rotation.x only; position.y is off-limits here
    const suspensionVibe = Math.sin(runningTime * 45.0) * 0.004 * speedRatio;
    carGroup.rotation.x += suspensionVibe;

    // 4. Steer + spin only — WheelSystem.update() never touches suspensionPivot.position
    if (wheelSystem) {
      const normSteer = steerOffset / 0.36;
      wheelSystem.update(car, normSteer, suspState, elapsedSec);
    }

    return suspState;
  }
}
