/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { CarState, ControlsState } from "../types";
import { TrackGeometryHelper } from "../utils/track";
import { GamePhysicsService } from "../physics/GamePhysics";

export class HighIQAIService {
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

      // --- ADVANCED PATH VECTOR LOOK-AHEAD ALGORITHM (HIGH IQ EDITION) ---
      // Evaluate not just the next checkpoint, but the path vector of the following checkpoint for smoother cornering.
      const distToNext = pos3.distanceTo(targetPos);
      const targetPoint = targetPos.clone();

      if (upcomingChpt) {
        const upcomingPos = new THREE.Vector3(upcomingChpt.position.x, upcomingChpt.position.y, upcomingChpt.position.z);

        // 1) Compute the path vector of the following checkpoint (from next to upcoming)
        const followingPathVector = new THREE.Vector3().subVectors(upcomingPos, targetPos);
        const followingPathLength = followingPathVector.length();
        const followingPathDir = followingPathVector.clone().normalize();

        // 2) Scale look-ahead range dynamically with current speed
        const lookaheadDistance = THREE.MathUtils.clamp(car.speed * 0.45, 14.0, 45.0);

        // 3) Calculate blend factor based on proximity to the next checkpoint
        const blendFactor = THREE.MathUtils.clamp(1.0 - distToNext / lookaheadDistance, 0.0, 1.0);

        // 4) Calculate look-ahead offset by sliding along the following path vector.
        // Cap the slide distance to 48% of the upcoming segment length to avoid overshooting.
        const maxOffsetDistance = Math.min(followingPathLength * 0.48, blendFactor * 22.0);
        const lookAheadOffsetVec = followingPathDir.clone().multiplyScalar(maxOffsetDistance);

        // Shift target point using the upcoming path vector for a smooth racing line cornering trajectory
        targetPoint.add(lookAheadOffsetVec);
      }

      // Detect where the player is to apply tactical play
      const player = otherCars.find((c) => c.id === "player");
      let activeIQOffset = 0; // custom steering shift

      if (player) {
        const distToPlayer = pos3.distanceTo(new THREE.Vector3(player.position.x, player.position.y, player.position.z));
        const distanceDelta = car.totalDistanceTraveled - player.totalDistanceTraveled;

        if (distanceDelta > 0 && distToPlayer < 45.0) {
          // --- PLAY IS BEHIND: ACTIVE DEFENSIVE BLOCKING ---
          // Determine player's local lateral offset relative to the High IQ AI's position and heading
          const dx = player.position.x - car.position.x;
          const dz = player.position.z - car.position.z;
          const cosA = Math.cos(-car.angle);
          const sinA = Math.sin(-car.angle);
          const playerLocalX = dx * cosA - dz * sinA; // lateral offset relative to AI car

          // Shift target point to actively cut off the player's path
          const blockStrength = THREE.MathUtils.clamp(playerLocalX, -4.0, 4.0);
          
          // Apply defensive alignment (weaving smoothly)
          activeIQOffset = blockStrength * 0.72;
        } else if (distanceDelta < 0 && distToPlayer < 50.0) {
          // --- PLAYER IS AHEAD: SLIPSTREAMING AND OVERTAKING ---
          // Position directly behind the player to "draft"
          const dx = player.position.x - car.position.x;
          const dz = player.position.z - car.position.z;
          const cosA = Math.cos(-car.angle);
          const sinA = Math.sin(-car.angle);
          const playerLocalX = dx * cosA - dz * sinA;

          if (Math.abs(playerLocalX) > 1.5 && distToPlayer > 12.0) {
            // Steering shift to slide directly into the player's wake
            activeIQOffset = playerLocalX * 0.55;
          } else if (distToPlayer <= 12.0) {
            // Extremely close: pop out to the opposite lane to perform a clean overtake
            const overtakeSign = playerLocalX >= 0 ? -1.0 : 1.0;
            activeIQOffset = overtakeSign * 3.5;
          }
        }
      }

      // Add the strategic offset perpendicular to the heading direction
      if (Math.abs(activeIQOffset) > 0.1) {
        const headingDir = new THREE.Vector3(targetPoint.x - car.position.x, 0, targetPoint.z - car.position.z).normalize();
        const lateralDir = new THREE.Vector3(-headingDir.z, 0, headingDir.x).normalize();
        targetPoint.addScaledVector(lateralDir, activeIQOffset);
      }

      // Calculate heading to strategically adjusted target point
      const toTargetX = targetPoint.x - car.position.x;
      const toTargetZ = targetPoint.z - car.position.z;
      const targetAngle = Math.atan2(toTargetX, toTargetZ);

      let angleDiff = targetAngle - car.angle;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

      // Corner sharpness
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

      // --- HIGH IQ TRAIL-BRAKING & CORNER EXIT MANAGEMENT ---
      // Dynamically slow down *before* entering tight corners to avoid sliding/understeering, then accelerate out
      let rubberBandFactor = 1.0;
      if (player) {
        const distanceDelta = car.totalDistanceTraveled - player.totalDistanceTraveled;
        if (distanceDelta > 150) {
          rubberBandFactor = 0.88;
        } else if (distanceDelta > 60) {
          rubberBandFactor = 0.93;
        } else if (distanceDelta < -150) {
          rubberBandFactor = 1.15;
        } else if (distanceDelta < -60) {
          rubberBandFactor = 1.1;
        }
      }

      let targetCruiseSpeed = 92.0 * car.aiSpeedFactor * rubberBandFactor;
      
      // Smart Zone-based cornering
      if (cornerSharpness > 0.6) {
        // High IQ knows to brake early. If closer than 20m to next sharp checkpoint, brake to entrance speed
        if (distToNext < 24.0) {
          targetCruiseSpeed = 32.0 * car.aiSpeedFactor * rubberBandFactor; // slow in, fast out
        } else {
          targetCruiseSpeed = 52.0 * car.aiSpeedFactor * rubberBandFactor;
        }
      } else if (cornerSharpness > 0.28) {
        if (distToNext < 18.0) {
          targetCruiseSpeed = 50.0 * car.aiSpeedFactor * rubberBandFactor;
        } else {
          targetCruiseSpeed = 70.0 * car.aiSpeedFactor * rubberBandFactor;
        }
      }

      // Stronger deceleration if steering angle deviation is high (reduces slides)
      if (Math.abs(angleDiff) > 0.3) {
        targetCruiseSpeed = Math.min(targetCruiseSpeed, 38.0);
      }

      // Smart avoidance with other competitive cars (avoids messy gridlocks)
      let vehicleBlocking = false;
      let blockDistance = 999;
      otherCars.forEach((other) => {
        if (other.id === car.id) return;
        const dx = other.position.x - car.position.x;
        const dz = other.position.z - car.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 18.0) {
          const cosA = Math.cos(-car.angle);
          const sinA = Math.sin(-car.angle);
          const localZ = dx * sinA + dz * cosA;
          const localX = dx * cosA - dz * sinA;
          if (localZ > 1.0 && localZ < 15.0 && Math.abs(localX) < 3.2) {
            vehicleBlocking = true;
            if (localZ < blockDistance) {
              blockDistance = localZ;
            }
          }
        }
      });

      if (vehicleBlocking) {
        if (blockDistance < 6.0) {
          targetCruiseSpeed = Math.min(targetCruiseSpeed, 10.0); // Brake cleanly
        } else {
          targetCruiseSpeed = Math.min(targetCruiseSpeed, 40.0); // Coast
        }
      }

      const thresholdSteer = 0.045;
      const aiControls: ControlsState = {
        forward: car.speed < targetCruiseSpeed,
        backward: car.speed > targetCruiseSpeed + 4.0, // clean precise engine brakes
        left: angleDiff > thresholdSteer,
        right: angleDiff < -thresholdSteer,
        nitro: false,
        gear: "D",
      };

      // Smart Nitro triggering: Only on long straightaways, when trailing, or to execute passes
      const playerIsAhead = player && player.totalDistanceTraveled > car.totalDistanceTraveled;
      const isStraightaway = Math.abs(angleDiff) < 0.08 && cornerSharpness < 0.12 && !vehicleBlocking;
      
      if (isStraightaway && car.speed > 40) {
        if (car.nitroCharged > 35) {
          aiControls.nitro = true;
        } else if (playerIsAhead && car.nitroCharged > 15) {
          // Play aggressively to catch up
          aiControls.nitro = true;
        }
      }

      return aiControls;
    } else {
      // Legacy road fallback with High IQ tracking
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

      let racingLineOffset = -bendFactor * (trackInfo.width * 0.35);
      racingLineOffset = THREE.MathUtils.clamp(racingLineOffset, -trackInfo.width * 0.35, trackInfo.width * 0.35);

      // Weave if player is close behind
      const player = otherCars.find((c) => c.id === "player");
      if (player) {
        const dx = player.position.x - car.position.x;
        const dz = player.position.z - car.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 35.0 && car.totalDistanceTraveled > player.totalDistanceTraveled) {
          const cosA = Math.cos(-car.angle);
          const sinA = Math.sin(-car.angle);
          const localX = dx * cosA - dz * sinA;
          racingLineOffset += THREE.MathUtils.clamp(localX, -4.0, 4.0) * 0.65;
        }
      }

      const targetApexPoint = targetSplinePt.clone();
      const maxAllowedAIDeviation = Math.max(0.2, trackInfo.width / 2 - 2.5);
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

      const thresholdSteer = 0.055;
      const aiControls: ControlsState = {
        forward: car.speed < 85.0 * car.aiSpeedFactor,
        backward: car.speed > 95.0 * car.aiSpeedFactor,
        left: angleDiff > thresholdSteer,
        right: angleDiff < -thresholdSteer,
        nitro: false,
        gear: "D",
      };

      if (Math.abs(angleDiff) < 0.1 && car.speed > 35 && car.nitroCharged > 30) {
        aiControls.nitro = true;
      }

      return aiControls;
    }
  }
}
