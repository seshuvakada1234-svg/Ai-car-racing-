const StrictMode = __vite__cjsImport0_react["StrictMode"];const createRoot = __vite__cjsImport1_reactDom_client["createRoot"];const _jsxDEV = __vite__cjsImport5_react_jsxDevRuntime["jsxDEV"];import __vite__cjsImport0_react from "/node_modules/.vite/deps/react.js?v=72914033";
import __vite__cjsImport1_reactDom_client from "/node_modules/.vite/deps/react-dom_client.js?v=2e063c79";
import App from "/src/App.tsx?t=1783243845056";
import "/src/index.css?t=1783243845056";
import * as THREE from "/node_modules/.vite/deps/three.js?v=cdbc32b6";
var _jsxFileName = "/app/applet/src/main.tsx";
import __vite__cjsImport5_react_jsxDevRuntime from "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=72914033";
// --- GLOBAL SELF-HEALING THREE.JS MONKEYPATCHES ---
// 1. Vector3 prototypes: Guard both 'this' self and parameter 'v' to safely return 0 on invalid values
const originalDistanceToSquared = THREE.Vector3.prototype.distanceToSquared;
THREE.Vector3.prototype.distanceToSquared = function(v) {
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
THREE.Vector3.prototype.distanceTo = function(v) {
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
		THREE.Vector2.prototype.distanceToSquared = function(v) {
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
		THREE.Vector2.prototype.distanceTo = function(v) {
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
		THREE.CatmullRomCurve3.prototype.getPointAt = function(t, optionalTarget) {
			if (!this.points || !Array.isArray(this.points) || this.points.length < 2) {
				this.points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)];
			}
			this.points = this.points.map((p) => {
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
		THREE.CatmullRomCurve3.prototype.getTangentAt = function(t, optionalTarget) {
			if (!this.points || !Array.isArray(this.points) || this.points.length < 2) {
				this.points = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)];
			}
			this.points = this.points.map((p) => {
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
		THREE.Ray.prototype.distanceSqToPoint = function(point) {
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
		THREE.Box3.prototype.intersectsSphere = function(sphere) {
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
		THREE.Sphere.prototype.intersectsSphere = function(sphere) {
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
		THREE.Sphere.prototype.intersectsBox = function(box) {
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
createRoot(document.getElementById("root")).render(/* @__PURE__ */ _jsxDEV(StrictMode, { children: /* @__PURE__ */ _jsxDEV(App, {}, void 0, false, {
	fileName: _jsxFileName,
	lineNumber: 198,
	columnNumber: 5
}, this) }, void 0, false, {
	fileName: _jsxFileName,
	lineNumber: 197,
	columnNumber: 3
}, this));

//# sourceMappingURL=data:application/json;base64,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QUFPLHlCQUF5QixLQUFLLE1BQU0sTUFBTTtHQUNuRCxTQUFTLEtBQUs7SUFDWixPQUFPO0dBQ1Q7RUFDRjtDQUNGO0FBQ0Y7QUFFQSxJQUFJLE1BQU0sVUFBVSxNQUFNLE9BQU8sV0FBVztDQUMxQyxNQUFNLGlDQUFpQyxNQUFNLE9BQU8sVUFBVTtDQUM5RCxJQUFJLGdDQUFnQztFQUNsQyxNQUFNLE9BQU8sVUFBVSxtQkFBbUIsU0FBcUIsUUFBYTtHQUMxRSxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sVUFBVSxPQUFPLE9BQU8sT0FBTyxNQUFNLFVBQVU7SUFDcEUsT0FBTztHQUNUO0dBQ0EsSUFBSTtJQUNGLE9BQU8sK0JBQStCLEtBQUssTUFBTSxNQUFNO0dBQ3pELFNBQVMsS0FBSztJQUNaLE9BQU87R0FDVDtFQUNGO0NBQ0Y7Q0FFQSxNQUFNLDhCQUE4QixNQUFNLE9BQU8sVUFBVTtDQUMzRCxJQUFJLDZCQUE2QjtFQUMvQixNQUFNLE9BQU8sVUFBVSxnQkFBZ0IsU0FBcUIsS0FBVTtHQUNwRSxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksT0FBTyxDQUFDLElBQUksT0FBTyxPQUFPLElBQUksSUFBSSxNQUFNLFVBQVU7SUFDakUsT0FBTztHQUNUO0dBQ0EsSUFBSTtJQUNGLE9BQU8sNEJBQTRCLEtBQUssTUFBTSxHQUFHO0dBQ25ELFNBQVMsS0FBSztJQUNaLE9BQU87R0FDVDtFQUNGO0NBQ0Y7QUFDRjtBQUVBLFdBQVcsU0FBUyxlQUFlLE1BQU0sQ0FBRSxDQUFDLENBQUMsT0FDM0Msd0JBQUMsWUFBRCxZQUNFLHdCQUFDLEtBQUQsQ0FBTTs7OztTQUNJOzs7O1FBQ2QiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsibWFpbi50c3giXSwidmVyc2lvbiI6Mywic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RyaWN0TW9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHsgY3JlYXRlUm9vdCB9IGZyb20gXCJyZWFjdC1kb20vY2xpZW50XCI7XG5pbXBvcnQgQXBwIGZyb20gXCIuL0FwcC50c3hcIjtcbmltcG9ydCBcIi4vaW5kZXguY3NzXCI7XG5pbXBvcnQgKiBhcyBUSFJFRSBmcm9tIFwidGhyZWVcIjtcblxuLy8gLS0tIEdMT0JBTCBTRUxGLUhFQUxJTkcgVEhSRUUuSlMgTU9OS0VZUEFUQ0hFUyAtLS1cbi8vIDEuIFZlY3RvcjMgcHJvdG90eXBlczogR3VhcmQgYm90aCAndGhpcycgc2VsZiBhbmQgcGFyYW1ldGVyICd2JyB0byBzYWZlbHkgcmV0dXJuIDAgb24gaW52YWxpZCB2YWx1ZXNcbmNvbnN0IG9yaWdpbmFsRGlzdGFuY2VUb1NxdWFyZWQgPSBUSFJFRS5WZWN0b3IzLnByb3RvdHlwZS5kaXN0YW5jZVRvU3F1YXJlZDtcblRIUkVFLlZlY3RvcjMucHJvdG90eXBlLmRpc3RhbmNlVG9TcXVhcmVkID0gZnVuY3Rpb24gKHRoaXM6IGFueSwgdjogYW55KSB7XG4gIGlmICghdGhpcyB8fCB0eXBlb2YgdGhpcy54ICE9PSBcIm51bWJlclwiIHx8IHR5cGVvZiB0aGlzLnkgIT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHRoaXMueiAhPT0gXCJudW1iZXJcIikge1xuICAgIHJldHVybiAwO1xuICB9XG4gIGlmICghdiB8fCB0eXBlb2Ygdi54ICE9PSBcIm51bWJlclwiIHx8IHR5cGVvZiB2LnkgIT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHYueiAhPT0gXCJudW1iZXJcIikge1xuICAgIHJldHVybiAwO1xuICB9XG4gIHRyeSB7XG4gICAgcmV0dXJuIG9yaWdpbmFsRGlzdGFuY2VUb1NxdWFyZWQuY2FsbCh0aGlzLCB2KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cbn07XG5cbmNvbnN0IG9yaWdpbmFsRGlzdGFuY2VUbyA9IFRIUkVFLlZlY3RvcjMucHJvdG90eXBlLmRpc3RhbmNlVG87XG5USFJFRS5WZWN0b3IzLnByb3RvdHlwZS5kaXN0YW5jZVRvID0gZnVuY3Rpb24gKHRoaXM6IGFueSwgdjogYW55KSB7XG4gIGlmICghdGhpcyB8fCB0eXBlb2YgdGhpcy54ICE9PSBcIm51bWJlclwiIHx8IHR5cGVvZiB0aGlzLnkgIT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHRoaXMueiAhPT0gXCJudW1iZXJcIikge1xuICAgIHJldHVybiAwO1xuICB9XG4gIGlmICghdiB8fCB0eXBlb2Ygdi54ICE9PSBcIm51bWJlclwiIHx8IHR5cGVvZiB2LnkgIT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHYueiAhPT0gXCJudW1iZXJcIikge1xuICAgIHJldHVybiAwO1xuICB9XG4gIHRyeSB7XG4gICAgcmV0dXJuIG9yaWdpbmFsRGlzdGFuY2VUby5jYWxsKHRoaXMsIHYpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gMDtcbiAgfVxufTtcblxuLy8gMi4gVmVjdG9yMiBwcm90b3R5cGVzOiBTYWZlZ3VhcmQgVmVjdG9yMiBkaXN0YW5jZSBtZWFzdXJlbWVudHNcbmlmIChUSFJFRS5WZWN0b3IyICYmIFRIUkVFLlZlY3RvcjIucHJvdG90eXBlKSB7XG4gIGNvbnN0IG9yaWdpbmFsVjJEaXN0YW5jZVRvU3F1YXJlZCA9IFRIUkVFLlZlY3RvcjIucHJvdG90eXBlLmRpc3RhbmNlVG9TcXVhcmVkO1xuICBpZiAob3JpZ2luYWxWMkRpc3RhbmNlVG9TcXVhcmVkKSB7XG4gICAgVEhSRUUuVmVjdG9yMi5wcm90b3R5cGUuZGlzdGFuY2VUb1NxdWFyZWQgPSBmdW5jdGlvbiAodGhpczogYW55LCB2OiBhbnkpIHtcbiAgICAgIGlmICghdGhpcyB8fCB0eXBlb2YgdGhpcy54ICE9PSBcIm51bWJlclwiIHx8IHR5cGVvZiB0aGlzLnkgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG4gICAgICBpZiAoIXYgfHwgdHlwZW9mIHYueCAhPT0gXCJudW1iZXJcIiB8fCB0eXBlb2Ygdi55ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIG9yaWdpbmFsVjJEaXN0YW5jZVRvU3F1YXJlZC5jYWxsKHRoaXMsIHYpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICBjb25zdCBvcmlnaW5hbFYyRGlzdGFuY2VUbyA9IFRIUkVFLlZlY3RvcjIucHJvdG90eXBlLmRpc3RhbmNlVG87XG4gIGlmIChvcmlnaW5hbFYyRGlzdGFuY2VUbykge1xuICAgIFRIUkVFLlZlY3RvcjIucHJvdG90eXBlLmRpc3RhbmNlVG8gPSBmdW5jdGlvbiAodGhpczogYW55LCB2OiBhbnkpIHtcbiAgICAgIGlmICghdGhpcyB8fCB0eXBlb2YgdGhpcy54ICE9PSBcIm51bWJlclwiIHx8IHR5cGVvZiB0aGlzLnkgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG4gICAgICBpZiAoIXYgfHwgdHlwZW9mIHYueCAhPT0gXCJudW1iZXJcIiB8fCB0eXBlb2Ygdi55ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIG9yaWdpbmFsVjJEaXN0YW5jZVRvLmNhbGwodGhpcywgdik7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG4gICAgfTtcbiAgfVxufVxuXG4vLyAzLiBDYXRtdWxsUm9tQ3VydmUzIHByb3RvdHlwZXM6IEZpbHRlciBvdXQgbnVsbC91bmRlZmluZWQgcG9pbnRzIGluICd0aGlzLnBvaW50cycgYXJyYXlzIGR5bmFtaWNhbGx5XG5pZiAoVEhSRUUuQ2F0bXVsbFJvbUN1cnZlMyAmJiBUSFJFRS5DYXRtdWxsUm9tQ3VydmUzLnByb3RvdHlwZSkge1xuICBjb25zdCBvcmlnaW5hbEdldFBvaW50QXQgPSBUSFJFRS5DYXRtdWxsUm9tQ3VydmUzLnByb3RvdHlwZS5nZXRQb2ludEF0O1xuICBpZiAob3JpZ2luYWxHZXRQb2ludEF0KSB7XG4gICAgVEhSRUUuQ2F0bXVsbFJvbUN1cnZlMy5wcm90b3R5cGUuZ2V0UG9pbnRBdCA9IGZ1bmN0aW9uICh0aGlzOiBhbnksIHQ6IG51bWJlciwgb3B0aW9uYWxUYXJnZXQ/OiBhbnkpIHtcbiAgICAgIGlmICghdGhpcy5wb2ludHMgfHwgIUFycmF5LmlzQXJyYXkodGhpcy5wb2ludHMpIHx8IHRoaXMucG9pbnRzLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgdGhpcy5wb2ludHMgPSBbbmV3IFRIUkVFLlZlY3RvcjMoMCwgMCwgMCksIG5ldyBUSFJFRS5WZWN0b3IzKDAsIDAsIDApXTtcbiAgICAgIH1cbiAgICAgIHRoaXMucG9pbnRzID0gdGhpcy5wb2ludHMubWFwKChwOiBhbnkpID0+IHtcbiAgICAgICAgaWYgKCFwIHx8IHR5cGVvZiBwLnggIT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHAueSAhPT0gXCJudW1iZXJcIiB8fCB0eXBlb2YgcC56ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBUSFJFRS5WZWN0b3IzKDAsIDAsIDApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwO1xuICAgICAgfSk7XG4gICAgICBpZiAodGhpcy5wb2ludHMubGVuZ3RoIDwgMikge1xuICAgICAgICB0aGlzLnBvaW50cyA9IFtuZXcgVEhSRUUuVmVjdG9yMygwLCAwLCAwKSwgbmV3IFRIUkVFLlZlY3RvcjMoMCwgMCwgMCldO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIG9yaWdpbmFsR2V0UG9pbnRBdC5jYWxsKHRoaXMsIHQsIG9wdGlvbmFsVGFyZ2V0KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zdCBmYWxsYmFjayA9IG9wdGlvbmFsVGFyZ2V0IHx8IG5ldyBUSFJFRS5WZWN0b3IzKCk7XG4gICAgICAgIGZhbGxiYWNrLnNldCgwLCAwLCAwKTtcbiAgICAgICAgcmV0dXJuIGZhbGxiYWNrO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICBjb25zdCBvcmlnaW5hbEdldFRhbmdlbnRBdCA9IFRIUkVFLkNhdG11bGxSb21DdXJ2ZTMucHJvdG90eXBlLmdldFRhbmdlbnRBdDtcbiAgaWYgKG9yaWdpbmFsR2V0VGFuZ2VudEF0KSB7XG4gICAgVEhSRUUuQ2F0bXVsbFJvbUN1cnZlMy5wcm90b3R5cGUuZ2V0VGFuZ2VudEF0ID0gZnVuY3Rpb24gKHRoaXM6IGFueSwgdDogbnVtYmVyLCBvcHRpb25hbFRhcmdldD86IGFueSkge1xuICAgICAgaWYgKCF0aGlzLnBvaW50cyB8fCAhQXJyYXkuaXNBcnJheSh0aGlzLnBvaW50cykgfHwgdGhpcy5wb2ludHMubGVuZ3RoIDwgMikge1xuICAgICAgICB0aGlzLnBvaW50cyA9IFtuZXcgVEhSRUUuVmVjdG9yMygwLCAwLCAxKSwgbmV3IFRIUkVFLlZlY3RvcjMoMCwgMCwgMSldO1xuICAgICAgfVxuICAgICAgdGhpcy5wb2ludHMgPSB0aGlzLnBvaW50cy5tYXAoKHA6IGFueSkgPT4ge1xuICAgICAgICBpZiAoIXAgfHwgdHlwZW9mIHAueCAhPT0gXCJudW1iZXJcIiB8fCB0eXBlb2YgcC55ICE9PSBcIm51bWJlclwiIHx8IHR5cGVvZiBwLnogIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFRIUkVFLlZlY3RvcjMoMCwgMCwgMCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHA7XG4gICAgICB9KTtcbiAgICAgIGlmICh0aGlzLnBvaW50cy5sZW5ndGggPCAyKSB7XG4gICAgICAgIHRoaXMucG9pbnRzID0gW25ldyBUSFJFRS5WZWN0b3IzKDAsIDAsIDEpLCBuZXcgVEhSRUUuVmVjdG9yMygwLCAwLCAxKV07XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gb3JpZ2luYWxHZXRUYW5nZW50QXQuY2FsbCh0aGlzLCB0LCBvcHRpb25hbFRhcmdldCk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc3QgZmFsbGJhY2sgPSBvcHRpb25hbFRhcmdldCB8fCBuZXcgVEhSRUUuVmVjdG9yMygwLCAwLCAxKTtcbiAgICAgICAgZmFsbGJhY2suc2V0KDAsIDAsIDEpO1xuICAgICAgICByZXR1cm4gZmFsbGJhY2s7XG4gICAgICB9XG4gICAgfTtcbiAgfVxufVxuXG4vLyA0LiBSYXkgcHJvdG90eXBlczogU2FmZWd1YXJkIGRpc3RhbmNlU3FUb1BvaW50IGxvZ2ljXG5pZiAoVEhSRUUuUmF5ICYmIFRIUkVFLlJheS5wcm90b3R5cGUpIHtcbiAgY29uc3Qgb3JpZ2luYWxSYXlEaXN0YW5jZVNxID0gVEhSRUUuUmF5LnByb3RvdHlwZS5kaXN0YW5jZVNxVG9Qb2ludDtcbiAgaWYgKG9yaWdpbmFsUmF5RGlzdGFuY2VTcSkge1xuICAgIFRIUkVFLlJheS5wcm90b3R5cGUuZGlzdGFuY2VTcVRvUG9pbnQgPSBmdW5jdGlvbiAodGhpczogYW55LCBwb2ludDogYW55KSB7XG4gICAgICBpZiAoIXRoaXMgfHwgIXRoaXMub3JpZ2luIHx8ICF0aGlzLmRpcmVjdGlvbikge1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH1cbiAgICAgIGlmICghcG9pbnQgfHwgdHlwZW9mIHBvaW50LnggIT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHBvaW50LnkgIT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHBvaW50LnogIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gb3JpZ2luYWxSYXlEaXN0YW5jZVNxLmNhbGwodGhpcywgcG9pbnQpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuICAgIH07XG4gIH1cbn1cblxuLy8gNS4gQm94MyBhbmQgU3BoZXJlIGJvdW5kcyBjaGVja3M6IFByb3RlY3Qgc3BhdGlhbCBpbnRlcnNlY3Rpb24gbWF0aFxuaWYgKFRIUkVFLkJveDMgJiYgVEhSRUUuQm94My5wcm90b3R5cGUpIHtcbiAgY29uc3Qgb3JpZ2luYWxJbnRlcnNlY3RzU3BoZXJlID0gVEhSRUUuQm94My5wcm90b3R5cGUuaW50ZXJzZWN0c1NwaGVyZTtcbiAgaWYgKG9yaWdpbmFsSW50ZXJzZWN0c1NwaGVyZSkge1xuICAgIFRIUkVFLkJveDMucHJvdG90eXBlLmludGVyc2VjdHNTcGhlcmUgPSBmdW5jdGlvbiAodGhpczogYW55LCBzcGhlcmU6IGFueSkge1xuICAgICAgaWYgKCFzcGhlcmUgfHwgIXNwaGVyZS5jZW50ZXIgfHwgdHlwZW9mIHNwaGVyZS5jZW50ZXIueCAhPT0gXCJudW1iZXJcIikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gb3JpZ2luYWxJbnRlcnNlY3RzU3BoZXJlLmNhbGwodGhpcywgc3BoZXJlKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfTtcbiAgfVxufVxuXG5pZiAoVEhSRUUuU3BoZXJlICYmIFRIUkVFLlNwaGVyZS5wcm90b3R5cGUpIHtcbiAgY29uc3Qgb3JpZ2luYWxTcGhlcmVJbnRlcnNlY3RzU3BoZXJlID0gVEhSRUUuU3BoZXJlLnByb3RvdHlwZS5pbnRlcnNlY3RzU3BoZXJlO1xuICBpZiAob3JpZ2luYWxTcGhlcmVJbnRlcnNlY3RzU3BoZXJlKSB7XG4gICAgVEhSRUUuU3BoZXJlLnByb3RvdHlwZS5pbnRlcnNlY3RzU3BoZXJlID0gZnVuY3Rpb24gKHRoaXM6IGFueSwgc3BoZXJlOiBhbnkpIHtcbiAgICAgIGlmICghc3BoZXJlIHx8ICFzcGhlcmUuY2VudGVyIHx8IHR5cGVvZiBzcGhlcmUuY2VudGVyLnggIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIG9yaWdpbmFsU3BoZXJlSW50ZXJzZWN0c1NwaGVyZS5jYWxsKHRoaXMsIHNwaGVyZSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICBjb25zdCBvcmlnaW5hbFNwaGVyZUludGVyc2VjdHNCb3ggPSBUSFJFRS5TcGhlcmUucHJvdG90eXBlLmludGVyc2VjdHNCb3g7XG4gIGlmIChvcmlnaW5hbFNwaGVyZUludGVyc2VjdHNCb3gpIHtcbiAgICBUSFJFRS5TcGhlcmUucHJvdG90eXBlLmludGVyc2VjdHNCb3ggPSBmdW5jdGlvbiAodGhpczogYW55LCBib3g6IGFueSkge1xuICAgICAgaWYgKCFib3ggfHwgIWJveC5taW4gfHwgIWJveC5tYXggfHwgdHlwZW9mIGJveC5taW4ueCAhPT0gXCJudW1iZXJcIikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gb3JpZ2luYWxTcGhlcmVJbnRlcnNlY3RzQm94LmNhbGwodGhpcywgYm94KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfTtcbiAgfVxufVxuXG5jcmVhdGVSb290KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwicm9vdFwiKSEpLnJlbmRlcihcbiAgPFN0cmljdE1vZGU+XG4gICAgPEFwcCAvPlxuICA8L1N0cmljdE1vZGU+LFxuKTtcbiJdfQ==