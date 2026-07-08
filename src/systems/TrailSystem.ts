import * as THREE from "three";
import { CarState } from "../types";

export class RibbonTrail {
  public geometry: THREE.BufferGeometry;
  public mesh: THREE.Mesh;
  public positions: THREE.Vector3[] = [];
  public maxPoints: number;
  public thickness: number;

  constructor(scene: THREE.Scene, colorHex: string, maxPoints = 20, thickness = 0.22) {
    this.maxPoints = maxPoints;
    this.thickness = thickness;
    this.geometry = new THREE.BufferGeometry();

    const vertexCount = maxPoints * 2;
    const indexCount = (maxPoints - 1) * 6;

    const posArr = new Float32Array(vertexCount * 3);
    const colArr = new Float32Array(vertexCount * 3);
    const indicesArr = new Uint16Array(indexCount);

    for (let i = 0; i < maxPoints - 1; i++) {
      const v0 = i * 2;
      const v1 = i * 2 + 1;
      const v2 = (i + 1) * 2;
      const v3 = (i + 1) * 2 + 1;

      const idx = i * 6;
      indicesArr[idx] = v0;
      indicesArr[idx + 1] = v1;
      indicesArr[idx + 2] = v2;

      indicesArr[idx + 3] = v1;
      indicesArr[idx + 4] = v3;
      indicesArr[idx + 5] = v2;
    }

    this.geometry.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(indicesArr, 1));

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, mat);
    this.mesh.visible = false; // Disable all trail rendering and make them invisible
    // scene.add(this.mesh); // Do not add to the scene to guarantee they are completely removed from the game
  }

  public addPoint(pos: THREE.Vector3, colorHex: string): void {
    // Return early to disable expanding and computing trail geometry
    return;
  }

  public clear(): void {
    if (this.positions.length === 0) return;
    this.positions = [];
    const posAttr = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setXYZ(i, 9999, 9999, 9999);
      colAttr.setXYZ(i, 0, 0, 0);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  public updateGeometry(colorHex: string): void {
    const posAttr = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute("color") as THREE.BufferAttribute;

    const pts = this.positions;
    const len = pts.length;
    const baseColor = new THREE.Color(colorHex);

    for (let i = 0; i < this.maxPoints; i++) {
      const v0 = i * 2;
      const v1 = i * 2 + 1;

      if (i < len) {
        const pt = pts[i];
        posAttr.setXYZ(v0, pt.x, pt.y - this.thickness / 2, pt.z);
        posAttr.setXYZ(v1, pt.x, pt.y + this.thickness / 2, pt.z);

        const ratio = i / (len - 1 || 1);
        const intensity = ratio * ratio * ratio;

        colAttr.setXYZ(v0, baseColor.r * intensity, baseColor.g * intensity, baseColor.b * intensity);
        colAttr.setXYZ(v1, baseColor.r * intensity, baseColor.g * intensity, baseColor.b * intensity);
      } else {
        posAttr.setXYZ(v0, 9999, 9999, 9999);
        posAttr.setXYZ(v1, 9999, 9999, 9999);
        colAttr.setXYZ(v0, 0, 0, 0);
        colAttr.setXYZ(v1, 0, 0, 0);
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  public dispose(): void {
    this.geometry.dispose();
    if (Array.isArray(this.mesh.material)) {
      this.mesh.material.forEach((m) => m.dispose());
    } else {
      this.mesh.material.dispose();
    }
  }
}

export class TrailSystem {
  private scene: THREE.Scene;

  // Track map lists of actual Ribbon Trails
  public leftTailMap = new Map<string, RibbonTrail>();
  public rightTailMap = new Map<string, RibbonTrail>();
  public leftExhaustMap = new Map<string, RibbonTrail>();
  public rightExhaustMap = new Map<string, RibbonTrail>();

  // Reusable vectors for zero allocation updates
  private _lx = new THREE.Vector3();
  private _rx = new THREE.Vector3();
  private _elx = new THREE.Vector3();
  private _erx = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public registerCar(carId: string): void {
    if (this.leftTailMap.has(carId)) return;

    this.leftTailMap.set(carId, new RibbonTrail(this.scene, "#ff0a26", 18, 0.22));
    this.rightTailMap.set(carId, new RibbonTrail(this.scene, "#ff0a26", 18, 0.22));
    this.leftExhaustMap.set(carId, new RibbonTrail(this.scene, "#00e5ff", 12, 0.16));
    this.rightExhaustMap.set(carId, new RibbonTrail(this.scene, "#00e5ff", 12, 0.16));
  }

  /**
   * Translates dynamic car positions to dual neon ribbons and nitrous exhausts.
   */
  public update(cars: CarState[], elapsedSec: number): void {
    cars.forEach((c) => {
      if (!c || !c.position) return;

      this.registerCar(c.id);

      const lTail = this.leftTailMap.get(c.id);
      const rTail = this.rightTailMap.get(c.id);
      const lEx = this.leftExhaustMap.get(c.id);
      const rEx = this.rightExhaustMap.get(c.id);

      if (!lTail || !rTail) return;

      const cosA = Math.cos(c.angle);
      const sinA = Math.sin(c.angle);
      const isTraffic = c.id.startsWith("traffic");
      const groupScale = isTraffic ? 1.25 : 1.4;

      const localLX = -0.55 * groupScale;
      const localLZ = -1.95 * groupScale;

      const lxVal = c.position.x + localLX * cosA + localLZ * sinA;
      const lyVal = c.position.y + 0.44 * groupScale;
      const lzVal = c.position.z - localLX * sinA + localLZ * cosA;

      const rxVal = c.position.x - localLX * cosA + localLZ * sinA;
      const ryVal = c.position.y + 0.44 * groupScale;
      const rzVal = c.position.z + localLX * sinA + localLZ * cosA;

      this._lx.set(lxVal, lyVal, lzVal);
      this._rx.set(rxVal, ryVal, rzVal);

      const speedKmh = Math.abs(c.speed) * 3.6;
      const isBraking = c.id === "player" ? false : c.speed < 18 && Math.random() > 0.4;

      if (speedKmh > 20) {
        const activeTailColor = isBraking ? "#ff000a" : "#8c010d";
        lTail.addPoint(this._lx, activeTailColor);
        rTail.addPoint(this._rx, activeTailColor);
      } else {
        lTail.clear();
        rTail.clear();
      }

      if (lEx && rEx) {
        if (c.isNitroActive && speedKmh > 30) {
          const exLX = -0.38 * groupScale;
          const exLZ = -1.92 * groupScale;
          const activeExColor = Math.random() > 0.45 ? "#00f0ff" : "#7200ff";

          const elxVal = c.position.x + exLX * cosA + exLZ * sinA;
          const elyVal = c.position.y + 0.24 * groupScale;
          const elzVal = c.position.z - exLX * sinA + exLZ * cosA;

          const erxVal = c.position.x - exLX * cosA + exLZ * sinA;
          const eryVal = c.position.y + 0.24 * groupScale;
          const erzVal = c.position.z + exLX * sinA + exLZ * cosA;

          this._elx.set(elxVal, elyVal, elzVal);
          this._erx.set(erxVal, eryVal, erzVal);

          lEx.addPoint(this._elx, activeExColor);
          rEx.addPoint(this._erx, activeExColor);
        } else {
          lEx.clear();
          rEx.clear();
        }
      }
    });
  }

  public destroy(): void {
    this.leftTailMap.forEach((v) => v.dispose());
    this.rightTailMap.forEach((v) => v.dispose());
    this.leftExhaustMap.forEach((v) => v.dispose());
    this.rightExhaustMap.forEach((v) => v.dispose());

    this.leftTailMap.clear();
    this.rightTailMap.clear();
    this.leftExhaustMap.clear();
    this.rightExhaustMap.clear();
  }
}
export default TrailSystem;
