# Cloudflare Workers + Durable Objects Multiplayer Vehicle Relay

This directory contains the vehicle synchronization relay for **Cloudflare Workers** with **Durable Objects**, plus a streaming public-asset proxy at `/api/proxy`.

This is a **high-frequency (20Hz / 50ms interval) memory-only data stream** that routes position vectors, orientation quaternions, nitro state, drift indicators, and speed measurements between racing competitors.

---

## Architecture Overview

```
                      +-----------------------------+
                      |     Client Browser (Vite)   |
                      +------+---------------+------+
                             |               |
       (Low-Frequency State) |               | (High-Frequency State)
       Room Setup, Lobby,    |               | WebSocket Relay
       Ready States, Laps    v               v
                +------------+---+     +-----+--------------------+
                |  Firestore     |     |  Cloudflare Worker       |
                |  Database      |     |  (Durable Object Room)   |
                +----------------+     +--------------------------+
```

1. **Control Plane (Firestore):** Manages user accounts, room creation, lobbies, player ready states, matching, countdown synchronization, and overall race state.
2. **Data Plane (Cloudflare Workers + Durable Objects):** Manages real-time vehicle movement replication. Each memory-only room instance handles one normalized room code. Firestore membership persists independently of temporary socket disconnects.

---

## File Structure

- `worker.ts`: The main entrance proxy that receives requests, validates parameters, and routes connections deterministically.
- `RoomDurableObject.ts`: Class managing the state and WebSocket sessions of a single race room in memory.
- `types.ts`: Shared TypeScript types for parameters, configuration environments, and packets.
- `tsconfig.json`: TypeScript compiler options optimized for edge environments.
- `wrangler.jsonc`: Cloudflare Wrangler settings with binding definitions and migrations.

---

## Cloudflare Bindings & Settings

The Durable Object class is bound to the `VEHICLE_ROOM` namespace inside `wrangler.jsonc`:

```json
"durable_objects": {
  "bindings": [
    {
      "name": "VEHICLE_ROOM",
      "class_name": "RoomDurableObject"
    }
  ]
},
"migrations": [
  {
    "tag": "v1",
    "new_sqlite_classes": ["RoomDurableObject"]
  }
]
```

---

## Deployment Instructions

### Prerequisites
1. Install [Node.js](https://nodejs.org/) (22.12 or newer for the full repository).
2. Install Cloudflare Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```
3. Authenticate Wrangler with your Cloudflare account:
   ```bash
   wrangler login
   ```

### Step 1: Clone & Navigate
Deploy from this directory in the full repository; the proxy imports shared source from `../src/services/`:
```bash
cd cloudflare-worker
```

### Step 2: Install Worker Dependencies
Install compilation and developer types packages:
```bash
npm install
```

### Step 3: Run Locally (Emulating Durable Objects)
You can test the entire Worker and Durable Object stack locally using the wrangler emulator:
```bash
npm run dev
```
By default, the emulator starts on `http://localhost:8787`. You can connect your local frontend to `ws://localhost:8787/ws?roomCode=ROOM123&playerId=UID123` to test.

### Step 4: Deploy to Cloudflare Network
Publish the worker globally onto Cloudflare's edge servers:
```bash
npm run deploy
```

Once deployment completes, Wrangler outputs your live Worker domain, e.g.:
`https://ai-car-racing-ws.<your-workers-subdomain>.workers.dev`

---

## Client Integration Config

Update your frontend client deployment configuration. Add your Cloudflare Worker URL to the `.env` or configuration parameters of your hosting site:

```env
# Expose the secure WebSocket endpoint to Vite
VITE_VEHICLE_WS_URL=wss://ai-car-racing-ws.<your-workers-subdomain>.workers.dev/ws
```

Replace the placeholder with the actual deployed host, then rebuild the frontend. All players with the same normalized code are routed to the same Durable Object.

To use this worker for asset fallback as well, set `VITE_ASSET_PROXY_URL=https://<actual-worker-host>/api/proxy` on the frontend. The worker already allows the repository's public R2 and Lovable asset hosts. For a custom asset domain, set the server-side worker variable `ASSET_ALLOWED_HOSTS` to its hostname (comma-separated for multiple domains). No R2 secrets or bucket bindings are required for public URLs.

See the root [README](../README.md#vercel-configuration) for Vercel settings, Firebase requirements, R2 CORS, and the multi-device verification procedure.
