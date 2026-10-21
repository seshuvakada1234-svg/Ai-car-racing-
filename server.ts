import express from "express";
import path from "path";
import http from "http";
import fs from "fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { proxyAsset } from "./src/services/assetProxy";
import { validateGlb } from "./src/services/glbAsset";
import { createServer as createViteServer } from "vite";
import { setupMultiplayerWebSocket } from "./src/multiplayer/multiplayerServer";
import { WebSocketServer } from "ws";
import { setupVehicleWsServer, setVehicleWsMembershipValidator } from "./src/network/wsVehicleServer";
import { createLanRoomRouter, LanRoomStore } from "./src/network/lanRoomServer";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Pre-download map GLB on startup for instantaneous, zero-CORS local loading
  const downloadMapOnStartup = async () => {
    const assetsDir = path.join(process.cwd(), "public", "assets");
    if (!fs.existsSync(assetsDir)) {
      try {
        fs.mkdirSync(assetsDir, { recursive: true });
      } catch (err) {}
    }
    const mapPath = path.join(assetsDir, "racing2.glb");
    const targetSize = 47139152;

    if (fs.existsSync(mapPath)) {
      const stats = fs.statSync(mapPath);
      if (stats.size === targetSize) {
        console.log(`[Startup Map Loader] Map GLB already downloaded and verified (${stats.size} bytes).`);
        return;
      }
      console.log(`[Startup Map Loader] Local map size mismatch (${stats.size} vs expected ${targetSize}). Re-downloading...`);
    } else {
      console.log(`[Startup Map Loader] Local map GLB not found. Pre-downloading in background...`);
    }

    try {
      const url = process.env.VITE_RACING_MAP_URL || "https://pub-a248afed72844944a7565dc9cbaacbb0.r2.dev/map/Untitled12.glb";
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch map GLB: HTTP ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      validateGlb(buffer);
      fs.writeFileSync(mapPath, Buffer.from(buffer));
      console.log(`[Startup Map Loader] Successfully downloaded and saved map GLB to local server at ${mapPath} (${buffer.byteLength} bytes).`);
    } catch (err: any) {
      console.error(`[Startup Map Loader] Failed to pre-download map GLB:`, err.message);
    }
  };

  downloadMapOnStartup();

  app.use(express.json());

  // Local Offline LAN room management APIs (no Firebase required)
  const lanRoomStore = new LanRoomStore();
  app.use("/api/lan", createLanRoomRouter(lanRoomStore, PORT));

  // Membership guard for local LAN rooms. Unknown room codes are allowed so
  // existing online mode paths keep working exactly as before.
  setVehicleWsMembershipValidator((roomCode, playerId, authToken) =>
    lanRoomStore.validateMembershipForRelay(roomCode, playerId, authToken),
  );

  // Client-side error telemetry logging endpoint
  app.post("/api/log-error", (req, res) => {
    try {
      const logEntry = `[${new Date().toISOString()}] ${JSON.stringify(req.body)}\n`;
      fs.appendFileSync(path.join(process.cwd(), "app_client_errors.log"), logEntry);
    } catch (err) {}
    res.sendStatus(200);
  });

  // Same-origin high-reliability CORS-bypass proxy for streaming binary GLB models
  app.all("/api/proxy", async (req, res) => {
    try {
      const headers = new Headers();
      if (req.headers.range) headers.set("Range", req.headers.range);
      const request = new Request(`http://localhost${req.originalUrl}`, { method: req.method, headers });
      const response = await proxyAsset(request, process.env.ASSET_ALLOWED_HOSTS || "");
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (!response.body) return res.end();
      // Send bytes as they arrive rather than buffering the entire 45 MB map.
      await pipeline(Readable.fromWeb(response.body as any), res);
    } catch (error) {
      console.error("[Asset Proxy] Response stream failed:", error);
      if (!res.headersSent) res.status(502).send("Asset proxy stream failed");
      else res.destroy();
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // High-performance direct static route for the large 45MB map GLB to bypass Vite dev middleware size/timeout limitations
  app.get("/assets/racing2.glb", (req, res) => {
    const paths = [
      path.join(process.cwd(), "public", "assets", "racing2.glb"),
      path.join(process.cwd(), "dist", "assets", "racing2.glb")
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        res.setHeader("Content-Type", "model/gltf-binary");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.sendFile(p, (err) => {
          if (err) {
            const error = err as any;
            if (
              error.code === "EPIPE" ||
              error.code === "ECONNRESET" ||
              error.message?.includes("EPIPE") ||
              error.message?.includes("ECONNRESET") ||
              error.message?.includes("aborted") ||
              error.message?.includes("abort")
            ) {
              console.log("[Static Server] Client disconnected or aborted while downloading racing2.glb. This is normal when a user closes, navigates, or refreshes their browser.");
            } else {
              console.error("[Static Server] Error serving racing2.glb:", err);
            }
          }
        });
      }
    }
    res.status(404).send("File not found");
  });

  // Vite development middleware vs production static handling
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : undefined,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("/{*path}", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Create standard HTTP server wrapping express app
  const server = http.createServer(app);

  // Setup our vehicle WebSocket server on /ws/vehicle
  const vehicleWss = new WebSocketServer({ noServer: true });
  setupVehicleWsServer(vehicleWss);

  server.on("upgrade", (request, socket, head) => {
    try {
      const urlObj = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
      const pathname = urlObj.pathname.replace(/\/+$/, "");
      if (pathname === "/ws/vehicle") {
        vehicleWss.handleUpgrade(request, socket, head, (ws) => {
          vehicleWss.emit("connection", ws, request);
        });
      }
    } catch (err) {
      console.error("[Vehicle WS Upgrade] Error routing upgrade:", err);
    }
  });

  // Setup multiplayer real-time sync WebSocket services
  setupMultiplayerWebSocket(server);

  server.on("error", (err: any) => {
    console.error("[Proxy & Multiplayer Server] HTTP server encountered an error:", err);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Proxy & Multiplayer Server] Running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start full-stack server:", err);
});
