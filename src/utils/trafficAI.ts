import * as THREE from "three";
import { CarState, ControlsState } from "../types";
import { TrackGeometryHelper } from "./track";
import { MemoryPool } from "./memoryPool";

export class TrafficAIService {
  private trackHelper: TrackGeometryHelper;

  // Custom configuration constants for realistic traffic flow
  private static readonly MAX_TRAFFIC_COUNT = 32; // optimal dense commuter traffic (feels like Rush Hour!)
  private static readonly ROAD_WIDTH_LIMIT_FACTOR = 0.42; // percentage of road width traffic uses
  private static readonly REFL_HAZARD_DIST = 25.0; // ahead detection zone (meters)

  constructor(trackHelper: TrackGeometryHelper) {
    this.trackHelper = trackHelper;
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
      // Space traffic uniformly along the track progress [u: 0.0 to 1.0]
      // Start spacing at 12% to leave the start-finish line empty for racers
      const progress = 0.12 + t * spacing * 0.85;

      const pt = this.trackHelper.curve ? this.trackHelper.curve.getPointAt(progress) : new THREE.Vector3();
      const tangent = this.trackHelper.curve
        ? this.trackHelper.curve.getTangentAt(progress).normalize()
        : new THREE.Vector3(0, 0, 1);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      // Alternate lanes: Left lane, middle-left lane, middle-right lane, right lane
      const laneSelector = t % 4;
      let laneOffset = 0;
      if (laneSelector === 0) laneOffset = -4.5;
      else if (laneSelector === 1) laneOffset = -1.5;
      else if (laneSelector === 2) laneOffset = 1.5;
      else if (laneSelector === 3) laneOffset = 4.5;

      const spawnPos = pt.clone().addScaledVector(normal, laneOffset);
      const angle = Math.atan2(tangent.x, tangent.z);

      const trafficPos3 = new THREE.Vector3(spawnPos.x, 0, spawnPos.z);
      const trackInfo = this.trackHelper.getNearestTrackInfo(trafficPos3);
      const roadHeight = trackInfo ? trackInfo.nearestPoint.y : 0;
      const spawnY = roadHeight + 0.05;

      const speedRatio = 0.22 + (t % 3) * 0.06; // Cruise speeds between 60 to 90 km/h (~17 - 25 m/s)

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
        racePosition: 99, // Traffic stays detached from leaderboard ranks
        totalDistanceTraveled: progress * trackLength,
        isFinished: false,
        lastActiveTime: Date.now(),
        nitroCharged: 0,
        isNitroActive: false,
        aiTargetNode: Math.floor(progress * this.trackHelper.cachedPoints.length),
        aiSpeedFactor: speedRatio,
        aiAggression: 0.05, // Commuters are passive and highly defensive
        stuckTimer: 0,
      });
    }

    return trafficCars;
  }

  /**
   * Evaluates the pilot commands for a single traffic vehicle.
   * Tracks curves smoothly and decelerates or veers away to avoid front-end collisions.
   */
  public updateTrafficControl(car: CarState, dt: number, otherCars: CarState[]): ControlsState {
    const pos3 = MemoryPool.getVector().set(car.position.x, car.position.y, car.position.z);
    const trackInfo = this.trackHelper.getNearestTrackInfo(pos3, car.id);

    // 1. Dynamic Lookahead point calculated relative to speed
    const lookaheadProgress = 0.012 + Math.min(0.035, (car.speed / 78) * 0.03);
    const targetU = (trackInfo.progress + lookaheadProgress) % 1.0;

    const targetSplinePt = this.trackHelper.curve.getPointAt(targetU);
    const tangentAhead = this.trackHelper.curve.getTangentAt(targetU).normalize();
    const normalAhead = MemoryPool.getVector().set(-tangentAhead.z, 0, tangentAhead.x).normalize();

    // 2. Stay primarily in designated lane
    const tIndex = parseInt(car.id.replace("traffic_", "")) || 0;
    const laneSelector = tIndex % 4;
    let laneOffset = 0;
    if (laneSelector === 0) laneOffset = -4.5;
    else if (laneSelector === 1) laneOffset = -1.5;
    else if (laneSelector === 2) laneOffset = 1.5;
    else if (laneSelector === 3) laneOffset = 4.5;

    // 3. Collision Avoidance with vehicles directly in front
    let targetEvasionOffset = 0;
    let brakeRequired = false;

    otherCars.forEach((other) => {
      if (other.id === car.id) return;

      const dx = other.position.x - car.position.x;
      const dz = other.position.z - car.position.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < TrafficAIService.REFL_HAZARD_DIST * TrafficAIService.REFL_HAZARD_DIST) {
        // Express relative offsets in coordinates system local to traffic car
        const cosAngle = Math.cos(-car.angle);
        const sinAngle = Math.sin(-car.angle);
        const localX = dx * cosAngle - dz * sinAngle;
        const localZ = dx * sinAngle + dz * cosAngle;

        // Threat check: directly in front (localZ > 0) and overlapping width (localX)
        if (localZ > 0 && localZ < 15.0) {
          if (Math.abs(localX) < 3.0) {
            // High hazard: apply brakes to prevent pile-up
            brakeRequired = true;

            // Gently nudge to the side if there is still space on the road
            const nudgeDir = localX >= 0 ? -1.0 : 1.0;
            targetEvasionOffset += nudgeDir * 1.5;
          }
        }
      }
    });

    // 4. Construct final spatial target position
    const targetPoint = targetSplinePt.clone();
    const finalOffset = THREE.MathUtils.clamp(
      laneOffset + targetEvasionOffset,
      -trackInfo.width * TrafficAIService.ROAD_WIDTH_LIMIT_FACTOR,
      trackInfo.width * TrafficAIService.ROAD_WIDTH_LIMIT_FACTOR,
    );
    targetPoint.addScaledVector(normalAhead, finalOffset);

    // Calculate heading angle to targeted point
    const dirX = targetPoint.x - car.position.x;
    const dirZ = targetPoint.z - car.position.z;
    const targetAngle = Math.atan2(dirX, dirZ);

    let angleDiff = targetAngle - car.angle;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    const steerDeadzone = 0.03;
    const cruiseMaxSpeed = 22.0 + (tIndex % 3) * 3.5; // Civilian speeds [70 to 110 km/h]

    // Slow down on sharp hairpins
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
}
export default TrafficAIService;
