/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { CarState, ControlsState, Checkpoint, Vector3D, Difficulty } from "../types";
import { TrackGeometryHelper } from "./track";
import { particleSystem } from "../world/particleSystem";
import { SuspensionSystem, SuspensionState } from "./suspension";
import { CarCollisionSystem } from "./carCollision";
import { TrafficAIService } from "./trafficAI";
import { terrainManager } from "../world/TerrainManager";
import { MemoryPool } from "./memoryPool";

// Constant physical constraints matching hypercar simulator performance
const MAX_SPEED = 78; // units/sec (~280 km/h)
const REVERSE_MAX_SPEED = 28; // units/sec (~100 km/h)
const ACCELERATION = 40; // responsive torque curve
const DECELERATION = 14; // mechanical engine compression drag
const BRAKING = 65; // high-efficiency carbon brakes
const STEER_SPEED = 2.85; // baseline steering rate (rad/sec)
const FRICTION = 0.988; // stable rolling tyre resistance
const DRIFT_GRIP = 0.86; // sliding slip factor
const NORMAL_GRIP = 0.984; // static tyre friction coefficient
const NITRO_BOOST_SPEED = 108; // maximum nitro speeds (~390 km/h)
const NITRO_BOOST_ACCEL = 75; // explosive rocket launch nitro charge up

export class GamePhysicsService {
  public trackHelper: TrackGeometryHelper;
  public sparkCounter = 0;

  // Traffic management service delegation
  private trafficAIService: TrafficAIService;

  // Track progress history for exact lap counting
  private carProgressHistory = new Map<string, number>();
  private carHasPassedMidpoint = new Map<string, boolean>();

  // Zero-allocation vector caches
  private static readonly _vecA = new THREE.Vector3();
  private static readonly _vecB = new THREE.Vector3();
  private static readonly _vecC = new THREE.Vector3();

  constructor(trackHelper: TrackGeometryHelper) {
    this.trackHelper = trackHelper;
    this.trafficAIService = new TrafficAIService(trackHelper);
  }

  /**
   * Spawns physical particles into the world environment
   */
  public spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: string,
    size: number,
    decay: number,
    isNitro = false,
    isSpark = false,
  ) {
    let type: "nitro" | "exhaust" | "smoke" | "spark" | "dust" = "exhaust";
    if (isNitro) {
      type = "nitro";
    } else if (isSpark) {
      type = "spark";
    } else if (color === "#e2e6eb" || color === "rgba(255,255,255,0.7)") {
      type = "smoke";
    }

    particleSystem.spawn(type, x, y, z, vx, vy, vz, color, size, decay);
  }

  /**
   * Initialises the active lineup of opponents, the player, and dense commuter traffic
   */
  public initializeCars(playerName: string, difficulty: Difficulty, playerCarColor: string): CarState[] {
    const aiColors = ["#ff053c", "#ffe105", "#00f6ff", "#ffa200", "#bebebe"];
    const aiNames = ["Apex", "Nova", "Phantom", "Titan", "Shadow"];
    const result: CarState[] = [];

    this.carProgressHistory.clear();
    this.carHasPassedMidpoint.clear();

    const wheelRadius = 0.38;
    const curveLength = this.trackHelper.curve.getLength();

    // 1. Setup Player Racer (Row 0, left side, side = -1)
    const playerProgress = (1.0 - 15.0 / curveLength) % 1.0;
    const playerPt = this.trackHelper.curve.getPointAt(playerProgress);
    const playerTangent = this.trackHelper.curve.getTangentAt(playerProgress).normalize();
    const playerNormal = new THREE.Vector3(-playerTangent.z, 0, playerTangent.x).normalize();
    const playerSpawnPos = playerPt.clone().addScaledVector(playerNormal, -2.5);

    // Set spawn height correctly on physical road
    const playerRoadHeightTest = terrainManager.queryRoadHeight(playerSpawnPos);
    const playerSpawnY = (playerRoadHeightTest !== null ? playerRoadHeightTest : playerPt.y) + wheelRadius;
    const playerStartAngle = Math.atan2(playerTangent.x, playerTangent.z);

    result.push({
      id: "player",
      name: playerName || "Player",
      isAI: false,
      color: playerCarColor || "#0062ff",
      position: { x: playerSpawnPos.x, y: playerSpawnY, z: playerSpawnPos.z },
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      angle: playerStartAngle,
      angularVelocity: 0,
      driftFactor: 0,
      isDrifting: false,
      currentLap: 1,
      currentCheckpointIndex: 0,
      distanceToNextCheckpoint: 999,
      racePosition: 1,
      totalDistanceTraveled: -15,
      isFinished: false,
      lastActiveTime: Date.now(),
      nitroCharged: 60,
      isNitroActive: false,
      stuckTimer: 0,
      aiTargetNode: 0,
      aiSpeedFactor: 1,
      aiAggression: 0.5,
    });

    // 2. Setup exactly 2 competitive AI Competitors (8m spacing between cars)
    for (let i = 0; i < 2; i++) {
      const side = i % 2 === 0 ? 1 : -1; // Alternate right and left lanes

      const aiDistance = 15.0 + (i + 1) * 8.0;
      const aiProgress = (((1.0 - aiDistance / curveLength) % 1.0) + 1.0) % 1.0;
      const aiPt = this.trackHelper.curve.getPointAt(aiProgress);
      const aiTangent = this.trackHelper.curve.getTangentAt(aiProgress).normalize();
      const aiNormal = new THREE.Vector3(-aiTangent.z, 0, aiTangent.x).normalize();
      const aiOffsetValue = side * 2.5;

      const aiSpawnPos = aiPt.clone().addScaledVector(aiNormal, aiOffsetValue);
      const groundY =
        terrainManager.queryRoadHeight(aiSpawnPos) ?? terrainManager.getHeight(aiSpawnPos.x, aiSpawnPos.z);
      const aiSpawnY = groundY + 0.25;
      const aiStartAngle = Math.atan2(aiTangent.x, aiTangent.z);

      let speedFactor = 0.88;
      let aggression = 0.45;
      if (difficulty === "medium") {
        speedFactor = 0.98;
        aggression = 0.72;
      } else if (difficulty === "hard") {
        speedFactor = 1.05;
        aggression = 0.95;
      }

      result.push({
        id: `ai_${aiNames[i].toLowerCase()}`,
        name: aiNames[i],
        isAI: true,
        color: aiColors[i],
        position: { x: aiSpawnPos.x, y: aiSpawnY, z: aiSpawnPos.z },
        velocity: { x: 0, y: 0, z: 0 },
        speed: 0,
        angle: aiStartAngle,
        angularVelocity: 0,
        driftFactor: 0,
        isDrifting: false,
        currentLap: 1,
        currentCheckpointIndex: 0,
        distanceToNextCheckpoint: 999,
        racePosition: i + 2,
        totalDistanceTraveled: -aiDistance,
        isFinished: false,
        lastActiveTime: Date.now(),
        nitroCharged: 20 + i * 15,
        isNitroActive: false,
        difficulty,
        aiTargetNode: 0,
        aiSpeedFactor: speedFactor + (Math.random() * 0.04 - 0.02),
        aiAggression: aggression,
        stuckTimer: 0,
      });
    }

    // 3. Disabled civilian commute traffic spawning as requested to focus on competitive grand prix racing
    // const trafficLineup = this.trafficAIService.generateTrafficLineup();
    // result.push(...trafficLineup);

    console.log(
      `Successfully initialized a total of ${result.length} vehicles (1 player, 5 AI rivals, 0 civilian traffic).`,
    );
    return result;
  }

  /**
   * Recovers a car immediately to its nearest track checkpoint upon out-of-bounds or NaN trigger.
   */
  public recoverCarToNearestCheckpoint(car: CarState) {
    const now = Date.now();
    const lastRecovery = car.lastRecoveryTime || 0;
    if (now - lastRecovery < 2000) {
      return;
    }
    car.lastRecoveryTime = now;

    const chpts = this.trackHelper.checkpoints;
    const chptIndex =
      car.currentCheckpointIndex >= 0 && car.currentCheckpointIndex < chpts.length ? car.currentCheckpointIndex : 0;
    const chpt = chpts[chptIndex];
    if (!chpt) return;

    console.warn(
      `[Auto-Recovery] Teleported ${car.name || car.id} to checkpoint [${chptIndex}] due to NaN, flying or sinking.`,
    );

    const wheelRadius = 0.38;
    car.position.x = chpt.position.x;
    car.position.z = chpt.position.z;
    car.position.y = chpt.position.y + wheelRadius;

    car.velocity.x = 0;
    car.velocity.y = 0;
    car.velocity.z = 0;
    car.speed = 0;
    car.angularVelocity = 0;
    car.driftFactor = 0;
    car.isDrifting = false;
    car.angle = Math.atan2(chpt.direction.x, chpt.direction.z);
  }

  /**
   * Evaluates the physical dynamics (acceleration, brakes, drift, downforce, gravity) for a vehicle state
   */
  public updateCar(car: CarState, dt: number, controls: ControlsState, isLocked: boolean) {
    // 1. Clamp and validate dt
    dt = Math.min(dt, 0.05);
    if (!Number.isFinite(dt) || dt <= 0) {
      dt = 0.0166;
    }

    // 2. Validate and heal CarState before updating
    if (
      !Number.isFinite(car.position.x) ||
      !Number.isFinite(car.position.y) ||
      !Number.isFinite(car.position.z) ||
      !Number.isFinite(car.velocity.x) ||
      !Number.isFinite(car.velocity.y) ||
      !Number.isFinite(car.velocity.z) ||
      !Number.isFinite(car.speed) ||
      !Number.isFinite(car.angle) ||
      !Number.isFinite(car.angularVelocity)
    ) {
      if (!Number.isFinite(car.position.x)) car.position.x = 0;
      if (!Number.isFinite(car.position.y)) car.position.y = 0;
      if (!Number.isFinite(car.position.z)) car.position.z = 0;
      if (!Number.isFinite(car.velocity.x)) car.velocity.x = 0;
      if (!Number.isFinite(car.velocity.y)) car.velocity.y = 0;
      if (!Number.isFinite(car.velocity.z)) car.velocity.z = 0;
      if (!Number.isFinite(car.speed)) car.speed = 0;
      if (!Number.isFinite(car.angle)) car.angle = 0;
      if (!Number.isFinite(car.angularVelocity)) car.angularVelocity = 0;

      this.recoverCarToNearestCheckpoint(car);
    }

    if (car.isFinished) {
      car.speed *= 0.94;
      car.isNitroActive = false;
      car.velocity.x *= 0.94;
      car.velocity.z *= 0.94;
      return;
    }

    if (isLocked) {
      car.speed = 0;
      car.velocity = { x: 0, y: 0, z: 0 };
      car.isNitroActive = false;
      return;
    }

    // --- AUTO RECOVERY CHECKS ---
    const posCheckObj = GamePhysicsService._vecA.set(car.position.x, car.position.y, car.position.z);
    const hasNan = isNaN(car.position.x) || isNaN(car.position.y) || isNaN(car.position.z);
    if (hasNan) {
      this.recoverCarToNearestCheckpoint(car);
    } else {
      const nearestInfo = this.trackHelper.getNearestTrackInfo(posCheckObj, car.id);
      const roadHeight = nearestInfo ? nearestInfo.nearestPoint.y : 0;
      const relativeY = car.position.y - roadHeight;
      if (relativeY > 5.0 || relativeY < -2.0) {
        this.recoverCarToNearestCheckpoint(car);
      }
    }

    const currentGear = controls.gear || "D";
    const topSpeed = car.isNitroActive ? NITRO_BOOST_SPEED : MAX_SPEED;
    const accelRate = car.isNitroActive ? NITRO_BOOST_ACCEL : ACCELERATION;
    const speedRatio = Math.abs(car.speed) / topSpeed;

    // --- 1. TRANSMISSION TORQUE ENGINE & ACCELERATION ---
    if (currentGear === "P") {
      car.speed = THREE.MathUtils.lerp(car.speed, 0, 15.0 * dt);
      if (Math.abs(car.speed) < 0.1) car.speed = 0;
    } else if (currentGear === "N") {
      if (car.speed > 0) {
        car.speed = Math.max(0, car.speed - DECELERATION * 0.5 * dt);
      } else if (car.speed < 0) {
        car.speed = Math.min(0, car.speed + DECELERATION * 0.5 * dt);
      }
    } else if (currentGear === "D") {
      if (controls.forward) {
        // Torque curve imitating mechanical transmission ratios (less pull at top extremes)
        const torqueRatio = Math.max(0.35, Math.pow(1.0 - speedRatio, 0.7));
        car.speed += accelRate * torqueRatio * dt;
        if (car.speed > topSpeed) car.speed = topSpeed;
      } else if (controls.backward) {
        const brakeEfficiency = 1.0 + speedRatio * 0.5;
        car.speed -= BRAKING * brakeEfficiency * dt;
        if (car.speed < 0) car.speed = 0;
      } else {
        car.speed = Math.max(0, car.speed - DECELERATION * dt);
      }
    } else if (currentGear === "R") {
      if (controls.forward) {
        // under accelerator in Reverse
        const reverseRatio = Math.max(0.4, 1.0 - (Math.abs(car.speed) / REVERSE_MAX_SPEED) * 0.45);
        car.speed -= ACCELERATION * 0.7 * reverseRatio * dt;
        if (car.speed < -REVERSE_MAX_SPEED) car.speed = -REVERSE_MAX_SPEED;
      } else if (controls.backward) {
        // under brake in Reverse
        const brakeEfficiency = 1.0 + (Math.abs(car.speed) / REVERSE_MAX_SPEED) * 0.45;
        car.speed += BRAKING * brakeEfficiency * dt;
        if (car.speed > 0) car.speed = 0;
      } else {
        car.speed = Math.min(0, car.speed + DECELERATION * dt);
      }
    }

    if (controls.handbrake) {
      if (car.speed > 0) {
        car.speed = Math.max(0, car.speed - BRAKING * 0.85 * dt);
      } else if (car.speed < 0) {
        car.speed = Math.min(0, car.speed + BRAKING * 0.85 * dt);
      }
    }

    // --- 2. AERODYNAMIC AIR RESISTANCE ---
    // Quad-drag fluid resistance (acts heavily above 200 km/h)
    const dragCoeff = 0.0016;
    const dragForce = (dragCoeff * car.speed * car.speed + 0.1) * dt;
    if (car.speed > 0) {
      car.speed = Math.max(0, car.speed - dragForce);
    } else if (car.speed < 0) {
      car.speed = Math.min(0, car.speed + dragForce);
    }

    // --- 3. NITRO ACCUMULATION ---
    if (!car.isNitroActive) {
      const isDriftBonus = car.isDrifting && Math.abs(car.speed) > 22 ? 28 : 5;
      car.nitroCharged = Math.min(100, car.nitroCharged + isDriftBonus * dt);

      if (car.isAI && car.nitroCharged > 90 && Math.abs(car.speed) > topSpeed * 0.65 && Math.random() < 0.04) {
        car.isNitroActive = true;
      } else if (!car.isAI && controls.nitro && car.nitroCharged > 15) {
        car.isNitroActive = true;
      }
    }

    if (car.isNitroActive) {
      car.nitroCharged -= 28 * dt;
      if (car.nitroCharged <= 0) {
        car.nitroCharged = 0;
        car.isNitroActive = false;
      }
    }

    // --- 4. SPEED-SENSITIVE ANALOG STEERING & YAW ---
    const rawSteerInput =
      controls.steerValue !== undefined ? controls.steerValue : controls.left ? 1 : controls.right ? -1 : 0;
    const smoothFactor = Math.abs(rawSteerInput) > 0.01 ? 12.0 : 15.0;
    car.steerValue = THREE.MathUtils.lerp(car.steerValue || 0, rawSteerInput, smoothFactor * dt);

    // Speed-sensitive steering angle (larger turning angle at low speeds, smaller at high speeds for stable 120 FPS AAA feel)
    const speedKmh = Math.abs(car.speed) * 3.6;
    const steerSpeedScale = 1.25 - Math.min(0.98, (speedKmh / 280) * 0.98);
    const driftSteerMultiplier = car.isDrifting ? 1.62 : 1.12;

    car.angularVelocity = STEER_SPEED * steerSpeedScale * driftSteerMultiplier * (car.steerValue || 0);

    // Turn yaw angle only when vehicle is in motion
    const movementGripFactor = Math.min(1.0, Math.abs(car.speed) / 3.0);
    car.angle += car.angularVelocity * dt * (car.speed < 0 ? -movementGripFactor : movementGripFactor);

    // --- 5. PROGRESSIVE DRIFT CONTROLS, WEIGHT TRANSFER & GRIP friction ---
    // Calculate longitudinal acceleration proxy to emulate suspension weight transfer
    const prevSpeedVal = (car as any)._prevSpeed !== undefined ? (car as any)._prevSpeed : car.speed;
    const longitudinalAccel = (car.speed - prevSpeedVal) / Math.max(0.001, dt);
    (car as any)._prevSpeed = car.speed;
    const weightTransferFrontRear = longitudinalAccel * 0.015;

    // Brake-to-drift / Handbrake-to-drift dynamic controls similar to Forza Horizon and NFS
    const isSteeringHard = Math.abs(car.steerValue || 0) > 0.25;
    const isBraking = controls.backward && car.speed > 12.0;
    const isSharpTurn = Math.abs(car.steerValue || 0) > 0.45;
    const minDriftThreshold = car.id.startsWith("traffic") ? 25 : 18;

    const wantsDrifting =
      controls.handbrake || (isSteeringHard && isBraking) || (isSharpTurn && Math.abs(car.speed) > minDriftThreshold);
    car.isDrifting = wantsDrifting && Math.abs(car.speed) > minDriftThreshold && currentGear !== "P";

    car.driftFactor = THREE.MathUtils.lerp(car.driftFactor || 0, car.isDrifting ? 1 : 0, 7.5 * dt);

    // Dynamic grip load modifier based on progressive weight transfer: heavy braking/handbraking unloads rear tires, easing drift engagement
    let gripLoadFactor = 1.0;
    if (weightTransferFrontRear < -0.15) {
      gripLoadFactor *= 0.88;
    }
    const currentGrip = car.isDrifting ? DRIFT_GRIP : NORMAL_GRIP;
    const gripFactor = controls.handbrake ? currentGrip * 0.82 : currentGrip * gripLoadFactor;

    let activeGrip = THREE.MathUtils.lerp(NORMAL_GRIP, gripFactor, car.driftFactor);

    // Facing angles
    const fowardX = Math.sin(car.angle);
    const forwardZ = Math.cos(car.angle);

    const targetVelX = fowardX * car.speed;
    const targetVelZ = forwardZ * car.speed;

    // Settle lateral slipping forces based on tire grip friction coefficients
    car.velocity.x = car.velocity.x * activeGrip + targetVelX * (1 - activeGrip);
    car.velocity.z = car.velocity.z * activeGrip + targetVelZ * (1 - activeGrip);

    car.velocity.x *= FRICTION;
    car.velocity.z *= FRICTION;

    // counter-steering assistance (helps maintain drift control, preventing random spins)
    if (car.isDrifting) {
      const velHeading = Math.atan2(car.velocity.x, car.velocity.z);
      let slipAngle = velHeading - car.angle;
      while (slipAngle < -Math.PI) slipAngle += Math.PI * 2;
      while (slipAngle > Math.PI) slipAngle -= Math.PI * 2;

      const assistFactor = car.isAI ? 0.45 : 0.85;
      car.angle += slipAngle * assistFactor * dt;
    }

    // Integrate positions
    car.position.x += car.velocity.x * dt;
    car.position.z += car.velocity.z * dt;

    // --- 5.1 ROAD GEOMETRY CHECKS AND TRACK BOUNDARY COUPLINGS (Invisible Barriers & Automatic Recovery Steering) ---
    const posCheckVal = GamePhysicsService._vecA.set(car.position.x, car.position.y, car.position.z);
    const checkTrackInfo = this.trackHelper.getNearestTrackInfo(posCheckVal, car.id);
    const currentRoadWidth = checkTrackInfo.width;

    const shoulderStart = currentRoadWidth / 2 - 1.8;
    const absoluteLimit = currentRoadWidth / 2 - 0.45;
    const sideSign = Math.sign(checkTrackInfo.sideOffset);

    // A. Gradual Dirt/Grass shoulder resistance, steering decay and gently steering/pushing back to center
    if (Math.abs(checkTrackInfo.sideOffset) > shoulderStart) {
      const offRoadFactor = Math.min(1.0, (Math.abs(checkTrackInfo.sideOffset) - shoulderStart) / 1.35);

      // Off-road penalties to grip, torque/acceleration, and speed (Forza mode)
      car.speed *= 1.0 - 0.08 * offRoadFactor * dt * 60;
      activeGrip *= 1.0 - offRoadFactor * 0.35;
      car.angularVelocity *= 1.0 - offRoadFactor * 0.48;

      // Show tire skid effects via thick brown dust particles on off-road segments
      if (Math.random() < 0.45 && Math.abs(car.speed) > 10) {
        this.spawnParticle(
          car.position.x,
          car.position.y + 0.1,
          car.position.z,
          Math.random() * 4 - 2,
          1 + Math.random() * 3,
          Math.random() * 4 - 2,
          "#d2b48c", // dust brown
          0.6 + Math.random() * 0.6,
          0.8 + Math.random() * 0.8,
        );
      }

      // Calculate target heading pointing inwards to gradually steer on road
      const roadHeading = Math.atan2(checkTrackInfo.tangent.x, checkTrackInfo.tangent.z);
      const inwardsOffsetAngle = 0.42 * -sideSign;
      let targetHeading = roadHeading + inwardsOffsetAngle;

      let headingDiff = targetHeading - car.angle;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;

      const steerBackStrength = car.isAI ? 5.5 : 3.2;
      car.angle += headingDiff * steerBackStrength * offRoadFactor * dt;

      // Gentle push towards center
      const inwardImpulse = (car.isAI ? 18.0 : 12.0) * offRoadFactor * dt;
      car.velocity.x += -checkTrackInfo.normal.x * sideSign * inwardImpulse;
      car.velocity.z += -checkTrackInfo.normal.z * sideSign * inwardImpulse;
    }

    // B. Hard Position Constraint & Invisible Barriers (Absolutely cannot leave the asphalt playable bounds)
    if (Math.abs(checkTrackInfo.sideOffset) > absoluteLimit) {
      // Snap position back onto the road surface shoulder edge
      car.position.x = checkTrackInfo.nearestPoint.x + checkTrackInfo.normal.x * absoluteLimit * sideSign;
      car.position.z = checkTrackInfo.nearestPoint.z + checkTrackInfo.normal.z * absoluteLimit * sideSign;

      // Zero out outward-facing velocity
      const velVec = MemoryPool.getVector().set(car.velocity.x, 0, car.velocity.z);
      const boundaryNormal = MemoryPool.getVector()
        .set(checkTrackInfo.normal.x, 0, checkTrackInfo.normal.z)
        .multiplyScalar(sideSign);

      const speedAlongBnyNormal = velVec.dot(boundaryNormal);
      if (speedAlongBnyNormal > 0) {
        // Elastic deflection bounce
        velVec.addScaledVector(boundaryNormal, -1.25 * speedAlongBnyNormal);
        car.velocity.x = velVec.x;
        car.velocity.z = velVec.z;
        car.speed *= 0.82; // rubbing friction cuts speed
      }

      // Sparks if moving fast
      if (Math.random() < 0.4 && Math.abs(car.speed) > 15) {
        this.spawnParticle(
          car.position.x,
          car.position.y + 0.2,
          car.position.z,
          -checkTrackInfo.normal.x * sideSign * (4 + Math.random() * 8),
          2 + Math.random() * 5,
          -checkTrackInfo.normal.z * sideSign * (4 + Math.random() * 8),
          "#ffa200",
          0.18,
          1.6,
          false,
          true,
        );
      }
    }

    // C. Disaster Emergency Recovery (If vehicle falls off road or escapes coordinate grids)
    const crashLimit = currentRoadWidth / 2 + 1.6;
    if (Math.abs(checkTrackInfo.sideOffset) > crashLimit) {
      console.warn(`Disaster recovery activated for ${car.id}. Safe recovery executed.`);
      this.recoverCarToNearestCheckpoint(car);
    }

    // --- 6. VERTICAL SUSPENSION, DOWNFORCE & GRAVITY CLAMPING ---
    const pos3 = GamePhysicsService._vecA.set(car.position.x, car.position.y, car.position.z);
    const trackInfo = this.trackHelper.getNearestTrackInfo(pos3, car.id);

    // Only query expensive queryRoadHeight if close to the road track spline! (Optimizes 80% of off-road calls)
    const bvhRoadY =
      trackInfo.distanceToTrack < trackInfo.width / 2 + 3.0 ? terrainManager.queryRoadHeight(pos3) : null;
    const terrainY = terrainManager.getHeight(car.position.x, car.position.z);

    let roadY = trackInfo.nearestPoint.y;
    // Prevent bridge/upper-level snap errors: ignore queryRoadHeight results that are far off road spline.
    // This perfectly prevents vehicles from snapping 5+ meters up onto bridges or lower paths!
    if (bvhRoadY !== null && Math.abs(bvhRoadY - trackInfo.nearestPoint.y) < 4.5) {
      roadY = bvhRoadY;
    } else {
      // If outside RoadBVH mesh for some reason, use track spline or terrain height
      if (trackInfo.distanceToTrack < trackInfo.width / 2 + 3.0) {
        roadY = trackInfo.nearestPoint.y;
      } else {
        roadY = terrainY;
      }
    }

    // Ground level is the road surface height (or terrain height if off-road)
    const minHeight = Math.max(roadY, terrainY);

    // If airborne distance > 0.3m, automatically reposition vehicle flat on the road surface
    const airborneDist = car.position.y - minHeight;
    if (airborneDist > 0.3) {
      car.position.y = minHeight;
      car.velocity.y = 0;
    }

    // Realistic Continuous Downforce: F_downforce = -0.022 * v^2 to keep cars extremely planted at speed
    const downforceY = -0.022 * car.speed * car.speed;

    // Apply high-sport suspension damping & spring force (Keep constant ride height, apply suspension damping)
    if (car.position.y <= minHeight + 0.15) {
      const springK = 250.0; // high-stiffness sport spring
      const dampC = 20.0; // heavy damping to keep car flat and eliminate vertical oscillations

      // Net vertical acceleration: Spring force (Hooke's Law) + Damping force + Downforce
      const accelY = (minHeight - car.position.y) * springK - dampC * car.velocity.y + downforceY;

      car.velocity.y += accelY * dt;
    } else {
      // Airborne gravity (if within the 0.3m limit)
      const gravity = 28.0; // strong realistic gravity
      car.velocity.y += (-gravity + downforceY * 0.5) * dt;
    }

    car.position.y += car.velocity.y * dt;

    // Hard constraint: Bottom of car/tires must touch the road surface (No sinking)
    if (car.position.y < minHeight) {
      car.position.y = minHeight;
      car.velocity.y = Math.max(0, car.velocity.y);
    }

    // Clamp values to secure stable, non-jiggling ranges
    const currentMaxSpeedCap = car.isNitroActive ? NITRO_BOOST_SPEED : MAX_SPEED;
    car.speed = THREE.MathUtils.clamp(car.speed, -REVERSE_MAX_SPEED, currentMaxSpeedCap);

    const speedMag = Math.sqrt(car.velocity.x * car.velocity.x + car.velocity.z * car.velocity.z);
    if (speedMag > currentMaxSpeedCap) {
      const scale = currentMaxSpeedCap / speedMag;
      car.velocity.x *= scale;
      car.velocity.z *= scale;
    }

    car.angularVelocity = THREE.MathUtils.clamp(car.angularVelocity, -STEER_SPEED * 1.5, STEER_SPEED * 1.5);

    // --- 7. SOLID GUARDRAIL CONTACT RESOLUTONS ---
    CarCollisionSystem.resolveWallCollision(car, trackInfo, this.spawnParticle.bind(this), dt);

    // Progress updates
    this.updateRaceChecking(car, trackInfo.progress, pos3);
  }

  /**
   * Tracks progression, registring checkpoints and counting lap loops
   */
  private updateRaceChecking(car: CarState, progress: number, pos3: THREE.Vector3) {
    let prevProgress = this.carProgressHistory.get(car.id);
    if (prevProgress === undefined) {
      prevProgress = progress;
    }
    this.carProgressHistory.set(car.id, progress);

    const chpts = this.trackHelper.checkpoints;
    const numCheckpoints = chpts.length;
    car.currentCheckpointIndex = Math.min(numCheckpoints - 1, Math.floor(progress * numCheckpoints));

    if (car.currentCheckpointIndex > 10 && car.currentCheckpointIndex < 20) {
      this.carHasPassedMidpoint.set(car.id, true);
    }

    // Crossing start/finish line checks
    if (prevProgress > 0.82 && progress < 0.18) {
      const hasPassedMid = this.carHasPassedMidpoint.get(car.id) || false;
      if (hasPassedMid) {
        if (!car.isFinished) {
          if (car.currentLap === 3) {
            car.isFinished = true;
            const clock = (window as any).raceElapsedTime;
            car.finishTime = typeof clock === "number" ? clock : performance.now() / 1000;
          } else {
            car.currentLap += 1;
            this.carHasPassedMidpoint.set(car.id, false);
          }
        }
      }
    }

    // Calculate checkpoint distance
    const nextChptIndex = (car.currentCheckpointIndex + 1) % numCheckpoints;
    const nextChpt = chpts[nextChptIndex];

    if (nextChpt && nextChpt.position) {
      const chptPos = GamePhysicsService._vecB.set(nextChpt.position.x, nextChpt.position.y, nextChpt.position.z);
      if (pos3 && typeof pos3.distanceTo === "function" && chptPos && typeof chptPos.distanceToSquared === "function") {
        car.distanceToNextCheckpoint = pos3.distanceTo(chptPos);
      } else {
        car.distanceToNextCheckpoint = 999;
      }
    } else {
      car.distanceToNextCheckpoint = 999;
    }

    const trackLength = this.trackHelper.length || 4150.0;
    let displayProgress = progress;
    if (car.currentLap === 1 && progress > 0.82) {
      displayProgress = progress - 1.0;
    }
    car.totalDistanceTraveled = (car.currentLap - 1) * trackLength + displayProgress * trackLength;
  }

  /**
   * Generates exhaust emission smoke, tire smoke during drift and blue nitro trails
   */
  public generateExhaustParticles(car: CarState, dt: number) {
    if (car.speed === 0) return;

    const angleBack = car.angle + Math.PI;
    const backOffsetX = Math.sin(angleBack) * 2.2;
    const backOffsetZ = Math.cos(angleBack) * 2.2;
    const exLY = car.position.y + 0.12;

    const nx = -backOffsetZ;
    const nz = backOffsetX;
    const nLen = Math.sqrt(nx * nx + nz * nz);
    const ux = nLen > 0 ? nx / nLen : 0;
    const uz = nLen > 0 ? nz / nLen : 0;

    const exLX = car.position.x + backOffsetX + ux * 0.72;
    const exLZ = car.position.z + backOffsetZ + uz * 0.72;
    const exRX = car.position.x + backOffsetX - ux * 0.72;
    const exRZ = car.position.z + backOffsetZ - uz * 0.72;

    if (car.isNitroActive) {
      for (let i = 0; i < 2; i++) {
        const vx = -Math.sin(car.angle) * 16 + (Math.random() * 2.5 - 1.25);
        const vy = 0.2 + Math.random() * 1.5;
        const vz = -Math.cos(car.angle) * 16 + (Math.random() * 2.5 - 1.25);

        const px = i === 0 ? exLX : exRX;
        const pz = i === 0 ? exLZ : exRZ;

        this.spawnParticle(
          px,
          exLY,
          pz,
          vx,
          vy,
          vz,
          Math.random() > 0.55 ? "#00eeff" : "#0048ff",
          0.38 + Math.random() * 0.22,
          4.8,
          true,
          false,
        );
      }
    }

    if (car.isDrifting && Math.abs(car.speed) > 18) {
      for (let i = 0; i < 3; i++) {
        const vx = Math.random() * 4.2 - 2.1;
        const vy = 1.0 + Math.random() * 2.5;
        const vz = Math.random() * 4.2 - 2.1;

        const side = Math.random() > 0.5 ? 0.95 : -0.95;
        const px = car.position.x + ux * side;
        const pz = car.position.z + uz * side;

        this.spawnParticle(
          px,
          car.position.y + 0.1,
          pz,
          vx,
          vy,
          vz,
          "#e2e6eb",
          0.72 + Math.random() * 0.68,
          0.75 + Math.random() * 0.65,
          false,
          false,
        );
      }
    }
  }

  /**
   * Continuous particles update tick
   */
  public updateParticles(dt: number) {
    particleSystem.update(dt);
  }

  /**
   * Resolves vehicle-to-vehicle soft impact overrides
   */
  public resolveCarCollisions(cars: CarState[]) {
    CarCollisionSystem.resolveVehicleCollisions(cars, this.spawnParticle.bind(this));
  }

  /**
   * Process autopilot guidance for competitive AI rivals and commuter traffic vehicles
   */
  public updateAICar(car: CarState, dt: number, otherCars: CarState[]) {
    // Clamp and validate dt
    dt = Math.min(dt, 0.05);
    if (!Number.isFinite(dt) || dt <= 0) {
      dt = 0.0166;
    }

    const isTraffic = car.id.startsWith("traffic");

    if (isTraffic) {
      // 1. COMMUTER TRAFFIC PILOT DIRECTION (Smooth lanes driving + braking safety controls)
      const commuterControls = this.trafficAIService.updateTrafficControl(car, dt, otherCars);
      this.updateCar(car, dt, commuterControls, false);
    } else {
      // 2. RIVALS COMPETITIVE AI autonavigation routine
      const pos3 = GamePhysicsService._vecA.set(car.position.x, car.position.y, car.position.z);
      const trackInfo = this.trackHelper.getNearestTrackInfo(pos3, car.id);

      // Speed sensitive target lookahead progress index
      const speedKmh = Math.abs(car.speed) * 3.6;
      const lookaheadU = 0.016 + Math.min(0.045, (speedKmh / 300) * 0.04);
      const targetU = (trackInfo.progress + lookaheadU) % 1.0;

      const targetSplinePt = this.trackHelper.curve.getPointAt(targetU);
      const tangentAhead = this.trackHelper.curve.getTangentAt(targetU).normalize();
      const normalAhead = GamePhysicsService._vecC.set(-tangentAhead.z, 0, tangentAhead.x).normalize();

      const currentTangent = trackInfo.tangent;
      const bendFactor = currentTangent.cross(tangentAhead).y;

      // Inside apex shortcuts targeting
      let racingLineOffset = -bendFactor * (trackInfo.width * 0.35);
      racingLineOffset = THREE.MathUtils.clamp(racingLineOffset, -trackInfo.width * 0.38, trackInfo.width * 0.38);

      // Collision avoiding & active overtaking swerving shifts
      let evasionSideOffset = 0;
      let decelerationWarning = false;

      otherCars.forEach((other) => {
        if (other.id === car.id) return;

        const relX = other.position.x - car.position.x;
        const relZ = other.position.z - car.position.z;
        const distSq = relX * relX + relZ * relZ;

        if (distSq < 576) {
          // 24m proximity check
          const cosAngle = Math.cos(-car.angle);
          const sinAngle = Math.sin(-car.angle);
          const localX = relX * cosAngle - relZ * sinAngle;
          const localZ = relX * sinAngle + relZ * cosAngle;

          if (localZ > 0 && localZ < 18.0) {
            // threat block path
            if (Math.abs(localX) < 3.2) {
              const dodgeSign = localX >= 0 ? -1 : 1;
              evasionSideOffset += dodgeSign * 4.8 * car.aiAggression;
              if (localZ < 7.5) {
                decelerationWarning = true;
              }
            }
          }
        }
      });

      const targetApexPoint = GamePhysicsService._vecB.copy(targetSplinePt);
      // Clamp final racing path offset so AI never drives onto off-road shoulders or touches walls during overtaking/dodging
      const maxAllowedAIDeviation = Math.max(0.2, trackInfo.width / 2 - 2.8);
      const finalOffset = THREE.MathUtils.clamp(
        racingLineOffset + evasionSideOffset,
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
        forward: !decelerationWarning,
        backward: decelerationWarning,
        left: angleDiff > thresholdSteer,
        right: angleDiff < -thresholdSteer,
        nitro: false,
        gear: "D",
      };

      // Competitive rubber-banding targets
      const player = otherCars.find((c) => c.id === "player");
      let rubberBandFactor = 1.0;

      if (player) {
        const distanceDelta = car.totalDistanceTraveled - player.totalDistanceTraveled;
        if (distanceDelta > 150) {
          rubberBandFactor = 0.9;
        } else if (distanceDelta > 60) {
          rubberBandFactor = 0.94;
        } else if (distanceDelta < -150) {
          rubberBandFactor = 1.15;
        } else if (distanceDelta < -60) {
          rubberBandFactor = 1.11;
        }
      }

      const roadType = this.trackHelper.getRoadTypeAt(trackInfo.progress);
      let targetCruiseSpeed = MAX_SPEED * car.aiSpeedFactor * rubberBandFactor;

      if (roadType === "hairpin") {
        targetCruiseSpeed = MAX_SPEED * 0.35;
        if (Math.abs(angleDiff) > 0.38) {
          aiControls.forward = false;
          aiControls.backward = true;
        }
      } else if (roadType === "normal" && Math.abs(bendFactor) > 0.08) {
        targetCruiseSpeed = MAX_SPEED * 0.7;
      }

      // Straight speedway nitro activates
      if (Math.abs(angleDiff) < 0.12 && roadType === "straight" && car.speed > 35 && car.nitroCharged > 32) {
        aiControls.nitro = true;
      }

      if (car.speed > targetCruiseSpeed) {
        aiControls.forward = false;
      }

      // Stuck recovery triggers
      if (Math.abs(car.speed) < 1.0) {
        car.stuckTimer += dt;
      } else {
        car.stuckTimer = 0;
      }

      if (car.stuckTimer > 1.5) {
        aiControls.forward = false;
        aiControls.backward = true;
        aiControls.gear = "R";
        aiControls.left = angleDiff < 0;
        aiControls.right = angleDiff > 0;

        if (car.stuckTimer > 5.0) {
          car.speed = 15;
          car.angle = Math.atan2(trackInfo.tangent.x, trackInfo.tangent.z);
          car.position.x = trackInfo.nearestPoint.x;
          car.position.y = trackInfo.nearestPoint.y;
          car.position.z = trackInfo.nearestPoint.z;
          car.velocity.x = trackInfo.tangent.x * 5;
          car.velocity.z = trackInfo.tangent.z * 5;
          car.stuckTimer = 0;
        }
      }

      this.updateCar(car, dt, aiControls, false);
    }
  }

  /**
   * Sorts stand-by leaderboards mapping
   */
  public evaluatePositionsRanks(cars: CarState[]) {
    this.resolveCarCollisions(cars);

    const sorted = [...cars].sort((a, b) => {
      if (a.isFinished && !b.isFinished) return -1;
      if (!a.isFinished && b.isFinished) return 1;
      return b.totalDistanceTraveled - a.totalDistanceTraveled;
    });

    for (let i = 0; i < sorted.length; i++) {
      const idx = cars.findIndex((c) => c.id === sorted[i].id);
      if (idx !== -1) {
        cars[idx].racePosition = i + 1;
      }
    }
  }
}
