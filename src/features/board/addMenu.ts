// Block kinds offered by the "+" menu and the node each one starts as.
import { newId, type CanvasNode } from "../../lib/canvas";

export type BlockKind = "note" | "table" | "image" | "chart" | "timeline" | "decision" | "group";

/** Menu order and Spanish labels. */
export const BLOCKS: { kind: BlockKind; label: string }[] = [
  { kind: "note", label: "Nota" },
  { kind: "table", label: "Tabla" },
  { kind: "image", label: "Imagen" },
  { kind: "chart", label: "Gráfica" },
  { kind: "timeline", label: "Línea de tiempo" },
  { kind: "decision", label: "Decisión" },
  { kind: "group", label: "Zona" },
];

export function defaultNode(kind: BlockKind, x: number, y: number): CanvasNode {
  const at = (width: number, height: number) => ({ id: newId(), x, y, width, height });
  switch (kind) {
    case "note":
      return { ...at(260, 160), type: "text", text: "# Nueva nota\n" };
    case "table":
      return { ...at(360, 200), type: "table", columns: ["Concepto", "Valor"], rows: [["", ""]] };
    case "chart":
      return {
        ...at(360, 240),
        type: "chart",
        kind: "bar",
        labels: ["A", "B"],
        series: [{ name: "Serie 1", values: [1, 2] }],
      };
    case "timeline":
      return { ...at(420, 240), type: "timeline", title: "Avances", items: [] };
    case "decision":
      return { ...at(420, 260), type: "decision", question: "¿Qué decidimos?", options: [] };
    case "group":
      return { ...at(520, 360), type: "group", label: "Zona" };
    case "image":
      return { ...at(300, 220), type: "file", file: "" };
  }
}
