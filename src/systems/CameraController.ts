import * as THREE from "three";
import { GamePhysicsState } from "../types";

/**
 * Chase Camera system with TWO modes:
 *   1. CHASE      (default) — original smooth follow chase camera.
 *   2. HIGH_CHASE          — elevated, downward-angled "drone" chase camera.
 *
 * Switching is driven externally by dispatching:
 *     window.dispatchEvent(new CustomEvent("race:setCameraMode", { detail: "CHASE" | "HIGH_CHASE" }))
 * The selected mode is persisted in localStorage under "race:cameraMode".
 *
 * Public API kept backwards-compatible:
 *   new CameraController(camera, baseFov?, scene?)
 *   update(player, elapsedSec, controls, _ignoredModeStr?)
 *   dispose()
 */

const EMERGENCY_POSITION = new THREE.Vector3(0, 5, 10);
const EMERGENCY_TARGET = new THREE.Vector3(0, 0, 0);

// ---- Mode 1: Chase ----
const FOV_LOW = 65;
const FOV_HIGH = 85;
const FOV_NITRO = 90;
const SPEED_FOR_MAX_FOV = 55; // m/s mapped to 1.0
const CHASE_DISTANCE = 6.0;
const CHASE_HEIGHT = 2.1;
const LOOK_AHEAD = 8.0;
const LOOK_HEIGHT = 1.0;
const MIN_GROUND_CLEARANCE = 0.5;
const MIN_CAR_DISTANCE = 2.0;

// ---- Mode 2: High Chase (elevated, ~30-40° downward) ----
const HC_DISTANCE = 9.0;       // 8–10m behind
const HC_HEIGHT = 5.0;         // 4–5m above
const HC_LOOK_HEIGHT = 0.3;    // look at near-ground point on car → ~30° downward tilt
const HC_FOV_LOW = 68;
const HC_FOV_HIGH = 82;
const HC_FOV_NITRO = 88;
const HC_MIN_GROUND_CLEARANCE = 1.5;
const HC_MIN_CAR_DISTANCE = 3.0;
const HC_STEER_TILT = 0.06;    // radians of camera roll at full steer

// ---- Mode 3: Cinematic Orbit ----
const ORBIT_RADIUS = 7.0;          // 6–8 m
const ORBIT_HEIGHT = 2.5;          // 2–3 m
const ORBIT_BASE_SPEED = 0.35;     // rad/s base 360° rotation (~18 s/rev)
const ORBIT_SPEED_BOOST = 0.45;    // extra rad/s added at full vehicle speed
const ORBIT_FOV_LOW = 60;
const ORBIT_FOV_HIGH = 72;
const ORBIT_MIN_GROUND_CLEARANCE = 0.8;
const ORBIT_LOOK_HEIGHT = 0.8;

// ---- Mode 4: Cockpit / Driver View ----
// Camera sits at the driver's eye level, centered behind the wheel. Values
// are car-relative offsets in meters (forward is car forward, right is car right).
const COCKPIT_OFFSET_FORWARD = 0.05;  // just ahead of car centre, near the wheel
const COCKPIT_OFFSET_RIGHT = -0.32;   // driver side (left-hand drive)
const COCKPIT_OFFSET_UP = 1.05;       // seated eye height above car origin
const COCKPIT_LOOK_AHEAD = 14;
const COCKPIT_LOOK_UP = 1.05;
const COCKPIT_DEFAULT_FOV = 75;
const COCKPIT_FOV_MIN = 65;
const COCKPIT_FOV_MAX = 90;
const COCKPIT_FOV_LS_KEY = "race:cockpitFov";



const LS_KEY = "race:cameraMode";

type Mode = "CHASE" | "HIGH_CHASE" | "ORBIT" | "COCKPIT";

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function isValidVec3Like(v: any): boolean {
  return !!v && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
}

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private baseFov = FOV_LOW;

  private smoothedPos = new THREE.Vector3();
  private smoothedLook = new THREE.Vector3();
  private initialised = false;

  private shake = 0;
  private prevSpeed = 0;

  // ---- mode state ----
  private mode: Mode = "CHASE";
  private smoothedRoll = 0; // for HIGH_CHASE tilt
  private orbitAngle = 0;          // current orbit yaw (radians)
  private orbitCollisionPause = 0; // seconds remaining to pause orbit after impact
  private onSetMode = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (
      detail === "CHASE" ||
      detail === "HIGH_CHASE" ||
      detail === "ORBIT" ||
      detail === "COCKPIT"
    )
      this.setMode(detail);
    else if (detail === "HOOD") this.setMode("COCKPIT"); // legacy migration
  };
  private onResetCamera = () => {
    // Force camera to re-snap on next update so it never lingers under the map or in the air.
    this.initialised = false;
    this.smoothedPos.set(0, 0, 0);
    this.smoothedLook.set(0, 0, 0);
  };

  // Cockpit / Driver View state.
  private cockpitFov = COCKPIT_DEFAULT_FOV;
  private smoothedPitch = 0;      // radians (nose-up on brake, nose-down on accel — subtle)
  private smoothedBodyRoll = 0;   // radians (steering lean)
  private smoothedHeadOffset = new THREE.Vector3(); // small G-force head displacement
  private onSetCockpitFov = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    const n = typeof detail === "number" ? detail : parseFloat(detail);
    if (!Number.isFinite(n)) return;
    this.cockpitFov = Math.min(COCKPIT_FOV_MAX, Math.max(COCKPIT_FOV_MIN, n));
    try {
      window.localStorage?.setItem(COCKPIT_FOV_LS_KEY, String(this.cockpitFov));
    } catch {
      /* ignore */
    }
  };

  constructor(camera: THREE.PerspectiveCamera, baseFov?: number, _scene?: unknown) {
    this.camera = camera;
    if (isFiniteNumber(baseFov) && baseFov > 10 && baseFov < 170) this.baseFov = baseFov;
    this.camera.fov = FOV_LOW;
    if (!isFiniteNumber(this.camera.near) || this.camera.near <= 0) this.camera.near = 0.1;
    if (!isFiniteNumber(this.camera.far) || this.camera.far <= this.camera.near) this.camera.far = 4000;
    this.camera.updateProjectionMatrix();

    // Restore persisted mode.
    try {
      if (typeof window !== "undefined") {
        const saved = window.localStorage?.getItem(LS_KEY);
        if (
          saved === "CHASE" ||
          saved === "HIGH_CHASE" ||
          saved === "ORBIT" ||
          saved === "COCKPIT"
        )
          this.mode = saved;
        else if (saved === "HOOD") {
          // Legacy Hood/Bumper view → promote to the new Driver View.
          this.mode = "COCKPIT";
          try { window.localStorage.setItem(LS_KEY, "COCKPIT"); } catch { /* ignore */ }
        }
        window.addEventListener("race:setCameraMode", this.onSetMode as EventListener);
        window.addEventListener("reset-camera", this.onResetCamera as EventListener);
        window.addEventListener("race:setCockpitFov", this.onSetCockpitFov as EventListener);
      }
    } catch {
      /* ignore */
    }
    // Load saved cockpit FOV preference.
    try {
      if (typeof window !== "undefined") {
        const raw = window.localStorage?.getItem(COCKPIT_FOV_LS_KEY);
        const n = raw != null ? parseFloat(raw) : NaN;
        if (isFiniteNumber(n)) {
          this.cockpitFov = Math.min(COCKPIT_FOV_MAX, Math.max(COCKPIT_FOV_MIN, n));
        }
      }
    } catch {
      /* ignore */
    }
  }

  public dispose() {
    try {
      if (typeof window !== "undefined") {
        window.removeEventListener("race:setCameraMode", this.onSetMode as EventListener);
        window.removeEventListener("reset-camera", this.onResetCamera as EventListener);
        window.removeEventListener("race:setCockpitFov", this.onSetCockpitFov as EventListener);
      }
    } catch {
      /* ignore */
    }
  }

  /** Get/set the driver-view FOV (65–90). Persisted to localStorage. */
  public getCockpitFov(): number { return this.cockpitFov; }
  public setCockpitFov(fov: number) {
    if (!Number.isFinite(fov)) return;
    this.cockpitFov = Math.min(COCKPIT_FOV_MAX, Math.max(COCKPIT_FOV_MIN, fov));
    try { window.localStorage?.setItem(COCKPIT_FOV_LS_KEY, String(this.cockpitFov)); } catch { /* ignore */ }
  }

  public setMode(mode: Mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.initialised = false; // re-snap so the transition isn't a long pan
    try {
      window.localStorage?.setItem(LS_KEY, mode);
    } catch {
      /* ignore */
    }
  }

  public getMode(): Mode {
    return this.mode;
  }

  /**
   * Backwards-compatible signature.
   *   update(player, elapsedSec, controls, _modeIgnored?)
   */
  public update(player: any, elapsedSec: any, controls?: any, _ignored?: any) {
    const dt = isFiniteNumber(elapsedSec) ? Math.min(Math.max(elapsedSec, 0), 0.1) : 0;
    if (dt <= 0) return;

    const state = this.coerceState(player);
    if (!state) {
      this.applyEmergency();
      return;
    }

    if (this.mode === "HIGH_CHASE") {
      this.updateHighChase(state, controls, dt);
    } else if (this.mode === "ORBIT") {
      this.updateOrbit(state, controls, dt);
    } else if (this.mode === "COCKPIT") {
      this.updateCockpit(state, controls, dt);
    } else {
      this.updateChase(state, controls, dt);
    }
  }

  // =============================================================
  // Mode 4: Driver View / Cockpit
  //
  // Camera is anchored to the car (car-relative offsets), sitting at the
  // driver's eye level, centered behind the wheel. Adds:
  //   • FOV pref (65–90°, persisted in localStorage)
  //   • Subtle nose pitch on accel/brake
  //   • Small body roll on steering
  //   • Tiny G-force head sway and high-speed vibration
  // No hood/bumper variant — that mode was removed.
  // =============================================================
  private updateCockpit(state: GamePhysicsState, controls: any, dt: number) {
    const boost = !!(controls && (controls.nitro || controls.boost));
    const speed = Math.abs(state.speed);
    const speedRatio = Math.min(1, speed / SPEED_FOR_MAX_FOV);

    // FOV: base = user pref, +6 during boost, +4 at top speed. Smoothed.
    const targetFov = this.cockpitFov + (boost ? 6 : 0) + speedRatio * 4;
    const fovK = 1 - Math.exp(-8 * dt);
    this.camera.fov = this.camera.fov + (targetFov - this.camera.fov) * fovK;
    if (!isFiniteNumber(this.camera.fov)) this.camera.fov = this.cockpitFov;
    this.camera.updateProjectionMatrix();

    // Forward (flattened) and right vectors from car direction.
    const fwd = state.direction.clone();
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);

    // Steering (for roll + lateral head sway).
    let steer = 0;
    if (controls && isFiniteNumber(controls.steerValue)) {
      steer = Math.max(-1, Math.min(1, controls.steerValue));
    } else if (controls) {
      if (controls.left) steer -= 1;
      if (controls.right) steer += 1;
    }

    // Longitudinal acceleration signal from speed delta (subtle head pitch).
    const dv = speed - this.prevSpeed; // note: prevSpeed is updated inside applyShakeAndCommit
    const accelSignal = Math.max(-1, Math.min(1, dv * 3.0));

    // Target subtle pitch: accel → nose down (negative), brake → nose up.
    const targetPitch = -accelSignal * 0.035;
    const targetRoll = -steer * 0.05 * (0.4 + speedRatio * 0.6);
    const pK = 1 - Math.exp(-10 * dt);
    const rK = 1 - Math.exp(-8 * dt);
    this.smoothedPitch += (targetPitch - this.smoothedPitch) * pK;
    this.smoothedBodyRoll += (targetRoll - this.smoothedBodyRoll) * rK;

    // Tiny G-force head offset (opposite to steering, forward on brake).
    const headTarget = new THREE.Vector3()
      .add(right.clone().multiplyScalar(-steer * 0.03 * (0.3 + speedRatio * 0.7)))
      .add(fwd.clone().multiplyScalar(-accelSignal * 0.025));
    const hK = 1 - Math.exp(-9 * dt);
    this.smoothedHeadOffset.lerp(headTarget, hK);

    // Desired anchor position at eye level, behind the wheel.
    const desiredPos = state.position
      .clone()
      .add(fwd.clone().multiplyScalar(COCKPIT_OFFSET_FORWARD))
      .add(right.clone().multiplyScalar(COCKPIT_OFFSET_RIGHT))
      .add(this.smoothedHeadOffset);
    desiredPos.y += COCKPIT_OFFSET_UP;

    const desiredLook = state.position
      .clone()
      .add(fwd.clone().multiplyScalar(COCKPIT_LOOK_AHEAD));
    desiredLook.y += COCKPIT_LOOK_UP;
    // Apply pitch by tilting the look target vertically.
    desiredLook.y += Math.tan(this.smoothedPitch) * COCKPIT_LOOK_AHEAD;

    if (!this.initialised || !isValidVec3Like(this.smoothedPos)) {
      this.smoothedPos.copy(desiredPos);
      this.smoothedLook.copy(desiredLook);
      this.initialised = true;
    } else {
      // Very tight, fps-independent follow so it feels attached to the car.
      const kPos = 1 - Math.exp(-26 * dt);
      const kLook = 1 - Math.exp(-20 * dt);
      this.smoothedPos.lerp(desiredPos, kPos);
      this.smoothedLook.lerp(desiredLook, kLook);
    }

    // Very subtle high-speed vibration (never excessive).
    const vibe = speed > 25 ? Math.min(0.015, (speed - 25) * 0.0006) : 0;
    this.applyShakeAndCommit(state, controls, boost, speed, speedRatio, dt, this.smoothedBodyRoll, vibe);
  }


  // =============================================================
  // Mode 1: Standard Chase (UNCHANGED behaviour)
  // =============================================================
  private updateChase(state: GamePhysicsState, controls: any, dt: number) {
    const boost = !!(controls && (controls.nitro || controls.boost));
    const speed = Math.abs(state.speed);
    const speedRatio = Math.min(1, speed / SPEED_FOR_MAX_FOV);

    const targetFov = boost ? FOV_NITRO : FOV_LOW + (FOV_HIGH - FOV_LOW) * speedRatio;
    const fovK = 1 - Math.exp(-6 * dt);
    this.camera.fov = this.camera.fov + (targetFov - this.camera.fov) * fovK;
    if (!isFiniteNumber(this.camera.fov)) this.camera.fov = FOV_LOW;
    this.camera.updateProjectionMatrix();

    const dir = state.direction.clone();
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    const desiredPos = state.position.clone().add(dir.clone().multiplyScalar(-CHASE_DISTANCE));
    desiredPos.y += CHASE_HEIGHT;

    const desiredLook = state.position.clone().add(dir.clone().multiplyScalar(LOOK_AHEAD));
    desiredLook.y += LOOK_HEIGHT;

    if (!this.initialised || !isValidVec3Like(this.smoothedPos)) {
      this.smoothedPos.copy(desiredPos);
      this.smoothedLook.copy(desiredLook);
      this.initialised = true;
    } else {
      const kPos = 1 - Math.exp(-7 * dt);
      const kLook = 1 - Math.exp(-9 * dt);
      this.smoothedPos.lerp(desiredPos, kPos);
      this.smoothedLook.lerp(desiredLook, kLook);
    }

    const groundY = state.position.y + MIN_GROUND_CLEARANCE;
    if (this.smoothedPos.y < groundY) this.smoothedPos.y = groundY;

    const dxz = new THREE.Vector3(
      this.smoothedPos.x - state.position.x,
      0,
      this.smoothedPos.z - state.position.z,
    );
    if (dxz.length() < MIN_CAR_DISTANCE) {
      const push = dir.clone().multiplyScalar(-MIN_CAR_DISTANCE);
      this.smoothedPos.x = state.position.x + push.x;
      this.smoothedPos.z = state.position.z + push.z;
    }

    this.applyShakeAndCommit(state, controls, boost, speed, speedRatio, dt, 0);
  }

  // =============================================================
  // Mode 2: High Chase (elevated, downward-angled "drone")
  // =============================================================
  private updateHighChase(state: GamePhysicsState, controls: any, dt: number) {
    const boost = !!(controls && (controls.nitro || controls.boost));
    const speed = Math.abs(state.speed);
    const speedRatio = Math.min(1, speed / SPEED_FOR_MAX_FOV);

    // Dynamic FOV (68 → 82, +nitro 88).
    const targetFov = boost
      ? HC_FOV_NITRO
      : HC_FOV_LOW + (HC_FOV_HIGH - HC_FOV_LOW) * speedRatio;
    const fovK = 1 - Math.exp(-5 * dt);
    this.camera.fov = this.camera.fov + (targetFov - this.camera.fov) * fovK;
    if (!isFiniteNumber(this.camera.fov)) this.camera.fov = HC_FOV_LOW;
    this.camera.updateProjectionMatrix();

    const dir = state.direction.clone();
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    // Desired rig: behind and above the car.
    const desiredPos = state.position
      .clone()
      .add(dir.clone().multiplyScalar(-HC_DISTANCE));
    desiredPos.y += HC_HEIGHT;

    // Always center the vehicle: look directly at the car (slight low offset
    // produces the requested 30–40° downward angle given the rig height).
    const desiredLook = state.position.clone();
    desiredLook.y += HC_LOOK_HEIGHT;

    if (!this.initialised || !isValidVec3Like(this.smoothedPos)) {
      this.smoothedPos.copy(desiredPos);
      this.smoothedLook.copy(desiredLook);
      this.initialised = true;
    } else {
      // Slightly laggier than CHASE for a satisfying "catch-up" feel on
      // acceleration, but look snaps faster so the car stays centered.
      const kPos = 1 - Math.exp(-4.5 * dt);
      const kLook = 1 - Math.exp(-8 * dt);
      this.smoothedPos.lerp(desiredPos, kPos);
      this.smoothedLook.lerp(desiredLook, kLook);
    }

    // Anti-clip: stay well above ground and never inside the car.
    const groundY = state.position.y + HC_MIN_GROUND_CLEARANCE;
    if (this.smoothedPos.y < groundY) this.smoothedPos.y = groundY;

    const dxz = new THREE.Vector3(
      this.smoothedPos.x - state.position.x,
      0,
      this.smoothedPos.z - state.position.z,
    );
    if (dxz.length() < HC_MIN_CAR_DISTANCE) {
      const push = dir.clone().multiplyScalar(-HC_MIN_CAR_DISTANCE);
      this.smoothedPos.x = state.position.x + push.x;
      this.smoothedPos.z = state.position.z + push.z;
    }

    // Steering tilt (camera roll).
    let steer = 0;
    if (controls && isFiniteNumber(controls.steerValue)) {
      steer = Math.max(-1, Math.min(1, controls.steerValue));
    } else if (controls) {
      if (controls.left) steer -= 1;
      if (controls.right) steer += 1;
    }
    const targetRoll = -steer * HC_STEER_TILT;
    const rollK = 1 - Math.exp(-6 * dt);
    this.smoothedRoll += (targetRoll - this.smoothedRoll) * rollK;

    this.applyShakeAndCommit(state, controls, boost, speed, speedRatio, dt, this.smoothedRoll);
  }

  // =============================================================
  // Mode 3: Cinematic Orbit (slow auto 360° around the car)
  // =============================================================
  private updateOrbit(state: GamePhysicsState, _controls: any, dt: number) {
    const speed = Math.abs(state.speed);
    const speedRatio = Math.min(1, speed / SPEED_FOR_MAX_FOV);

    // Dynamic FOV.
    const targetFov = ORBIT_FOV_LOW + (ORBIT_FOV_HIGH - ORBIT_FOV_LOW) * speedRatio;
    const fovK = 1 - Math.exp(-4 * dt);
    this.camera.fov = this.camera.fov + (targetFov - this.camera.fov) * fovK;
    if (!isFiniteNumber(this.camera.fov)) this.camera.fov = ORBIT_FOV_LOW;
    this.camera.updateProjectionMatrix();

    // Pause orbit briefly on collisions, then smoothly resume.
    const crashI = isFiniteNumber(state.crashIntensity) ? state.crashIntensity : 0;
    if (crashI > 0.15) this.orbitCollisionPause = Math.max(this.orbitCollisionPause, 0.6);
    if (this.orbitCollisionPause > 0) this.orbitCollisionPause = Math.max(0, this.orbitCollisionPause - dt);

    const orbitActive = this.orbitCollisionPause <= 0;
    if (orbitActive) {
      const omega = ORBIT_BASE_SPEED + ORBIT_SPEED_BOOST * speedRatio;
      this.orbitAngle += omega * dt;
      if (this.orbitAngle > Math.PI * 2) this.orbitAngle -= Math.PI * 2;
    }

    const cx = state.position.x + Math.sin(this.orbitAngle) * ORBIT_RADIUS;
    const cz = state.position.z + Math.cos(this.orbitAngle) * ORBIT_RADIUS;
    const cy = state.position.y + ORBIT_HEIGHT;
    const desiredPos = new THREE.Vector3(cx, cy, cz);

    const desiredLook = state.position.clone();
    desiredLook.y += ORBIT_LOOK_HEIGHT;

    if (!this.initialised || !isValidVec3Like(this.smoothedPos)) {
      this.smoothedPos.copy(desiredPos);
      this.smoothedLook.copy(desiredLook);
      this.initialised = true;
    } else {
      const kPos = 1 - Math.exp(-5 * dt);
      const kLook = 1 - Math.exp(-10 * dt);
      this.smoothedPos.lerp(desiredPos, kPos);
      this.smoothedLook.lerp(desiredLook, kLook);
    }

    // Keep above ground.
    const groundY = state.position.y + ORBIT_MIN_GROUND_CLEARANCE;
    if (this.smoothedPos.y < groundY) this.smoothedPos.y = groundY;

    // Commit without shake (cinematic). Reuse shared commit with no boost/shake.
    this.applyShakeAndCommit(state, null, false, speed, speedRatio, dt, 0);
  }



  // =============================================================
  // Shared commit: shake, NaN guard, lookAt + optional roll.
  // =============================================================
  private applyShakeAndCommit(
    state: GamePhysicsState,
    _controls: any,
    boost: boolean,
    speed: number,
    speedRatio: number,
    dt: number,
    roll: number,
    extraShake: number = 0,
  ) {
    void extraShake;
    const dv = speed - this.prevSpeed;
    this.prevSpeed = speed;

    let targetShake = extraShake;
    if (boost && speed > 5) targetShake = Math.max(targetShake, 0.04 + speedRatio * 0.05);
    const crashI = isFiniteNumber(state.crashIntensity) ? state.crashIntensity : 0;
    if (crashI > 0.05) targetShake = Math.max(targetShake, crashI * 0.45);
    if (dv < -10) targetShake = Math.max(targetShake, Math.min(0.4, -dv * 0.03));

    const shakeK = targetShake > this.shake ? 1 - Math.exp(-12 * dt) : 1 - Math.exp(-3 * dt);
    this.shake = this.shake + (targetShake - this.shake) * shakeK;
    if (this.shake < 0.001) this.shake = 0;

    let px = this.smoothedPos.x;
    let py = this.smoothedPos.y;
    let pz = this.smoothedPos.z;

    if (this.shake > 0) {
      const s = this.shake;
      px += (Math.random() - 0.5) * s;
      py += (Math.random() - 0.5) * s * 0.7;
      pz += (Math.random() - 0.5) * s;
    }

    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
      this.applyEmergency(state.position);
      return;
    }

    this.camera.up.set(0, 1, 0);
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(this.smoothedLook);

    if (roll !== 0 && Number.isFinite(roll)) {
      this.camera.rotateZ(roll);
    }
  }

  // =============================================================
  // Helpers
  // =============================================================
  private coerceState(src: any): GamePhysicsState | null {
    if (!src || typeof src !== "object") return null;

    const p = src.position;
    if (!isValidVec3Like(p)) return null;
    const position = p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p.x, p.y, p.z);

    let direction: THREE.Vector3;
    if (isValidVec3Like(src.direction)) {
      direction =
        src.direction instanceof THREE.Vector3
          ? src.direction.clone()
          : new THREE.Vector3(src.direction.x, src.direction.y, src.direction.z);
    } else if (isFiniteNumber(src.angle)) {
      direction = new THREE.Vector3(Math.sin(src.angle), 0, Math.cos(src.angle));
    } else {
      direction = new THREE.Vector3(0, 0, 1);
    }
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);

    const speed = isFiniteNumber(src.speed) ? src.speed : 0;
    const crashIntensity = isFiniteNumber(src.crashIntensity) ? src.crashIntensity : 0;

    return { position, direction, speed, crashIntensity };
  }

  private applyEmergency(lookAt?: THREE.Vector3) {
    this.camera.position.copy(EMERGENCY_POSITION);
    this.camera.up.set(0, 1, 0);
    const target = lookAt && isValidVec3Like(lookAt) ? lookAt : EMERGENCY_TARGET;
    this.camera.lookAt(target);
    if (!isFiniteNumber(this.camera.fov)) {
      this.camera.fov = FOV_LOW;
      this.camera.updateProjectionMatrix();
    }
  }
}

export default CameraController;
