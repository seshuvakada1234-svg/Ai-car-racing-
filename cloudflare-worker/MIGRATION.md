# Migration & Deployment Guide: Node.js to Cloudflare Workers + Durable Objects

This guide provides step-by-step instructions for migrating your high-performance racing game's vehicle coordination relay from a standalone Node.js `ws` server to serverless **Cloudflare Workers** backed by **Durable Objects**.

---

## 🚀 Why Cloudflare Workers + Durable Objects?
- **Ultra-low latency**: Runs on Cloudflare's global edge network (closer to your players).
- **In-memory state synchronization**: Durable Objects keep WebSocket connections in-memory for zero-database overhead during live coordinate updates.
- **Scale-to-zero pricing**: Zero cost when nobody is playing; automatically scales up to handle thousands of concurrent rooms with no server provisioning or maintenance.

---

## 📂 Architecture Split

Our multiplayer logic utilizes a **dual-networking architecture** to maximize speed and data integrity:

| System | Responsibility | Service |
| :--- | :--- | :--- |
| **Control Plane** | User auth, room lobby, player ready states, countdown synchronizer, lap counting, and overall race start/finished states | **Google Firestore** |
| **Data Plane** | 20Hz real-time coordinate streaming (vehicle position vector, orientation quaternion, speed, drifting, and nitro active states) | **Cloudflare Durable Objects** |

---

## 🛠️ Configuration & Code Map

### 1. Cloudflare Workers Code (`/cloudflare-worker`)
- `worker.ts`: Main entry proxy. Validates query parameters (`roomCode` and `playerId`) and deterministically routes websocket connections.
- `RoomDurableObject.ts`: A memory-only coordinate broker managing a list of connected players. It broadcasts new connection arrivals, coordinate telemetry, and client departures to everyone except the sender.
- `types.ts`: TypeScript schemas for payload packets and environment bindings.
- `wrangler.jsonc`: Main configuration and deployment properties.

### 2. Client Integration (`/src/network/vehicleSocket.ts`)
The game client connects to the Worker using the query parameter structure:
`wss://<worker-domain>/ws?roomCode=ROOM123&playerId=UID123`

---

## 📦 Cloudflare Configuration (`wrangler.jsonc`)

To configure Durable Objects, the following declarations must exist in your `wrangler.jsonc` configuration file (already generated):

```json
{
  "name": "racing-game-vehicle-relay",
  "main": "worker.ts",
  "compatibility_date": "2024-12-18",
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
      "new_classes": ["RoomDurableObject"]
    }
  ]
}
```

---

## 🤖 Continuous Deployment with GitHub Actions

A production-ready GitHub Actions workflow is located at `.github/workflows/deploy-worker.yml`. It triggers automatic deployments to Cloudflare every time you push to the `main` branch.

### How to Configure Secrets on GitHub:
To authenticate Wrangler with your Cloudflare account from GitHub Actions, you must add the following **Repository Secrets**:

1. Navigate to your repository on GitHub.
2. Go to **Settings** -> **Secrets and variables** -> **Actions**.
3. Click **New repository secret** and add:
   - **`CLOUDFLARE_API_TOKEN`**: Your Cloudflare API token. 
     - *How to generate*: In Cloudflare Dashboard, go to **My Profile** -> **API Tokens** -> **Create Token**. Choose the **Edit Cloudflare Workers** template, select your Account and Zone resources, and copy the token.
   - **`CLOUDFLARE_ACCOUNT_ID`**: Your Cloudflare Account ID.
     - *How to find*: Look at the sidebar or the URL of your Cloudflare Dashboard (it's the 32-character hexadecimal string after `dash.cloudflare.com/`).

Once these are set up, every push to `main` will securely run:
1. `npm install` inside `/cloudflare-worker`.
2. `npx wrangler deploy` to build your TypeScript bundle, provision your Durable Object namespace, and push it to Cloudflare's edge servers.

---

## 🎯 Testing Locally

To run the Worker emulator locally on your machine:
```bash
cd cloudflare-worker
npm install
npm run dev
```
The local emulator will run on `http://localhost:8787`. You can test multiplayer vehicle positioning by connecting local client tabs to the emulator instance.
