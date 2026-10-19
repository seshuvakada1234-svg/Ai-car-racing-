import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeWorkerWebSocket, installFakeWorkerRuntime } from "./test/fakeWorkerRuntime";

type Packet = Record<string, any>;

function parsePacket(raw: unknown): Packet | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createInbox(socket: FakeWorkerWebSocket) {
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

  const onMessage = (event: { data: unknown }) => {
    const packet = parsePacket(event.data);
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

  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);

  const waitForNext = (
    predicate: (packet: Packet) => boolean,
    timeoutMs = 1000,
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
    timeoutMs = 1000,
  ): Promise<Packet> => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return waitForNext(predicate, timeoutMs);
  };

  const dispose = () => {
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
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
  socket: FakeWorkerWebSocket;
  inbox: ReturnType<typeof createInbox>;
}

interface RoomRelay {
  fetch: (request: Request) => Promise<any>;
}

async function createRoom(): Promise<RoomRelay> {
  const modulePath = ["..", "..", "cloudflare-worker", "RoomDurableObject"].join("/");
  const mod = await import(modulePath);
  const RoomDurableObjectCtor = (mod as any).RoomDurableObject;
  return new RoomDurableObjectCtor({} as any, { VEHICLE_ROOM: {} as any } as any);
}

async function connectPlayer(
  room: RoomRelay,
  roomCode: string,
  playerId: string,
): Promise<ConnectedPlayer> {
  const request = new Request(
    `https://relay.example/ws?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(playerId)}`,
    { headers: { Upgrade: "websocket" } },
  );

  const response: any = await room.fetch(request);
  expect(response.status).toBe(101);

  const socket = response.webSocket as FakeWorkerWebSocket;
  if (!socket) {
    throw new Error("Expected durable object to return a webSocket response peer");
  }

  const inbox = createInbox(socket);

  socket.send(
    JSON.stringify({
      type: "join",
      roomCode,
      playerId,
    }),
  );

  await inbox.waitFor(
    (packet) => packet.type === "player_list" && Array.isArray(packet.players) && packet.players.includes(playerId),
    1000,
  );

  return { socket, inbox };
}

let runtimeHandle: ReturnType<typeof installFakeWorkerRuntime> | null = null;
const activeSockets: FakeWorkerWebSocket[] = [];
const activeInboxes: Array<ReturnType<typeof createInbox>> = [];

beforeEach(() => {
  runtimeHandle = installFakeWorkerRuntime();
});

afterEach(() => {
  activeInboxes.splice(0).forEach((inbox) => inbox.dispose());
  activeSockets.splice(0).forEach((socket) => socket.close());
  runtimeHandle?.restore();
  runtimeHandle = null;
});

async function attachPlayer(room: RoomRelay, roomCode: string, playerId: string) {
  const player = await connectPlayer(room, roomCode, playerId);
  activeSockets.push(player.socket);
  activeInboxes.push(player.inbox);
  return player;
}

describe("RoomDurableObject parity behavior", () => {
  it("accepts compatible join packets and rejects identity-changing join attempts", async () => {
    const room = await createRoom();
    const host = await attachPlayer(room, "ROOM_JOIN", "host-join");
    const joiner = await attachPlayer(room, "ROOM_JOIN", "joiner-join");

    await host.inbox.waitFor(
      (packet) =>
        (packet.type === "playerJoined" || packet.type === "player_join") && packet.playerId === "joiner-join",
      1000,
    );

    const spoofJoinNotice = joiner.inbox.waitForNext(
      (packet) =>
        (packet.type === "playerJoined" || packet.type === "player_join") && packet.playerId === "spoof-id",
      300,
    );

    host.socket.send(
      JSON.stringify({
        type: "join",
        roomCode: "ROOM_JOIN",
        playerId: "spoof-id",
      }),
    );

    await expect(spoofJoinNotice).rejects.toThrow("Timed out waiting for packet");

    host.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "ROOM_JOIN",
        playerId: "host-join",
        position: { x: 2, y: 0, z: 1 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        speed: 12,
        steering: 0,
        wheelRotation: 0,
        nitro: false,
        drift: false,
        timestamp: Date.now(),
      }),
    );

    const relayed = await joiner.inbox.waitFor(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "host-join",
      1000,
    );

    expect(relayed.roomCode).toBe("ROOM_JOIN");
  });

  it("keeps race-start idempotent and replays same start timestamp to reconnects", async () => {
    const room = await createRoom();
    const host = await attachPlayer(room, "ROOM_START", "host-start");
    const joiner = await attachPlayer(room, "ROOM_START", "joiner-start");

    host.socket.send(JSON.stringify({ type: "start_race" }));

    const hostStart = await host.inbox.waitFor((packet) => packet.type === "race_start", 1000);
    const joinerStart = await joiner.inbox.waitFor(
      (packet) => packet.type === "race_start" && packet.startTime === hostStart.startTime,
      1000,
    );
    expect(joinerStart.startTime).toBe(hostStart.startTime);

    await joiner.inbox.waitFor(
      (packet) => packet.type === "raceStart" && packet.startTime === hostStart.startTime,
      1000,
    );

    const duplicateForHost = host.inbox.waitForNext(
      (packet) => packet.type === "race_start" && packet.startTime === hostStart.startTime,
      1000,
    );
    const unexpectedNewForJoiner = joiner.inbox.waitForNext(
      (packet) => packet.type === "race_start" && packet.startTime !== hostStart.startTime,
      300,
    );

    host.socket.send(JSON.stringify({ type: "start_race" }));

    await expect(duplicateForHost).resolves.toBeTruthy();
    await expect(unexpectedNewForJoiner).rejects.toThrow("Timed out waiting for packet");

    joiner.socket.close();
    await host.inbox.waitFor(
      (packet) =>
        (packet.type === "playerLeft" || packet.type === "player_leave") && packet.playerId === "joiner-start",
      1000,
    );

    const reconnectingJoiner = await attachPlayer(room, "ROOM_START", "joiner-start");
    await reconnectingJoiner.inbox.waitFor(
      (packet) => packet.type === "race_start" && packet.startTime === hostStart.startTime,
      1000,
    );
    await reconnectingJoiner.inbox.waitFor(
      (packet) => packet.type === "raceStart" && packet.startTime === hostStart.startTime,
      1000,
    );
  });

  it("relays movement updates in both directions while preserving compatible aliases", async () => {
    const room = await createRoom();
    const host = await attachPlayer(room, "ROOM_MOVE", "host-move");
    const joiner = await attachPlayer(room, "ROOM_MOVE", "joiner-move");

    host.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "room_move",
        playerId: "host-move",
        position: { x: 11, y: 0, z: 9 },
        rotation: { x: 0, y: 0.2, z: 0, w: 0.98 },
        speed: 45,
        steering: 0.2,
        wheelRotation: 1.1,
        nitro: false,
        drift: false,
        timestamp: Date.now(),
      }),
    );

    const hostSeenByJoiner = await joiner.inbox.waitFor(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "host-move",
      1000,
    );
    expect(hostSeenByJoiner.roomCode).toBe("ROOM_MOVE");
    expect(hostSeenByJoiner.position).toEqual({ x: 11, y: 0, z: 9 });

    joiner.socket.send(
      JSON.stringify({
        type: "vehicle_update",
        roomCode: "ROOM_MOVE",
        playerId: "joiner-move",
        position: { x: 4, y: 0, z: 13 },
        rotation: { x: 0, y: 0.4, z: 0, w: 0.9 },
        speed: 33,
        steering: -0.1,
        wheelRotation: 1.7,
        nitro: true,
        drift: true,
        timestamp: Date.now(),
      }),
    );

    const joinerSeenByHost = await host.inbox.waitFor(
      (packet) => packet.type === "vehicle_update" && packet.playerId === "joiner-move",
      1000,
    );
    expect(joinerSeenByHost.position).toEqual({ x: 4, y: 0, z: 13 });
  });

  it("rejects spoofed and malformed vehicle updates", async () => {
    const room = await createRoom();
    const host = await attachPlayer(room, "ROOM_VALIDATE", "host-validate");
    const joiner = await attachPlayer(room, "ROOM_VALIDATE", "joiner-validate");

    const spoofedIdentity = host.inbox.waitForNext(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "host-validate" && packet.position?.x === 901,
      300,
    );

    joiner.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "ROOM_VALIDATE",
        playerId: "host-validate",
        position: { x: 901, y: 0, z: 1 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    );

    await expect(spoofedIdentity).rejects.toThrow("Timed out waiting for packet");

    const wrongRoom = host.inbox.waitForNext(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "joiner-validate" && packet.position?.x === 902,
      300,
    );

    joiner.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "OTHER_ROOM",
        playerId: "joiner-validate",
        position: { x: 902, y: 0, z: 1 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    );

    await expect(wrongRoom).rejects.toThrow("Timed out waiting for packet");

    const malformedPayload = host.inbox.waitForNext(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "joiner-validate" && packet.position?.x === 903,
      300,
    );

    joiner.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "ROOM_VALIDATE",
        playerId: "joiner-validate",
        position: { x: "903", y: 0, z: 1 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    );

    await expect(malformedPayload).rejects.toThrow("Timed out waiting for packet");
  });

  it("replays latestStates and avoids duplicate playerJoined on socket replacement reconnect", async () => {
    const room = await createRoom();
    const host = await attachPlayer(room, "ROOM_REPLAY", "host-replay");
    const joiner = await attachPlayer(room, "ROOM_REPLAY", "joiner-replay");

    host.socket.send(
      JSON.stringify({
        type: "vehicleUpdate",
        roomCode: "ROOM_REPLAY",
        playerId: "host-replay",
        position: { x: 77, y: 0, z: 5 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        speed: 28,
        steering: 0,
        wheelRotation: 0,
        nitro: false,
        drift: false,
        timestamp: Date.now(),
      }),
    );

    await joiner.inbox.waitFor(
      (packet) => packet.type === "vehicleUpdate" && packet.playerId === "host-replay",
      1000,
    );

    const duplicateJoinNotice = host.inbox.waitForNext(
      (packet) =>
        (packet.type === "playerJoined" || packet.type === "player_join") && packet.playerId === "joiner-replay",
      300,
    );

    const replacement = await attachPlayer(room, "ROOM_REPLAY", "joiner-replay");
    await expect(duplicateJoinNotice).rejects.toThrow("Timed out waiting for packet");

    const replayedList = await replacement.inbox.waitFor(
      (packet) => packet.type === "player_list" && packet.latestStates?.["host-replay"],
      1000,
    );

    expect(replayedList.latestStates["host-replay"].position).toEqual({ x: 77, y: 0, z: 5 });
    expect(joiner.socket.readyState).toBe(3);
  });
});
