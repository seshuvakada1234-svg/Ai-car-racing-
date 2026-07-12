// @ts-nocheck
/**
 * GamePhysics.ts — V2 FULL FIX
 * ================================
 * FIXES:
 * 1. Subnormal float underflow — velocity decays to 1e-300 never reaching 0
 * 2. Wrong spawn Y (8.4m above road) — fixed to use road surface directly
 * 3. Ghost steerValue never resets to 0
 * 4. Removed corridorHalf wall that stopped all cars at 10m
 * 5. Racing2 map bounds check removed (was triggering at 60m from center)
 */

import * as THREE from "three";
import { CarState, ControlsState, Difficulty } from "../types";
import { TrackGeometryHelper } from "../utils/track";
import { particleSystem } from "../world/particleSystem";
import { CarCollisionSystem } from "../utils/carCollision";
import { terrainManager } from "../world/TerrainManager";
import { MemoryPool } from "../utils/memoryPool";

const MAX_SPEED = 78;
const REVERSE_MAX_SPEED = 28;
const ACCELERATION = 40;
const DECELERATION = 14;
const BRAKING = 65;
const STEER_SPEED = 2.85;
const FRICTION = 0.988;
const DRIFT_GRIP = 0.86;
const NORMAL_GRIP = 0.984;
const NITRO_BOOST_SPEED = 108;
const NITRO_BOOST_ACCEL = 75;

// Subnormal float threshold — anything smaller than this is treated as zero
const FLOAT_ZERO = 0.0001;
const WHEEL_RADIUS = 0.38;
const LINEAR_DAMPING = 1 - FRICTION;
const ANGULAR_DAMPING = 0.08;

export class GamePhysicsService {
  public trackHelper: TrackGeometryHelper;
  public sparkCounter = 0;

  private carProgressHistory = new Map<string, number>();
  private carHasPassedMidpoint = new Map<string, boolean>();

  private static readonly _vecA = new THREE.Vector3();
  private static readonly _vecB = new THREE.Vector3();
  private static readonly _vecC = new THREE.Vector3();

  constructor(trackHelper: TrackGeometryHelper) {
    this.trackHelper = trackHelper;
  }

  private resolveSpawnOnRoad(base: THREE.Vector3, wheelRadius: number): THREE.Vector3 {
    if (this.trackHelper.mapType === "racing2") {
      const road = terrainManager.resolveRoadSurfacePosition(base, 240);
      if (road) return new THREE.Vector3(road.x, road.y + wheelRadius, road.z);
      const roadY = terrainManager.getRoadHeight(base, base.y);
      return new THREE.Vector3(base.x, roadY + wheelRadius, base.z);
    }
    const roadY = terrainManager.getRoadHeight(base);
    return new THREE.Vector3(base.x, roadY + wheelRadius, base.z);
  }

  public spawnParticle(x, y, z, vx, vy, vz, color, size, decay, isNitro = false, isSpark = false) {
    let type = "exhaust";
    if (isNitro) type = "nitro";
    else if (isSpark) type = "spark";
    else if (color === "#e2e6eb" || color === "rgba(255,255,255,0.7)") type = "smoke";
    particleSystem.spawn(type, x, y, z, vx, vy, vz, color, size, decay);
  }

  public initializeCars(playerName: string, difficulty: Difficulty, playerCarColor: string): CarState[] {
    const isRacing2 = this.trackHelper.mapType === "racing2";
    const aiCount = 2; // Always spawn exactly 2 AI cars (plus 1 player)
    const aiColors = ["#ffe105", "#00f6ff", "#ffa200", "#ff3e8a", "#9d4dff"];
    const aiNames = ["Nova", "Phantom", "Titan", "Apex", "Specter"];
    const result: CarState[] = [];

    this.carProgressHistory.clear();
    this.carHasPassedMidpoint.clear();

    const wheelRadius = 0.38;
    const curveLength = this.trackHelper.curve.getLength();

    const GRID_ROW_SPACING = 8.0;
    const GRID_LATERAL = 2.6;
    const FIRST_ROW_BACK = 18.0;

    const gridSlot = (slotIndex: number) => {
      const row = Math.floor(slotIndex / 2);
      const sideIdx = slotIndex % 2;
      const back = FIRST_ROW_BACK + row * GRID_ROW_SPACING;
      const lateral = sideIdx === 0 ? -GRID_LATERAL : GRID_LATERAL;
      const progress = (((1.0 - back / curveLength) % 1.0) + 1.0) % 1.0;
      const pt = this.trackHelper.curve.getPointAt(progress);
      const tangent = this.trackHelper.curve.getTangentAt(progress).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const spawn = pt.clone().addScaledVector(normal, lateral);
      const road = this.resolveSpawnOnRoad(spawn, wheelRadius);
      const angle = Math.atan2(tangent.x, tangent.z);
      return { road, angle, back };
    };

    const p = gridSlot(0);
    result.push({
      id: "player",
      name: playerName || "Player",
      isAI: false,
      color: playerCarColor || "#0062ff",
      position: { x: p.road.x, y: p.road.y, z: p.road.z },
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      angle: p.angle,
      angularVelocity: 0,
      driftFactor: 0,
      isDrifting: false,
      currentLap: 1,
      currentCheckpointIndex: 0,
      distanceToNextCheckpoint: 999,
      racePosition: 1,
      totalDistanceTraveled: -p.back,
      isFinished: false,
      lastActiveTime: Date.now(),
      nitroCharged: 60,
      isNitroActive: false,
      stuckTimer: 0,
      aiTargetNode: 0,
      aiSpeedFactor: 1,
      aiAggression: 0.5,
      throttle: 0,
      brake: 0,
      steering: 0,
      gear: "D",
      awake: true,
      mass: 1450,
      engineRunning: true,
      steerValue: 0,
    });

    for (let i = 0; i < aiCount; i++) {
      const slot = i + 1;
      const a = gridSlot(slot);
      let speedFactor = 0.88,
        aggression = 0.45;
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
        position: { x: a.road.x, y: a.road.y, z: a.road.z },
        velocity: { x: 0, y: 0, z: 0 },
        speed: 0,
        angle: a.angle,
        angularVelocity: 0,
        driftFactor: 0,
        isDrifting: false,
        currentLap: 1,
        currentCheckpointIndex: 0,
        distanceToNextCheckpoint: 999,
        racePosition: slot + 1,
        totalDistanceTraveled: -a.back,
        isFinished: false,
        lastActiveTime: Date.now(),
        nitroCharged: 20 + i * 12,
        isNitroActive: false,
        difficulty,
        aiTargetNode: 0,
        aiSpeedFactor: speedFactor + (Math.random() * 0.04 - 0.02),
        aiAggression: aggression,
        stuckTimer: 0,
        throttle: 0,
        brake: 0,
        steering: 0,
        gear: "D",
        awake: true,
        mass: 1450,
        engineRunning: true,
        steerValue: 0,
      });
    }
    return result;
  }

  public recoverCarToNearestCheckpoint(car: CarState) {
    const now = Date.now();
    const lastRecovery = car.lastRecoveryTime || 0;
    if (now - lastRecovery < 5000) return;
    car.lastRecoveryTime = now;
    car.recoveryCount = (car.recoveryCount || 0) + 1;

    const chpts = this.trackHelper.checkpoints;
    const chptIndex =
      car.currentCheckpointIndex >= 0 && car.currentCheckpointIndex < chpts.length ? car.currentCheckpointIndex : 0;
    const chpt = chpts[chptIndex];
    if (!chpt) return;

    const wheelRadius = 0.38;
    const checkpointPos = GamePhysicsService._vecA.set(chpt.position.x, chpt.position.y, chpt.position.z);
    const roadSpawn = this.resolveSpawnOnRoad(checkpointPos, wheelRadius);
    car.position.x = roadSpawn.x;
    car.position.y = roadSpawn.y;
    car.position.z = roadSpawn.z;
    car.lastValidY = roadSpawn.y - wheelRadius;
    car.velocity.x = 0;
    car.velocity.y = 0;
    car.velocity.z = 0;
    car.speed = 0;
    car.angularVelocity = 0;
    car.driftFactor = 0;
    car.isDrifting = false;
    car.steerValue = 0;
    car.angle = Math.atan2(chpt.direction.x, chpt.direction.z);
  }

  private checkAndHandleRecovery(car: CarState, dt: number) {
    const now = Date.now();

    // FIX: Sanitize all values including steerValue
    const hasNan =
      !Number.isFinite(car.position.x) ||
      !Number.isFinite(car.position.y) ||
      !Number.isFinite(car.position.z) ||
      !Number.isFinite(car.velocity.x) ||
      !Number.isFinite(car.velocity.y) ||
      !Number.isFinite(car.velocity.z) ||
      !Number.isFinite(car.speed) ||
      !Number.isFinite(car.angle) ||
      !Number.isFinite(car.angularVelocity);

    if (hasNan) {
      car.position.x = Number.isFinite(car.position.x) ? car.position.x : 0;
      car.position.y = Number.isFinite(car.position.y) ? car.position.y : 2.71;
      car.position.z = Number.isFinite(car.position.z) ? car.position.z : 0;
      car.velocity.x = 0;
      car.velocity.y = 0;
      car.velocity.z = 0;
      car.speed = 0;
      car.angle = 0;
      car.angularVelocity = 0;
      car.steerValue = 0;
      this.recoverCarToNearestCheckpoint(car);
      return;
    }

    // Legacy map bounds only
    if (
      this.trackHelper.mapType !== "racing2" &&
      (Math.abs(car.position.x) > 3000 || car.position.z < -3000 || car.position.z > 4500)
    ) {
      this.recoverCarToNearestCheckpoint(car);
      return;
    }

    // FIX: Racing2 — recover if car falls below map OR if it has been floating/flying too high off-road/in-air
    if (this.trackHelper.mapType === "racing2") {
      const roadY = terrainManager.getRoadHeight(car.position, car.lastValidY);
      const isFloating = Math.abs(car.position.y - roadY) > 8.0;

      if (isFloating) {
        car.floatTimer = (car.floatTimer || 0) + dt;
      } else {
        car.floatTimer = 0;
      }

      if (car.position.y < -20.0 || (isFloating && (car.floatTimer || 0) >= 2.0)) {
        car.floatTimer = 0;
        this.recoverCarToNearestCheckpoint(car);
        return;
      }
      // Skip legacy bounds and continue normal loop if not floating
      return;
    }

    const roadY = terrainManager.getRoadHeight(car.position, car.lastValidY);
    if (Number.isFinite(roadY)) car.lastValidY = roadY;

    const isFallingOffMap = car.position.y < -50.0 || car.position.y < roadY - 15.0;
    const isFloating = Math.abs(car.position.y - roadY) > 5.0 || isFallingOffMap;

    if (isFloating) {
      car.floatTimer = (car.floatTimer || 0) + dt;
    } else {
      car.floatTimer = 0;
    }

    if (isFloating && (car.floatTimer || 0) >= 2.0) {
      const lastRecTime = car.lastRecoveryTime || 0;
      if (now - lastRecTime >= 5000) {
        car.floatTimer = 0;
        this.recoverCarToNearestCheckpoint(car);
      } else {
        car.position.y = THREE.MathUtils.lerp(car.position.y, roadY, 5.0 * dt);
        car.velocity.y = 0;
      }
    }
  }

  private sampleWheelContacts(car: CarState) {
    const halfTrack = 0.95;
    const halfWheelBase = 1.22;
    const cosA = Math.cos(car.angle || 0);
    const sinA = Math.sin(car.angle || 0);
    const tireBottomY = (car.position?.y ?? 0) - WHEEL_RADIUS;
    const wheelDefs = [
      ["frontLeft", -halfTrack, halfWheelBase],
      ["frontRight", halfTrack, halfWheelBase],
      ["rearLeft", -halfTrack, -halfWheelBase],
      ["rearRight", halfTrack, -halfWheelBase],
    ];
    const contacts: any = {};
    let contactCount = 0;
    let roadSum = 0;
    let validRoadCount = 0;

    for (const [name, localX, localZ] of wheelDefs as any[]) {
      const wx = car.position.x + localX * cosA + localZ * sinA;
      const wz = car.position.z - localX * sinA + localZ * cosA;
      const probe = GamePhysicsService._vecC.set(wx, car.position.y, wz);
      const roadY = terrainManager.getRoadHeight(probe, car.lastValidY);
      const compression = roadY - tireBottomY;
      const touching = Number.isFinite(roadY) && compression > -0.12 && compression < 0.55;
      contacts[name] = {
        touching,
        roadY,
        compression,
      };
      if (touching) contactCount++;
      if (Number.isFinite(roadY)) {
        roadSum += roadY;
        validRoadCount++;
      }
    }

    return {
      contacts,
      contactCount,
      avgRoadY: validRoadCount > 0 ? roadSum / validRoadCount : car.lastValidY,
    };
  }

  private publishVehicleDebug(car: CarState, controls: ControlsState, isLocked: boolean, extra: any = {}) {
    if (car.id !== "player" || typeof window === "undefined") return;
    const wheel = extra.wheelContact || this.sampleWheelContacts(car);
    const linVel = car.velocity || { x: 0, y: 0, z: 0 };
    (window as any).vehiclePhysicsDebug = {
      speed: car.speed || 0,
      speedKmh: Math.abs(car.speed || 0) * 3.6,
      engineTorque: (car as any).engineTorque || 0,
      brakeForce: (car as any).brakeForce || 0,
      throttle: (car as any).throttle || 0,
      brake: (car as any).brake || 0,
      handbrake: !!(car as any).handbrakeActive,
      gear: car.gear || controls.gear || "D",
      wheelContact: wheel.contacts,
      wheelContactCount: wheel.contactCount,
      sleeping: !car.awake || !!isLocked,
      kinematic: false,
      linearVelocity: { x: linVel.x || 0, y: linVel.y || 0, z: linVel.z || 0 },
      angularVelocity: car.angularVelocity || 0,
      linearDamping: LINEAR_DAMPING,
      angularDamping: ANGULAR_DAMPING,
      friction: FRICTION,
      mass: car.mass || 1450,
      centerOfGravity: (car as any).centerOfGravity || { x: 0, y: 0.35, z: -0.1 },
      awake: !!car.awake,
      locked: !!isLocked,
      staticCollision: !!extra.staticCollision,
      onRoad: extra.onRoad ?? true,
      roadY: wheel.avgRoadY,
      recoveryCount: car.recoveryCount || 0,
      drivetrainBlocked: !!extra.drivetrainBlocked,
      drivetrainForceApplied: !!extra.drivetrainForceApplied,
      position: { ...car.position },
      lastRecoveryTime: car.lastRecoveryTime || 0,
      updatedAt: performance.now(),
    };
  }

  public updateCar(car: CarState, dt: number, controls: ControlsState, isLocked: boolean) {
    dt = Math.min(dt, 0.05);
    if (!Number.isFinite(dt) || dt <= 0) dt = 0.0166;

    this.checkAndHandleRecovery(car, dt);

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
      car.awake = true;
      (car as any).engineTorque = 0;
      (car as any).brakeForce = BRAKING;
      (car as any).handbrakeActive = false;
      this.publishVehicleDebug(car, controls, isLocked);
      return;
    }

    const isRacing2Map = this.trackHelper.mapType === "racing2";

    let currentGear = controls.gear || car.gear || "D";
    const rawForward = !!controls.forward;
    const rawBackward = !!controls.backward;

    // Player launch safety: once the countdown releases, a throttle press must
    // always put the drivetrain into Drive unless the car is already rolling
    // backward. This prevents stale Reverse/Park state from swallowing torque.
    if (!car.isAI && rawForward && !rawBackward && (currentGear === "P" || currentGear === "N" || (currentGear === "R" && car.speed >= -0.15))) {
      currentGear = "D";
      controls.gear = "D";
    }

    const throttleActive = rawForward && currentGear !== "P" && currentGear !== "N";
    const brakeActive = rawBackward && !rawForward;
    const handbrakeActive = !!controls.handbrake && !throttleActive;
    if (throttleActive && controls.handbrake) controls.handbrake = false;
    if (!car.isAI && throttleActive) {
      // Movement safety contract: throttle must always mean released brakes,
      // released handbrake, awake dynamic body, and Drive gear after countdown.
      // This prevents stale HUD/mobile brake/handbrake flags from swallowing
      // engine torque while logs still show throttle=1 and velocity=(0,0,0).
      currentGear = currentGear === "R" && car.speed < -0.25 ? "R" : "D";
      controls.gear = currentGear;
      controls.backward = false;
      controls.handbrake = false;
    }

    const contactBeforeDrive = this.sampleWheelContacts(car);
    if (isRacing2Map && contactBeforeDrive.contactCount === 0 && Number.isFinite(contactBeforeDrive.avgRoadY)) {
      const targetY = contactBeforeDrive.avgRoadY + WHEEL_RADIUS;
      if (Math.abs(car.position.y - targetY) < 2.0) {
        car.position.y = targetY;
        car.velocity.y = 0;
      }
    }

    // Stuck-car kick (3 seconds throttle with no movement)
    if (throttleActive && Math.abs(car.speed) < 0.1) {
      (car as any).stuckSpeedZeroTimer = ((car as any).stuckSpeedZeroTimer || 0) + dt;
      if ((car as any).stuckSpeedZeroTimer >= 3.0) {
        car.gear = "D";
        controls.gear = "D";
        car.speed = 12.0;
        car.velocity.x = Math.sin(car.angle) * 12.0;
        car.velocity.z = Math.cos(car.angle) * 12.0;
        (car as any).stuckSpeedZeroTimer = 0;
      }
    } else {
      (car as any).stuckSpeedZeroTimer = 0;
    }

    car.gear = currentGear;
    car.throttle = throttleActive ? 1.0 : 0.0;
    car.brake = brakeActive ? 1.0 : 0.0;
    car.awake = true;
    car.mass = THREE.MathUtils.clamp(car.mass || 1450, 800, 2500);
    car.engineRunning = true;
    (car as any).centerOfGravity = (car as any).centerOfGravity || { x: 0, y: 0.35, z: -0.1 };
    (car as any).handbrakeActive = handbrakeActive;

    const topSpeed = car.isNitroActive ? NITRO_BOOST_SPEED : MAX_SPEED;
    const accelRate = car.isNitroActive ? NITRO_BOOST_ACCEL : ACCELERATION;
    const speedRatio = Math.abs(car.speed) / topSpeed;
    const torqueCurve = Math.max(0.35, Math.pow(Math.max(0, 1.0 - speedRatio), 0.7));
    (car as any).engineTorque = throttleActive ? accelRate * torqueCurve * car.mass * 0.08 : 0;
    (car as any).brakeForce = brakeActive ? BRAKING * (1.0 + speedRatio * 0.5) : 0;

    // Transmission
    if (currentGear === "P") {
      car.speed = THREE.MathUtils.lerp(car.speed, 0, 15.0 * dt);
      if (Math.abs(car.speed) < 0.1) car.speed = 0;
    } else if (currentGear === "N") {
      if (car.speed > 0) car.speed = Math.max(0, car.speed - DECELERATION * 0.5 * dt);
      else if (car.speed < 0) car.speed = Math.min(0, car.speed + DECELERATION * 0.5 * dt);
    } else if (currentGear === "D") {
      if (throttleActive) {
        car.speed += accelRate * torqueCurve * dt;
        if (car.speed > topSpeed) car.speed = topSpeed;
        (car as any).brakeHoldTimer = 0;
      } else if (brakeActive) {
        // Brake reduces forward speed smoothly to 0 — never pushes car into
        // reverse. Reverse gear requires vehicle fully stopped + brake held
        // for ~0.4 s.
        if (car.speed > 0.1) {
          car.speed -= BRAKING * (1.0 + speedRatio * 0.5) * dt;
          if (car.speed < 0) car.speed = 0;
          (car as any).brakeHoldTimer = 0;
        } else {
          car.speed = 0;
          if (!car.isAI) {
            (car as any).brakeHoldTimer = ((car as any).brakeHoldTimer || 0) + dt;
            if ((car as any).brakeHoldTimer >= 0.4) {
              currentGear = "R";
              controls.gear = "R";
              car.gear = "R";
              (car as any).brakeHoldTimer = 0;
            }
          }
        }
      } else {
        car.speed = Math.max(0, car.speed - DECELERATION * dt);
        (car as any).brakeHoldTimer = 0;
      }
    } else if (currentGear === "R") {
      if (throttleActive) {
        // Accelerator in Reverse: if stopped or already drifting forward,
        // auto-shift back into Drive.
        if (car.speed >= -0.15) {
          currentGear = "D";
          controls.gear = "D";
          car.gear = "D";
          car.speed += accelRate * torqueCurve * dt;
          if (car.speed > topSpeed) car.speed = topSpeed;
        } else {
          car.speed -= ACCELERATION * 0.7 * Math.max(0.4, 1.0 - (Math.abs(car.speed) / REVERSE_MAX_SPEED) * 0.45) * dt;
          if (car.speed < -REVERSE_MAX_SPEED) car.speed = -REVERSE_MAX_SPEED;
        }
        (car as any).brakeHoldTimer = 0;
      } else if (brakeActive) {
        // Brake in Reverse slows backward motion to 0. Does not auto-shift.
        if (car.speed < -0.1) {
          car.speed += BRAKING * (1.0 + (Math.abs(car.speed) / REVERSE_MAX_SPEED) * 0.45) * dt;
          if (car.speed > 0) car.speed = 0;
        } else {
          car.speed = 0;
        }
        (car as any).brakeHoldTimer = 0;
      } else {
        car.speed = Math.min(0, car.speed + DECELERATION * dt);
        (car as any).brakeHoldTimer = 0;
      }
    }

    if (handbrakeActive) {
      if (car.speed > 0) car.speed = Math.max(0, car.speed - BRAKING * 0.85 * dt);
      else if (car.speed < 0) car.speed = Math.min(0, car.speed + BRAKING * 0.85 * dt);
    }

    // Aerodynamic drag
    const dragForce = (0.0016 * car.speed * car.speed + 0.1) * dt;
    if (car.speed > 0) car.speed = Math.max(0, car.speed - dragForce);
    else if (car.speed < 0) car.speed = Math.min(0, car.speed + dragForce);

    // FIX 1: Kill subnormal speed
    if (Math.abs(car.speed) < FLOAT_ZERO) car.speed = 0;

    // Nitro
    if (!car.isNitroActive) {
      car.nitroCharged = Math.min(100, car.nitroCharged + (car.isDrifting && Math.abs(car.speed) > 22 ? 28 : 5) * dt);
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

    // FIX 3: steerValue — clamp raw input and reset to zero properly
    const rawSteerInput =
      controls.steerValue !== undefined ? controls.steerValue : controls.left ? 1 : controls.right ? -1 : 0;
    const clampedSteer = THREE.MathUtils.clamp(rawSteerInput, -1, 1);
    car.steerValue = THREE.MathUtils.lerp(
      car.steerValue || 0,
      clampedSteer,
      (Math.abs(clampedSteer) > 0.01 ? 12.0 : 15.0) * dt,
    );
    // FIX 3: Kill subnormal steerValue — this was causing ghost steering forever
    if (Math.abs(car.steerValue) < FLOAT_ZERO) car.steerValue = 0;
    if (!Number.isFinite(car.steerValue)) car.steerValue = 0;

    car.steering = car.steerValue;

    const speedKmh = Math.abs(car.speed) * 3.6;
    const steerSpeedScale = 1.25 - Math.min(0.98, (speedKmh / 280) * 0.98);
    car.angularVelocity = STEER_SPEED * steerSpeedScale * (car.isDrifting ? 1.62 : 1.12) * car.steerValue;
    const movementGripFactor = Math.min(1.0, Math.abs(car.speed) / 3.0);
    car.angle += car.angularVelocity * dt * (car.speed < 0 ? -movementGripFactor : movementGripFactor);
    if (!Number.isFinite(car.angle)) car.angle = 0;

    // Drift
    const prevSpeedVal = (car as any)._prevSpeed ?? car.speed;
    const longitudinalAccel = (car.speed - prevSpeedVal) / Math.max(0.001, dt);
    (car as any)._prevSpeed = car.speed;

    const isSteeringHard = Math.abs(car.steerValue) > 0.25;
    const isBraking = brakeActive && car.speed > 12.0;
    const isSharpTurn = Math.abs(car.steerValue) > 0.45;
    const minDriftThreshold = car.id.startsWith("traffic") ? 25 : 18;
    const wantsDrifting =
      handbrakeActive || (isSteeringHard && isBraking) || (isSharpTurn && Math.abs(car.speed) > minDriftThreshold);
    car.isDrifting = wantsDrifting && Math.abs(car.speed) > minDriftThreshold && currentGear !== "P";
    car.driftFactor = THREE.MathUtils.lerp(car.driftFactor || 0, car.isDrifting ? 1 : 0, 7.5 * dt);

    const gripLoadFactor = longitudinalAccel * 0.015 < -0.15 ? 0.88 : 1.0;
    const currentGrip = car.isDrifting ? DRIFT_GRIP : NORMAL_GRIP;
    const gripFactor = handbrakeActive ? currentGrip * 0.82 : currentGrip * gripLoadFactor;
    const activeGrip = THREE.MathUtils.lerp(NORMAL_GRIP, gripFactor, car.driftFactor);

    const fwdX = Math.sin(car.angle);
    const fwdZ = Math.cos(car.angle);
    const velocityBlend = isRacing2Map ? (car.isDrifting ? 0.08 : 0.18) : 1 - activeGrip;
    car.velocity.x = car.velocity.x * (1 - velocityBlend) + fwdX * car.speed * velocityBlend;
    car.velocity.z = car.velocity.z * (1 - velocityBlend) + fwdZ * car.speed * velocityBlend;
    car.velocity.x *= FRICTION;
    car.velocity.z *= FRICTION;

    let drivetrainBlocked = false;
    let drivetrainForceApplied = Math.abs(car.velocity.x) + Math.abs(car.velocity.z) > 0.0001;
    const horizontalVelSq = car.velocity.x * car.velocity.x + car.velocity.z * car.velocity.z;
    if (
      throttleActive &&
      !brakeActive &&
      !handbrakeActive &&
      Math.abs(car.speed) > 0.2 &&
      horizontalVelSq < 0.0004
    ) {
      // Last-resort drivetrain continuity guard: if speed/torque were produced
      // but horizontal velocity has been clamped to zero, re-apply the driven
      // wheel impulse in the car's forward axis instead of letting the vehicle
      // sit awake with throttle=1 and velocity=(0,0,0).
      car.velocity.x = fwdX * car.speed;
      car.velocity.z = fwdZ * car.speed;
      drivetrainBlocked = true;
      drivetrainForceApplied = true;
    }

    // FIX 1: Kill subnormal velocity — THE KEY FIX for 10m stop
    if (Math.abs(car.velocity.x) < FLOAT_ZERO) car.velocity.x = 0;
    if (Math.abs(car.velocity.z) < FLOAT_ZERO) car.velocity.z = 0;

    if (car.isDrifting) {
      const velHeading = Math.atan2(car.velocity.x, car.velocity.z);
      let slipAngle = velHeading - car.angle;
      while (slipAngle < -Math.PI) slipAngle += Math.PI * 2;
      while (slipAngle > Math.PI) slipAngle -= Math.PI * 2;
      car.angle += slipAngle * (car.isAI ? 0.45 : 0.85) * dt;
    }

    car.position.x += car.velocity.x * dt;
    car.position.z += car.velocity.z * dt;

    // Road geometry
    const posVec = GamePhysicsService._vecA.set(car.position.x, car.position.y, car.position.z);
    const checkTrackInfo = this.trackHelper.getNearestTrackInfo(posVec, car.id);
    const sideSign = Math.sign(checkTrackInfo.sideOffset);
    const absoluteLimit = checkTrackInfo.width / 2 - 0.45;

    let offRoadFactor = terrainManager.getOffRoadFactor(posVec);
    if (isRacing2Map) {
      const roadSurfaceY = terrainManager.queryRoadHeight(posVec);
      if (roadSurfaceY !== null && Math.abs(car.position.y - WHEEL_RADIUS - roadSurfaceY) < 0.85) {
        offRoadFactor = 0;
      }
    }
    if (offRoadFactor > 0.0) {
      car.speed *= 1.0 - 0.08 * offRoadFactor * dt * 60;
      car.angularVelocity *= 1.0 - offRoadFactor * 0.48;
      if (Math.random() < 0.45 && Math.abs(car.speed) > 10) {
        this.spawnParticle(
          car.position.x,
          car.position.y + 0.1,
          car.position.z,
          Math.random() * 4 - 2,
          1 + Math.random() * 3,
          Math.random() * 4 - 2,
          "#d2b48c",
          0.6 + Math.random() * 0.6,
          0.8 + Math.random() * 0.8,
        );
      }
      const roadHeading = Math.atan2(checkTrackInfo.tangent.x, checkTrackInfo.tangent.z);
      let headingDiff = roadHeading + 0.42 * -sideSign - car.angle;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      car.angle += headingDiff * (car.isAI ? 5.5 : 3.2) * offRoadFactor * dt;
      const inwardImpulse = (car.isAI ? 18.0 : 12.0) * offRoadFactor * dt;
      car.velocity.x += -checkTrackInfo.normal.x * sideSign * inwardImpulse;
      car.velocity.z += -checkTrackInfo.normal.z * sideSign * inwardImpulse;
    }

    if (!isRacing2Map && Math.abs(checkTrackInfo.sideOffset) > absoluteLimit) {
      car.position.x = checkTrackInfo.nearestPoint.x + checkTrackInfo.normal.x * absoluteLimit * sideSign;
      car.position.z = checkTrackInfo.nearestPoint.z + checkTrackInfo.normal.z * absoluteLimit * sideSign;
      const velVec = MemoryPool.getVector().set(car.velocity.x, 0, car.velocity.z);
      const bNormal = MemoryPool.getVector()
        .set(checkTrackInfo.normal.x, 0, checkTrackInfo.normal.z)
        .multiplyScalar(sideSign);
      const spd = velVec.dot(bNormal);
      if (spd > 0) {
        velVec.addScaledVector(bNormal, -1.25 * spd);
        car.velocity.x = velVec.x;
        car.velocity.z = velVec.z;
        car.speed *= 0.82;
      }
    }

    if (!isRacing2Map && Math.abs(checkTrackInfo.sideOffset) > checkTrackInfo.width / 2 + 1.6) {
      this.recoverCarToNearestCheckpoint(car);
    }

    // FIX 4: Racing2 — NO corridorHalf invisible wall (was stopping cars at 10m)
    // Static colliders only
    let staticCollision = false;
    let onDrivableRoad = true;
    const roadSurfaceUnderCar = isRacing2Map ? terrainManager.queryRoadHeight(posVec) : null;
    const hasRoadUnderCar =
      roadSurfaceUnderCar !== null &&
      Number.isFinite(roadSurfaceUnderCar) &&
      Math.abs(car.position.y - WHEEL_RADIUS - roadSurfaceUnderCar) < 1.25;
    if (isRacing2Map) {
      const safeHalfWidth = Math.max(2.5, checkTrackInfo.width / 2 - 1.2);
      onDrivableRoad =
        hasRoadUnderCar ||
        (Math.abs(checkTrackInfo.sideOffset) < safeHalfWidth && checkTrackInfo.distanceToTrack < safeHalfWidth);
      // Prevent broad AABB proxy meshes (pit/gantry/building boxes) from acting
      // like invisible walls on the racing line. Static collision is only used
      // after the car has actually left the drivable road corridor.
      staticCollision = onDrivableRoad ? false : terrainManager.resolveStaticCollisions(car, 1.75);
    } else {
      CarCollisionSystem.resolveWallCollision(car, checkTrackInfo, this.spawnParticle.bind(this), dt);
    }

    // Vertical / suspension
    const pos3 = GamePhysicsService._vecA.set(car.position.x, car.position.y, car.position.z);
    const trackInfo = this.trackHelper.getNearestTrackInfo(pos3, car.id);

    let targetRoadY: number;
    if (isRacing2Map) {
      const roadSurfaceY = terrainManager.getRoadHeight(pos3, car.lastValidY);
      if (Number.isFinite(roadSurfaceY)) car.lastValidY = roadSurfaceY;
      targetRoadY = Number.isFinite(roadSurfaceY)
        ? roadSurfaceY + WHEEL_RADIUS
        : (Number.isFinite(trackInfo.nearestPoint.y) ? trackInfo.nearestPoint.y + 0.23 : 2.71);
    } else {
      targetRoadY = terrainManager.getRoadHeight(pos3, car.lastValidY);
      if (Number.isFinite(targetRoadY)) car.lastValidY = targetRoadY;
    }

    car.position.y = THREE.MathUtils.lerp(car.position.y, targetRoadY, (car.isAI ? 35.0 : 25.0) * dt);
    const downforceY = -0.022 * car.speed * car.speed;

    if (car.position.y <= targetRoadY + 0.15) {
      car.velocity.y += ((targetRoadY - car.position.y) * 250.0 - 20.0 * car.velocity.y + downforceY) * dt;
    } else {
      car.velocity.y += (-28.0 + downforceY * 0.5) * dt;
    }

    car.velocity.y = THREE.MathUtils.clamp(car.velocity.y, -25.0, 25.0);
    car.position.y += car.velocity.y * dt;
    if (car.position.y < targetRoadY) {
      car.position.y = targetRoadY;
      car.velocity.y = Math.max(0, car.velocity.y);
    }

    const currentMaxSpeedCap = car.isNitroActive ? NITRO_BOOST_SPEED : MAX_SPEED;
    car.speed = THREE.MathUtils.clamp(car.speed, -REVERSE_MAX_SPEED, currentMaxSpeedCap);

    const speedMag = Math.sqrt(car.velocity.x * car.velocity.x + car.velocity.z * car.velocity.z);
    if (speedMag > currentMaxSpeedCap) {
      car.velocity.x *= currentMaxSpeedCap / speedMag;
      car.velocity.z *= currentMaxSpeedCap / speedMag;
    }

    const finalHorizontalVelSq = car.velocity.x * car.velocity.x + car.velocity.z * car.velocity.z;
    if (throttleActive && !brakeActive && !handbrakeActive && Math.abs(car.speed) > 0.2 && finalHorizontalVelSq < 0.0004) {
      car.velocity.x = Math.sin(car.angle) * car.speed;
      car.velocity.z = Math.cos(car.angle) * car.speed;
      car.position.x += car.velocity.x * dt;
      car.position.z += car.velocity.z * dt;
      drivetrainBlocked = true;
      drivetrainForceApplied = true;
    }

    car.angularVelocity = THREE.MathUtils.clamp(car.angularVelocity, -STEER_SPEED * 1.5, STEER_SPEED * 1.5);

    this.publishVehicleDebug(car, controls, false, {
      staticCollision,
      onRoad: onDrivableRoad,
      wheelContact: this.sampleWheelContacts(car),
      drivetrainBlocked,
      drivetrainForceApplied,
    });

    this.updateRaceChecking(car, trackInfo.progress, pos3);
  }

  private updateRaceChecking(car: CarState, progress: number, pos3: THREE.Vector3) {
    let prevProgress = this.carProgressHistory.get(car.id);
    if (prevProgress === undefined) prevProgress = progress;
    this.carProgressHistory.set(car.id, progress);

    const chpts = this.trackHelper.checkpoints;
    const numCheckpoints = chpts.length;

    if (this.trackHelper.mapType === "racing2") {
      // Initialize if undefined/invalid
      if (car.currentCheckpointIndex === undefined || car.currentCheckpointIndex < 0 || car.currentCheckpointIndex >= numCheckpoints) {
        car.currentCheckpointIndex = 0;
      }
      if (car.currentLap === undefined || car.currentLap < 1) {
        car.currentLap = 1;
      }

      // Look ahead up to 3 checkpoints to allow minor skips/misses and prevent driving style from locking lap tracking
      let advancedTo = -1;
      for (let lookAhead = 1; lookAhead <= 3; lookAhead++) {
        const checkIndex = (car.currentCheckpointIndex + lookAhead) % numCheckpoints;
        const nextChpt = chpts[checkIndex];
        if (!nextChpt) continue;

        const cpPos = GamePhysicsService._vecB.set(nextChpt.position.x, nextChpt.position.y, nextChpt.position.z);
        const dist = pos3.distanceTo(cpPos);

        // Generous detection threshold: half of road width + margin, minimum 20m.
        // This ensures driving on the far shoulder or grass still registers the checkpoint.
        const chptWidth = nextChpt.width || 18.0;
        const checkpointThreshold = Math.max(20.0, chptWidth * 1.25);

        if (dist < checkpointThreshold) {
          advancedTo = checkIndex;
          break; // Stop at the furthest valid checkpoint in sequence we find close by
        }
      }

      if (advancedTo !== -1) {
        // If we hit the final checkpoint, wrap immediately to 0 and increment lap
        if (advancedTo === numCheckpoints - 1) {
          if (!car.isFinished) {
            if (car.currentLap >= 3) {
              car.isFinished = true;
              const clock = (window as any).raceElapsedTime;
              car.finishTime = typeof clock === "number" ? clock : performance.now() / 1000;
              car.currentCheckpointIndex = advancedTo;
              if (car.id === "player") {
                console.log("Lap completed", car.currentLap);
                console.log("Race completed");
              }
            } else {
              car.currentLap += 1;
              car.currentCheckpointIndex = 0;
              if (car.id === "player") {
                console.log("Lap completed", car.currentLap);
              }
            }
          } else {
            car.currentCheckpointIndex = advancedTo;
          }
        } else {
          // Normal advance. If new index is less than current index (e.g. 0 or 1 after 54), it is a wrap-around
          const isWrapAround = advancedTo < car.currentCheckpointIndex;
          car.currentCheckpointIndex = advancedTo;
          if (isWrapAround) {
            if (!car.isFinished) {
              if (car.currentLap >= 3) {
                car.isFinished = true;
                const clock = (window as any).raceElapsedTime;
                car.finishTime = typeof clock === "number" ? clock : performance.now() / 1000;
                if (car.id === "player") {
                  console.log("Lap completed", car.currentLap);
                  console.log("Race completed");
                }
              } else {
                car.currentLap += 1;
                if (car.id === "player") {
                  console.log("Lap completed", car.currentLap);
                }
              }
            }
          }
        }

        // Dispatch checkpointPassed custom event so HUD/Broadcaster/Sound are in sync
        if (car.id === "player" || !car.isAI) {
          window.dispatchEvent(new CustomEvent("race:checkpointPassed", { 
            detail: { checkpointIndex: advancedTo, currentLap: car.currentLap } 
          }));
        }
      }

      // Calculate distance to the next targeted checkpoint
      const nextTargetIndex = (car.currentCheckpointIndex + 1) % numCheckpoints;
      const nextChpt = chpts[nextTargetIndex];
      if (nextChpt?.position) {
        const cp = GamePhysicsService._vecB.set(nextChpt.position.x, nextChpt.position.y, nextChpt.position.z);
        car.distanceToNextCheckpoint = pos3.distanceTo(cp);
      } else {
        car.distanceToNextCheckpoint = 999;
      }

      const trackLength = this.trackHelper.length || 4150.0;
      const displayProgress = numCheckpoints > 1 ? car.currentCheckpointIndex / (numCheckpoints - 1) : progress;
      car.totalDistanceTraveled = (car.currentLap - 1) * trackLength + displayProgress * trackLength;

    } else {
      car.currentCheckpointIndex = Math.min(numCheckpoints - 1, Math.floor(progress * numCheckpoints));

      if (car.currentCheckpointIndex > 10 && car.currentCheckpointIndex < 20) {
        this.carHasPassedMidpoint.set(car.id, true);
      }

      if (prevProgress > 0.82 && progress < 0.18) {
        if (this.carHasPassedMidpoint.get(car.id)) {
          if (!car.isFinished) {
            if (car.currentLap === 3) {
              car.isFinished = true;
              const clock = (window as any).raceElapsedTime;
              car.finishTime = typeof clock === "number" ? clock : performance.now() / 1000;
              if (car.id === "player") {
                console.log("Lap completed", car.currentLap);
                console.log("Race completed");
              }
            } else {
              car.currentLap += 1;
              this.carHasPassedMidpoint.set(car.id, false);
              if (car.id === "player") {
                console.log("Lap completed", car.currentLap);
              }
            }
          }
        }
      }

      const nextChpt = chpts[(car.currentCheckpointIndex + 1) % numCheckpoints];
      if (nextChpt?.position) {
        const cp = GamePhysicsService._vecB.set(nextChpt.position.x, nextChpt.position.y, nextChpt.position.z);
        car.distanceToNextCheckpoint = pos3.distanceTo(cp);
      } else {
        car.distanceToNextCheckpoint = 999;
      }

      const trackLength = this.trackHelper.length || 4150.0;
      let displayProgress = progress;
      if (car.currentLap === 1 && progress > 0.82) displayProgress = progress - 1.0;
      car.totalDistanceTraveled = (car.currentLap - 1) * trackLength + displayProgress * trackLength;
    }
  }

  public generateExhaustParticles(car: CarState, dt: number) {
    if (car.speed === 0) return;
    const angleBack = car.angle + Math.PI;
    const bx = Math.sin(angleBack) * 2.2,
      bz = Math.cos(angleBack) * 2.2;
    const nx = -bz,
      nz = bx,
      nLen = Math.sqrt(nx * nx + nz * nz);
    const ux = nLen > 0 ? nx / nLen : 0,
      uz = nLen > 0 ? nz / nLen : 0;

    if (car.isNitroActive) {
      for (let i = 0; i < 2; i++) {
        this.spawnParticle(
          car.position.x + bx + (i === 0 ? ux : -ux) * 0.72,
          car.position.y + 0.12,
          car.position.z + bz + (i === 0 ? uz : -uz) * 0.72,
          -Math.sin(car.angle) * 16 + (Math.random() * 2.5 - 1.25),
          0.2 + Math.random() * 1.5,
          -Math.cos(car.angle) * 16 + (Math.random() * 2.5 - 1.25),
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
        const side = Math.random() > 0.5 ? 0.95 : -0.95;
        this.spawnParticle(
          car.position.x + ux * side,
          car.position.y + 0.1,
          car.position.z + uz * side,
          Math.random() * 4.2 - 2.1,
          1.0 + Math.random() * 2.5,
          Math.random() * 4.2 - 2.1,
          "#e2e6eb",
          0.72 + Math.random() * 0.68,
          0.75 + Math.random() * 0.65,
          false,
          false,
        );
      }
    }
  }

  public updateParticles(dt: number) {
    particleSystem.update(dt);
  }

  public resolveCarCollisions(cars: CarState[]) {
    CarCollisionSystem.resolveVehicleCollisions(cars, this.spawnParticle.bind(this));
  }

  public evaluatePositionsRanks(cars: CarState[]) {
    this.resolveCarCollisions(cars);
    const sorted = [...cars].sort((a, b) => {
      if (a.isFinished && !b.isFinished) return -1;
      if (!a.isFinished && b.isFinished) return 1;
      return b.totalDistanceTraveled - a.totalDistanceTraveled;
    });
    for (let i = 0; i < sorted.length; i++) {
      const idx = cars.findIndex((c) => c.id === sorted[i].id);
      if (idx !== -1) cars[idx].racePosition = i + 1;
    }
  }
}

export const GamePhysics = GamePhysicsService;
