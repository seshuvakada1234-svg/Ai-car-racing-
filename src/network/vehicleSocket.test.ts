import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectVehicleSocket, disconnectVehicleSocket, resolveVehicleSocketUrl, sendVehicleUpdate } from "./vehicleSocket";

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen?: () => void;
  onclose?: (event: any) => void;
  onmessage?: (event: any) => void;
  onerror?: (event: any) => void;
  send = vi.fn();
  constructor(public url: string) { TestSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: "" }); }
  loseConnection() { this.readyState = 3; this.onclose?.({ code: 1006, reason: "" }); }
}

beforeEach(() => {
  vi.useFakeTimers();
  TestSocket.instances = [];
  vi.stubGlobal("WebSocket", TestSocket);
});
afterEach(() => { disconnectVehicleSocket(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("vehicle relay lifecycle", () => {
  it("accepts a complete worker endpoint without appending /ws twice", () => {
    const url = new URL(resolveVehicleSocketUrl("https://relay.example/ws", "https://game.example/race/abc123", " abc123 ", "player-uid"));
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe("/ws");
    expect(url.searchParams.get("roomCode")).toBe("ABC123");
    expect(new URL(resolveVehicleSocketUrl("", "http://localhost:3000/", "ABC123", "host")).pathname).toBe("/ws/vehicle");
  });

  it("reconnects after a temporary disconnect using the same room and Firebase UID", async () => {
    connectVehicleSocket(" abc123 ", "firebase-uid", vi.fn(), vi.fn());
    const first = TestSocket.instances[0];
    first.open();
    first.loseConnection();
    await vi.advanceTimersByTimeAsync(1000);
    const second = TestSocket.instances[1];
    expect(second.url).toBe(first.url);
    second.open();
    expect(JSON.parse(second.send.mock.calls[0][0])).toEqual({ type: "join", roomCode: "ABC123", playerId: "firebase-uid" });
    sendVehicleUpdate({ position: { x: 1, y: 2, z: 3 }, angle: 0 });
    expect(JSON.parse(second.send.mock.calls.at(-1)![0])).toMatchObject({ roomCode: "ABC123", playerId: "firebase-uid" });
  });

  it("cancels pending reconnects when a component unmounts or leaves", async () => {
    const cleanup = connectVehicleSocket("ABC123", "host", vi.fn(), vi.fn());
    TestSocket.instances[0].loseConnection();
    cleanup();
    await vi.advanceTimersByTimeAsync(60000);
    expect(TestSocket.instances).toHaveLength(1);
  });

  it("ignores stale/cross-room updates", () => {
    const update = vi.fn();
    connectVehicleSocket("ABC123", "host", update, vi.fn());
    const first = TestSocket.instances[0];
    first.onmessage?.({ data: JSON.stringify({ type: "vehicleUpdate", roomCode: "OTHER1", playerId: "guest" }) });
    expect(update).not.toHaveBeenCalled();
    connectVehicleSocket("NEW123", "host", update, vi.fn());
    first.onmessage?.({ data: JSON.stringify({ type: "vehicleUpdate", roomCode: "ABC123", playerId: "guest" }) });
    expect(update).not.toHaveBeenCalled();
  });
});
