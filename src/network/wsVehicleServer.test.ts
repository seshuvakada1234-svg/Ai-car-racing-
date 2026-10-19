import { createServer } from "http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { setupVehicleWsServer } from "./wsVehicleServer";

type Packet = Record<string, any>;

function parsePacket(raw: WebSocket.RawData): Packet | null {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

function waitForOpen(ws: WebSocket, timeoutMs = 2000): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket to open"));
    }, timeoutMs);

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err || new Error("WebSocket open failed"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
    };

    ws.on("open", onOpen);
    ws.on("error", onError);
  });
}

function closeSocket(ws: WebSocket, timeoutMs = 1000): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    const onClose = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("close", onClose);
    };

    ws.on("close", onClose);

    try {
      ws.close();
    } catch {
      cleanup();
      resolve();
    }
  });
}

function createInbox(ws: WebSocket) {
  const messages: Packet[] = [];
  const waiters: Array<{
    predicate: (packet: Packet) => boolean;
    resolve: (packet: Packet) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  const fulfillWaiters = (packet: Packet) => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      if (!waiter.predicate(packet)) continue;
      waiters.splice(i, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(packet);
    }
  };

  const onMessage = (raw: WebSocket.RawData) => {
    const packet = parsePacket(raw);
    if (!packet) return;
    messages.push(packet);
    fulfillWaiters(packet);
  };

  const rejectAll = (reason: string) => {
    while (waiters.length > 0) {
      const waiter = waiters.pop();
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
  };

  const onClose = () => rejectAll("Socket closed before expected packet");
  const onError = () => rejectAll("Socket errored before expected packet");

  ws.on("message", onMessage);
  ws.on("close", onClose);
  ws.on("error", onError);

  const waitForNext = (
    predicate: (packet: Packet) => boolean,
    timeoutMs = 2000,
  ): Promise<Packet> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) {
          waiters.splice(idx, 1);
        }
        reject(new Error("Timed out waiting for packet"));
      }, timeoutMs);

      waiters.push({ predicate, resolve, reject, timer });
    });
  };

  const waitFor = (
    predicate: (packet: Packet) => boolean,
    timeoutMs = 2000,
  ): Promise<Packet> => {
    const existing = messages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return waitForNext(predicate, timeoutMs);
  };

  const dispose = () => {
    ws.off("message", onMessage);
    ws.off("close", onClose);
    ws.off("error", onError);
    rejectAll("Inbox disposed");
  };

  return {
    messages,
    waitFor,
    waitForNext,
    dispose,
  };
}

interface ConnectedPlayer {
  socket: WebSocket;
  inbox: ReturnType<typeof createInbox>;
}

interface Harness {
  connectPlayer: (roomCode: string, playerId: string) => Promise<ConnectedPlayer>;
  shutdown: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  setupVehicleWsServer(wss);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
    httpServer.once("error", reject);
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test WebSocket server");
  }

  const baseUrl = `ws://127.0.0.1:${address.port}`;
  const sockets: WebSocket[] = [];
  const inboxes: Array<ReturnType<typeof createInbox>> = [];

  const connectPlayer = async (roomCode: string, playerId: string): Promise<ConnectedPlayer> => {
    const url = `${baseUrl}/ws/vehicle?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(playerId)}`;
    const socket = new WebSocket(url);
    const inbox = createInbox(socket);
    sockets.push(socket);
    inboxes.push(inbox);

    await waitForOpen(socket);
    await inbox.waitFor(
      (packet) => packet.type === "player_list" && Array.isArray(packet.players) && packet.players.includes(playerId),
      2000,
    );

    return { socket, inbox };
  };

  const shutdown = async () => {
    inboxes.forEach((inbox) => inbox.dispose());

    for (const socket of sockets) {
      await closeSocket(socket);
    }

    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  };

  return { connectPlayer, shutdown };
}

const harnesses: Harness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (!harness) continue;
    await harness.shutdown();
  }
});

async function startHarness() {
  const harness = await createHarness();
  harnesses.push(harness);
  return harness;
}

describe("wsVehicleServer multiplayer relay", () => {
  it("registers players and broadcasts join events to existing room members", async () => {
    const harness = await startHarness();

    const host = await harness.connectPlayer("room-a", "host-1");
    const hostList = await host.inbox.waitFor((packet) => packet.type === "player_list");
    expect(hostList.players).toContain("host-1");

    const joiner = await harness.connectPlayer("room-a", "joiner-1");
    const joinerList = await joiner.inbox.waitFor(
      (packet) => packet.type === "player_list" && packet.players?.includes("joiner-1"),
    );
    expect(new Set(joinerList.players)).toEqual(new Set(["host-1", "joiner-1"]));

    const hostJoinNotice = await host.inbox.waitFor(
      (packet) =>
        (packet.type === "playerJoined" || packet.type === "player_join") && packet.playerId === "joiner-1",
    );
    expect(hostJoinNotice.playerId).toBe("joiner-1");
  });

  it("broadcasts one authoritative race_start timestamp and deduplicates repeated start requests", async () => {
    const harness = await startHarness();

    const host = await harness.connectPlayer("room-start", "host-start");
    const joiner = await harness.connectPlayer("room-start", "joiner-start");

    host.socket.send(JSON.stringify({ type: "start_race" }));

    const hostStart = await host.inbox.waitFor((packet) => packet.type === "race_start");
    const joinerStart = await joiner.inbox.waitFor((packet) => packet.type === "race_start");

    expect(typeof hostStart.startTime).toBe("number");
    expect(joinerStart.startTime).toBe(hostStart.startTime);

    const duplicateHostPromise = host.inbox.waitForNext(
      (packet) => packet.type === "race_start" && packet.startTime === hostStart.startTime,
      2000,
    );
    const unexpectedJoinerPromise = joiner.inbox.waitForNext((packet) => packet.type === "race_start", 500);

    host.socket.send(JSON.stringify({ type: "start_race" }));

    await expect(duplicateHostPromise).resolves.toBeTruthy();
    await expect(unexpectedJoinerPromise).rejects.toThrow("Timed out waiting for packet");
  });

  it("relays vehicle updates both directions and rejects spoofed room/player payloads", async () => {
    const harness = await startHarness();

    const host = await harness.connectPlayer("room-move", "host-move");
    const joiner = await harness.connectPlayer("room-move", "joiner-move");

    host.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "room-move",
        playerId: "host-move",
        position: { x: 12, y: 0, z: 4 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        speed: 42,
      }),
    );

    const hostSeenByJoiner = await joiner.inbox.waitFor(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "host-move",
    );
    expect(hostSeenByJoiner.position).toEqual({ x: 12, y: 0, z: 4 });

    const secondHostUpdate = joiner.inbox.waitForNext(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "host-move" && packet.position?.x === 18,
      2000,
    );

    host.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "room-move",
        playerId: "host-move",
        position: { x: 18, y: 0, z: 6 },
        rotation: { x: 0, y: 0.1, z: 0, w: 0.99 },
        speed: 58,
      }),
    );

    const continuedHostMovement = await secondHostUpdate;
    expect(continuedHostMovement.position).toEqual({ x: 18, y: 0, z: 6 });

    joiner.socket.send(
      JSON.stringify({
        type: "vehicle_update",
        roomCode: "room-move",
        playerId: "joiner-move",
        position: { x: 3, y: 0, z: 21 },
        rotation: { x: 0, y: 0.4, z: 0, w: 0.9 },
        speed: 28,
      }),
    );

    const joinerSeenByHost = await host.inbox.waitFor(
      (packet) => packet.type === "vehicle_update" && packet.playerId === "joiner-move",
    );
    expect(joinerSeenByHost.position).toEqual({ x: 3, y: 0, z: 21 });

    const spoofShouldFail = host.inbox.waitForNext(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "joiner-move" && packet.position?.x === 999,
      500,
    );

    joiner.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "other-room",
        playerId: "joiner-move",
        position: { x: 999, y: 0, z: 999 },
      }),
    );

    await expect(spoofShouldFail).rejects.toThrow("Timed out waiting for packet");
  });

  it("handles disconnect/reconnect and replays latest state plus active race_start", async () => {
    const harness = await startHarness();

    const host = await harness.connectPlayer("room-reconnect", "host-reconnect");
    const joiner = await harness.connectPlayer("room-reconnect", "joiner-reconnect");

    host.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "room-reconnect",
        playerId: "host-reconnect",
        position: { x: 77, y: 0, z: 1 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    );

    await joiner.inbox.waitFor((packet) => packet.type === "vehicleUpdate" && packet.playerId === "host-reconnect");

    host.socket.send(JSON.stringify({ type: "start_race" }));
    const start = await host.inbox.waitFor((packet) => packet.type === "race_start");
    await joiner.inbox.waitFor((packet) => packet.type === "race_start" && packet.startTime === start.startTime);

    await closeSocket(joiner.socket);

    await host.inbox.waitFor(
      (packet) =>
        (packet.type === "playerLeft" || packet.type === "player_leave") && packet.playerId === "joiner-reconnect",
    );

    const reconnectingJoiner = await harness.connectPlayer("room-reconnect", "joiner-reconnect");

    await host.inbox.waitFor(
      (packet) =>
        (packet.type === "playerJoined" || packet.type === "player_join") && packet.playerId === "joiner-reconnect",
    );

    const replayedList = await reconnectingJoiner.inbox.waitFor(
      (packet) => packet.type === "player_list" && packet.latestStates?.["host-reconnect"],
    );
    expect(replayedList.latestStates["host-reconnect"].position).toEqual({ x: 77, y: 0, z: 1 });

    const replayedStart = await reconnectingJoiner.inbox.waitFor(
      (packet) => packet.type === "race_start" && packet.startTime === start.startTime,
    );
    expect(replayedStart.startTime).toBe(start.startTime);
  });

  it("locks socket identity and rejects malformed vehicle payloads", async () => {
    const harness = await startHarness();

    const host = await harness.connectPlayer("room-lock", "host-lock");
    const joiner = await harness.connectPlayer("room-lock", "joiner-lock");

    const spoofJoinBroadcast = joiner.inbox.waitForNext(
      (packet) =>
        (packet.type === "playerJoined" || packet.type === "player_join") && packet.playerId === "spoof-lock",
      500,
    );

    host.socket.send(
      JSON.stringify({
        type: "join",
        roomCode: "room-lock",
        playerId: "spoof-lock",
      }),
    );

    await expect(spoofJoinBroadcast).rejects.toThrow("Timed out waiting for packet");

    host.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "room-lock",
        playerId: "host-lock",
        position: { x: 15, y: 0, z: 2 },
        rotation: { x: 0, y: 0.1, z: 0, w: 0.99 },
      }),
    );

    const preservedIdentity = await joiner.inbox.waitFor(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "host-lock" && packet.position?.x === 15,
    );
    expect(preservedIdentity.playerId).toBe("host-lock");

    const malformedDropped = joiner.inbox.waitForNext(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "host-lock" && packet.position?.x === 999,
      500,
    );

    host.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "room-lock",
        playerId: "host-lock",
        position: { x: 999, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: NaN },
      }),
    );

    await expect(malformedDropped).rejects.toThrow("Timed out waiting for packet");
  });
});
