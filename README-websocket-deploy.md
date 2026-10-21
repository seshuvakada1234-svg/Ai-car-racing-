# Persistent WebSocket Deployment Guide (Vehicle Live Tracking)

This racing game uses a dual-networking architecture for high-performance multiplayer synchronization:
1. **Firestore (Control Plane):** Manages user accounts, room creation, ready states, match countdowns, and lap achievements.
2. **WebSocket Relay (Data Plane):** A dedicated, lightweight real-time data stream running at **20Hz** that broadcasts high-frequency vehicle coordinate vectors (positions, orientations, speed, and nitro triggers) to all competitors with sub-millisecond overhead.

Vercel hosts the frontend and streaming asset proxy. Host the WebSocket relay using the included [Cloudflare Worker + Durable Object](cloudflare-worker/README.md), or use the persistent Node.js server described below. See the root [README](README.md#vercel-configuration) for the current room, map-loading, and deployment requirements.

---

## Technical Specifications

- **Server Entry Point:** `src/network/wsVehicleServer.ts`
- **Default Port:** `3001` (configurable via `WS_PORT` or `PORT` environment variables)
- **Protocol:** WebSocket Protocol (RFC 6455)
- **Encryption:** Secure WebSockets (`wss://`) is required in production since client browsers reject unencrypted WS connections (`ws://`) from HTTPS websites.

---

## Step 1: Choosing a Hosting Provider

Select an always-on host that supports persistent Node.js servers, WebSockets, and custom reverse proxies:
- **Cloud Containers:** Render, Railway, Fly.io, or Heroku
- **Virtual Private Servers (VPS):** DigitalOcean Droplets, AWS EC2, Linode, Hetzner, or Google Compute Engine
- **Dedicated Hardware:** Any permanent Linux VM with port 80/443 exposed to the public internet

---

## Step 2: Running the WebSocket Server

### Option A: Running with `tsx` (TypeScript Execution)
You can directly run the TypeScript server using the pre-installed developer runner `tsx`:
```bash
# Start server on a specific port (e.g., 3001)
PORT=3001 npx tsx src/network/wsVehicleServer.ts
```

### Option B: Compiling and Running with Node
If your deployment pipeline prefers pure JavaScript, compile the entry point first:
```bash
# Compile using esbuild (configured in project builder)
npx esbuild src/network/wsVehicleServer.ts --bundle --platform=node --format=cjs --outfile=dist/wsVehicleServer.cjs

# Run standalone bundle
PORT=3001 node dist/wsVehicleServer.cjs
```

---

## Step 3: Setting up the Reverse Proxy (Nginx) and SSL/TLS

To enable `wss://` (WebSocket Secure) connections, configure an Nginx reverse proxy with SSL termination (using Let's Encrypt / Certbot) on your virtual machine.

### Nginx Site Configuration (`/etc/nginx/sites-available/default`):
```nginx
server {
    listen 80;
    server_name your-websocket-server.example.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-websocket-server.example.com;

    ssl_certificate /etc/letsencrypt/live/your-websocket-server.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-websocket-server.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        
        # Enable WebSocket upgrades
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        
        # Forward client info
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeouts adjustments for long-lived racing sessions
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

---

## Step 4: Configuring the Racing Game Client

Once your secure WebSocket relay server is online, tell the client application where to connect by defining the public environment variable.

1. Create or open your production `.env` file or hosting control panel.
2. Add the `VITE_VEHICLE_WS_URL` variable:
```env
# Client environment variables must be prefixed with VITE_ to be exposed to Vite
VITE_VEHICLE_WS_URL=wss://your-websocket-server.example.com
```

3. Re-build and deploy your frontend client application.

During development and preview in AI Studio, the application dynamically falls back to the local proxy route (`/ws/vehicle` on port 3000), allowing you to test multiplayer racing out-of-the-box with zero configuration.
