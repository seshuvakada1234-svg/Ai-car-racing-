import { Env } from "./types";
import { RoomDurableObject } from "./RoomDurableObject";

// Re-export the Durable Object class so Cloudflare can find and bind it
export { RoomDurableObject };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Provide a simple health-check route matching the Node.js relay server
    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response("OK", {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // Only handle WebSocket requests on "/ws" (or similar paths)
    if (url.pathname === "/ws" || url.pathname === "/ws/vehicle") {
      const roomCode = (url.searchParams.get("roomCode") || "").toUpperCase().trim();
      const playerId = url.searchParams.get("playerId") || "";

      if (!roomCode) {
        return new Response("Bad Request: Missing 'roomCode' query parameter", { status: 400 });
      }
      if (!playerId) {
        return new Response("Bad Request: Missing 'playerId' query parameter", { status: 400 });
      }

      // Generate a deterministic Durable Object ID from the uppercase roomCode
      const id = env.VEHICLE_ROOM.idFromName(roomCode);
      const roomObject = env.VEHICLE_ROOM.get(id);

      // Forward request to the resolved Durable Object room instance
      return roomObject.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
