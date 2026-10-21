import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: "host" } as { uid: string } | null },
  authListeners: new Set<() => void>(),
  listenToRoom: vi.fn(),
  leaveRoom: vi.fn(),
}));
vi.mock("../lib/firebase", () => ({ auth: mocks.auth }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: any, listener: () => void) => {
    mocks.authListeners.add(listener);
    return () => mocks.authListeners.delete(listener);
  },
}));
vi.mock("../multiplayer/RoomService", () => ({ RoomService: { listenToRoom: mocks.listenToRoom, leaveRoom: mocks.leaveRoom } }));

import { useRoom } from "./useRoom";
import { RoomManager } from "../multiplayer/RoomManager";

const room = (code: string) => ({ roomCode: code, hostId: "host", players: [], status: "waiting" });
beforeEach(() => {
  RoomManager.clearSession(RoomManager.getCurrentCode() || "");
  window.localStorage?.clear();
  window.sessionStorage?.clear();
  mocks.auth.currentUser = { uid: "host" };
  vi.clearAllMocks();
  mocks.listenToRoom.mockReturnValue(vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("shared room subscription timing", () => {
  it("keeps the first render connecting until the requested room snapshot arrives", () => {
    const { result } = renderHook(() => useRoom(" abc123 "));
    expect(result.current).toMatchObject({ roomCode: "ABC123", loading: true, roomMissing: false, room: null });
    act(() => mocks.listenToRoom.mock.calls[0][1](room("ABC123")));
    expect(result.current).toMatchObject({ loading: false, roomMissing: false, room: { roomCode: "ABC123" } });
  });

  it("waits for Firebase authentication before attaching Firestore", () => {
    mocks.auth.currentUser = null;
    const { result } = renderHook(() => useRoom("ABC123"));
    expect(mocks.listenToRoom).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    act(() => {
      mocks.auth.currentUser = { uid: "host" };
      mocks.authListeners.forEach((listener) => listener());
    });
    expect(mocks.listenToRoom).toHaveBeenCalledTimes(1);
  });

  it("switches rooms on URL changes and ignores late events from the old room", () => {
    const { result, rerender } = renderHook(({ code }) => useRoom(code), { initialProps: { code: "OLD123" } });
    const oldListener = mocks.listenToRoom.mock.calls[0][1];
    act(() => oldListener(room("OLD123")));
    rerender({ code: "NEW123" });
    expect(result.current).toMatchObject({ room: null, roomCode: "NEW123", loading: true, roomMissing: false });
    act(() => oldListener(null));
    expect(result.current.roomMissing).toBe(false);
    act(() => mocks.listenToRoom.mock.calls.at(-1)![1](room("NEW123")));
    expect(result.current.room?.roomCode).toBe("NEW123");
  });

  it("shares one listener across components and unmounting never leaves the room", () => {
    const first = renderHook(() => useRoom("ABC123"));
    const second = renderHook(() => useRoom("ABC123"));
    expect(mocks.listenToRoom).toHaveBeenCalledTimes(1);
    const unsubscribe = mocks.listenToRoom.mock.results[0].value;
    first.unmount();
    expect(unsubscribe).not.toHaveBeenCalled();
    second.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.leaveRoom).not.toHaveBeenCalled();
    expect(RoomManager.getCurrentCode()).toBe("ABC123");
  });

  it("distinguishes subscription errors from missing rooms and allows retry", () => {
    const { result } = renderHook(() => useRoom("ABC123"));
    act(() => mocks.listenToRoom.mock.calls[0][2](new Error("permission-denied")));
    expect(result.current).toMatchObject({ error: "permission-denied", roomMissing: false, loading: false });
    act(() => result.current.retryRoom());
    expect(mocks.listenToRoom).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(true);
  });

  it("does not switch to another tab's room after an explicit session clear", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    RoomManager.rememberSession("ABC123");
    window.localStorage.setItem("activeRoomCode", "OTHER1");
    RoomManager.clearSession("ABC123");
    expect(window.localStorage.getItem("activeRoomCode")).toBe("OTHER1");
    expect(RoomManager.getCurrentCode()).toBeNull();
  });
});
