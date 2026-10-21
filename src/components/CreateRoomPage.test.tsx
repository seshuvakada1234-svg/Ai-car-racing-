import React, { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), navigate: vi.fn() }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ profile: { uid: "host", name: "Host", photoURL: "" } }) }));
vi.mock("../multiplayer/NormalRoomService", () => ({ NormalRoomService: { createRoom: mocks.create } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate, useLocation: () => ({ state: { selectedCar: "porsche", selectedMap: "race2map" } }) }));
import { CreateRoomPage } from "./CreateRoomPage";

afterEach(cleanup);
it("creates only one room when React StrictMode replays the creation effect", async () => {
  let resolve!: (code: string) => void;
  mocks.create.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
  render(<StrictMode><CreateRoomPage /></StrictMode>);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  await act(async () => { resolve("ABC123"); });
  expect(mocks.navigate).toHaveBeenCalledTimes(1);
  expect(mocks.navigate).toHaveBeenCalledWith("/room/ABC123");
});
