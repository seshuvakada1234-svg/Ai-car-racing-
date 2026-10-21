import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeGlb } from "../test/glbFixture";

const mocks = vi.hoisted(() => ({
  map: vi.fn(), car: vi.fn(), status: vi.fn(), retry: vi.fn(),
  room: { roomCode: "ABC123", id: "ABC123", map: "race2map", hostId: "host", status: "racing", difficulty: "medium",
    players: ["host", "guest"].map((id) => ({ uid: id, id, carId: "porsche", ready: false, isAI: false })) },
}));
vi.mock("../hooks/useMultiplayer", () => ({ useMultiplayer: () => ({
  room: mocks.room,
  playerId: "host", isConnecting: false, roomMissing: false, error: null, retryRoom: mocks.retry,
  leaveRoom: vi.fn(), sendLocalCar: vi.fn(), sendAICars: vi.fn(),
}) }));
vi.mock("../multiplayer/RoomManager", () => ({ RoomManager: { getCurrentPlayerId: () => "host", getCurrentCode: () => "ABC123", clearSession: vi.fn() } }));
vi.mock("../multiplayer/NormalRoomService", () => ({ NormalRoomService: { updatePlayerLoadingStatus: mocks.status, listenToPlayers: () => () => {} } }));
vi.mock("../services/racingMapAsset", () => ({ loadRacingMap: mocks.map }));
vi.mock("../services/assetLoadingManager", () => ({ verifyCar: mocks.car, getNormalizedCarKey: () => "porsche_911_gt3" }));
vi.mock("../world/procedural", () => ({ setPlayerSelectedModelKey: vi.fn() }));
vi.mock("../world/Racing2World", () => ({ Racing2World: class {
  gridSpawns = [0, 1].map((x) => ({ position: { x, y: 2, z: 3 }, headingY: 0 }));
  readyPromise = Promise.resolve(this);
  dispose() {}
} }));
vi.mock("../network/vehicleSocket", () => ({ connectVehicleSocket: () => () => {}, sendVehicleUpdate: vi.fn(), triggerWsStartRace: vi.fn() }));
vi.mock("../multiplayer/multiplayerRaceStartSync", () => ({ measureServerTimeOffset: vi.fn(), startCountdown: vi.fn(), beginRace: vi.fn(), getSynchronizedServerTime: () => Date.now() }));
vi.mock("./GameCanvas", () => ({ GameCanvas: () => <div data-testid="game-canvas" /> }));
vi.mock("./HUD", () => ({ HUD: () => null }));
vi.mock("./MultiplayerRaceLoadingScreen", () => ({ MultiplayerRaceLoadingScreen: (props: any) => <div data-testid="race-loader" data-map-ready={props.mapDownloadReady} data-parsed={props.glbParsed} /> }));
import { UserRacePage } from "./UserRacePage";

function showRace() {
  return render(<MemoryRouter initialEntries={["/race/ABC123"]}><Routes><Route path="/race/:roomCode" element={<UserRacePage />} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue(undefined);
  mocks.car.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("race initialization failures and retry", () => {
  it("reports the actual map exception without declaring physics/spawn failures", async () => {
    mocks.map.mockRejectedValueOnce(new Error("Map upstream HTTP 503"));
    showRace();
    await screen.findByText("Map upstream HTTP 503");
    expect(screen.getByText("6. Physics Service:").parentElement).toHaveTextContent("PENDING");
    expect(screen.getByText("7. Spawn Lineup:").parentElement).toHaveTextContent("PENDING");
    expect(mocks.car).not.toHaveBeenCalled();
    expect(mocks.status.mock.calls.some(([, , status]) => status.mapReady === true || status.ready === true)).toBe(false);
  });

  it("keeps a progressing/loading map pending after the old 15-second cutoff", async () => {
    vi.useFakeTimers();
    mocks.map.mockReturnValueOnce(new Promise(() => {}));
    showRace();
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(screen.getByTestId("race-loader")).toHaveAttribute("data-map-ready", "false");
    expect(screen.queryByText("INITIALIZATION FAILED")).toBeNull();
  });

  it("restarts asset initialization when Retry is clicked and handles cached car readiness", async () => {
    mocks.map.mockRejectedValueOnce(new Error("Temporary map failure")).mockResolvedValueOnce({ buffer: makeGlb() });
    showRace();
    await screen.findByText("Temporary map failure");
    fireEvent.click(screen.getByText("RETRY INIT"));
    await waitFor(() => expect(screen.getByTestId("game-canvas")).toBeInTheDocument());
    expect(mocks.map).toHaveBeenCalledTimes(2);
    expect(mocks.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("race-loader")).toHaveAttribute("data-parsed", "true");
  });
});
