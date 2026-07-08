import * as THREE from "three";
import { getCarModelForId, gltfModelCache, playerSelectedModelKey } from "../world/procedural";
import { WheelSystem } from "./WheelSystem";
import { autoRepairWheels } from "./WheelAutoRepair";
import { upgradeTextures } from "../systems/GraphicsConfig";
import { toast } from "sonner";



export interface LoadedCarAsset {
  model: THREE.Group;
  wheelSystem: WheelSystem;
  brakeLights: THREE.Material[];
  headlights: THREE.Mesh[];
  height: number;
}

export class CarLoader {
  // Keyed by `${carId}::${modelKey}` so that a previous failure on one vehicle
  // never blocks a different vehicle the player just selected.
  private static failedCarIds = new Set<string>();

  /** Forget every previous load failure — call when the player picks a new car. */
  public static resetFailures(): void {
    CarLoader.failedCarIds.clear();
  }

  private static failKey(carId: string): string {
    return `${carId}::${playerSelectedModelKey ?? "?"}`;
  }

  private static reportVehicleLoadError(carId: string, message: string): void {
    const k = CarLoader.failKey(carId);
    if (CarLoader.failedCarIds.has(k)) return;
    CarLoader.failedCarIds.add(k);
    console.error(`[CarLoader] ${message}`);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("race:vehicleLoadError", { detail: { carId, message } }));
      toast.error("Vehicle model error", { description: message });
    }
  }

  private static getRootLocalMatrix(node: THREE.Object3D, root: THREE.Object3D): THREE.Matrix4 | null {
    const chain: THREE.Object3D[] = [];
    let current: THREE.Object3D | null = node;
    while (current && current !== root) {
      chain.push(current);
      current = current.parent;
    }
    if (current !== root) return null;

    const matrix = new THREE.Matrix4().identity();
    for (let i = chain.length - 1; i >= 0; i--) {
      chain[i].updateMatrix();
      matrix.multiply(chain[i].matrix);
    }
    return matrix;
  }

  private static getMeshRootLocalBox(mesh: THREE.Mesh, root: THREE.Object3D): THREE.Box3 | null {
    if (!mesh.geometry) return null;
    mesh.geometry.computeBoundingBox();
    const geoBox = mesh.geometry.boundingBox;
    if (!geoBox || geoBox.isEmpty()) return null;

    const rootLocalMatrix = CarLoader.getRootLocalMatrix(mesh, root);
    if (!rootLocalMatrix) return null;

    const box = new THREE.Box3();
    const corners = [
      new THREE.Vector3(geoBox.min.x, geoBox.min.y, geoBox.min.z),
      new THREE.Vector3(geoBox.min.x, geoBox.min.y, geoBox.max.z),
      new THREE.Vector3(geoBox.min.x, geoBox.max.y, geoBox.min.z),
      new THREE.Vector3(geoBox.min.x, geoBox.max.y, geoBox.max.z),
      new THREE.Vector3(geoBox.max.x, geoBox.min.y, geoBox.min.z),
      new THREE.Vector3(geoBox.max.x, geoBox.min.y, geoBox.max.z),
      new THREE.Vector3(geoBox.max.x, geoBox.max.y, geoBox.min.z),
      new THREE.Vector3(geoBox.max.x, geoBox.max.y, geoBox.max.z),
    ];
    corners.forEach((corner) => box.expandByPoint(corner.applyMatrix4(rootLocalMatrix)));
    return box.isEmpty() ? null : box;
  }

  private static rebuildPorsche911WheelHierarchy(modelRoot: THREE.Object3D, label = "porsche_911_gt3"): boolean {
    const containers: THREE.Object3D[] = [];
    modelRoot.traverse((node) => {
      if (/^Combined3DWheel/i.test(node.name || "")) containers.push(node);
    });
    if (containers.length === 0) return false;

    const meshes: THREE.Mesh[] = [];
    const ancestors = new Set<THREE.Object3D>();
    const sourceNodes = new Set<THREE.Object3D>();
    for (const container of containers) {
      ancestors.add(container);
      let parent: THREE.Object3D | null = container.parent;
      while (parent && parent !== modelRoot) {
        ancestors.add(parent);
        parent = parent.parent;
      }
      container.traverse((node) => {
        sourceNodes.add(node);
        if (node instanceof THREE.Mesh && node.geometry) meshes.push(node);
      });
    }
    if (meshes.length < 4) return false;

    type Slot = "FL" | "FR" | "RL" | "RR";
    type MeshSample = { mesh: THREE.Mesh; center: THREE.Vector3; box: THREE.Box3; weight: number };

    const samples: MeshSample[] = [];
    for (const mesh of meshes) {
      const box = CarLoader.getMeshRootLocalBox(mesh, modelRoot);
      if (!box) continue;
      const size = box.getSize(new THREE.Vector3());
      samples.push({
        mesh,
        center: box.getCenter(new THREE.Vector3()),
        box,
        weight: Math.max(size.x * size.y * size.z, 1e-8),
      });
    }
    if (samples.length < 4) return false;

    const minX = Math.min(...samples.map((s) => s.center.x));
    const maxX = Math.max(...samples.map((s) => s.center.x));
    const minZ = Math.min(...samples.map((s) => s.center.z));
    const maxZ = Math.max(...samples.map((s) => s.center.z));

    // Porsche-specific repair: the GLB names only one giant Front_L wheel
    // container, but it actually contains all four wheels as fragments. Median
    // quadrant splits can put rear-right fragments into the wrong wheel. Use a
    // local-space four-cluster solve to rebuild true FL/FR/RL/RR pivots.
    let centers = [
      new THREE.Vector2(maxX, maxZ),
      new THREE.Vector2(minX, maxZ),
      new THREE.Vector2(maxX, minZ),
      new THREE.Vector2(minX, minZ),
    ];
    let groups: MeshSample[][] = [[], [], [], []];
    for (let iter = 0; iter < 18; iter++) {
      groups = [[], [], [], []];
      for (const sample of samples) {
        let bestIndex = 0;
        let bestDist = Infinity;
        for (let i = 0; i < centers.length; i++) {
          const dx = sample.center.x - centers[i].x;
          const dz = sample.center.z - centers[i].y;
          const dist = dx * dx + dz * dz;
          if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
          }
        }
        groups[bestIndex].push(sample);
      }

      centers = groups.map((group, index) => {
        if (group.length === 0) return centers[index].clone();
        let sx = 0;
        let sz = 0;
        let sw = 0;
        group.forEach((sample) => {
          sx += sample.center.x * sample.weight;
          sz += sample.center.z * sample.weight;
          sw += sample.weight;
        });
        return new THREE.Vector2(sx / sw, sz / sw);
      });
    }

    if (groups.some((group) => group.length === 0)) {
      console.warn(`[CarLoader] ${label}: unable to rebuild all four wheel clusters`, {
        counts: groups.map((group) => group.length),
      });
      return false;
    }

    const splitX = (Math.min(...centers.map((c) => c.x)) + Math.max(...centers.map((c) => c.x))) * 0.5;
    const splitZ = (Math.min(...centers.map((c) => c.y)) + Math.max(...centers.map((c) => c.y))) * 0.5;
    const buckets: Record<Slot, { samples: MeshSample[]; box: THREE.Box3 }> = {
      FL: { samples: [], box: new THREE.Box3() },
      FR: { samples: [], box: new THREE.Box3() },
      RL: { samples: [], box: new THREE.Box3() },
      RR: { samples: [], box: new THREE.Box3() },
    };

    groups.forEach((group, index) => {
      const center = centers[index];
      const left = center.x >= splitX;
      const front = center.y >= splitZ;
      const slot = ((front ? "F" : "R") + (left ? "L" : "R")) as Slot;
      group.forEach((sample) => {
        buckets[slot].samples.push(sample);
        buckets[slot].box.union(sample.box);
      });
    });

    const slots: Slot[] = ["FL", "FR", "RL", "RR"];
    if (slots.some((slot) => buckets[slot].samples.length === 0)) {
      console.warn(`[CarLoader] ${label}: rebuilt wheel hierarchy missing a slot`, {
        counts: slots.reduce((acc, slot) => ({ ...acc, [slot]: buckets[slot].samples.length }), {}),
      });
      return false;
    }

    const slotNames: Record<Slot, string> = {
      FL: "FrontLeftWheel",
      FR: "FrontRightWheel",
      RL: "RearLeftWheel",
      RR: "RearRightWheel",
    };

    for (const slot of slots) {
      const bucket = buckets[slot];
      const pivot = new THREE.Group();
      pivot.name = slotNames[slot];
      pivot.position.copy(bucket.box.getCenter(new THREE.Vector3()));
      pivot.rotation.set(0, 0, 0);
      pivot.scale.set(1, 1, 1);
      pivot.userData.forcedSpinAxisLocal = new THREE.Vector3(1, 0, 0);

      const size = bucket.box.getSize(new THREE.Vector3());
      pivot.userData.forcedWheelRadius = THREE.MathUtils.clamp(Math.max(size.y, size.z) * 0.5, 0.28, 0.48);
      modelRoot.add(pivot);
      pivot.updateMatrix();

      const pivotRootMatrix = new THREE.Matrix4().makeTranslation(pivot.position.x, pivot.position.y, pivot.position.z);
      const pivotInverse = pivotRootMatrix.clone().invert();
      for (const sample of bucket.samples) {
        const rootLocalMatrix = CarLoader.getRootLocalMatrix(sample.mesh, modelRoot);
        if (!rootLocalMatrix) continue;
        const localMatrix = pivotInverse.clone().multiply(rootLocalMatrix);
        sample.mesh.parent?.remove(sample.mesh);
        pivot.add(sample.mesh);
        localMatrix.decompose(sample.mesh.position, sample.mesh.quaternion, sample.mesh.scale);
        sample.mesh.updateMatrix();
      }
    }

    for (const ancestor of ancestors) {
      if (ancestor.name) ancestor.name = ancestor.name.replace(/wheel|tire|tyre|rim|pneu/gi, "wh1");
    }
    for (const sourceNode of sourceNodes) {
      if (sourceNode.name) sourceNode.name = sourceNode.name.replace(/wheel|tire|tyre|rim|pneu/gi, "wh1");
    }

    console.log(
      `[CarLoader] ${label} wheel hierarchy rebuilt → ` +
        slots
          .map((slot) => {
            const center = buckets[slot].box.getCenter(new THREE.Vector3());
            return `${slot}=${buckets[slot].samples.length}@${center.toArray().map((v) => v.toFixed(3)).join(",")}`;
          })
          .join(" "),
    );
    return true;
  }

  /**
   * Sketchfab "merged-wheels" preprocessor.
   *
   * Some GLBs (Ferrari Purosangue, Porsche 911 GT3) store all four wheels as
   * hundreds of tiny `polySurfaceN_..._Wheel1A_3D_...` meshes parented under a
   * single `Combined3DWheel_..._Instance` container, with positions baked into
   * the vertices and zero per-node translations. Each individual polysurface is
   * far too small to satisfy the global auto-repair's per-mesh radius check, so
   * the resulting helper pivots end up far below the chassis and the wheels
   * look detached.
   *
   * This pass detects that hierarchy, partitions the descendants into FL / FR /
   * RL / RR by their WORLD position relative to the chassis, builds 4 correctly
   * sized helper pivots at each quadrant's true wheel centre, and reparents the
   * mesh fragments under them while preserving world transforms. The downstream
   * WheelSystem then finds exactly 4 `helper_wheel_*` roots — the same contract
   * that already works for the Bugatti.
   *
   * Returns true if a Sketchfab merged-wheel container was found and rebuilt.
   */
  private static preprocessSketchfabMergedWheels(modelRoot: THREE.Object3D, carId: string): boolean {
    if (carId === "porsche_911_gt3" || carId === "ferrari_purosangue") {
      return CarLoader.rebuildPorsche911WheelHierarchy(modelRoot, carId);
    }

    modelRoot.updateMatrixWorld(true);

    // Find merged-wheel containers ("Combined3DWheel..." or top-level "Wheel1A_3D...").
    const containers: THREE.Object3D[] = [];
    modelRoot.traverse((n) => {
      const nm = n.name || "";
      if (/Combined3DWheel/i.test(nm)) containers.push(n);
    });
    if (containers.length === 0) return false;

    // Gather every mesh under any such container.
    const meshes: THREE.Mesh[] = [];
    const ancestors = new Set<THREE.Object3D>();
    for (const c of containers) {
      ancestors.add(c);
      let p: THREE.Object3D | null = c.parent;
      while (p && p !== modelRoot) { ancestors.add(p); p = p.parent; }
      c.traverse((n) => {
        if (n instanceof THREE.Mesh && n.geometry) meshes.push(n);
      });
    }
    if (meshes.length < 4) return false;

    // ── Compute partition origin from the WHEEL CLUSTER itself ──────────────
    // Using the chassis bbox centre can mis-classify wheel fragments on cars
    // with very asymmetric bodywork (e.g. Porsche 911 GT3: rear-engine mass
    // + low front splitter pulls the chassis-bbox centroid forward, so some
    // rear-left fragments fall into the RR bucket and helpers land off-corner).
    // Use median X / median Z of the wheel mesh centres — this is exactly
    // halfway between the 4 wheel rows by construction, regardless of body
    // shape, and is robust to any number of fragments per corner.
    type Quad = "FL" | "FR" | "RL" | "RR";
    const meshCenters: { mesh: THREE.Mesh; center: THREE.Vector3; box: THREE.Box3 }[] = [];
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      const b = new THREE.Box3().setFromObject(m);
      if (b.isEmpty()) continue;
      meshCenters.push({ mesh: m, center: b.getCenter(new THREE.Vector3()), box: b });
    }
    if (meshCenters.length < 4) return false;

    const median = (vals: number[]) => {
      const s = [...vals].sort((a, b) => a - b);
      const n = s.length;
      return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
    };
    const splitX = median(meshCenters.map((mc) => mc.center.x));
    const splitZ = median(meshCenters.map((mc) => mc.center.z));

    const buckets: Record<Quad, { meshes: THREE.Mesh[]; box: THREE.Box3 }> = {
      FL: { meshes: [], box: new THREE.Box3() },
      FR: { meshes: [], box: new THREE.Box3() },
      RL: { meshes: [], box: new THREE.Box3() },
      RR: { meshes: [], box: new THREE.Box3() },
    };
    for (const mc of meshCenters) {
      const left = mc.center.x - splitX > 0; // +X = LEFT (matches autoRepair convention)
      const front = mc.center.z - splitZ > 0; // +Z = FRONT
      const q: Quad = ((front ? "F" : "R") + (left ? "L" : "R")) as Quad;
      buckets[q].meshes.push(mc.mesh);
      buckets[q].box.union(mc.box);
    }

    const quads: Quad[] = ["FL", "FR", "RL", "RR"];
    if (quads.some((q) => buckets[q].meshes.length === 0)) {
      console.warn(`[CarLoader] ${carId}: Sketchfab merged-wheel partition missing a quadrant`, {
        splitX, splitZ,
        counts: quads.reduce((o, q) => ((o[q] = buckets[q].meshes.length), o), {} as Record<string, number>),
      });
      return false;
    }


    // Build 4 helper pivots at each quadrant's true wheel centre (chassis-local).
    // We also tag each helper with the correct local spin axis and rolling
    // radius, computed directly in chassis-local space. This bypasses the
    // generic world-bbox heuristics in WheelSystem.setupAssembly which can
    // misclassify the spin axis on Sketchfab cars that stack multiple
    // Y-up/Z-up coordinate swaps above the wheel meshes (e.g. Porsche 911 GT3
    // has three nested coordinate swaps; Ferrari has one).
    modelRoot.updateMatrixWorld(true);
    const localTmp = new THREE.Vector3();
    for (const q of quads) {
      const wb = buckets[q].box;
      const worldCentre = wb.getCenter(new THREE.Vector3());

      // Compute the cluster bbox in CHASSIS-LOCAL space (not world space).
      const localBox = new THREE.Box3();
      for (const m of buckets[q].meshes) {
        m.updateWorldMatrix(true, false);
        const mb = new THREE.Box3().setFromObject(m);
        if (mb.isEmpty()) continue;
        const corners = [
          new THREE.Vector3(mb.min.x, mb.min.y, mb.min.z),
          new THREE.Vector3(mb.min.x, mb.min.y, mb.max.z),
          new THREE.Vector3(mb.min.x, mb.max.y, mb.min.z),
          new THREE.Vector3(mb.min.x, mb.max.y, mb.max.z),
          new THREE.Vector3(mb.max.x, mb.min.y, mb.min.z),
          new THREE.Vector3(mb.max.x, mb.min.y, mb.max.z),
          new THREE.Vector3(mb.max.x, mb.max.y, mb.min.z),
          new THREE.Vector3(mb.max.x, mb.max.y, mb.max.z),
        ];
        for (const c of corners) {
          modelRoot.worldToLocal(c);
          localBox.expandByPoint(c);
        }
      }

      const helper = new THREE.Group();
      helper.name = `helper_wheel_${q}`;
      modelRoot.worldToLocal(localTmp.copy(worldCentre));
      helper.position.copy(localTmp);

      // Chassis-local layout for these GLBs: X = lateral (axle), Y = vertical,
      // Z = forward/back. Rolling diameter spans Y and Z; axle is X.
      const localSize = new THREE.Vector3();
      if (!localBox.isEmpty()) localBox.getSize(localSize);
      const rollingDiameter = Math.max(localSize.y, localSize.z);
      const wheelRadius = THREE.MathUtils.clamp(rollingDiameter * 0.5, 0.28, 0.48);
      helper.userData.forcedSpinAxisLocal = new THREE.Vector3(1, 0, 0);
      helper.userData.forcedWheelRadius = wheelRadius;

      modelRoot.add(helper);
      modelRoot.updateMatrixWorld(true);
      for (const m of buckets[q].meshes) helper.attach(m); // preserves world xform
    }

    // Rename the original ancestor containers so the downstream wheel-name walk
    // can no longer match them and only sees our 4 helper_wheel_* groups.
    for (const a of ancestors) {
      if (a.name) a.name = a.name.replace(/wheel|tire|tyre|rim|pneu/gi, "wh1");
    }

    console.log(
      `[CarLoader] ${carId}: Sketchfab merged-wheel rebuild → ` +
        quads.map((q) => `${q}=${buckets[q].meshes.length}`).join(" "),
    );
    return true;
  }

  private static collectWheelRoots(modelRoot: THREE.Object3D): THREE.Object3D[] {
    const wheelTerms = ["helper_wheel", "wheel", "tire", "tyre", "rim", "pneu", "col_w"];
    const forbiddenTerms = ["caliper", "disc", "brake", "rotor", "drum", "arch", "housing", "well", "fender", "shadow", "lod", "collision"];
    const detected: THREE.Object3D[] = [];
    const boneDetected: THREE.Object3D[] = [];

    modelRoot.traverse((node) => {
      const nl = node.name.toLowerCase();
      const isMatch = wheelTerms.some((t) => nl.includes(t)) && !forbiddenTerms.some((t) => nl.includes(t));
      if (!isMatch) return;

      if (node instanceof THREE.Bone) {
        if (!boneDetected.includes(node)) boneDetected.push(node);
        return;
      }

      let root = node;
      while (root.parent && root.parent !== modelRoot) {
        const parentName = root.parent.name.toLowerCase();
        const parentWheel = wheelTerms.some((t) => parentName.includes(t));
        const parentForbidden = forbiddenTerms.some((t) => parentName.includes(t));
        if (parentWheel && !parentForbidden) root = root.parent;
        else break;
      }

      if (!detected.includes(root)) detected.push(root);
    });

    // Bone rigs are authoritative: animate the bones directly rather than
    // wrapping/moving the visual wheel meshes.
    return boneDetected.length >= 4 ? boneDetected : detected;
  }

  /**
   * Clones and prepares a high-performance GLTF car model, setting up shadows,
   * materials, detecting wheels/lights, and creating the WheelSystem hierarchy.
   *
   * FIX: Bounding box is computed with wheel meshes hidden so that the chassis
   * height (finalY) is not inflated by wheel geometry sticking out below/above.
   */
  public static loadAndPrepareCar(carId: string, carGroup: THREE.Group): LoadedCarAsset | null {
    if (CarLoader.failedCarIds.has(CarLoader.failKey(carId))) return null;
    if (!gltfModelCache.isLoaded) return null;

    const modelSource = getCarModelForId(carId);
    if (!modelSource) return null;
    const modelKey =
      modelSource === gltfModelCache.porsche_911_gt3
        ? "porsche_911_gt3"
        : modelSource === gltfModelCache.ferrari_purosangue
          ? "ferrari_purosangue"
          : modelSource === gltfModelCache.bugatti_chiron_top_edition
            ? "bugatti_chiron_top_edition"
            : carId;

    const clonedModel = modelSource.clone();
    clonedModel.name = "gltf_car_model";
    clonedModel.updateMatrixWorld(true);

    // Deep-clone materials per instance. THREE's Object3D.clone() shares
    // materials by default — without this, painting one car (or one car's
    // brake lights) mutates the cached source group and bleeds into every
    // other vehicle that was cloned from the same GLB.
    clonedModel.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.computeBoundingBox();
        if (Array.isArray(node.material)) {
          node.material = node.material.map((m) => (m ? m.clone() : m));
        } else if (node.material) {
          node.material = node.material.clone();
        }
      }
    });

    // --- Collect wheel meshes so we can hide them when computing chassis bounds ---
    const wheelTerms = ["helper_wheel", "wheel", "tire", "tyre", "rim", "pneu", "col_w"];
    const forbiddenTerms = ["caliper", "disc", "brake", "rotor", "drum", "arch", "housing", "well", "fender"];
    const wheelMeshes: THREE.Object3D[] = [];

    clonedModel.traverse((node) => {
      const nl = node.name.toLowerCase();
      if (wheelTerms.some((t) => nl.includes(t)) && !forbiddenTerms.some((t) => nl.includes(t))) {
        wheelMeshes.push(node);
      }
    });

    // Hide wheels before measuring chassis height so the box reflects only
    // the body/chassis and is not pulled down by tyre geometry.
    wheelMeshes.forEach((w) => {
      w.visible = false;
    });
    const box = new THREE.Box3().setFromObject(clonedModel);
    const size = box.getSize(new THREE.Vector3());
    // Restore visibility immediately
    wheelMeshes.forEach((w) => {
      w.visible = true;
    });

    const center = new THREE.Vector3();
    box.getCenter(center);

    // Place chassis so its bottom rests at Y=0
    const finalY = -box.min.y;

    clonedModel.userData.boundingBox = box;
    clonedModel.userData.height = size.y;
    clonedModel.userData.initialY = finalY;

    clonedModel.position.x -= center.x;
    clonedModel.position.z -= center.z;
    clonedModel.position.y = finalY;

    // Per-car preprocessing: rebuild Sketchfab "merged-wheels" hierarchies
    // (Ferrari Purosangue, Porsche 911 GT3, …) into 4 proper helper pivots
    // BEFORE the generic wheel-root walk runs. This leaves the Bugatti — which
    // has no such hierarchy — completely untouched and routed through the
    // working geometry-based path.
    CarLoader.preprocessSketchfabMergedWheels(clonedModel, modelKey);

    // Collect wheel root nodes for WheelSystem (before attaching to scene).
    // Detection is intentionally strict: unsafe fallback positions are never
    // used, because bad wheel transforms are worse than refusing the GLB.
    let detectedWheels = CarLoader.collectWheelRoots(clonedModel);

    carGroup.add(clonedModel);
    clonedModel.updateMatrixWorld(true);

    // Auto-repair pass: if the GLB exposes fewer than 4 distinct wheel roots
    // (merged geometry, missing names, no per-corner pivots), cluster mesh
    // centers into FL/FR/RL/RR and generate helper pivot groups so the
    // WheelSystem's 4-wheel contract is always satisfied.
    if (detectedWheels.length !== 4) {
      const report = autoRepairWheels(clonedModel);
      if (report.helpers.length > 0) {
        console.log(
          `[CarLoader] Wheel auto-repair for "${carId}": ` +
            `byName=${report.detectedByName} byGeometry=${report.detectedByGeometry} ` +
            `quadrants=${JSON.stringify(report.quadrants)}` +
            (report.missing.length ? ` !! missing=${report.missing.join(",")}` : ""),
        );
        detectedWheels = CarLoader.collectWheelRoots(clonedModel);
      } else {
        CarLoader.reportVehicleLoadError(carId, `Cannot load ${carId}: no usable wheel geometry was detected.`);
        carGroup.remove(clonedModel);
        return null;
      }
    }

    if (detectedWheels.length !== 4) {
      CarLoader.reportVehicleLoadError(
        carId,
        `Cannot load ${carId}: expected exactly 4 wheel roots, detected ${detectedWheels.length}.`,
      );
      carGroup.remove(clonedModel);
      return null;
    }

    const wheelSystem = new WheelSystem(detectedWheels, clonedModel);

    if (!wheelSystem.isValid) {
      CarLoader.reportVehicleLoadError(
        carId,
        `Cannot load ${carId}: detected ${wheelSystem.debugInfo.length}/4 wheel assemblies. Check GLB wheel names or pivots.`,
      );
      carGroup.remove(clonedModel);
      return null;
    }

    console.groupCollapsed(`[CarLoader] ${carId} wheel rig verified`);
    console.log("Chassis transform", {
      position: clonedModel.position.toArray(),
      rotation: clonedModel.rotation.toArray(),
      scale: clonedModel.scale.toArray(),
    });
    wheelSystem.debugInfo.forEach((w) => {
      console.log(`${w.slot} wheel`, {
        name: w.name,
        localPosition: w.localPosition.toArray(),
        parent: w.parentName,
        mode: w.mode,
      });
    });
    console.groupEnd();


    const brakeLights: THREE.Material[] = [];
    const headlights: THREE.Mesh[] = [];

    clonedModel.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.visible = true;
        node.frustumCulled = false;
        node.castShadow = carId === "player";
        node.receiveShadow = true;

        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((mat) => {
          if (!mat) return;
          if (mat.emissive && typeof mat.emissive.set === "function") mat.emissive.set(0x000000);
          mat.emissiveIntensity = 0;
          mat.roughness = 0.5;
          mat.metalness = 0.8;

          const mn = mat.name.toLowerCase();
          if (mn.includes("brakelight") || mn.includes("taillight") || mn.includes("brake_light")) {
            brakeLights.push(mat);
          }
        });

        const meshName = node.name.toLowerCase();
        if (meshName.includes("headlight")) headlights.push(node);
      }
    });

    // Crisp textures across all car materials: anisotropic filtering + sRGB color space.
    try {
      const renderer = (window as any).__renderer as THREE.WebGLRenderer | undefined;
      if (renderer) upgradeTextures(clonedModel, renderer);
    } catch {}

    return { model: clonedModel, wheelSystem, brakeLights, headlights, height: size.y };
  }
}
