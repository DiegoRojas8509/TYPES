import { describe, expect, it } from "vitest";
import simpleRaw from "./__fixtures__/stream-simple.jsonl?raw";
import toolsRaw from "./__fixtures__/stream-tools.jsonl?raw";
import {
  type ChatItem,
  type ChatState,
  initialChat,
  MSG_AUTH,
  MSG_CRASHED,
  MSG_RESUME,
  MSG_STOPPED,
  reducer,
} from "./reducer";

const ROOT = "/private/tmp/claude-501/-Users-user-Documents-TYPES/636cb978-c758-41da-a70b-9df1023f4b5d/scratchpad";
const SPACE = "run1";

const parse = (raw: string): Record<string, any>[] =>
  raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const simple = parse(simpleRaw);
const tools = parse(toolsRaw);

function started(root = ROOT, space = SPACE): ChatState {
  let s = reducer(initialChat(), { kind: "begin" });
  s = reducer(s, { kind: "user", text: "hola", attachments: [], root, space });
  return reducer(s, { kind: "started", runId: 1 });
}
const feed = (s: ChatState, lines: unknown[], runId = 1) =>
  lines.reduce<ChatState>((acc, line) => reducer(acc, { kind: "raw", runId, line }), s);
const of = <T extends ChatItem["type"]>(s: ChatState, type: T) =>
  s.items.filter((i): i is Extract<ChatItem, { type: T }> => i.type === type);

describe("reducer", () => {
  it("reducer_streams_assistant_text: deltas show live, the whole message replaces them, nothing doubles", () => {
    const deltaAt = simple.findIndex((l) => l.event?.delta?.type === "text_delta");
    const wholeAt = simple.findIndex((l) => l.type === "assistant");
    const live = feed(started(), simple.slice(0, deltaAt + 1));
    expect(of(live, "assistant")).toMatchObject([{ text: "ok" }]);
    expect(of(live, "assistant")[0].final).toBeUndefined();

    const done = feed(started(), simple);
    expect(of(done, "assistant")).toMatchObject([{ text: "ok", final: true }]);
    expect(wholeAt).toBeGreaterThan(deltaAt);

    const bigDeltas = tools.filter((l) => l.event?.delta?.type === "text_delta").length;
    expect(bigDeltas).toBeGreaterThan(10);
    const final = tools.find((l) => l.type === "assistant" && l.message.content[0].type === "text")!;
    const t = feed(started(), tools);
    expect(of(t, "assistant")).toHaveLength(1);
    expect(of(t, "assistant")[0].text).toBe(final.message.content[0].text);
  });

  it("builds the same transcript from whole messages alone (no partial deltas)", () => {
    const whole = tools.filter((l) => l.type !== "stream_event");
    const a = feed(started(), whole).items.map(({ id: _id, ...rest }) => rest);
    const b = feed(started(), tools).items.map(({ id: _id, ...rest }) => rest);
    expect(a).toEqual(b);
  });

  it("reducer_turns_tool_use_into_step: relative labels, workspace paths, running then done", () => {
    const stopAt = tools.findIndex((l) => l.type === "assistant" && l.message.content[0].type === "tool_use");
    const mid = feed(started(), tools.slice(0, stopAt));
    // streamed tool call: visible as running before its input is complete
    expect(of(mid, "step")).toMatchObject([{ status: "running" }]);

    const end = feed(started(), tools);
    expect(of(end, "step")).toMatchObject([
      { name: "Write", label: "Escribiendo nota.md", path: "run1/nota.md", status: "done" },
      { name: "Read", label: "Leyendo nota.md", path: "run1/nota.md", status: "done" },
    ]);
    expect(end.items.map((i) => i.type)).toEqual(["user", "step", "step", "assistant"]);
  });

  it("fills in the step from streamed input_json before the whole message arrives", () => {
    const wholeAt = tools.findIndex((l) => l.type === "assistant" && l.message.content[0].type === "tool_use");
    const lines = tools.filter((_, i) => i !== wholeAt).slice(0, tools.findIndex((l, i) => i > wholeAt && l.event?.type === "content_block_stop"));
    const s = feed(started(), lines);
    expect(of(s, "step")[0]).toMatchObject({ label: "Escribiendo nota.md", path: "run1/nota.md" });
  });

  it("marks failed tool results quietly and shows only 'thinking' state, never its text", () => {
    const thinkingAt = tools.findIndex((l) => l.event?.content_block?.type === "thinking");
    expect(feed(started(), tools.slice(0, thinkingAt + 1)).thinking).toBe(true);
    expect(feed(started(), tools).thinking).toBe(false);
    expect(JSON.stringify(feed(started(), tools).items)).not.toContain("signature");

    let s = feed(started(), tools.slice(0, 53));
    s = feed(s, [
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_01YWBLVzcYNtsrqVxELsSnHW", is_error: true, content: "boom" }] } },
    ]);
    expect(of(s, "step")[0].status).toBe("error");
  });

  it("only shows paths as clickable inside the workspace, tolerating /private/var", () => {
    const call = (file: string) => ({
      type: "assistant",
      message: { id: "m", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: file } }] },
    });
    const inside = feed(started("/var/ws", "Ropa"), [call("/private/var/ws/Ropa/Telas/algodón.md")]);
    expect(of(inside, "step")[0]).toMatchObject({ label: "Leyendo Telas/algodón.md", path: "Ropa/Telas/algodón.md" });
    const sibling = feed(started("/var/ws", "Ropa"), [call("/var/ws/CLAUDE.md")]);
    expect(of(sibling, "step")[0].path).toBe("CLAUDE.md");
    const outside = feed(started("/var/ws", "Ropa"), [call("/etc/hosts")]);
    expect(of(outside, "step")[0]).toMatchObject({ label: "Leyendo /etc/hosts" });
    expect(of(outside, "step")[0].path).toBeUndefined();
    const escape = feed(started("/var/ws", "Ropa"), [call("/var/ws/Ropa/../../secret.txt")]);
    expect(of(escape, "step")[0].path).toBeUndefined();
  });

  it("reducer_captures_session_id from init and from result", () => {
    const init = simple.find((l) => l.subtype === "init")!;
    const afterInit = feed(started(), simple.slice(0, simple.indexOf(init) + 1));
    expect(afterInit.sessionId).toBe(init.session_id);
    const result = simple.find((l) => l.type === "result")!;
    expect(feed(started(), [{ type: "result", session_id: "from-result", is_error: false, result: "x" }]).sessionId).toBe("from-result");
    expect(feed(started(), simple).sessionId).toBe(result.session_id);
  });

  it("ignores hooks, status, rate limits and lines of other runs", () => {
    const first7 = simple.slice(0, 7);
    expect(feed(started(), first7).items.map((i) => i.type)).toEqual(["user"]);
    const other = feed(started(), simple, 99);
    expect(other.items.map((i) => i.type)).toEqual(["user"]);
  });

  it("shows the final result text only when nothing was streamed", () => {
    const res = { type: "result", is_error: false, result: "Respuesta final", session_id: "s" };
    expect(of(feed(started(), [res]), "assistant")).toMatchObject([{ text: "Respuesta final" }]);
    expect(of(feed(started(), [...simple, res]), "assistant")).toHaveLength(1);
  });

  it("says in Spanish which tools were denied", () => {
    const res = {
      type: "result",
      is_error: false,
      result: "No pude.",
      permission_denials: [{ tool_name: "Bash", tool_use_id: "t9", tool_input: { command: "ls" } }],
    };
    const s = feed(started(), [res]);
    expect(of(s, "notice")[0].text).toContain("«Bash»");
    expect(of(s, "notice")[0].text).toContain("no se lo permite");
  });

  it("surfaces a result error, mapping auth failures to the login message", () => {
    const auth = feed(started(), [{ type: "result", is_error: true, result: "Not logged in · Please run /login" }]);
    expect(of(auth, "error")).toMatchObject([{ text: MSG_AUTH }]);
    const other = feed(started(), [{ type: "result", is_error: true, result: "Se acabó el tiempo" }]);
    expect(of(other, "error")).toMatchObject([{ text: "Se acabó el tiempo" }]);
    // the exit that follows must not add a second error
    const exited = reducer(auth, { kind: "exit", runId: 1, code: 1 });
    expect(of(exited, "error")).toHaveLength(1);
    expect(exited.running).toBe(false);
  });

  it("reducer_handles_exit_nonzero_as_error", () => {
    let s = reducer(started(), { kind: "stderr", runId: 1, text: "Error: Not logged in" });
    expect(of(reducer(s, { kind: "exit", runId: 1, code: 1 }), "error")).toMatchObject([{ text: MSG_AUTH }]);

    s = reducer(started(), { kind: "stderr", runId: 1, text: "No conversation found with session ID: abc" });
    expect(of(reducer(s, { kind: "exit", runId: 1, code: 1 }), "error")).toMatchObject([{ text: MSG_RESUME }]);

    s = reducer(started(), { kind: "stderr", runId: 1, text: "algo raro" });
    const generic = reducer(s, { kind: "exit", runId: 1, code: 2 });
    expect(of(generic, "error")[0].text).toBe("Claude Code terminó con un error (código 2). algo raro");

    expect(of(reducer(started(), { kind: "exit", runId: 1, code: null }), "error")).toMatchObject([{ text: MSG_CRASHED }]);
    expect(of(reducer(started(), { kind: "exit", runId: 1, code: 0 }), "error")).toHaveLength(0);
  });

  it("a requested stop ends the run with a notice, not an error, and settles running steps", () => {
    const wholeAt = tools.findIndex((l) => l.type === "assistant" && l.message.content[0].type === "tool_use");
    let s = feed(started(), tools.slice(0, wholeAt + 1));
    s = reducer(s, { kind: "stopRequested" });
    s = reducer(s, { kind: "exit", runId: 1, code: null });
    expect(of(s, "error")).toHaveLength(0);
    expect(of(s, "notice")).toMatchObject([{ text: MSG_STOPPED }]);
    expect(of(s, "step")[0].status).toBe("stopped");
    expect(s.running).toBe(false);
  });

  it("a failed send ends the run and keeps the composer usable", () => {
    const s = reducer(reducer(initialChat(), { kind: "begin" }), { kind: "failed", message: "No encontré Claude Code." });
    expect(s.running).toBe(false);
    expect(of(s, "error")).toMatchObject([{ text: "No encontré Claude Code." }]);
  });
});
