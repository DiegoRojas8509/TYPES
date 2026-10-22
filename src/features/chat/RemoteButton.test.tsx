import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteStatus } from "../../lib/api";

vi.mock("../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api")>()),
  api: {
    remoteStatus: vi.fn(async () => ({ state: "off" })),
    remoteStart: vi.fn(async () => ({ state: "starting" })),
    remoteStop: vi.fn(async () => ({ state: "off" })),
    remoteTrust: vi.fn(async () => {}),
  },
  onRemoteEvent: vi.fn(async () => () => {}),
}));

import { api } from "../../lib/api";
import { useApp } from "../../store/app";
import { RemoteButton } from "./RemoteButton";
import { resetRemoteForTests, useRemote } from "./remote";

const mocked = vi.mocked(api);
const setStatus = (status: RemoteStatus) => act(() => useRemote.setState({ status }));
async function mount() {
  render(<RemoteButton />);
  await act(async () => {}); // let the initial status load settle
}
const button = () => screen.getByRole("button", { name: "Control remoto desde el cel" });

beforeEach(() => {
  vi.clearAllMocks();
  resetRemoteForTests();
  act(() => useApp.setState({ settings: { workspaceRoot: "/Users/d/Docs/espacios", claudePath: null } }));
});

describe("RemoteButton", () => {
  it("off: click starts", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(button());
    });
    expect(mocked.remoteStart).toHaveBeenCalledOnce();
  });

  it("starting: shows 'Conectando…' and is disabled", async () => {
    await mount();
    setStatus({ state: "starting" });
    expect(button()).toBeDisabled();
    expect(screen.getByText("Conectando…")).toBeInTheDocument();
  });

  it("on: popover names the folder, copies the url and stops", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await mount();
    setStatus({ state: "on", url: "https://claude.ai/code/session_1" });
    fireEvent.click(button());
    expect(screen.getByText(/Activo\. Abre la app de Claude → pestaña Code → «espacios»\./)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Copiar enlace"));
    expect(writeText).toHaveBeenCalledWith("https://claude.ai/code/session_1");
    await act(async () => {
      fireEvent.click(screen.getByText("Detener"));
    });
    expect(mocked.remoteStop).toHaveBeenCalledOnce();
  });

  it("on without url: no copy button", async () => {
    await mount();
    setStatus({ state: "on" });
    fireEvent.click(button());
    expect(screen.queryByText("Copiar enlace")).toBeNull();
    expect(screen.getByText("Detener")).toBeInTheDocument();
  });

  it("untrusted: both buttons call the right api", async () => {
    await mount();
    setStatus({ state: "untrusted" });
    expect(screen.getByText(/Primera vez: hay que confiar en la carpeta/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("Abrir Terminal"));
    });
    expect(mocked.remoteTrust).toHaveBeenCalledOnce();
    await act(async () => {
      fireEvent.click(screen.getByText("Reintentar"));
    });
    expect(mocked.remoteStart).toHaveBeenCalledOnce();
  });

  it("error: shows the message and retries", async () => {
    await mount();
    setStatus({ state: "error", message: "No encuentro Claude Code." });
    expect(screen.getByRole("alert")).toHaveTextContent("No encuentro Claude Code.");
    await act(async () => {
      fireEvent.click(screen.getByText("Reintentar"));
    });
    expect(mocked.remoteStart).toHaveBeenCalledOnce();
  });

  it("Escape and outside click close the popover", async () => {
    await mount();
    setStatus({ state: "on" });
    fireEvent.click(button());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
