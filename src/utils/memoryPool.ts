import * as THREE from "three";

export class MemoryPool {
  private static vectors: THREE.Vector3[] = [];
  private static vectorIndex = 0;

  private static quaternions: THREE.Quaternion[] = [];
  private static quaternionIndex = 0;

  private static eulers: THREE.Euler[] = [];
  private static eulerIndex = 0;

  private static matrices: THREE.Matrix4[] = [];
  private static matrixIndex = 0;

  static {
    // Warm up the pool with preallocated structures
    for (let i = 0; i < 200; i++) {
      this.vectors.push(new THREE.Vector3());
      this.quaternions.push(new THREE.Quaternion());
      this.eulers.push(new THREE.Euler());
      this.matrices.push(new THREE.Matrix4());
    }
  }

  // Common reused scratchpads for quick access anywhere
  public static readonly tempVecA = new THREE.Vector3();
  public static readonly tempVecB = new THREE.Vector3();
  public static readonly tempVecC = new THREE.Vector3();
  public static readonly tempVecD = new THREE.Vector3();

  public static readonly tempRotA = new THREE.Euler();
  public static readonly tempQuatA = new THREE.Quaternion();
  public static readonly tempQuatB = new THREE.Quaternion();

  public static readonly tempBox = new THREE.Box3();
  public static readonly tempRay = new THREE.Raycaster();

  public static getVector(): THREE.Vector3 {
    const v = this.vectors[this.vectorIndex];
    v.set(0, 0, 0);
    this.vectorIndex = (this.vectorIndex + 1) % this.vectors.length;
    return v;
  }

  public static getQuaternion(): THREE.Quaternion {
    const q = this.quaternions[this.quaternionIndex];
    q.set(0, 0, 0, 1);
    this.quaternionIndex = (this.quaternionIndex + 1) % this.quaternions.length;
    return q;
  }

  public static getEuler(): THREE.Euler {
    const e = this.eulers[this.eulerIndex];
    e.set(0, 0, 0, "XYZ");
    this.eulerIndex = (this.eulerIndex + 1) % this.eulers.length;
    return e;
  }

  public static getMatrix(): THREE.Matrix4 {
    const m = this.matrices[this.matrixIndex];
    m.identity();
    this.matrixIndex = (this.matrixIndex + 1) % this.matrices.length;
    return m;
  }
}
