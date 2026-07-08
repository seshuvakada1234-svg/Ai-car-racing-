import * as THREE from "three";
import { CarState } from "../types";
import { SuspensionState } from "../utils/suspension";

export interface WheelAssembly {
  node: THREE.Object3D;
  steerPivot: THREE.Group;
  suspensionPivot: THREE.Group;
  hub: THREE.Group;
  initialLocalPos: THREE.Vector3;
  originalQuaternion: THREE.Quaternion;
  originalScale: THREE.Vector3;
  spinAxis: THREE.Vector3;
  spinSign: number;
  wheelRadius: number;
  mode: "bone" | "mesh";
}

export interface WheelDebugInfo {
  slot: "FL" | "FR" | "RL" | "RR";
  name: string;
  localPosition: THREE.Vector3;
  parentName: string;
  mode: "bone" | "mesh";
}

type WheelSlotName = "frontLeft" | "frontRight" | "rearLeft" | "rearRight";
type WheelSlotCode = "FL" | "FR" | "RL" | "RR";

interface WheelCandidate {
  node: THREE.Object3D;
  localCenter: THREE.Vector3;
  slot: WheelSlotCode;
  mode: "bone" | "mesh";
}

export class WheelSystem {
  public frontLeft: WheelAssembly | null = null;
  public frontRight: WheelAssembly | null = null;
  public rearLeft: WheelAssembly | null = null;
  public rearRight: WheelAssembly | null = null;

  // Per-wheel spin angles so wheels of different radii stay in sync with the
  // road surface independently. Kept public for debugging.
  public spinAngles = { fl: 0, fr: 0, rl: 0, rr: 0 };
  public wheelspinAngle: number = 0; // legacy aggregate, kept for back-compat
  public readonly debugInfo: WheelDebugInfo[] = [];
  public readonly isValid: boolean = false;

  private _qSteer = new THREE.Quaternion();
  private _qZero = new THREE.Quaternion().set(0, 0, 0, 1);
  private _axisY = new THREE.Vector3(0, 1, 0);
  private _smoothSteerYaw = 0;


  constructor(wheels: THREE.Object3D[], modelRoot: THREE.Object3D) {
    if (!wheels || wheels.length === 0) return;
    this.detectAndAssignWheels(wheels, modelRoot);
    const detectedCount = [this.frontLeft, this.frontRight, this.rearLeft, this.rearRight].filter(
      Boolean,
    ).length;
    (this as { isValid: boolean }).isValid = detectedCount === 4;
    if (detectedCount !== 4) {
      console.warn(
        `[WheelSystem] Invalid wheel rig: detected ${detectedCount}/4 wheels (FL=${!!this.frontLeft} FR=${!!this.frontRight} RL=${!!this.rearLeft} RR=${!!this.rearRight}). Refusing unsafe wheel placement.`,
      );
    }
  }

  private detectAndAssignWheels(wheels: THREE.Object3D[], modelRoot: THREE.Object3D): void {
    const forbiddenTerms = [
      "car",
      "body",
      "chassis",
      "suspension",
      "brake",
      "axle",
      "wheel_group",
      "support",
      "fender",
      "caliper",
      "disc",
      "hub",
      "steering",
      "arch",
      "well",
      "housing",
      "pivot",
      "rotor",
      "drum",
    ];
    const wheelTerms = ["wheel", "rim", "tire", "tyre", "pneu", "col_w", "helper_wheel"];

    const isWheelish = (node: THREE.Object3D): boolean => {
      const nameLower = node.name.toLowerCase();
      const containsWheelTerm = wheelTerms.some((t) => nameLower.includes(t));
      const containsForbiddenTerm = forbiddenTerms.some((t) => nameLower.includes(t));
      return containsWheelTerm && !containsForbiddenTerm;
    };

    const collectRootCandidates = (source: THREE.Object3D[]): THREE.Object3D[] => {
      const candidates: THREE.Object3D[] = [];
      source.forEach((node) => {
        if (!isWheelish(node)) return;
        let current = node;
        while (current.parent && current.parent !== modelRoot) {
          const pName = current.parent.name.toLowerCase();
          const pWheel = wheelTerms.some((t) => pName.includes(t));
          const pForbidden = forbiddenTerms.some((t) => pName.includes(t));
          if (pWheel && !pForbidden) {
            current = current.parent;
          } else {
            break;
          }
        }
        if (!candidates.includes(current)) candidates.push(current);
      });
      return candidates;
    };

    let rawCandidates = collectRootCandidates(wheels);
    if (rawCandidates.length < 4) {
      const traversed: THREE.Object3D[] = [];
      modelRoot.traverse((node) => traversed.push(node));
      rawCandidates = collectRootCandidates(traversed);
    }

    const candidates = this.classifyCandidates(rawCandidates, modelRoot);
    const bySlot = new Map<WheelSlotCode, WheelCandidate>();
    for (const c of candidates) {
      // One and only one visual assembly may own each corner. Prefer the first
      // candidate supplied by CarLoader (normally helper_wheel_FL/FR/RL/RR).
      if (!bySlot.has(c.slot)) bySlot.set(c.slot, c);
    }

    this.frontLeft = this.setupAssembly(bySlot.get("FL") ?? null, "frontLeft", "FL", modelRoot);
    this.frontRight = this.setupAssembly(bySlot.get("FR") ?? null, "frontRight", "FR", modelRoot);
    this.rearLeft = this.setupAssembly(bySlot.get("RL") ?? null, "rearLeft", "RL", modelRoot);
    this.rearRight = this.setupAssembly(bySlot.get("RR") ?? null, "rearRight", "RR", modelRoot);
  }

  private classifyCandidates(nodes: THREE.Object3D[], modelRoot: THREE.Object3D): WheelCandidate[] {
    const seen = new Set<THREE.Object3D>();
    const candidates: WheelCandidate[] = [];

    for (const node of nodes) {
      if (!node || seen.has(node)) continue;
      seen.add(node);

      const localCenter = this.getWheelLocalCenter(node, modelRoot);
      const name = node.name.toLowerCase();
      const explicitSlot = name.includes("fl") || name.includes("frontleft") || name.includes("front_left")
        ? "FL"
        : name.includes("fr") || name.includes("frontright") || name.includes("front_right")
          ? "FR"
          : name.includes("rl") || name.includes("rearleft") || name.includes("rear_left")
            ? "RL"
            : name.includes("rr") || name.includes("rearright") || name.includes("rear_right")
              ? "RR"
              : null;

      const slot = explicitSlot ?? ((localCenter.z >= 0 ? "F" : "R") + (localCenter.x >= 0 ? "L" : "R")) as WheelSlotCode;
      candidates.push({
        node,
        localCenter,
        slot,
        mode: node instanceof THREE.Bone ? "bone" : "mesh",
      });
    }

    return candidates;
  }

  private getWheelLocalCenter(node: THREE.Object3D, modelRoot: THREE.Object3D): THREE.Vector3 {
    modelRoot.updateMatrixWorld(true);
    node.updateWorldMatrix(true, true);

    // Prefer the node's authored local transform. If the pivot is wrong, fall
    // back to the visual bounds centre converted once into chassis-local space.
    const direct = node.position.clone();
    if (node.parent && node.parent !== modelRoot) {
      node.parent.localToWorld(direct);
      modelRoot.worldToLocal(direct);
    }

    const box = new THREE.Box3().setFromObject(node);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      modelRoot.worldToLocal(center);
      if (Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)) return center;
    }

    return direct;
  }

  private setupAssembly(
    candidate: WheelCandidate | null,
    name: WheelSlotName,
    slot: WheelSlotCode,
    modelRoot: THREE.Object3D,
  ): WheelAssembly | null {
    if (!candidate) return null;
    const node = candidate.node;

    node.updateWorldMatrix(true, true);
    modelRoot.updateWorldMatrix(true, true);

    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    node.getWorldQuaternion(worldQuat);
    node.getWorldScale(worldScale);
    const originalParentName = node.parent?.name || "<none>";

    const localPos = candidate.localCenter.clone();

    const modelRootWorldQuat = new THREE.Quaternion();
    modelRoot.getWorldQuaternion(modelRootWorldQuat);
    const localQuat = modelRootWorldQuat.clone().invert().multiply(worldQuat);

    const initialLocalPos = localPos.clone();
    const originalQuaternion = localQuat.clone();

    const modelRootWorldScale = new THREE.Vector3();
    modelRoot.getWorldScale(modelRootWorldScale);
    const originalScale = new THREE.Vector3(
      worldScale.x / (modelRootWorldScale.x || 1),
      worldScale.y / (modelRootWorldScale.y || 1),
      worldScale.z / (modelRootWorldScale.z || 1),
    );

    // ── Measure ONLY visible tyre/rim meshes, ignoring helpers & brake parts ──
    const brakeTerms = [
      "caliper",
      "disc",
      "brake",
      "rotor",
      "drum",
      "hub",
      "helper",
      "pivot",
      "dummy",
      "empty",
      "shadow",
      "lod",
      "collision",
    ];

    const savedParent = node.parent;
    const savedPos = node.position.clone();
    const savedQuat = node.quaternion.clone();
    const savedRot = node.rotation.clone();
    const savedScale = node.scale.clone();
    node.updateMatrixWorld(true);

    const meshBox = new THREE.Box3();
    const childBox = new THREE.Box3();
    let meshBoxEmpty = true;

    node.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (!child.visible) return;
      if (!child.geometry) return;

      const cName = child.name.toLowerCase();
      if (brakeTerms.some((t) => cName.includes(t))) return;

      // Skip suspiciously tiny geometry (brake discs, invisible helpers)
      const geo = child.geometry;
      if (geo.attributes.position && geo.attributes.position.count < 12) return;

      child.updateWorldMatrix(true, false);
      childBox.setFromObject(child);
      if (!childBox.isEmpty()) {
        meshBox.union(childBox);
        meshBoxEmpty = false;
      }
    });

    // Fallback: use full object bounds if no clean meshes were found
    if (meshBoxEmpty) {
      meshBox.setFromObject(node);
    }

    node.position.copy(savedPos);
    node.quaternion.copy(savedQuat);
    node.rotation.copy(savedRot);
    node.scale.copy(savedScale);
    node.updateMatrixWorld(true);

    const size = new THREE.Vector3();
    meshBox.getSize(size);

    // Sort dims descending: [largest, middle, smallest(=axle width)]
    // Use the SECOND-LARGEST (middle) dimension as rolling diameter.
    // The largest can be the tyre width on wide-bodied models; the middle is
    // always the outer diameter cross-section.
    const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
    const rollingDiameter = dims[1]; // second largest = tyre diameter
    let wheelRadius = THREE.MathUtils.clamp(rollingDiameter * 0.5, 0.28, 0.48);

    // Spin axis = direction of the smallest dimension (the axle)
    const localSpinAxis = new THREE.Vector3(1, 0, 0);
    const minDim = Math.min(size.x, size.y, size.z);
    if (minDim === size.y) localSpinAxis.set(0, 1, 0);
    else if (minDim === size.z) localSpinAxis.set(0, 0, 1);

    let spinAxis = localSpinAxis.clone().applyQuaternion(originalQuaternion).normalize();

    // Per-car preprocessors (e.g. Sketchfab merged-wheels for Porsche/Ferrari)
    // know the correct chassis-local spin axis and rolling radius and tag the
    // helper accordingly. Honor those hints instead of the heuristic above,
    // which can pick the wrong axis when multiple Y-up/Z-up coord swaps are
    // stacked above the wheel meshes.
    const forcedAxis = (node.userData as { forcedSpinAxisLocal?: THREE.Vector3 }).forcedSpinAxisLocal;
    const forcedRadius = (node.userData as { forcedWheelRadius?: number }).forcedWheelRadius;
    if (forcedAxis) spinAxis = forcedAxis.clone().normalize();
    if (typeof forcedRadius === "number" && forcedRadius > 0.05) wheelRadius = forcedRadius;

    const spinSign = spinAxis.x >= 0 ? 1 : -1;


    // Hierarchy: modelRoot → SteerPivot → SuspensionPivot → Hub → WheelMesh
    const steerPivot = new THREE.Group();
    steerPivot.name = `${name}SteerPivot`;
    steerPivot.position.copy(initialLocalPos);
    modelRoot.add(steerPivot);

    const suspensionPivot = new THREE.Group();
    suspensionPivot.name = `${name}SuspensionPivot`;
    steerPivot.add(suspensionPivot);

    const hub = new THREE.Group();
    hub.name = `${name}Hub`;
    suspensionPivot.add(hub);

    if (candidate.mode === "bone") {
      // Skeleton bones must remain in their original hierarchy. The dummy pivot
      // chain is still used for local mount/suspension diagnostics, while the
      // bone receives steering/spin rotation directly in update().
      if (savedParent && node.parent !== savedParent) savedParent.add(node);
      node.position.copy(savedPos);
      node.quaternion.copy(savedQuat);
      node.scale.copy(savedScale);
    } else {
      // Recenter bad wheel pivots once by wrapping the visual wheel root in a
      // hub at the true wheel centre. attach() preserves the original world
      // transform, so meshes do not jump or receive per-frame offsets.
      modelRoot.updateMatrixWorld(true);
      steerPivot.updateMatrixWorld(true);
      suspensionPivot.updateMatrixWorld(true);
      hub.updateMatrixWorld(true);
      hub.attach(node);
    }

    this.debugInfo.push({
      slot,
      name: node.name || name,
      localPosition: initialLocalPos.clone(),
      parentName: originalParentName,
      mode: candidate.mode,
    });

    return {
      node,
      steerPivot,
      suspensionPivot,
      hub,
      initialLocalPos,
      originalQuaternion,
      originalScale,
      spinAxis,
      spinSign,
      wheelRadius,
      mode: candidate.mode,
    };
  }

  /**
   * Updates steering yaw and wheel spin ONLY.
   *
   * OWNERSHIP CONTRACT — suspensionPivot.position is NOT touched here.
   * VehicleRenderer is the sole owner; it sets it once per frame after
   * querying ground height under each wheel.
   */
  public update(car: CarState, steerOffset: number, _suspState: SuspensionState, elapsedSec: number): void {
    const maxSteerAngle = 0.36;
    const dt = Math.max(0, Math.min(elapsedSec, 0.1));

    // Sign-preserving linear velocity along the car's forward axis. We want the
    // tyres to keep rotating even at very low speeds, during braking, drifting,
    // and reverse — only stop when truly motionless.
    const speed = car.speed || 0;
    const direction = speed >= 0 ? 1 : -1;
    const linearSpeed = Math.abs(speed);
    const rotationActive = linearSpeed > 0.05;

    // Low-pass the steering input so left/right flicks ease into a target
    // angle instead of snapping. Framerate-independent exponential smoothing.
    const targetSteer = THREE.MathUtils.clamp(steerOffset, -1, 1) * maxSteerAngle;
    const steerSmoothing = 1 - Math.exp(-dt * 14); // ~70ms time constant
    this._smoothSteerYaw += (targetSteer - this._smoothSteerYaw) * steerSmoothing;
    const steerYaw = this._smoothSteerYaw;


    const updateAssembly = (
      assembly: WheelAssembly | null,
      isFront: boolean,
      angleKey: "fl" | "fr" | "rl" | "rr",
    ) => {
      if (!assembly) return;

      // 1) Steering yaw — only front wheels turn with the wheel.
      if (isFront) {
        this._qSteer.setFromAxisAngle(this._axisY, steerYaw);
        assembly.steerPivot.quaternion.copy(this._qSteer);
      } else {
        assembly.steerPivot.quaternion.copy(this._qZero);
      }

      // 2) Roll spin — uses this wheel's own radius so visual rolling matches
      // the car's true ground velocity (omega = v / r). Reverse flips sign.
      if (rotationActive) {
        const radius = assembly.wheelRadius > 0.05 ? assembly.wheelRadius : 0.38;
        const deltaAngle = (linearSpeed * dt) / radius;
        this.spinAngles[angleKey] += deltaAngle * direction;
        // Keep angle bounded so floating-point precision stays stable over
        // long sessions without introducing visible snaps.
        if (this.spinAngles[angleKey] > Math.PI * 2) this.spinAngles[angleKey] -= Math.PI * 2;
        else if (this.spinAngles[angleKey] < -Math.PI * 2) this.spinAngles[angleKey] += Math.PI * 2;
      }

      assembly.hub.quaternion.setFromAxisAngle(assembly.spinAxis, this.spinAngles[angleKey] * assembly.spinSign);

      if (assembly.mode === "bone") {
        const spinQ = new THREE.Quaternion().setFromAxisAngle(
          assembly.spinAxis,
          this.spinAngles[angleKey] * assembly.spinSign,
        );
        assembly.node.quaternion.copy(assembly.originalQuaternion);
        if (isFront) assembly.node.quaternion.premultiply(this._qSteer);
        assembly.node.quaternion.multiply(spinQ);
      }
    };

    updateAssembly(this.frontLeft, true, "fl");
    updateAssembly(this.frontRight, true, "fr");
    updateAssembly(this.rearLeft, false, "rl");
    updateAssembly(this.rearRight, false, "rr");

    // Keep aggregate angle in sync for any legacy reader.
    this.wheelspinAngle = this.spinAngles.fl;
  }
}

