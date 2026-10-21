import { describe, expect, it } from "vitest";
import { archiveNode, type CanvasNode } from "../../lib/canvas";
import { historyEntries } from "./historyModel";

const base = { x: 0, y: 0, width: 10, height: 10 };
const arch = (n: CanvasNode, at: string, reason = "r", by: "claude" | "tu" = "tu") => ({ ...n, archived: { at, reason, by } });

describe("historyEntries", () => {
  it("lists only validly archived nodes", () => {
    const nodes: CanvasNode[] = [
      { id: "a", type: "text", ...base, text: "visible" },
      arch({ id: "b", type: "text", ...base, text: "x" }, "2026-10-01"),
      { id: "c", type: "text", ...base, archived: { at: "mal", reason: "x" } },
    ];
    expect(historyEntries(nodes).map((e) => e.id)).toEqual(["b"]);
  });

  it("orders by date descending, then by position in the file", () => {
    const n = (id: string, at: string) => arch({ id, type: "text", ...base, text: id }, at);
    const out = historyEntries([n("a", "2026-10-01"), n("b", "2026-10-03"), n("c", "2026-10-01"), n("d", "2026-10-03")]);
    expect(out.map((e) => e.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("derives the title by type", () => {
    const t = (n: Partial<CanvasNode> & { type: string }) => historyEntries([arch({ id: "a", ...base, ...n }, "2026-10-01")])[0].title;
    expect(t({ type: "text", text: "intro\n# Costos de tela\nmás" })).toBe("Costos de tela");
    expect(t({ type: "text", text: "sin encabezado" })).toBe("text");
    expect(t({ type: "table", title: "Tabla A" })).toBe("Tabla A");
    expect(t({ type: "chart", title: "Ventas" })).toBe("Ventas");
    expect(t({ type: "timeline", title: "Plan" })).toBe("Plan");
    expect(t({ type: "decision", question: "¿Qué tela?" })).toBe("¿Qué tela?");
    expect(t({ type: "group", label: "Escenario B" })).toBe("Escenario B");
    expect(t({ type: "file", file: "Imágenes/molde.png" })).toBe("molde.png");
    expect(t({ type: "weird" })).toBe("weird");
    expect(t({ type: "table", title: 3 })).toBe("table");
  });

  it("builds a plain-text snippet of at most 120 characters", () => {
    const long = "palabra ".repeat(40);
    const e = historyEntries([arch({ id: "a", type: "text", ...base, text: `# T\n**negrita** ${long}` }, "2026-10-01")])[0];
    expect(e.snippet.length).toBeLessThanOrEqual(120);
    expect(e.snippet.startsWith("negrita")).toBe(false); // markdown markers are not stripped, text stays literal
    expect(e.snippet).toContain("**negrita**");
  });

  it("carries date, reason and author; hostile text stays literal", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const e = historyEntries([arch({ id: "a", type: "text", ...base, text: hostile }, "2026-10-02", hostile, "claude")])[0];
    expect(e).toMatchObject({ at: "2026-10-02", reason: hostile, by: "claude", snippet: hostile });
  });

  it("archiveNode output is listed", () => {
    const n = archiveNode({ id: "a", type: "text", ...base }, "x", "tu", new Date(2026, 9, 21));
    expect(historyEntries([n])[0]).toMatchObject({ at: "2026-10-21", by: "tu" });
  });
});
