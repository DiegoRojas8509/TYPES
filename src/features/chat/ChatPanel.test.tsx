import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeEvent } from "../../lib/api";

let listener: ((e: ClaudeEvent) => void) | null = null;

vi.mock("../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api")>()),
  api: {
    claudeStatus: vi.fn(),
    claudeSend: vi.fn(),
    claudeStop: vi.fn(),
    saveAttachment: vi.fn(),
  },
  onClaudeEvent: vi.fn(async (cb: (e: ClaudeEvent) => void) => {
    listener = cb;
    return () => {};
  }),
  openExternal: vi.fn(),
}));

import { api } from "../../lib/api";
import { initialState, useApp } from "../../store/app";
import { ChatPanel } from "./ChatPanel";
import { resetChatsForTests } from "./conversations";
import { MSG_AUTH, MSG_NOT_FOUND } from "./reducer";
import { loadConversation } from "./sessions";

const mocked = vi.mocked(api);
const ROOT = "/var/ws";

const emit = (ev: ClaudeEvent) => act(() => listener!(ev));
const raw = (runId: number, line: unknown) => emit({ kind: "raw", runId, line });
const textBlock = (text: string, id = "m1") => ({
  type: "assistant",
  message: { id, content: [{ type: "text", text }] },
});
const toolCall = (file: string, name = "Write") => ({
  type: "assistant",
  message: { id: "m0", content: [{ type: "tool_use", id: "t1", name, input: { file_path: file } }] },
});

function setSpace(space: string | null) {
  act(() => useApp.setState({ activeSpace: space }));
}

async function type(text: string) {
  fireEvent.change(screen.getByLabelText("Mensaje para Claude"), { target: { value: text } });
}
async function send(text: string) {
  await type(text);
  fireEvent.keyDown(screen.getByLabelText("Mensaje para Claude"), { key: "Enter" });
  await waitFor(() => expect(mocked.claudeSend).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetChatsForTests();
  listener = null;
  useApp.setState({
    ...initialState(),
    settings: { workspaceRoot: ROOT, claudePath: null },
    activeSpace: "Ropa",
  });
  mocked.claudeStatus.mockResolvedValue({ found: true, path: "/bin/claude", version: "2.1.296" });
  mocked.claudeSend.mockResolvedValue(1);
  mocked.claudeStop.mockResolvedValue();
  mocked.saveAttachment.mockImplementation(async (space, name) => `${space}/adjuntos/${name}`);
});

describe("ChatPanel", () => {
  it("invites choosing a space when none is selected", () => {
    setSpace(null);
    render(<ChatPanel />);
    expect(screen.getByText(/dentro de un espacio/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensaje para Claude")).not.toBeInTheDocument();
  });

  it("panel_shows_message_when_claude_missing", async () => {
    mocked.claudeStatus.mockResolvedValue({ found: false, path: null, version: null });
    render(<ChatPanel />);
    expect(await screen.findByText(MSG_NOT_FOUND)).toBeInTheDocument();
    expect(screen.getByLabelText("Mensaje para Claude")).toBeEnabled();
  });

  it("claude_not_found on send shows the message and leaves the composer usable", async () => {
    mocked.claudeSend.mockRejectedValue({ kind: "claude_not_found", message: "texto del backend" });
    render(<ChatPanel />);
    await send("hola");
    expect((await screen.findAllByText(MSG_NOT_FOUND)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mensaje para Claude")).toBeEnabled();
  });

  it("sends the model picked in the selector", async () => {
    render(<ChatPanel />);
    fireEvent.change(screen.getByLabelText("Modelo de Claude"), { target: { value: "opus" } });
    await type("hola");
    fireEvent.keyDown(screen.getByLabelText("Mensaje para Claude"), { key: "Enter" });
    await waitFor(() => expect(mocked.claudeSend).toHaveBeenCalledWith("Ropa", "hola", [], null, "opus", null));
    localStorage.removeItem("types.model");
  });

  it("Enter sends, Shift+Enter does not, and send is disabled while empty", async () => {
    render(<ChatPanel />);
    const box = screen.getByLabelText("Mensaje para Claude");
    const sendBtn = screen.getByRole("button", { name: "Enviar" });
    expect(sendBtn).toBeDisabled();
    await type("  ");
    expect(sendBtn).toBeDisabled();
    await type("costea la tela");
    expect(sendBtn).toBeEnabled();
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(mocked.claudeSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(mocked.claudeSend).toHaveBeenCalledWith("Ropa", "costea la tela", [], null, "", null));
    expect(await screen.findByText("costea la tela")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("shows the live trail, clickable steps, the answer, and 'Detener' while running", async () => {
    render(<ChatPanel />);
    await send("haz un reporte");
    expect(screen.getByRole("button", { name: "Detener" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar" })).not.toBeInTheDocument();

    await raw(1, { type: "system", subtype: "init", session_id: "sess-1" });
    await raw(1, toolCall("/private/var/ws/Ropa/reporte.md"));
    const step = await screen.findByRole("button", { name: /Escribiendo reporte\.md/ });
    expect(step).toHaveAttribute("data-status", "running");
    await raw(1, {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    });
    expect(step).toHaveAttribute("data-status", "done");
    fireEvent.click(step);
    expect(useApp.getState().openPath).toBe("Ropa/reporte.md");

    await raw(1, textBlock("| a | b |\n|---|---|\n| 1 | 2 |\n\nListo **ya**."));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("ya").tagName).toBe("STRONG");

    await raw(1, { type: "result", is_error: false, result: "Listo ya.", session_id: "sess-1", permission_denials: [] });
    await emit({ kind: "exit", runId: 1, code: 0 });
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
    expect(screen.getByText("Nueva conversación")).toBeEnabled();

    // second message resumes the session
    mocked.claudeSend.mockResolvedValue(2);
    await type("otra cosa");
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(mocked.claudeSend).toHaveBeenLastCalledWith("Ropa", "otra cosa", [], "sess-1", "", null));
  });

  it("does not render raw HTML from the assistant", async () => {
    render(<ChatPanel />);
    await send("hola");
    await raw(1, textBlock("hola <img src=x onerror=alert(1)> <b>negrita</b> [x](javascript:alert(1))"));
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".chat-md b")).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("shows 'Detener' working: stopping ends with a clear message and a usable composer", async () => {
    render(<ChatPanel />);
    await send("hola");
    fireEvent.click(screen.getByRole("button", { name: "Detener" }));
    expect(mocked.claudeStop).toHaveBeenCalledWith(1);
    await emit({ kind: "exit", runId: 1, code: null });
    expect(screen.getByText("Detuviste a Claude.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  it("auth failure (stderr + non-zero exit) shows the login message", async () => {
    render(<ChatPanel />);
    await send("hola");
    await emit({ kind: "stderr", runId: 1, text: "Not logged in · Please run /login" });
    await emit({ kind: "exit", runId: 1, code: 1 });
    expect(screen.getByText(MSG_AUTH)).toBeInTheDocument();
    expect(screen.getByLabelText("Mensaje para Claude")).toBeEnabled();
  });

  it("routes events by run id: a run in A keeps updating A while B is on screen", async () => {
    render(<ChatPanel />);
    await send("pregunta en Ropa");
    setSpace("Café");
    expect(screen.queryByText("pregunta en Ropa")).not.toBeInTheDocument();
    // B is idle and can send its own message while A still runs
    mocked.claudeSend.mockResolvedValue(2);
    await send("pregunta en Café");

    await raw(1, textBlock("respuesta para Ropa", "mA"));
    await raw(2, textBlock("respuesta para Café", "mB"));
    expect(screen.getByText("respuesta para Café")).toBeInTheDocument();
    expect(screen.queryByText("respuesta para Ropa")).not.toBeInTheDocument();

    setSpace("Ropa");
    expect(screen.getByText("respuesta para Ropa")).toBeInTheDocument();
    expect(screen.queryByText("respuesta para Café")).not.toBeInTheDocument();
    await emit({ kind: "exit", runId: 1, code: 0 });
    await emit({ kind: "exit", runId: 2, code: 0 });
    expect(loadConversation("Ropa")?.items.map((i) => i.type)).toEqual(["user", "assistant"]);
    expect(loadConversation("Café")?.items).toHaveLength(2);
  });

  it("keeps events that arrive before claudeSend resolves", async () => {
    let resolveSend!: (id: number) => void;
    mocked.claudeSend.mockReturnValue(new Promise((r) => (resolveSend = r)));
    render(<ChatPanel />);
    await send("hola");
    await raw(7, textBlock("llegó temprano"));
    await emit({ kind: "exit", runId: 7, code: 0 });
    await act(async () => resolveSend(7));
    expect(await screen.findByText("llegó temprano")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  it("restores a stored conversation and 'Nueva conversación' clears it", async () => {
    mocked.claudeSend.mockResolvedValue(1);
    const first = render(<ChatPanel />);
    await send("recuérdame");
    await raw(1, { type: "result", is_error: false, result: "hecho", session_id: "s-9" });
    await emit({ kind: "exit", runId: 1, code: 0 });
    first.unmount();
    resetChatsForTests(); // simulates an app restart: memory gone, storage kept
    render(<ChatPanel />);
    expect(screen.getByText("recuérdame")).toBeInTheDocument();
    expect(screen.getByText("hecho")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Nueva conversación"));
    expect(screen.getByText("recuérdame")).toBeInTheDocument(); // one click only asks
    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.getByText("recuérdame")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Nueva conversación"));
    fireEvent.click(screen.getByText("Borrar y empezar"));
    expect(screen.queryByText("recuérdame")).not.toBeInTheDocument();
    expect(loadConversation("Ropa")).toBeNull();
  });

  it("attaches images as removable chips, saves them and sends space-relative paths", async () => {
    render(<ChatPanel />);
    const input = screen.getByTestId("file-input");
    const png = new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" });
    const junk = new File(["x"], "nota.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [png] } });
    expect(await screen.findByText("foto.png")).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [junk] } });
    expect(await screen.findByText(/solo puedo recibir imágenes/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Quitar foto.png"));
    expect(screen.queryByText("foto.png")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { files: [png] } });
    await screen.findByText("foto.png");
    expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(); // attachments alone are enough
    await type("mira esta tela");
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(mocked.claudeSend).toHaveBeenCalledWith("Ropa", "mira esta tela", ["adjuntos/foto.png"], null, "", null));
    expect(mocked.saveAttachment).toHaveBeenCalledWith("Ropa", "foto.png", expect.any(Uint8Array));
    // the transcript chip opens the workspace-relative path
    fireEvent.click(await screen.findByTitle("Abrir Ropa/adjuntos/foto.png"));
    expect(useApp.getState().openPath).toBe("Ropa/adjuntos/foto.png");
  });

  it("gives the draft back when an attachment cannot be saved", async () => {
    mocked.saveAttachment.mockRejectedValue({ kind: "io", message: "Disco lleno" });
    render(<ChatPanel />);
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File([new Uint8Array([1])], "a.png", { type: "image/png" })] },
    });
    await screen.findByText("a.png");
    await type("mensaje importante");
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText(/Disco lleno/)).toBeInTheDocument();
    expect(mocked.claudeSend).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Mensaje para Claude")).toHaveValue("mensaje importante"));
    expect(screen.getByText("a.png")).toBeInTheDocument();
  });
  describe("open board context", () => {
    const sendWith = async (openPath: string | null) => {
      act(() => useApp.setState({ openPath }));
      render(<ChatPanel />);
      await send("agrega una tabla");
    };

    it("passes the board path relative to the space folder", async () => {
      await sendWith("Ropa/Plan.canvas");
      expect(mocked.claudeSend).toHaveBeenCalledWith("Ropa", "agrega una tabla", [], null, "", "Plan.canvas");
    });

    it("keeps subfolders in the relative path", async () => {
      await sendWith("Ropa/sub/Plan.canvas");
      expect(mocked.claudeSend).toHaveBeenCalledWith("Ropa", "agrega una tabla", [], null, "", "sub/Plan.canvas");
    });

    it.each([["a markdown page", "Ropa/Notas.md"], ["a board of another space", "Comida/Plan.canvas"], ["nothing open", null]])(
      "passes null for %s",
      async (_name, openPath) => {
        await sendWith(openPath);
        expect(mocked.claudeSend).toHaveBeenCalledWith("Ropa", "agrega una tabla", [], null, "", null);
      },
    );

    it("passes null for a board that sits at the workspace root (no space folder)", async () => {
      await sendWith("Ropa.canvas");
      expect(mocked.claudeSend).toHaveBeenCalledWith("Ropa", "agrega una tabla", [], null, "", null);
    });
  });
});
