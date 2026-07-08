# Production Quality Upgrade Plan

This plan covers three pillars: **Vehicle Animation**, **Graphics Quality**, and **Performance/Settings**. UI is untouched.

---

## 1. Vehicle Wheel & Suspension System

**New file:** `src/vehicles/WheelRig.ts`

Auto-detects wheels in any GLB by name pattern (`wheel`, `tire`, `rueda`, `FL/FR/RL/RR`, or position heuristics: 4 lowest-Y meshes at corners). Returns `{ FL, FR, RL, RR }` with their original world pivots re-centered into a parent `Group` so rotation happens around the hub, not the model origin.

Per frame, from vehicle state (`speed`, `steerAngle`, `suspensionTravel[4]`):
- **Spin:** `rotation.x += (speed / wheelRadius) * dt` — radius auto-measured from wheel bbox.
- **Steer:** front wheel parent groups set `rotation.y = steerAngle` (clamped ±35°).
- **Suspension:** parent group `position.y = restY + travel[i]` (lerp-smoothed, ~12Hz cutoff).

**Integration:** `Car.ts` (or equivalent player car loader) calls `attachWheelRig(carRoot, physicsState)` on load. Same call used for Ferrari, Porsche, Bugatti, and any future GLB — no per-car code.

**Fixes:** pivot misalignment, wheels-don't-spin, steering not visible, jittery suspension.

---

## 2. Graphics Quality

**Renderer (`GameCanvas.tsx`):**
- `antialias: true`, `powerPreference: 'high-performance'`.
- `pixelRatio = min(devicePixelRatio, qualityCap)` — Low 1.0, Med 1.25, High 1.5, Ultra/Extreme = native (cap 2.0).
- `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1.05`.
- `shadowMap.type = PCFSoftShadowMap` (High+) or `BasicShadowMap` (Low/Med).

**Textures:** global pass on load — `anisotropy = renderer.capabilities.getMaxAnisotropy()` (capped per tier: 1/2/8/16/16), `colorSpace = SRGB` for albedo, generate mipmaps. Replace `NearestFilter` with `LinearMipmapLinearFilter`.

**Environment:** load one HDRI (`royal_esplanade_1k.hdr` or similar small file) via `RGBELoader` → `PMREMGenerator` → `scene.environment`. Cached singleton. Drives PBR reflections on all cars.

**Materials:** car body materials upgraded to `MeshPhysicalMaterial` with `clearcoat: 1`, `clearcoatRoughness: 0.05`, `envMapIntensity` per tier.

**Post-processing (`EffectComposer`):**
- Low/Med: none (direct render).
- High: FXAA + subtle Bloom (threshold 0.9, strength 0.3).
- Ultra/Extreme: SMAA + Bloom + slight chromatic aberration.
- Mobile auto-caps at High regardless of selection.

---

## 3. Performance & Settings

**Settings store** (`src/systems/GraphicsSettings.ts`) — single source of truth, persisted to `localStorage`:

```text
Quality:  Low | Medium | High | Ultra | Extreme
FPS Cap:  30 | 60 | 90 | 120 | Unlimited
```

Each preset emits a config object:

| Setting        | Low   | Med   | High  | Ultra | Extreme |
|----------------|-------|-------|-------|-------|---------|
| shadowMapSize  | 512   | 1024  | 2048  | 4096  | 4096    |
| shadowDistance | 30    | 60    | 100   | 150   | 200     |
| textureAniso   | 1     | 2     | 8     | 16    | 16      |
| reflections    | off   | static| probe | probe+| RT-lite |
| postFX         | none  | none  | FXAA+Bloom | SMAA+Bloom | full |
| drawDistance   | 400   | 700   | 1200  | 1600  | 2000    |
| grassDensity   | 0     | 0.3   | 0.6   | 0.9   | 1.0     |
| particles      | 0.3   | 0.6   | 1.0   | 1.0   | 1.5     |
| pixelRatio cap | 1.0   | 1.25  | 1.5   | 2.0   | 2.0     |

FPS cap implemented via rAF gating (`if (now - last < 1000/cap) return;`). "Unlimited" disables the gate.

**Optimization passes** (extend existing `Racing2World.ts` + `GameCanvas.tsx`):
- LOD: `THREE.LOD` wrappers for cars (high/med/low decimated copies — auto-generated via `SimplifyModifier` once per car at load, cached).
- Frustum culling: ensure `frustumCulled = true` on all meshes (currently disabled on some).
- Occlusion: use existing distance-based hiding, extended with screen-space size cutoff.
- Instancing: trees/barriers/lights/signs → `InstancedMesh` (already partial; complete it).
- Static merge: ground tiles, curbs, walls → `BufferGeometryUtils.mergeGeometries`.
- Shader cache: `renderer.compile(scene, camera)` on world load to prevent first-frame stutter.
- **Adaptive scaler:** rolling 2s FPS avg. If <85% of FPS target for 3s, drop one preset step and toast "Auto-reduced to {tier} for stable FPS". Recovery upgrade requires explicit user action.

---

## Technical Details

**Files added:**
- `src/vehicles/WheelRig.ts` — auto wheel detection + per-frame update.
- `src/systems/GraphicsSettings.ts` — presets + persistence + event bus.
- `src/systems/EnvironmentMap.ts` — HDRI loader/cache.
- `src/systems/PostFX.ts` — composer setup per tier.

**Files modified:**
- `src/components/GameCanvas.tsx` — renderer config, composer, env, settings subscription, adaptive scaler hookup.
- `src/vehicles/Car.ts` (and AI car loader) — call `attachWheelRig`.
- `src/world/Racing2World.ts` — instancing completion, mesh merging, LOD, frustum flags.
- `src/components/Menu.tsx` — graphics settings panel gains Ultra + Extreme tiers and 90/120/Unlimited FPS options (settings UI only; no layout change).
- `src/systems/FpsCapabilityMonitor.tsx` — switched to step-down tier ladder instead of FPS-only.

**Not changed:** physics, controls, camera math, multiplayer netcode, map geometry, HUD layout, garage layout.

---

## Out of scope / call out

- **True ray-traced reflections** are not feasible in three.js WebGL — "Extreme RT-lite" uses planar reflectors on the car only.
- **Occlusion culling** in WebGL has no hardware path; we use distance + screen-size heuristic, which is the standard three.js approach.
- HDRI adds ~500KB; loaded once, cached across sessions.

Approve to proceed, or tell me which sections to drop/expand.