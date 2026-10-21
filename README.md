<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# AI Car Racing

React/Vite and Three.js racing game with Firebase authentication, Firestore multiplayer rooms, and an optional WebSocket vehicle relay. The Express server also supports the existing offline LAN mode.

View your app in AI Studio: https://ai.studio/apps/9544403b-6ac1-40b8-a886-1ff8a39151b8

## Run Locally

**Prerequisites:** Node.js 22.12+ and npm.

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local` and supply the Firebase client configuration for your project. All clients must use the same Firebase project **and Firestore database ID**. Existing fallback configuration remains in `firebase-applet-config.json`.
3. Run `npm run dev` and open `http://localhost:3000`. This starts Express, Vite middleware, the local asset proxy, and local WebSocket/LAN endpoints.

```text
npm run build       # Vite client -> dist; Express bundle -> dist/server.cjs
npm run lint        # ESLint
npm test            # Vitest regression suite
npx tsc --noEmit    # Client/source type check
```

For an Express production deployment, set `NODE_ENV=production` and `PORT`, then run `npm start` after building. Vercel serves the Vite client and its separate `api/proxy.ts` function.

## Multiplayer and race initialization fixes

### Room identity and subscriptions

- `/room/:roomCode` and `/race/:roomCode` supply the room ID to the shared React subscription. Codes are trimmed and uppercased; the Firestore document ID overrides stale `roomCode`/`code`/`id` aliases in document data.
- Creation publishes the room and host player document in one transaction. React StrictMode and repeated Create clicks no longer create duplicate rooms. The garage displays an invitation code only after it has actually been allocated.
- Both the normal lobby service and `RoomManager` update the same session state. Per-tab session storage takes precedence over shared local storage.
- Firestore listeners attach after Firebase Auth is ready. An initial empty cache, a delayed snapshot, or a permission error is not reported as a deleted room. Old subscription callbacks are ignored after switching codes.
- Rejoining an existing membership is idempotent, including full rooms and countdown/racing phases. It preserves the player's car, join order, readiness, and saved telemetry. New participants still undergo capacity and phase validation.
- The hooks preserve the existing map/car/scene readiness fields and `raceStarted`, so the host's loading gate and every player's status display receive the actual Firestore values.

### Leaving versus losing connectivity

Firestore remains authoritative for membership. Closing a component or losing a relay connection does not call `leaveRoom`. The vehicle client reconnects with the same room code and Firebase UID, and relay disconnection messages do not remove a car while its Firestore membership remains.

The existing explicit cleanup policy is retained:

- Explicit leave/kick in a room with two or fewer players deletes the room and those player documents.
- In larger rooms, only the departing player is removed. If the host leaves, the oldest remaining member becomes host without being falsely marked ready.
- Creating a room passively cleans up the current user's idle rooms after 30 minutes. A transaction rechecks activity and ownership before deletion; starting/countdown/racing rooms are protected.

Temporary disconnects reserve membership for reconnection. Firestore is not a WebSocket-presence database, and this change adds no presence collection or schema migration. A permanently abandoned active room can still be closed through the existing host/admin controls.

### Map, physics, and vehicle loading

The lobby, race page, and `Racing2World` now share `racingMapAsset.ts` instead of downloading the map independently. Default sources are:

1. Optional local `/assets/racing2.glb` (the Express server can pre-download this).
2. `https://pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/map/Untitled12.glb`.
3. The existing Lovable asset specified by `src/assets/racing2.glb.asset.json`.
4. The corresponding asset-proxy fallbacks.

The downloader checks HTTP status, rejects HTML/JSON error responses (including an SPA fallback returning HTTP 200), validates the GLB v2 header, declared byte length, and JSON chunk, and reports each failing URL/status/stage with the original exception. Missing `Content-Length` is handled using the GLB's own length. The timeout measures **30 seconds without incoming data**, rather than failing every loading stage after 15 seconds.

Invalid cached files are discarded. Cache Storage/IndexedDB restrictions or quota exhaustion allow a verified asset to be used from memory; they do not turn failed downloads into successful ones. A rejected download can be retried.

Race setup parses the map, builds road physics, reads the authored grid, and then creates a deterministic lineup containing the real room members. The renderer reuses that prepared world. Existing telemetry is restored when rejoining an already-started race. Car progress uses the actual `percentage` field; cached cars also complete the parsing state. Only a mounted car and ready world publish `sceneReady`/`ready`.

The Racing 2 GLB must contain driveable road meshes, `StartSpawn`, `Finish`, ordered `Checkpoint_01` through at least `Checkpoint_55`, and `Grid_01` through `Grid_06`. Names are case-insensitive with the existing supported aliases. Runtime/GLB/wheel errors retain their actual exception or validation message. **RETRY INIT** remounts the initialization pipeline.

## Vercel configuration

`vercel.json` explicitly configures:

| Setting | Value |
| --- | --- |
| Framework preset | `vite` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | Set the project runtime to Node.js 22.x (22.12+) or a compatible newer release |

Keep the existing SPA and `/__/auth/:path*` rewrites. The latter proxies Firebase Auth to the configured Firebase Hosting domain. If you change Firebase projects, update that destination to the new project's auth domain as well.

### Environment variables

Set these for the Vercel environments you deploy, then **rebuild/redeploy** because Vite variables are embedded at build time:

| Variable | Required value/purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_STORAGE_BUCKET` | Your existing Firebase web-app configuration; identical for clients joining the same room |
| `VITE_FIREBASE_FIRESTORE_DATABASE_ID` | Your configured database ID; ensure it matches the database where the room documents and rules are deployed |
| `VITE_FIREBASE_MEASUREMENT_ID` | Optional existing analytics configuration |
| `VITE_VEHICLE_WS_URL` | The deployed relay endpoint, for example `wss://ai-car-racing-ws.<your-workers-subdomain>.workers.dev/ws` |
| `VITE_RACING_MAP_URL` | Optional override: a real public GLB URL, with the correct case-sensitive object path. Leave unset to use the repository's existing sources |
| `VITE_ASSET_PROXY_URL` | Optional alternate proxy endpoint, e.g. `https://ai-car-racing-ws.<your-workers-subdomain>.workers.dev/api/proxy`. Leave unset to use same-origin `/api/proxy` |
| `ASSET_ALLOWED_HOSTS` | Server-only comma-separated hostnames if proxying assets from a custom domain. The existing R2 and Lovable hosts are already allowed |

`<your-workers-subdomain>` is a placeholder: use the real URL printed by your Cloudflare deployment. Vercel does not run the Express WebSocket server; configure the external relay for WebSocket transport. Firestore synchronization remains available when the relay is unavailable.

The added `api/proxy.ts` is a Vercel Edge function using a streaming `Response`. It shares the same implementation as Express and Cloudflare, preserves upstream error/range status codes, and does not buffer the full 45 MB map. Only approved HTTPS asset hosts are accepted. No R2 access key or secret is required for these public assets, and private credentials must not be put in `VITE_*` variables.

In Firebase Authentication, keep the production/preview domains you use in **Authorized domains**, and enable the sign-in providers already used by the app (Google and Anonymous for guest play). Keep the existing room/player Firestore rules deployed to the selected database; the fixes require no schema migration or broader permissions.

## Cloudflare configuration

From `cloudflare-worker/`, install dependencies and run `npm run deploy` with your Cloudflare account. Keep the existing `wrangler.jsonc` configuration:

- Worker name: `ai-car-racing-ws`.
- Durable Object binding: `VEHICLE_ROOM` -> `RoomDurableObject`.
- Existing `v1` migration with `new_sqlite_classes: ["RoomDurableObject"]`.

The worker accepts `/ws` and `/ws/vehicle`, and now also serves `/api/proxy`. If you use a custom asset domain, add `ASSET_ALLOWED_HOSTS` to the worker's variables as well. No R2 bucket binding is needed for proxying an already-public asset URL. Redeploy the worker to activate the new proxy route, and set the Vercel relay/proxy URLs to its actual deployment URL.

### R2 public access and CORS

The existing map endpoint returned HTTP **200** for HEAD and **206** for range GET, with `Access-Control-Allow-Origin: *`, during diagnosis. The full binary also downloaded, parsed, and rendered in the browser check. A missing object or a currently absent wildcard CORS header was **not** observed at that endpoint.

Keep public read access enabled. For a new bucket/custom domain hosting these public assets, this CORS policy supports the credential-free loader:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Type", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"],
    "MaxAgeSeconds": 3600
  }
]
```

You can use exact frontend origins instead of `*` if your deployment requires an origin allowlist. Ensure every production/preview/LAN origin you use is included. `model/gltf-binary` is the preferred object content type; `application/octet-stream` is also accepted. If a custom Cloudflare domain caches old CORS headers, purge that object's cached response after changing the policy.

## Regression checks and deployment verification

The Vitest suite covers room-code normalization, Auth-delayed subscriptions, cached misses versus confirmed deletion, stale callbacks, StrictMode creation, full-room reconnect, explicit cleanup/host transfer, readiness propagation, race-start gating, relay reconnection, corrupt/HTML/truncated asset responses, slow downloads, cache failure, deterministic grid assignment, and initialization retry. Firestore behavior is tested with mocked SDK boundaries; these tests do not authenticate against production Firebase.

A local Chrome asset smoke check exercised the real R2 map and all three car GLBs, road construction, grid markers, vehicle preparation, finite physics state, and a WebGL render. It is separate from a complete multi-device race test.

After deployment, verify the integration using two separate browser profiles/accounts (two tabs sharing a Firebase UID represent one player):

1. Create a two-player room and join its code/link from the other profile. Confirm both URLs/HUDs use the same uppercase code and both players appear.
2. Wait for real map downloads and start from the host. Confirm map, car, and scene readiness before the shared countdown.
3. Reload a player in the full room/countdown/race. Confirm the same UID remains a member and no false room-closed notice appears.
4. Briefly disconnect/reconnect the network. Confirm relay recovery and retained Firestore membership.
5. Explicitly leave a two-player room, then test host transfer in a three-player room. Confirm the documented cleanup policy.
6. In browser Network tools, confirm `/api/proxy?url=<encoded-approved-asset-url>` returns binary data or the actual upstream HTTP error, never `index.html`. Confirm the relay upgrades with HTTP 101.

## Recent maintenance

- Updated TanStack Start dependencies to patched versions to address the Vercel security advisory for `@tanstack/react-start`.
- Fixed multiplayer room identity/subscription races, false room-closure handling, readiness propagation, shared GLB loading, and race initialization/retry. Added streaming Vercel/Cloudflare asset proxy support and regression coverage.
