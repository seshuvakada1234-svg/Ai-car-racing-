import * as THREE from "three";

export interface ScenerySector {
  name: string;
  center: THREE.Vector3;
  group: THREE.Object3D | null;
  nearDistance: number; // Distance within which we run Full Detail
  farDistance: number; // Distance beyond which we set visible = false
  detailMeshes: THREE.Object3D[]; // Precomputed cache of detail-toggled nodes
}

export class LODManager {
  private static instance: LODManager | null = null;
  private sectors: ScenerySector[] = [];

  private constructor() {}

  public static getInstance(): LODManager {
    if (!LODManager.instance) {
      LODManager.instance = new LODManager();
    }
    return LODManager.instance;
  }

  public clear(): void {
    this.sectors = [];
  }

  /**
   * Registers a scenery sector group with its central coordinate
   */
  public registerSector(
    name: string,
    centerX: number,
    centerY: number,
    centerZ: number,
    group: THREE.Object3D,
    nearDistance = 50,
    farDistance = 250,
  ): void {
    if (this.sectors.some((s) => s.name === name || s.group === group)) {
      return;
    }
    const detailMeshes: THREE.Object3D[] = [];

    // Perform tree walk once at registration to cache target detail nodes
    group.traverse((child) => {
      if (
        child.name &&
        (child.name.includes("detail") ||
          child.name.includes("bench") ||
          child.name.includes("post") ||
          child.name.includes("lantern") ||
          child.name.includes("lamp_pole"))
      ) {
        detailMeshes.push(child);
      }
    });

    const finalFarDistance = 250; // Universal 250m cull boundary
    const finalNearDistance = 50; // Universal 50m detail boundary (LOD0: 0-50m)

    this.sectors.push({
      name,
      center: new THREE.Vector3(centerX, centerY, centerZ),
      group,
      nearDistance: finalNearDistance,
      farDistance: finalFarDistance,
      detailMeshes,
    });
    console.log(
      `Registered Scenery LOD Sector: ${name} (far: ${finalFarDistance}m, detailed segments cached: ${detailMeshes.length})`,
    );
  }

  /**
   * Evaluates player distance and updates visibility recursively based on:
   * LOD0: 0-50m (full details)
   * LOD1: 50-120m (sector visible, details hidden)
   * LOD2: 120-250m (sector visible, details hidden)
   * Beyond 250m: hide objects completely
   */
  public update(playerPos: THREE.Vector3): void {
    if (!playerPos || typeof playerPos.distanceTo !== "function") return;

    for (let i = 0; i < this.sectors.length; i++) {
      const sector = this.sectors[i];
      if (!sector.group || !sector.center) continue;

      const dist = playerPos.distanceTo(sector.center);

      if (dist > 250) {
        // Beyond 250m: hide objects completely
        if (sector.group.visible) {
          sector.group.visible = false;
        }
      } else {
        // Load into frustum
        if (!sector.group.visible) {
          sector.group.visible = true;
        }

        // Apply progressive detail scaling (Level of Detail)
        // LOD0: 0-50m, LOD1: 50-120m, LOD2: 120-250m
        // Show detailed segments only in LOD0 (0-50m)
        const showDetails = dist <= 50;
        const details = sector.detailMeshes;
        const len = details.length;
        for (let idx = 0; idx < len; idx++) {
          const child = details[idx];
          if (child.visible !== showDetails) {
            child.visible = showDetails;
          }
        }
      }
    }
  }
}

export const lodManager = LODManager.getInstance();
