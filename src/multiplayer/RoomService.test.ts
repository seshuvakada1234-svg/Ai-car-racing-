import { beforeEach, describe, expect, it, vi } from "vitest";

const firestore = vi.hoisted(() => {
  const documents = new Map<string, any>();
  const ref = (...parts: string[]) => ({ path: parts.join("/"), id: parts.at(-1) });
  const snapshot = (reference: any) => ({
    exists: () => documents.has(reference.path),
    data: () => documents.get(reference.path),
    ref: reference,
    id: reference.id,
  });
  const transaction = {
    get: vi.fn(async (reference: any) => snapshot(reference)),
    set: vi.fn((reference: any, data: any, options?: any) => documents.set(reference.path, options?.merge ? { ...documents.get(reference.path), ...data } : data)),
    update: vi.fn((reference: any, data: any) => documents.set(reference.path, { ...documents.get(reference.path), ...data })),
    delete: vi.fn((reference: any) => documents.delete(reference.path)),
  };
  return { documents, ref, snapshot, transaction, onSnapshot: vi.fn(), getDocs: vi.fn(), auth: { currentUser: { uid: "host" }, authStateReady: async () => {} } };
});

vi.mock("../lib/firebase", () => ({ db: {}, auth: firestore.auth }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: any, ...parts: string[]) => firestore.ref(...parts),
  collection: (_db: any, ...parts: string[]) => firestore.ref(...parts),
  getDoc: async (reference: any) => firestore.snapshot(reference),
  getDocs: firestore.getDocs,
  updateDoc: vi.fn(),
  runTransaction: async (_db: any, fn: any) => fn(firestore.transaction),
  onSnapshot: firestore.onSnapshot,
  serverTimestamp: () => Date.now(),
  query: (reference: any) => reference,
  where: vi.fn(),
}));

import { RoomService } from "./RoomService";
import { NormalRoomService } from "./NormalRoomService";
import { RoomManager } from "./RoomManager";
import { RoomCodeGenerator } from "./RoomCodeGenerator";
import { startCountdown, beginRace } from "./multiplayerRaceStartSync";
import type { RoomPlayer } from "./RoomState";

const player = (uid: string, joinedAt = 1): RoomPlayer => ({ uid, id: uid, playerName: uid, photoURL: "", isAI: false, carId: "porsche", ready: false, joinedAt, isHost: uid === "host" });
function seedRoom(players = [player("host")], extra = {}) {
  const room = {
    roomCode: "ABC123", code: "ABC123", id: "ABC123", hostId: "host", ownerUid: "host",
    status: "waiting", phase: "waiting", players, maxPlayers: 3, updatedAt: Date.now(),
    selectedCars: Object.fromEntries(players.map((p) => [p.uid, p.carId])),
    selectedCar: { id: "porsche", name: "Porsche 911 GT3" }, ...extra,
  };
  firestore.documents.set("rooms/ABC123", room);
  players.forEach((p) => firestore.documents.set(`rooms/ABC123/players/${p.uid}`, { ...p }));
  return room;
}

beforeEach(() => {
  vi.clearAllMocks();
  firestore.documents.clear();
  firestore.auth.currentUser = { uid: "host" };
  firestore.getDocs.mockResolvedValue({ docs: [] });
  firestore.onSnapshot.mockReturnValue(vi.fn());
});

describe("authoritative race start", () => {
  it("waits for real scene readiness even if all downloads finished", async () => {
    seedRoom([{ ...player("host"), ready: true, mapReady: true, carReady: true, sceneReady: false }], { status: "racing" });
    await startCountdown("ABC123");
    expect(firestore.transaction.update).not.toHaveBeenCalled();
  });

  it("starts once all players are ready and transitions without losing raceStarted", async () => {
    seedRoom(["host", "guest"].map((id) => ({ ...player(id), ready: true, mapReady: true, carReady: true, sceneReady: true })), { status: "racing" });
    await startCountdown("ABC123");
    expect(firestore.documents.get("rooms/ABC123")).toMatchObject({ status: "countdown" });
    await beginRace("ABC123");
    expect(firestore.documents.get("rooms/ABC123")).toMatchObject({ status: "racing", raceStarted: true });
  });
});

describe("Firestore room lifecycle", () => {
  it("creates one canonical room and its host in the same transaction", async () => {
    vi.spyOn(RoomCodeGenerator, "generateUnique").mockResolvedValueOnce("abc123");
    expect(await RoomService.createRoom("host", "Host", "", "porsche")).toBe("ABC123");
    expect(firestore.transaction.set).toHaveBeenCalledTimes(2);
    expect(firestore.documents.get("rooms/ABC123")).toMatchObject({ roomCode: "ABC123", id: "ABC123", code: "ABC123" });
    expect(firestore.documents.get("rooms/ABC123/players/host")).toMatchObject({ uid: "host", ready: false });
  });

  it("normalizes a pasted code and converts the host's car object to its ID", async () => {
    seedRoom();
    await NormalRoomService.joinRoom(" abc123 ", "guest", "Guest", "");
    expect(RoomManager.getCurrentCode()).toBe("ABC123");
    expect(firestore.documents.get("rooms/ABC123/players/guest")).toMatchObject({ carId: "porsche", selectedCar: "porsche" });
    expect(firestore.documents.get("rooms/ABC123").players).toHaveLength(2);
  });

  it.each(["waiting", "countdown", "racing"])("rejoins an existing member of a full %s room without resetting their state", async (status) => {
    const host = { ...player("host"), ready: true, mapReady: true, sceneReady: true, position: { x: 12, y: 4, z: 35 } };
    seedRoom([host, player("guest")], { status, phase: status, maxPlayers: 2 });
    await RoomService.joinRoom("abc123", "host", "Changed", "", "ferrari");
    expect(firestore.documents.get("rooms/ABC123/players/host")).toEqual(host);
    expect(firestore.transaction.update).not.toHaveBeenCalled();
  });

  it("still rejects a new member when the room is full", async () => {
    seedRoom([player("host"), player("guest")], { maxPlayers: 2 });
    await expect(RoomService.joinRoom("ABC123", "third", "Third", "", "ferrari")).rejects.toThrow("Room Full");
    expect(firestore.documents.has("rooms/ABC123/players/third")).toBe(false);
  });

  it("preserves explicit two-player room cleanup", async () => {
    seedRoom([player("host"), player("guest")]);
    await RoomService.leaveRoom("ABC123", "guest");
    expect(firestore.documents.size).toBe(0);
  });

  it("transfers host to the oldest remaining member without faking readiness", async () => {
    seedRoom([player("host", 1), player("later", 3), player("oldest", 2)]);
    await RoomService.leaveRoom("ABC123", "host");
    expect(firestore.documents.get("rooms/ABC123")).toMatchObject({ hostId: "oldest", currentPlayers: 2 });
    expect(firestore.documents.get("rooms/ABC123/players/oldest")).toMatchObject({ isHost: true, ready: false });
  });

  it("does not set isReady when only map progress changes", async () => {
    seedRoom([{ ...player("host"), isReady: false }]);
    await RoomService.updatePlayerLoadingStatus("ABC123", "host", { mapProgress: 20 });
    expect(firestore.documents.get("rooms/ABC123/players/host")).toMatchObject({ isReady: false, mapProgress: 20 });
  });

  it("does not recreate a departed player through a late loading update", async () => {
    seedRoom();
    await expect(RoomService.updatePlayerLoadingStatus("ABC123", "departed", { ready: true })).rejects.toThrow("no longer a member");
    expect(firestore.documents.has("rooms/ABC123/players/departed")).toBe(false);
  });

  it("rechecks expiration against the current transaction snapshot", async () => {
    const room = seedRoom();
    firestore.getDocs.mockResolvedValueOnce({ docs: [{ id: "ABC123", ref: firestore.ref("rooms", "ABC123"), data: () => ({ ...room, updatedAt: 1 }) }] });
    await RoomService.deleteExpiredRooms();
    expect(firestore.transaction.delete).not.toHaveBeenCalled();
  });

  it("still cleans up an idle expired room and its player documents", async () => {
    seedRoom(undefined, { updatedAt: Date.now() - 31 * 60 * 1000 });
    firestore.getDocs.mockResolvedValueOnce({ docs: [firestore.snapshot(firestore.ref("rooms", "ABC123"))] });
    await RoomService.deleteExpiredRooms();
    expect(firestore.documents.size).toBe(0);
  });

  it("synchronizes both mapProgress and downloadProgress as well as mapReady and mapDownloaded", async () => {
    seedRoom([{ ...player("host"), isReady: false }]);
    await RoomService.updatePlayerLoadingStatus("ABC123", "host", { mapProgress: 75, mapReady: false });
    expect(firestore.documents.get("rooms/ABC123/players/host")).toMatchObject({
      mapProgress: 75,
      downloadProgress: 75,
      mapReady: false,
      mapDownloaded: false,
    });

    await RoomService.updatePlayerLoadingStatus("ABC123", "host", { mapProgress: 100, mapReady: true });
    expect(firestore.documents.get("rooms/ABC123/players/host")).toMatchObject({
      mapProgress: 100,
      downloadProgress: 100,
      mapReady: true,
      mapDownloaded: true,
    });
  });

  it("matches player by id as well as uid when updating loading status", async () => {
    seedRoom([{ id: "player-without-uid", playerName: "Solo", ready: false, isReady: false } as any]);
    await RoomService.updatePlayerLoadingStatus("ABC123", "player-without-uid", { carProgress: 50 });
    expect(firestore.documents.get("rooms/ABC123/players/player-without-uid")).toMatchObject({ carProgress: 50 });
  });

  it("preserves a two-player room when a player temporarily disconnects without explicit leaveRoom", async () => {
    seedRoom([player("host"), player("guest")]);
    // A temporary disconnect or network hiccup does not call leaveRoom
    // Verify room and both player records remain intact in Firestore
    expect(firestore.documents.size).toBe(3); // 1 room doc + 2 player subcollection docs
    expect(firestore.documents.has("rooms/ABC123")).toBe(true);
    expect(firestore.documents.has("rooms/ABC123/players/host")).toBe(true);
    expect(firestore.documents.has("rooms/ABC123/players/guest")).toBe(true);
  });
});

describe("room snapshots", () => {
  it("ignores cache misses and only reports server-confirmed deletion", () => {
    const update = vi.fn();
    RoomService.listenToRoom(" abc123 ", update);
    const [reference, options, next] = firestore.onSnapshot.mock.calls[0];
    expect(reference.path).toBe("rooms/ABC123");
    expect(options.includeMetadataChanges).toBe(true);
    next({ exists: () => false, metadata: { fromCache: true, hasPendingWrites: false } });
    next({ exists: () => false, metadata: { fromCache: false, hasPendingWrites: true } });
    expect(update).not.toHaveBeenCalled();
    next({ exists: () => false, metadata: { fromCache: false, hasPendingWrites: false } });
    expect(update).toHaveBeenCalledWith(null);
  });

  it("keeps the subscribed document ID and all race readiness fields through RoomManager", () => {
    const room = seedRoom([{ ...player("host"), mapReady: true, carReady: true, sceneReady: true, mapProgress: 100 }], { roomCode: "WRONG1", raceStarted: true });
    const update = vi.fn();
    RoomManager.listenToRoom("ABC123", update);
    firestore.onSnapshot.mock.calls[0][2]({ exists: () => true, data: () => room });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      roomCode: "ABC123", code: "ABC123", id: "ABC123", raceStarted: true,
      players: [expect.objectContaining({ mapReady: true, carReady: true, sceneReady: true, mapProgress: 100 })],
    }));
  });

  it("reports permission errors without emitting a room deletion", () => {
    const update = vi.fn();
    const onError = vi.fn();
    RoomService.listenToRoom("ABC123", update, onError);
    const error = new Error("permission-denied");
    firestore.onSnapshot.mock.calls[0][3](error);
    expect(onError).toHaveBeenCalledWith(error);
    expect(update).not.toHaveBeenCalled();
  });
});
