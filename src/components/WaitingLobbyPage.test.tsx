import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toggleReady: vi.fn(),
  setRoomStatus: vi.fn(),
  updateRoomSettings: vi.fn(),
  leaveOrCancelRoom: vi.fn(),
  joinRoom: vi.fn(),
  loadRacingMap: vi.fn(),
  profile: { uid: "host-uid", name: "Host Player", photoURL: "" },
  roomListeners: new Set<(room: any) => void>(),
  playerListeners: new Set<(players: any[]) => void>(),
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ profile: mocks.profile, user: { uid: mocks.profile.uid } }),
}));

vi.mock("../multiplayer/NormalRoomService", () => ({
  NormalRoomService: {
    listenToRoom: (code: string, cb: (room: any) => void) => {
      mocks.roomListeners.add(cb);
      return () => mocks.roomListeners.delete(cb);
    },
    listenToPlayers: (code: string, cb: (players: any[]) => void) => {
      mocks.playerListeners.add(cb);
      return () => mocks.playerListeners.delete(cb);
    },
    updatePlayerDownloadStatus: vi.fn().mockResolvedValue(undefined),
    toggleReady: mocks.toggleReady,
    setRoomStatus: mocks.setRoomStatus,
    updateRoomSettings: mocks.updateRoomSettings,
    leaveOrCancelRoom: mocks.leaveOrCancelRoom,
    joinRoom: mocks.joinRoom,
  },
}));

vi.mock("../services/racingMapAsset", () => ({
  loadRacingMap: (onProgress?: (progress: any) => void) => {
    onProgress?.({ percentage: 100, stage: "cache", bytesLoaded: 1000, bytesTotal: 1000 });
    return Promise.resolve({ buffer: new ArrayBuffer(8) });
  },
}));

vi.mock("../multiplayer/multiplayerRaceStartSync", () => ({
  measureServerTimeOffset: vi.fn().mockResolvedValue(0),
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn((_, cb) => {
    cb({ docs: [] });
    return () => {};
  }),
}));

vi.mock("../lib/firebase", () => ({
  db: {},
  auth: { currentUser: { uid: "host-uid" } },
}));

import { WaitingLobbyPage } from "./WaitingLobbyPage";

function renderLobby() {
  return render(
    <MemoryRouter initialEntries={["/room/ABC123"]}>
      <Routes>
        <Route path="/room/:roomCode" element={<WaitingLobbyPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function emitRoomState(room: any) {
  mocks.roomListeners.forEach((listener) => listener(room));
}

function emitPlayersState(players: any[]) {
  mocks.playerListeners.forEach((listener) => listener(players));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.roomListeners.clear();
  mocks.playerListeners.clear();
  mocks.profile = { uid: "host-uid", name: "Host Player", photoURL: "" };
  mocks.toggleReady.mockResolvedValue(undefined);
  mocks.setRoomStatus.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("WaitingLobbyPage Host and Guest Readiness", () => {
  const baseRoom = {
    roomCode: "ABC123",
    ownerUid: "host-uid",
    ownerName: "Host Player",
    hostId: "host-uid",
    selectedCar: "ferrari",
    mapId: "race2map",
    status: "waiting",
    maxPlayers: 3,
    players: ["host-uid", "guest-uid"],
  };

  const initialPlayers = [
    {
      uid: "host-uid",
      playerName: "Host Player",
      photoURL: "",
      ready: false,
      mapReady: true,
      mapDownloaded: true,
      carId: "ferrari",
    },
    {
      uid: "guest-uid",
      playerName: "Guest Racer",
      photoURL: "",
      ready: false,
      mapReady: true,
      mapDownloaded: true,
      carId: "porsche",
    },
  ];

  it("renders a READY UP button for the host alongside a disabled START RACE button", async () => {
    renderLobby();
    emitRoomState(baseRoom);
    emitPlayersState(initialPlayers);

    const readyButton = await screen.findByRole("button", { name: /ready up/i });
    expect(readyButton).toBeInTheDocument();

    const startButton = screen.getByRole("button", { name: /start race/i });
    expect(startButton).toBeDisabled();
  });

  it("allows host to explicitly toggle readiness with their Firebase UID", async () => {
    renderLobby();
    emitRoomState(baseRoom);
    emitPlayersState(initialPlayers);

    const readyButton = await screen.findByRole("button", { name: /ready up/i });
    await waitFor(() => expect(readyButton).toBeEnabled());
    fireEvent.click(readyButton);

    expect(mocks.toggleReady).toHaveBeenCalledWith("ABC123", "host-uid", true);
  });

  it("enables the separate START RACE button when both host and guest are ready and map is downloaded", async () => {
    renderLobby();
    emitRoomState(baseRoom);
    emitPlayersState([
      { ...initialPlayers[0], ready: true },
      { ...initialPlayers[1], ready: true },
    ]);

    const startButton = await screen.findByRole("button", { name: /start race/i });
    await waitFor(() => expect(startButton).toBeEnabled());

    fireEvent.click(startButton);
    expect(mocks.setRoomStatus).toHaveBeenCalledWith("ABC123", "racing");
  });

  it("disables START RACE button and allows canceling readiness when a player clicks READY (CANCEL)", async () => {
    renderLobby();
    emitRoomState(baseRoom);
    emitPlayersState([
      { ...initialPlayers[0], ready: true },
      { ...initialPlayers[1], ready: true },
    ]);

    const cancelButton = await screen.findByRole("button", { name: /ready \(cancel\)/i });
    expect(cancelButton).toBeInTheDocument();

    const startButton = screen.getByRole("button", { name: /start race/i });
    await waitFor(() => expect(startButton).toBeEnabled());

    // Host cancels ready state
    fireEvent.click(cancelButton);
    expect(mocks.toggleReady).toHaveBeenCalledWith("ABC123", "host-uid", false);

    // Simulate guest cancelling readiness
    emitPlayersState([
      { ...initialPlayers[0], ready: true },
      { ...initialPlayers[1], ready: false },
    ]);

    await waitFor(() => expect(startButton).toBeDisabled());
  });

  it("renders guest ready toggle for guest player without START RACE button", async () => {
    mocks.profile = { uid: "guest-uid", name: "Guest Racer", photoURL: "" };
    renderLobby();
    emitRoomState(baseRoom);
    emitPlayersState(initialPlayers);

    const readyButton = await screen.findByRole("button", { name: /ready up/i });
    expect(readyButton).toBeInTheDocument();

    // Guest should NOT see the START RACE button
    expect(screen.queryByRole("button", { name: /start race/i })).toBeNull();

    await waitFor(() => expect(readyButton).toBeEnabled());
    fireEvent.click(readyButton);
    expect(mocks.toggleReady).toHaveBeenCalledWith("ABC123", "guest-uid", true);
  });
});
