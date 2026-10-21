import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloseTopicResult, MemoryStatus } from "../../lib/api";

vi.mock("../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api")>()),
  api: {
    claudeStatus: vi.fn(),
    claudeSend: vi.fn(),
    claudeStop: vi.fn(),
    saveAttachment: vi.fn(),
    memoryStatus: vi.fn(),
    memoryRead: vi.fn(),
    memoryCloseTopic: vi.fn(),
  },
  onClaudeEvent: vi.fn(async () => () => {}),
  openExternal: vi.fn(),
}));

import { api } from "../../lib/api";
import { initialState, useApp } from "../../store/app";
import { ChatPanel } from "./ChatPanel";
import { CONTEXT_HIGH, CONTEXT_WARN, ContextMeter, contextLevel, formatTokens } from "./ContextMeter";
import { resetChatsForTests, useChats } from "./conversations";
import { MemoryBadge } from "./MemoryBadge";
import { resetMemoryUiForTests, useMemoryUi } from "./memoryUi";
import { splitFrontmatter } from "./MemoryPanel";
import { initialChat, restoreChat } from "./reducer";

const m = vi.mocked(api);
const HOSTILE = "<img src=x onerror=alert(1)>";

const status = (over: Partial<MemoryStatus> = {}): MemoryStatus => ({
  dir: "/mem/Ropa",
  exists: true,
  entries: [{ file: "cronista-precios.md", title: "Precios", description: "Tarifas de telas", updated: Date.now() - 3 * 3_600_000 }],
  facts: 12,
  decisions: 3,
  updated: Date.now() - 3 * 3_600_000,
  indexLines: 5,
  ...over,
});
const result = (over: Partial<CloseTopicResult> = {}): CloseTopicResult => ({
  ok: true,
  changes: [],
  error: null,
  nothingToSave: false,
  ...over,
});
const change = (over = {}) => ({
  file: "cronista-precios.md",
  action: "actualizado",
  summary: "Subió la tarifa del corte",
  added: ["corte: 40"],
  removed: ["corte: 35"],
  truncated: false,
  ...over,
});

function seed(opts: { sessionId?: string | null; withItems?: boolean; running?: boolean } = {}) {
  const { sessionId = "sess-1", withItems = true, running = false } = opts;
  const base = restoreChat(sessionId, withItems ? [{ id: 1, type: "user", text: "hola", attachments: [] }] : []);
  act(() => useChats.setState({ conversations: { Ropa: { ...base, running, contextTokens: 182_000 } } }));
}
const renderChat = () => render(<ChatPanel />);
const closeBtn = () => document.getElementById("close-topic-trigger") as HTMLButtonElement;
const open = () => fireEvent.click(closeBtn());

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetChatsForTests();
  resetMemoryUiForTests();
  useApp.setState({ ...initialState(), settings: { workspaceRoot: "/ws", claudePath: null }, activeSpace: "Ropa" });
  m.claudeStatus.mockResolvedValue({ found: true, path: "/bin/claude", version: "2" });
  m.memoryStatus.mockResolvedValue(status());
  m.memoryRead.mockResolvedValue("---\nname: x\n---\n# Hola");
  m.memoryCloseTopic.mockResolvedValue(result({ changes: [change()] }));
});
afterEach(() => vi.useRealTimers());

describe("close topic: header button", () => {
  it("is disabled with a reason when there is no conversation", () => {
    seed({ sessionId: null, withItems: false });
    renderChat();
    expect(closeBtn()).toBeDisabled();
    expect(closeBtn()).toHaveAttribute("title", "Aún no hay una conversación que cerrar.");
  });
  it("is disabled without sessionId", () => {
    seed({ sessionId: null });
    renderChat();
    expect(closeBtn()).toBeDisabled();
  });
  it("is disabled while a message runs", () => {
    seed({ running: true });
    renderChat();
    expect(closeBtn()).toHaveAttribute("title", "Espera a que Claude termine de responder.");
  });
});

describe("close topic: dialog", () => {
  it("shows saving state, then the list of changes with the exact payload", async () => {
    let done!: (r: CloseTopicResult) => void;
    m.memoryCloseTopic.mockReturnValue(new Promise((r) => (done = r)));
    seed();
    renderChat();
    open();
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText(/Guardando lo importante/)).toBeInTheDocument();
    expect(within(dlg).getByText("Se termina de guardar en segundo plano.")).toBeInTheDocument();
    expect(m.memoryCloseTopic).toHaveBeenCalledTimes(1);
    expect(m.memoryCloseTopic).toHaveBeenCalledWith("Ropa", "sess-1");
    expect(closeBtn()).toBeDisabled();
    await act(async () => done(result({ changes: [change(), change({ file: "cronista-x.md", action: "nuevo", summary: "n", added: ["a"], removed: [], truncated: true }), change({ file: "cronista-y.md", action: "sin-cambios" })] })));
    expect(within(dlg).getByText("precios")).toBeInTheDocument();
    expect(within(dlg).getByText("Actualizado")).toBeInTheDocument();
    expect(within(dlg).getByText("Nuevo")).toBeInTheDocument();
    expect(within(dlg).queryByText("y")).not.toBeInTheDocument();
    fireEvent.click(within(dlg).getAllByRole("button", { name: "Ver cambios" })[0]);
    expect(within(dlg).getByText("+ corte: 40")).toBeInTheDocument();
    expect(within(dlg).getByText("− corte: 35")).toBeInTheDocument();
    fireEvent.click(within(dlg).getAllByRole("button", { name: "Ver cambios" })[1]);
    expect(within(dlg).getByText("…hay más cambios")).toBeInTheDocument();
  });

  it("renders hostile text literally", async () => {
    m.memoryCloseTopic.mockResolvedValue(result({ changes: [change({ summary: HOSTILE, added: [HOSTILE], removed: [] })] }));
    seed();
    const { container } = renderChat();
    open();
    const dlg = await screen.findByRole("alertdialog");
    await screen.findByText(HOSTILE);
    fireEvent.click(within(dlg).getByRole("button", { name: "Ver cambios" }));
    expect(screen.getByText("+ " + HOSTILE)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("nothingToSave and all sin-cambios say memory is up to date", async () => {
    m.memoryCloseTopic.mockResolvedValue(result({ nothingToSave: true }));
    seed();
    renderChat();
    open();
    expect(await screen.findByText("No hay nada nuevo que guardar: la memoria ya está al día.")).toBeInTheDocument();
    expect(await screen.findByText(/Memoria de Ropa cargada: 12 datos · 3 decisiones/)).toBeInTheDocument();
  });

  it("all sin-cambios counts as up to date", async () => {
    m.memoryCloseTopic.mockResolvedValue(result({ changes: [change({ action: "sin-cambios" })] }));
    seed();
    renderChat();
    open();
    expect(await screen.findByText(/ya está al día/)).toBeInTheDocument();
  });

  it("ok:false shows the error, retry calls again, new conversation still possible", async () => {
    m.memoryCloseTopic.mockResolvedValueOnce(result({ ok: false, error: "El cronista no está instalado. Revisa el plugin sistema." }));
    seed();
    renderChat();
    open();
    const alert = await screen.findByText("El cronista no está instalado. Revisa el plugin sistema.");
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listo, abrir conversación nueva" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Subió la tarifa del corte")).toBeInTheDocument();
    expect(m.memoryCloseTopic).toHaveBeenCalledTimes(2);
  });

  it("a rejected call (concurrent) shows its message", async () => {
    m.memoryCloseTopic.mockRejectedValue({ kind: "invalid", message: "Ya se está guardando el tema." });
    seed();
    renderChat();
    open();
    expect(await screen.findByText("Ya se está guardando el tema.")).toBeInTheDocument();
  });

  it("cancel while saving closes the dialog, the call keeps going and clears the flag", async () => {
    let done!: (r: CloseTopicResult) => void;
    m.memoryCloseTopic.mockReturnValue(new Promise((r) => (done = r)));
    seed();
    renderChat();
    open();
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(closeBtn()).toBeDisabled();
    await act(async () => done(result()));
    expect(closeBtn()).toBeEnabled();
  });

  it("«abrir conversación nueva» resets the conversation and closes", async () => {
    seed();
    renderChat();
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Listo, abrir conversación nueva" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(useChats.getState().conversations.Ropa.items).toHaveLength(0);
    expect(useChats.getState().conversations.Ropa.sessionId).toBeNull();
  });

  it("«Mantener» and Esc close without touching the conversation", async () => {
    seed();
    renderChat();
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Mantener esta conversación" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(closeBtn());
    open();
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(useChats.getState().conversations.Ropa.items).toHaveLength(1);
  });
});

describe("memory badge", () => {
  it("shows counts and age, refreshing after close-topic", async () => {
    render(<MemoryBadge space="Ropa" />);
    expect(await screen.findByText("Memoria de Ropa cargada: 12 datos · 3 decisiones · actualizada hace 3 h")).toBeInTheDocument();
    m.memoryStatus.mockResolvedValue(status({ facts: 13 }));
    act(() => useMemoryUi.getState().bump());
    expect(await screen.findByText(/13 datos/)).toBeInTheDocument();
  });
  it.each([[status({ exists: false })], [status({ facts: 0 })]])("explains an empty memory", async (s) => {
    m.memoryStatus.mockResolvedValue(s);
    render(<MemoryBadge space="Ropa" />);
    expect(await screen.findByText("Aún no hay memoria de Ropa. Se irá llenando sola mientras trabajas.")).toBeInTheDocument();
  });
  it("shows up only in the empty state of the chat", async () => {
    seed({ sessionId: null, withItems: false });
    renderChat();
    expect(await screen.findByText(/Memoria de Ropa cargada/)).toBeInTheDocument();
  });
  it("is absent once there are messages", async () => {
    seed();
    renderChat();
    await act(async () => {});
    expect(screen.queryByText(/Memoria de Ropa cargada/)).not.toBeInTheDocument();
  });
  it("refetches ~8 s and ~30 s after a run ends", async () => {
    vi.useFakeTimers();
    seed({ running: true });
    render(<MemoryBadge space="Ropa" />);
    await act(async () => {});
    expect(m.memoryStatus).toHaveBeenCalledTimes(1);
    act(() => useChats.setState({ conversations: { Ropa: { ...useChats.getState().conversations.Ropa, running: false } } }));
    await act(async () => void vi.advanceTimersByTime(7_900));
    expect(m.memoryStatus).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(200));
    expect(m.memoryStatus).toHaveBeenCalledTimes(2);
    await act(async () => void vi.advanceTimersByTime(22_000));
    expect(m.memoryStatus).toHaveBeenCalledTimes(3);
  });
});

describe("memory panel", () => {
  it("lists entries, opens MEMORY.md first, hides frontmatter dimmed, reads others", async () => {
    m.memoryRead.mockImplementation(async (_s, f) => (f === "MEMORY.md" ? "- [Precios](cronista-precios.md)" : `---\nname: p\n---\n${HOSTILE}`));
    seed({ sessionId: null, withItems: false });
    const { container } = renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Ver qué recuerda" }));
    const dlg = await screen.findByRole("dialog", { name: "Memoria de Ropa" });
    expect(await within(dlg).findByText("- [Precios](cronista-precios.md)")).toBeInTheDocument();
    expect(m.memoryRead).toHaveBeenCalledWith("Ropa", "MEMORY.md");
    fireEvent.click(await within(dlg).findByRole("button", { name: /Precios/ }));
    expect(await within(dlg).findByText(HOSTILE)).toBeInTheDocument();
    expect(m.memoryRead).toHaveBeenCalledWith("Ropa", "cronista-precios.md");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".memory-front")?.textContent).toContain("name: p");
    expect(within(dlg).getByText(/edita el archivo en/)).toBeInTheDocument();
  });
  it("copies the path and closes with Esc", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    seed({ sessionId: null, withItems: false });
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Ver qué recuerda" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copiar ruta" }));
    expect(writeText).toHaveBeenCalledWith("/mem/Ropa");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Memoria de Ropa" })).not.toBeInTheDocument();
    expect(m.memoryCloseTopic).not.toHaveBeenCalled();
  });
  it("splitFrontmatter", () => {
    expect(splitFrontmatter("---\na: 1\n---\nbody")).toEqual({ front: "---\na: 1\n---", body: "body" });
    expect(splitFrontmatter("sin front")).toEqual({ front: "", body: "sin front" });
  });
});

describe("context meter", () => {
  it("levels at the thresholds", () => {
    expect(contextLevel(CONTEXT_WARN - 1)).toBe("normal");
    expect(contextLevel(CONTEXT_WARN)).toBe("warning");
    expect(contextLevel(CONTEXT_HIGH)).toBe("warning");
    expect(contextLevel(CONTEXT_HIGH + 1)).toBe("high");
  });
  it("rounds to k and shows a dash for null", () => {
    expect(formatTokens(182_400)).toBe("182k");
    expect(formatTokens(182_600)).toBe("183k");
    expect(formatTokens(null)).toBe("—");
  });
  it("normal: no hint, no shortcut", () => {
    render(<ContextMeter tokens={50_000} blocker={null} />);
    expect(screen.getByText(/Contexto 50k/)).toBeInTheDocument();
    expect(screen.queryByText(/Conversación larga/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("null: dash, no hint", () => {
    render(<ContextMeter tokens={null} blocker={null} />);
    expect(screen.getByText(/Contexto —/)).toBeInTheDocument();
  });
  it.each([[150_000, "warning", "largo"], [250_000, "high", "muy largo"]])("%i shows hint, text marker and shortcut", (t, level, word) => {
    const { container } = render(<ContextMeter tokens={t} blocker={null} />);
    expect(container.firstElementChild).toHaveAttribute("data-level", level);
    expect(screen.getByText(`(${word})`)).toBeInTheDocument();
    expect(screen.getByText("Conversación larga: cierra el tema y abre una nueva; la memoria ya tiene lo importante.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar tema" }));
    expect(useMemoryUi.getState().closeOpen).toBe(true);
  });
  it("shortcut is disabled when closing is blocked", () => {
    render(<ContextMeter tokens={150_000} blocker="Espera." />);
    expect(screen.getByRole("button", { name: "Cerrar tema" })).toBeDisabled();
  });
  it("shows the conversation's tokens inside the chat", () => {
    seed();
    renderChat();
    expect(screen.getByText(/Contexto 182k/)).toBeInTheDocument();
    expect(initialChat().contextTokens).toBeNull();
  });
});
