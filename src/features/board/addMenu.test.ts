import { describe, expect, it } from "vitest";
import { BLOCKS, defaultNode, type BlockKind } from "./addMenu";

describe("defaultNode", () => {
  const cases: [BlockKind, Record<string, unknown>][] = [
    ["note", { type: "text", text: "# Nueva nota\n", width: 260, height: 160 }],
    ["table", { type: "table", columns: ["Concepto", "Valor"], rows: [["", ""]], width: 360, height: 200 }],
    [
      "chart",
      { type: "chart", kind: "bar", labels: ["A", "B"], series: [{ name: "Serie 1", values: [1, 2] }], width: 360, height: 240 },
    ],
    ["timeline", { type: "timeline", title: "Avances", items: [], width: 420, height: 240 }],
    ["decision", { type: "decision", question: "¿Qué decidimos?", options: [], width: 420, height: 260 }],
    ["group", { type: "group", label: "Zona", width: 520, height: 360 }],
    ["image", { type: "file", file: "", width: 300, height: 220 }],
  ];

  it.each(cases)("%s has the exact defaults at the given position", (kind, expected) => {
    const node = defaultNode(kind, 10, -20);
    expect(node).toEqual({ ...expected, id: expect.any(String), x: 10, y: -20 });
    expect(node.id.length).toBeGreaterThan(0);
  });

  it("gives every node a distinct id", () => {
    expect(defaultNode("note", 0, 0).id).not.toBe(defaultNode("note", 0, 0).id);
  });

  it("the menu lists every kind once, in Spanish", () => {
    expect(BLOCKS.map((b) => b.label)).toEqual(["Nota", "Tabla", "Imagen", "Gráfica", "Línea de tiempo", "Decisión", "Zona"]);
    expect(new Set(BLOCKS.map((b) => b.kind)).size).toBe(7);
  });
});
