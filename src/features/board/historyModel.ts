// Pure view-model of the history layer: archived nodes as plain-text list entries.
import { archivedOf, type CanvasNode } from "../../lib/canvas";

export type HistoryEntry = {
  id: string;
  type: string;
  title: string;
  snippet: string;
  at: string;
  reason: string;
  by?: "claude" | "tu";
};

const SNIPPET_MAX = 120;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function firstHeading(markdown: string): string {
  const m = /^#[ \t]+(\S.*?)[ \t]*$/m.exec(markdown);
  return m ? m[1] : "";
}

function titleOf(n: CanvasNode): string {
  switch (n.type) {
    case "text":
      return firstHeading(str(n.text)) || n.type;
    case "table":
    case "chart":
    case "timeline":
      return str(n.title).trim() || n.type;
    case "decision":
      return str(n.question).trim() || n.type;
    case "group":
      return str(n.label).trim() || n.type;
    case "file":
      return str(n.file).split("/").pop()?.trim() || n.type;
    default:
      return n.type;
  }
}

function snippetOf(n: CanvasNode): string {
  const raw = n.type === "text" ? str(n.text) : str(n.title) || str(n.question) || str(n.label);
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat;
}

/** Archived (valid) nodes, newest archive date first, ties in file order. */
export function historyEntries(nodes: CanvasNode[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const n of nodes) {
    const a = archivedOf(n);
    if (!a) continue;
    out.push({ id: n.id, type: n.type, title: titleOf(n), snippet: snippetOf(n), at: a.at, reason: a.reason, by: a.by });
  }
  // Array.prototype.sort is stable: equal dates keep file order.
  return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}
