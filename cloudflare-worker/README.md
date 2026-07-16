# Cloudflare Workers + Durable Objects Multiplayer Vehicle Relay

This directory contains the production-ready source code for a ultra-low-latency vehicle coordinate synchronization relay designed to run on **Cloudflare Workers** with **Durable Objects**.

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
2. **Data Plane (Cloudflare Workers + Durable Objects):** Manages real-time vehicle movement replication. It uses memory-only Durable Objects where each instance handles exactly one race room code, avoiding storage fees and keeping communication latency under 10ms.

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
1. Install [Node.js](https://nodejs.org/) (v18 or newer).
2. Install Cloudflare Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```
3. Authenticate Wrangler with your Cloudflare account:
   ```bash
   wrangler login
   ```

### Step 1: Clone & Navigate
If you copied this directory separately, navigate to this directory:
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
`https://racing-game-vehicle-relay.your-subdomain.workers.dev`

---

## Client Integration Config

Update your frontend client deployment configuration. Add your Cloudflare Worker URL to the `.env` or configuration parameters of your hosting site:

```env
# Expose the secure WebSocket endpoint to Vite
VITE_VEHICLE_WS_URL=wss://racing-game-vehicle-relay.your-subdomain.workers.dev
```

When building, Vite embeds this variable into your frontend bundles, ensuring all racing players automatically route their high-frequency coordinates to the Durable Object closest to them.
