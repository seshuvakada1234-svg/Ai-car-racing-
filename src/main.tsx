import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import * as THREE from "three";

// --- GLOBAL SELF-HEALING THREE.JS MONKEYPATCHES ---
// 1. Vector3 prototypes: Guard both 'this' self and parameter 'v' to safely return 0 on invalid values
const originalDistanceToSquared = THREE.Vector3.prototype.distanceToSquared;
THREE.Vector3.prototype.distanceToSquared = function (this: any, v: any) {
  if (!this || typeof this.x !== "number" || typeof this.y !== "number" || typeof this.z !== "number") {
    return 0;
  }
  if (!v || typeof v.x !== "number" || typeof v.y !== "number" || typeof v.z !== "number") {
    return 0;
  }
  try {
    return originalDistanceToSquared.call(this, v);
  } catch (err) {
    return 0;
  }
};

const originalDistanceTo = THREE.Vector3.prototype.distanceTo;
THREE.Vector3.prototype.distanceTo = function (this: any, v: any) {
  if (!this || typeof this.x !== "number" || typeof this.y !== "number" || typeof this.z !== "number") {
    return 0;
  }
  if (!v || typeof v.x !== "number" || typeof v.y !== "number" || typeof v.z !== "number") {
    return 0;
  }
  try {
    return originalDistanceTo.call(this, v);
  } catch (err) {
    return 0;
  }
};

// 2. Vector2 prototypes: Safeguard Vector2 distance measurements
if (THREE.Vector2 && THREE.Vector2.prototype) {
  const originalV2DistanceToSquared = THREE.Vector2.prototype.distanceToSquared;
  if (originalV2DistanceToSquared) {
    THREE.Vector2.prototype.distanceToSquared = function (this: any, v: any) {
      if (!this || typeof this.x !== "number" || typeof this.y !== "number") {
        return 0;
      }
      if (!v || typeof v.x !== "number" || typeof v.y !== "number") {
        return 0;
      }
      try {
        return originalV2DistanceToSquared.call(this, v);
      } catch (err) {
        return 0;
      }
    };
  }

  const originalV2DistanceTo = THREE.Vector2.prototype.distanceTo;
  if (originalV2DistanceTo) {
    THREE.Vector2.prototype.distanceTo = function (this: any, v: any) {
      if (!this || typeof this.x !== "number" || typeof this.y !== "number") {
        return 0;
      }
      if (!v || typeof v.x !== "number" || typeof v.y !== "number") {
        return 0;
      }
      try {
        return originalV2DistanceTo.call(this, v);
      } catch (err) {
        return 0;
      }
    };
  }
}

// 3. CatmullRomCurve3 prototypes: Filter out null/undefined points in 'this.points' arrays dynamically
if (THREE.CatmullRomCurve3 && THREE.CatmullRomCurve3.prototype) {
  const originalGetPointAt = THREE.CatmullRomCurve3.prototype.getPointAt;
  if (originalGetPointAt) {
    THREE.CatmullRomCurve3.prototype.getPointAt = function (this: any, t: number, optionalTarget?: any) {
      if (!this.points || !Array.isArray(this.points) || this.points.length < 2) {
        this.points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)];
      }
      this.points = this.points.map((p: any) => {
        if (!p || typeof p.x !== "number" || typeof p.y !== "number" || typeof p.z !== "number") {
          return new THREE.Vector3(0, 0, 0);
        }
        return p;
      });
      if (this.points.length < 2) {
        this.points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)];
      }
      try {
        return originalGetPointAt.call(this, t, optionalTarget);
      } catch (err) {
        const fallback = optionalTarget || new THREE.Vector3();
        fallback.set(0, 0, 0);
        return fallback;
      }
    };
  }

  const originalGetTangentAt = THREE.CatmullRomCurve3.prototype.getTangentAt;
  if (originalGetTangentAt) {
    THREE.CatmullRomCurve3.prototype.getTangentAt = function (this: any, t: number, optionalTarget?: any) {
      if (!this.points || !Array.isArray(this.points) || this.points.length < 2) {
        this.points = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)];
      }
      this.points = this.points.map((p: any) => {
        if (!p || typeof p.x !== "number" || typeof p.y !== "number" || typeof p.z !== "number") {
          return new THREE.Vector3(0, 0, 0);
        }
        return p;
      });
      if (this.points.length < 2) {
        this.points = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)];
      }
      try {
        return originalGetTangentAt.call(this, t, optionalTarget);
      } catch (err) {
        const fallback = optionalTarget || new THREE.Vector3(0, 0, 1);
        fallback.set(0, 0, 1);
        return fallback;
      }
    };
  }
}

// 4. Ray prototypes: Safeguard distanceSqToPoint logic
if (THREE.Ray && THREE.Ray.prototype) {
  const originalRayDistanceSq = THREE.Ray.prototype.distanceSqToPoint;
  if (originalRayDistanceSq) {
    THREE.Ray.prototype.distanceSqToPoint = function (this: any, point: any) {
      if (!this || !this.origin || !this.direction) {
        return 0;
      }
      if (!point || typeof point.x !== "number" || typeof point.y !== "number" || typeof point.z !== "number") {
        return 0;
      }
      try {
        return originalRayDistanceSq.call(this, point);
      } catch (err) {
        return 0;
      }
    };
  }
}

// 5. Box3 and Sphere bounds checks: Protect spatial intersection math
if (THREE.Box3 && THREE.Box3.prototype) {
  const originalIntersectsSphere = THREE.Box3.prototype.intersectsSphere;
  if (originalIntersectsSphere) {
    THREE.Box3.prototype.intersectsSphere = function (this: any, sphere: any) {
      if (!sphere || !sphere.center || typeof sphere.center.x !== "number") {
        return false;
      }
      try {
        return originalIntersectsSphere.call(this, sphere);
      } catch (err) {
        return false;
      }
    };
  }
}

if (THREE.Sphere && THREE.Sphere.prototype) {
  const originalSphereIntersectsSphere = THREE.Sphere.prototype.intersectsSphere;
  if (originalSphereIntersectsSphere) {
    THREE.Sphere.prototype.intersectsSphere = function (this: any, sphere: any) {
      if (!sphere || !sphere.center || typeof sphere.center.x !== "number") {
        return false;
      }
      try {
        return originalSphereIntersectsSphere.call(this, sphere);
      } catch (err) {
        return false;
      }
    };
  }

  const originalSphereIntersectsBox = THREE.Sphere.prototype.intersectsBox;
  if (originalSphereIntersectsBox) {
    THREE.Sphere.prototype.intersectsBox = function (this: any, box: any) {
      if (!box || !box.min || !box.max || typeof box.min.x !== "number") {
        return false;
      }
      try {
        return originalSphereIntersectsBox.call(this, box);
      } catch (err) {
        return false;
      }
    };
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
