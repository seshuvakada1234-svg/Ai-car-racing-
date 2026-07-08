/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { CarState, ControlsState } from "../types";
import { TrackGeometryHelper } from "../utils/track";
import { MemoryPool } from "../utils/memoryPool";
import { GamePhysicsService } from "../physics/GamePhysics";
import { terrainManager } from "../world/TerrainManager";
import { SpeedAIService } from "./SpeedAI";
import { HighIQAIService } from "./HighIQAI";

export class TrafficAIService {
  private trackHelper: TrackGeometryHelper;
  private speedAI: SpeedAIService;
  private highIQAI: HighIQAIService;

  private static readonly MAX_TRAFFIC_COUNT = 32;
  private static readonly ROAD_WIDTH_LIMIT_FACTOR = 0.42;
  private static readonly REFL_HAZARD_DIST = 25.0;

  // Zero-allocation scratch vectors cached inside the AI system
  private static readonly _vecA = new THREE.Vector3();
  private static readonly _vecB = new THREE.Vector3();
  private static readonly _vecC = new THREE.Vector3();

  constructor(trackHelper: TrackGeometryHelper) {
    this.trackHelper = trackHelper;
    this.speedAI = new SpeedAIService(trackHelper);
    this.highIQAI = new HighIQAIService(trackHelper);
  }

  /**
   * Generates a lineup of uniformly spaced civilian commuter vehicles
   */
  public generateTrafficLineup(): CarState[] {
    const trafficCars: CarState[] = [];
    const trafficColors = [
      "#e2e8f0",
      "#fbbf24",
      "#94a3b8",
      "#38bdf8",
      "#34d399",
      "#f472b6",
      "#a78bfa",
      "#fb923c",
      "#818cf8",
      "#cbd5e1",
    ];
    const trafficNames = ["Coupe", "Cab", "Sedan", "Hatchback", "SUV", "Estate", "Van", "Pickup", "Hybrid", "Minivan"];

    const trackLength = this.trackHelper.length || 4150.0;
    const spacing = 1.0 / TrafficAIService.MAX_TRAFFIC_COUNT;

    for (let t = 0; t < TrafficAIService.MAX_TRAFFIC_COUNT; t++) {
      const progress = 0.12 + t * spacing * 0.85;

      const pt = this.trackHelper.curve ? this.trackHelper.curve.getPointAt(progress) : new THREE.Vector3();
      const tangent = this.trackHelper.curve
        ? this.trackHelper.curve.getTangentAt(progress).normalize()
        : new THREE.Vector3(0, 0, 1);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      const laneSelector = t % 4;
      let laneOffset = 0;
      if (laneSelector === 0) laneOffset = -4.5;
      else if (laneSelector === 1) laneOffset = -1.5;
      else if (laneSelector === 2) laneOffset = 1.5;
      else if (laneSelector === 3) laneOffset = 4.5;

      const spawnPos = pt.clone().addScaledVector(normal, laneOffset);
      const angle = Math.atan2(tangent.x, tangent.z);

      const trafficPos3 = new THREE.Vector3(spawnPos.x, 0, spawnPos.z);
      const roadHeight = terrainManager.getRoadHeight(trafficPos3);
      const spawnY = roadHeight + 0.38;

      const speedRatio = 0.22 + (t % 3) * 0.06;

      trafficCars.push({
        id: `traffic_${t}`,
        name: `${trafficNames[t % trafficNames.length]} #${t + 1}`,
        isAI: true,
        color: trafficColors[t % trafficColors.length],
        position: { x: spawnPos.x, y: spawnY, z: spawnPos.z },
        velocity: { x: tangent.x * (speedRatio * 78), y: 0, z: tangent.z * (speedRatio * 78) },
        speed: speedRatio * 78,
        angle: angle,
        angularVelocity: 0,
        driftFactor: 0,
        isDrifting: false,
        currentLap: 1,
        currentCheckpointIndex: 0,
        distanceToNextCheckpoint: 999,
        racePosition: 99,
        totalDistanceTraveled: progress * trackLength,
        isFinished: false,
        lastActiveTime: Date.now(),
        nitroCharged: 0,
        isNitroActive: false,
        aiTargetNode: Math.floor(progress * this.trackHelper.cachedPoints.length),
        aiSpeedFactor: speedRatio,
        aiAggression: 0.05,
        stuckTimer: 0,
      });
    }

    return trafficCars;
  }

  /**
   * Evaluates the pilot commands for a single traffic vehicle.
   */
  public updateTrafficControl(car: CarState, dt: number, otherCars: CarState[]): ControlsState {
    const pos3 = MemoryPool.getVector().set(car.position.x, car.position.y, car.position.z);
    const trackInfo = this.trackHelper.getNearestTrackInfo(pos3, car.id);

    const lookaheadProgress = 0.012 + Math.min(0.035, (car.speed / 78) * 0.03);
    const targetU = (trackInfo.progress + lookaheadProgress) % 1.0;

    const targetSplinePt = this.trackHelper.curve.getPointAt(targetU);
    const tangentAhead = this.trackHelper.curve.getTangentAt(targetU).normalize();
    const normalAhead = MemoryPool.getVector().set(-tangentAhead.z, 0, tangentAhead.x).normalize();

    const tIndex = parseInt(car.id.replace("traffic_", "")) || 0;
    const laneSelector = tIndex % 4;
    let laneOffset = 0;
    if (laneSelector === 0) laneOffset = -4.5;
    else if (laneSelector === 1) laneOffset = -1.5;
    else if (laneSelector === 2) laneOffset = 1.5;
    else if (laneSelector === 3) laneOffset = 4.5;

    let targetEvasionOffset = 0;
    let brakeRequired = false;

    otherCars.forEach((other) => {
      if (other.id === car.id) return;

      const dx = other.position.x - car.position.x;
      const dz = other.position.z - car.position.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < TrafficAIService.REFL_HAZARD_DIST * TrafficAIService.REFL_HAZARD_DIST) {
        const cosAngle = Math.cos(-car.angle);
        const sinAngle = Math.sin(-car.angle);
        const localX = dx * cosAngle - dz * sinAngle;
        const localZ = dx * sinAngle + dz * cosAngle;

        if (localZ > 0 && localZ < 15.0) {
          if (Math.abs(localX) < 3.0) {
            brakeRequired = true;
            const nudgeDir = localX >= 0 ? -1.0 : 1.0;
            targetEvasionOffset += nudgeDir * 1.5;
          }
        }
      }
    });

    const targetPoint = targetSplinePt.clone();
    const finalOffset = THREE.MathUtils.clamp(
      laneOffset + targetEvasionOffset,
      -trackInfo.width * TrafficAIService.ROAD_WIDTH_LIMIT_FACTOR,
      trackInfo.width * TrafficAIService.ROAD_WIDTH_LIMIT_FACTOR,
    );
    targetPoint.addScaledVector(normalAhead, finalOffset);

    const dirX = targetPoint.x - car.position.x;
    const dirZ = targetPoint.z - car.position.z;
    const targetAngle = Math.atan2(dirX, dirZ);

    let angleDiff = targetAngle - car.angle;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    const steerDeadzone = 0.03;
    const cruiseMaxSpeed = 22.0 + (tIndex % 3) * 3.5;

    const roadType = this.trackHelper.getRoadTypeAt(trackInfo.progress);
    const targetSpeed = roadType === "hairpin" ? 12.0 : cruiseMaxSpeed;

    const finalControls: ControlsState = {
      forward: !brakeRequired && car.speed < targetSpeed,
      backward: brakeRequired || car.speed > targetSpeed + 4.0,
      left: angleDiff > steerDeadzone,
      right: angleDiff < -steerDeadzone,
      nitro: false,
      gear: "D",
    };

    return finalControls;
  }

  /**
   * Process autopilot guidance for competitive AI rivals and commuter traffic vehicles
   */
  public updateAICar(car: CarState, dt: number, otherCars: CarState[], physicsService: GamePhysicsService) {
    dt = Math.min(dt, 0.05);
    if (!Number.isFinite(dt) || dt <= 0) {
      dt = 0.0166;
    }

    const isTraffic = car.id.startsWith("traffic");

    if (isTraffic) {
      const commuterControls = this.updateTrafficControl(car, dt, otherCars);
      physicsService.updateCar(car, dt, commuterControls, false);
    } else {
      // Run specialized AI logic depending on the AI car profile
      let aiControls: ControlsState;
      const isNova = car.id.includes("nova");

      if (isNova) {
        // AI Nova is the SPEED enthusiast (Aggressive and Fast)
        aiControls = this.speedAI.update(car, dt, otherCars, physicsService);
      } else {
        // AI Phantom is the HIGH IQ strategist (Dynamic blocking and slipstreaming)
        // Also serves as the fallback for any other competitive AI
        aiControls = this.highIQAI.update(car, dt, otherCars, physicsService);
      }

      // --- STUCK RECOVERY ENGINE (Universal) ---
      if (Math.abs(car.speed) < 2.0) {
        car.stuckTimer += dt;
      } else {
        car.stuckTimer = 0;
      }

      if (car.stuckTimer > 1.0) {
        // Reverse with steering to untangle
        aiControls.forward = false;
        aiControls.backward = true;
        aiControls.gear = "R";
        aiControls.left = Math.random() > 0.5;
        aiControls.right = !aiControls.left;
      }

      if (car.stuckTimer > 2.8) {
        // Stuck for too long, reset to track checkpoints or spline points
        const isRacing2 = this.trackHelper.mapType === "racing2";
        if (isRacing2) {
          const chpts = this.trackHelper.checkpoints;
          if (chpts && chpts.length > 0) {
            car.speed = 15;
            const currentChpt = chpts[car.currentCheckpointIndex || 0] || chpts[0];
            car.angle = Math.atan2(currentChpt.direction.x, currentChpt.direction.z);
            car.position.x = currentChpt.position.x;
            car.position.y = currentChpt.position.y + 0.35;
            car.position.z = currentChpt.position.z;
            car.velocity.x = currentChpt.direction.x * 5;
            car.velocity.y = 0;
            car.velocity.z = currentChpt.direction.z * 5;
          }
        } else {
          const pos3 = TrafficAIService._vecA.set(car.position.x, car.position.y, car.position.z);
          const trackInfo = this.trackHelper.getNearestTrackInfo(pos3, car.id);
          car.speed = 15;
          car.angle = Math.atan2(trackInfo.tangent.x, trackInfo.tangent.z);
          car.position.x = trackInfo.nearestPoint.x;
          car.position.y = terrainManager.getRoadHeight(car.position, car.lastValidY);
          car.position.z = trackInfo.nearestPoint.z;
          car.velocity.x = trackInfo.tangent.x * 5;
          car.velocity.y = 0;
          car.velocity.z = trackInfo.tangent.z * 5;
        }
        car.stuckTimer = 0;
      }

      physicsService.updateCar(car, dt, aiControls, false);
    }
  }
}

export const TrafficAI = TrafficAIService;
