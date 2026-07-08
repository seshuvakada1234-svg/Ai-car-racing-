import * as THREE from "three";

export function convertMaterialToStandard(mat: any): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  if (!mat) return mat;

  // Check emergency fallback (forced Lambert)
  const isEmergency = (window as any).useEmergencyLambert === true;

  if (isEmergency) {
    const lambert = new THREE.MeshLambertMaterial();
    if (mat.color) lambert.color.copy(mat.color);
    if (mat.map) lambert.map = mat.map;
    try {
      mat.dispose();
    } catch (e) {}
    return lambert;
  }

  if (mat instanceof THREE.MeshPhysicalMaterial || mat.isMeshPhysicalMaterial || mat.type === "MeshPhysicalMaterial") {
    const stdMat = new THREE.MeshStandardMaterial();

    try {
      THREE.Material.prototype.copy.call(stdMat, mat); // copy common properties
    } catch (e) {}

    if (mat.color) stdMat.color.copy(mat.color);
    stdMat.roughness = typeof mat.roughness === "number" ? mat.roughness : 0.5;
    stdMat.metalness = typeof mat.metalness === "number" ? mat.metalness : 0.5;
    if (mat.map) stdMat.map = mat.map;
    if (mat.normalMap) {
      stdMat.normalMap = mat.normalMap;
      if (mat.normalScale) stdMat.normalScale.copy(mat.normalScale);
    }
    if (mat.roughnessMap) stdMat.roughnessMap = mat.roughnessMap;
    if (mat.metalnessMap) stdMat.metalnessMap = mat.metalnessMap;
    if (mat.aoMap) {
      stdMat.aoMap = mat.aoMap;
      stdMat.aoMapIntensity = mat.aoMapIntensity;
    }
    if (mat.emissive) {
      stdMat.emissive.copy(mat.emissive);
      stdMat.emissiveIntensity = mat.emissiveIntensity;
    }
    if (mat.envMap) stdMat.envMap = mat.envMap;
    if (mat.envMapIntensity !== undefined) stdMat.envMapIntensity = mat.envMapIntensity;

    // Explicitly disable physical attributes to dodge WebGL compilation issues & GPU overhead
    (stdMat as any).clearcoat = 0;
    (stdMat as any).transmission = 0;
    (stdMat as any).sheen = 0;
    (stdMat as any).iridescence = 0;
    (stdMat as any).thickness = 0;
    (stdMat as any).specularIntensity = 0;

    try {
      mat.dispose();
    } catch (e) {}

    return stdMat;
  } else if (
    mat instanceof THREE.MeshStandardMaterial ||
    mat.isMeshStandardMaterial ||
    mat.type === "MeshStandardMaterial"
  ) {
    // Disable physical material extensions on standard materials too
    (mat as any).clearcoat = 0;
    (mat as any).transmission = 0;
    (mat as any).sheen = 0;
    (mat as any).iridescence = 0;
    (mat as any).thickness = 0;
    (mat as any).specularIntensity = 0;
    return mat;
  }

  return mat;
}

export function applyGltfMaterialFix(object: THREE.Object3D): void {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      // Depth & distance material removals
      node.customDepthMaterial = undefined;
      node.customDistanceMaterial = undefined;
      node.castShadow = true;
      node.receiveShadow = true;

      if (Array.isArray(node.material)) {
        node.material = node.material.map(convertMaterialToStandard);
      } else {
        node.material = convertMaterialToStandard(node.material);
      }
    }
  });
}
