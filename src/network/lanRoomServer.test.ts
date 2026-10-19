import { describe, expect, it } from "vitest";

import { LanRoomStore } from "./lanRoomServer";

function expectLanError(fn: () => unknown, expectedStatus: number) {
  try {
    fn();
    throw new Error("Expected LAN error but function succeeded");
  } catch (error: any) {
    expect(error?.status).toBe(expectedStatus);
  }
}

describe("LanRoomStore", () => {
  it("creates rooms, joins players, toggles ready, and advances countdown to racing", () => {
    let now = 1_000_000;
    const store = new LanRoomStore(() => now);

    const created = store.createRoom("Host Racer", 6);
    expect(created.room.status).toBe("waiting");
    expect(created.room.players.length).toBe(1);
    expect(created.session.isHost).toBe(true);

    const joined = store.joinRoom(created.room.roomCode, "Guest Racer");
    expect(joined.room.players.length).toBe(2);
    expect(joined.session.isHost).toBe(false);

    const readyRoom = store.setReady(
      created.room.roomCode,
      joined.session.playerId,
      joined.session.authToken,
      true,
    );
    const guestReady = readyRoom.players.find((player) => player.playerId === joined.session.playerId);
    expect(guestReady?.ready).toBe(true);

    const countdownRoom = store.startRace(created.room.roomCode, created.session.playerId, created.session.authToken);
    expect(countdownRoom.status).toBe("countdown");
    expect(typeof countdownRoom.raceStartTime).toBe("number");

    now += 6000;
    const advanced = store.getRoom(created.room.roomCode);
    expect(advanced.status).toBe("racing");
  });

  it("supports reconnect with token validation", () => {
    const store = new LanRoomStore();
    const created = store.createRoom("Reconnect Host");

    const ok = store.reconnect(created.room.roomCode, created.session.playerId, created.session.authToken);
    expect(ok.session.playerId).toBe(created.session.playerId);
    expect(ok.session.authToken).toBe(created.session.authToken);

    expectLanError(() => {
      store.reconnect(created.room.roomCode, created.session.playerId, "wrong-token");
    }, 403);
  });

  it("enforces host-only race start and keeps start_race idempotent within replay window", () => {
    let now = 50_000;
    const store = new LanRoomStore(() => now);

    const created = store.createRoom("Host");
    const guest = store.joinRoom(created.room.roomCode, "Guest");

    expectLanError(() => {
      store.startRace(created.room.roomCode, guest.session.playerId, guest.session.authToken);
    }, 403);

    const first = store.startRace(created.room.roomCode, created.session.playerId, created.session.authToken);
    const firstStart = first.raceStartTime;
    expect(typeof firstStart).toBe("number");

    now += 1000;
    const repeated = store.startRace(created.room.roomCode, created.session.playerId, created.session.authToken);
    expect(repeated.raceStartTime).toBe(firstStart);

    now += 35_000;
    const fresh = store.startRace(created.room.roomCode, created.session.playerId, created.session.authToken);
    expect((fresh.raceStartTime || 0) > (firstStart || 0)).toBe(true);
  });

  it("handles leave flow and host transfer or closure", () => {
    const store = new LanRoomStore();
    const created = store.createRoom("Host");
    const guest = store.joinRoom(created.room.roomCode, "Guest");

    const guestLeave = store.leaveRoom(created.room.roomCode, guest.session.playerId, guest.session.authToken);
    expect(guestLeave.closed).toBe(false);
    expect(guestLeave.room?.players.length).toBe(1);

    const hostLeave = store.leaveRoom(created.room.roomCode, created.session.playerId, created.session.authToken);
    expect(hostLeave.closed).toBe(true);
    expect(hostLeave.room).toBeNull();
  });

  it("validates relay membership tokens while allowing unknown non-LAN room codes", () => {
    const store = new LanRoomStore();
    const created = store.createRoom("Relay Host");

    expect(store.validateMembershipForRelay("unknown-room", "any-player", "any-token")).toBe(true);
    expect(
      store.validateMembershipForRelay(created.room.roomCode, created.session.playerId, created.session.authToken),
    ).toBe(true);

    expect(store.validateMembershipForRelay(created.room.roomCode, created.session.playerId, "wrong-token")).toBe(
      false,
    );
    expect(store.validateMembershipForRelay(created.room.roomCode, created.session.playerId)).toBe(false);
    expect(store.validateMembershipForRelay(created.room.roomCode, "missing-player", created.session.authToken)).toBe(
      false,
    );
  });
});
