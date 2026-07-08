/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { CarState, ControlsState } from "../types";
import { TrackGeometryHelper } from "../utils/track";
import { GamePhysicsService } from "../physics/GamePhysics";

export class SpeedAIService {
  private trackHelper: TrackGeometryHelper;

  constructor(trackHelper: TrackGeometryHelper) {
    this.trackHelper = trackHelper;
  }

  public update(
    car: CarState,
    dt: number,
    otherCars: CarState[],
    physicsService: GamePhysicsService,
  ): ControlsState {
    const isRacing2 = this.trackHelper.mapType === "racing2";

    if (isRacing2) {
      const chpts = this.trackHelper.checkpoints;
      const numCheckpoints = chpts.length;

      if (
        car.currentCheckpointIndex === undefined ||
        car.currentCheckpointIndex < 0 ||
        car.currentCheckpointIndex >= numCheckpoints
      ) {
        car.currentCheckpointIndex = 0;
      }

      const pos3 = new THREE.Vector3(car.position.x, car.position.y, car.position.z);
      const targetIndex = (car.currentCheckpointIndex + 1) % numCheckpoints;
      const nextChpt = chpts[targetIndex];
      const upcomingChpt = chpts[(targetIndex + 1) % numCheckpoints];

      const targetPos = new THREE.Vector3(nextChpt.position.x, nextChpt.position.y, nextChpt.position.z);

      // --- ADVANCED PATH VECTOR LOOK-AHEAD ALGORITHM ---
      // Evaluate not just the next checkpoint, but the path vector of the following checkpoint for smoother cornering.
      const distToNext = pos3.distanceTo(targetPos);
      const targetPoint = targetPos.clone();

      if (upcomingChpt) {
        const upcomingPos = new THREE.Vector3(upcomingChpt.position.x, upcomingChpt.position.y, upcomingChpt.position.z);
        
        // 1) Compute the path vector of the following checkpoint (from next to upcoming)
        const followingPathVector = new THREE.Vector3().subVectors(upcomingPos, targetPos);
        const followingPathLength = followingPathVector.length();
        const followingPathDir = followingPathVector.clone().normalize();

        // 2) Scale look-ahead range dynamically with current speed (faster cars initiate turns earlier)
        const lookaheadDistance = THREE.MathUtils.clamp(car.speed * 0.50, 16.0, 50.0);

        // 3) Calculate blend factor based on proximity to the next checkpoint
        const blendFactor = THREE.MathUtils.clamp(1.0 - distToNext / lookaheadDistance, 0.0, 1.0);

        // 4) Calculate look-ahead offset by sliding along the following path vector.
        // Cap the slide distance to 48% of the upcoming segment length to avoid overshooting.
        const maxOffsetDistance = Math.min(followingPathLength * 0.48, blendFactor * 25.0);
        const lookAheadOffsetVec = followingPathDir.clone().multiplyScalar(maxOffsetDistance);

        // Shift the target point using the upcoming path vector for a smooth cornering trajectory
        targetPoint.add(lookAheadOffsetVec);
      }

      const toTargetX = targetPoint.x - car.position.x;
      const toTargetZ = targetPoint.z - car.position.z;
      const targetAngle = Math.atan2(toTargetX, toTargetZ);

      let angleDiff = targetAngle - car.angle;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

      let cornerSharpness = 0;
      if (upcomingChpt) {
        const toUpcomingX = upcomingChpt.position.x - nextChpt.position.x;
        const toUpcomingZ = upcomingChpt.position.z - nextChpt.position.z;
        const upcomingAngle = Math.atan2(toUpcomingX, toUpcomingZ);
        const nextAngle = Math.atan2(nextChpt.direction.x, nextChpt.direction.z);
        let diff = upcomingAngle - nextAngle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        cornerSharpness = Math.abs(diff);
      }

      // Dynamic Speed Control - Speed AI has a much higher cruise speed
      let targetCruiseSpeed = 104.0 * car.aiSpeedFactor;
      if (cornerSharpness > 0.6) {
        targetCruiseSpeed = 44.0 * car.aiSpeedFactor; // Speeds through tight corners
      } else if (cornerSharpness > 0.28) {
        targetCruiseSpeed = 68.0 * car.aiSpeedFactor; // High medium corner speed
      }

      // Mild steering speed reduction
      if (Math.abs(angleDiff) > 0.35) {
        targetCruiseSpeed = Math.min(targetCruiseSpeed, 50.0);
      }

      // Collision avoidance (only minor yielding, tries to push/bypass other vehicles)
      let vehicleBlocking = false;
      let blockDistance = 999;
      otherCars.forEach((other) => {
        if (other.id === car.id) return;
        const dx = other.position.x - car.position.x;
        const dz = other.position.z - car.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 12.0) {
          const cosA = Math.cos(-car.angle);
          const sinA = Math.sin(-car.angle);
          const localZ = dx * sinA + dz * cosA;
          const localX = dx * cosA - dz * sinA;
          if (localZ > 1.0 && localZ < 11.0 && Math.abs(localX) < 2.5) {
            vehicleBlocking = true;
            if (localZ < blockDistance) {
              blockDistance = localZ;
            }
          }
        }
      });

      if (vehicleBlocking) {
        if (blockDistance < 4.0) {
          targetCruiseSpeed = Math.min(targetCruiseSpeed, 20.0); // Push forward/aggressive pass
        } else {
          targetCruiseSpeed = Math.min(targetCruiseSpeed, 55.0);
        }
      }

      const thresholdSteer = 0.045;
      const aiControls: ControlsState = {
        forward: car.speed < targetCruiseSpeed,
        backward: car.speed > targetCruiseSpeed + 8.0, // brake less aggressively, coast more
        left: angleDiff > thresholdSteer,
        right: angleDiff < -thresholdSteer,
        nitro: false,
        gear: "D",
      };

      // Nitro is triggered aggressively on straightaways
      if (
        Math.abs(angleDiff) < 0.18 &&
        car.speed > 35 &&
        car.nitroCharged > 15 &&
        cornerSharpness < 0.25 &&
        !vehicleBlocking
      ) {
        aiControls.nitro = true;
      }

      return aiControls;
    } else {
      // Legacy road fallback
      const pos3 = new THREE.Vector3(car.position.x, car.position.y, car.position.z);
      const trackInfo = this.trackHelper.getNearestTrackInfo(pos3, car.id);

      const speedKmh = Math.abs(car.speed) * 3.6;
      const lookaheadU = 0.016 + Math.min(0.045, (speedKmh / 300) * 0.04);
      const targetU = (trackInfo.progress + lookaheadU) % 1.0;

      const targetSplinePt = this.trackHelper.curve.getPointAt(targetU);
      const tangentAhead = this.trackHelper.curve.getTangentAt(targetU).normalize();
      const normalAhead = new THREE.Vector3(-tangentAhead.z, 0, tangentAhead.x).normalize();

      const currentTangent = trackInfo.tangent;
      const bendFactor = currentTangent.cross(tangentAhead).y;

      let racingLineOffset = -bendFactor * (trackInfo.width * 0.4);
      racingLineOffset = THREE.MathUtils.clamp(racingLineOffset, -trackInfo.width * 0.38, trackInfo.width * 0.38);

      const targetApexPoint = targetSplinePt.clone();
      const maxAllowedAIDeviation = Math.max(0.2, trackInfo.width / 2 - 2.2);
      const finalOffset = THREE.MathUtils.clamp(
        racingLineOffset,
        -maxAllowedAIDeviation,
        maxAllowedAIDeviation,
      );
      targetApexPoint.addScaledVector(normalAhead, finalOffset);

      const toApexX = targetApexPoint.x - car.position.x;
      const toApexZ = targetApexPoint.z - car.position.z;
      const targetAngle = Math.atan2(toApexX, toApexZ);

      let angleDiff = targetAngle - car.angle;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

      const thresholdSteer = 0.05;
      const aiControls: ControlsState = {
        forward: car.speed < 90.0 * car.aiSpeedFactor,
        backward: car.speed > 100.0 * car.aiSpeedFactor,
        left: angleDiff > thresholdSteer,
        right: angleDiff < -thresholdSteer,
        nitro: false,
        gear: "D",
      };

      if (Math.abs(angleDiff) < 0.15 && car.speed > 40 && car.nitroCharged > 15) {
        aiControls.nitro = true;
      }

      return aiControls;
    }
  }
}
