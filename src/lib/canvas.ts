// `.canvas` whiteboard format: JSON Canvas (nodes + edges) plus extra node types.
// Pure logic: parse, serialize and three-way merge. Unknown node types and fields
// are preserved untouched so other tools (and Claude) can add their own.

export type CanvasNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  [k: string]: unknown;
};

export type CanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  label?: string;
  [k: string]: unknown;
};

export type CanvasDoc = { nodes: CanvasNode[]; edges: CanvasEdge[] };

const NODE_KEY_ORDER = ["id", "type", "x", "y", "width", "height"];
const EDGE_KEY_ORDER = ["id", "fromNode", "toNode"];

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * 8 characters of [a-z0-9]. `crypto.randomUUID` needs a secure context and may be
 * missing in the packaged app's webview, so fall back to `getRandomValues`, then to
 * `Math.random` (ids only need to be unique within one board, not unguessable).
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID().slice(0, 8);
  const bytes = new Uint8Array(8);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

/** History layer: an archived node stays in the file, just hidden from the board. */
export type Archived = { at: string; reason: string; by?: "claude" | "tu" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The node's `archived` entry, or null when absent or malformed (a malformed one leaves the node visible). */
export function archivedOf(node: CanvasNode): Archived | null {
  const a = node.archived;
  if (!isRecord(a)) return null;
  if (typeof a.at !== "string" || !DATE_RE.test(a.at) || typeof a.reason !== "string") return null;
  return a.by === "claude" || a.by === "tu" ? { at: a.at, reason: a.reason, by: a.by } : { at: a.at, reason: a.reason };
}

/** Local date as YYYY-MM-DD. */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Adds `archived` and touches nothing else. */
export function archiveNode(node: CanvasNode, reason: string, by: "claude" | "tu", now: Date = new Date()): CanvasNode {
  return { ...node, archived: { at: localDate(now), reason, by } };
}

/** Removes only `archived`. */
export function restoreNode(node: CanvasNode): CanvasNode {
  const { archived: _archived, ...rest } = node;
  return rest as CanvasNode;
}

/** Own-property check (tsconfig lib predates Object.hasOwn). */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * First occurrence keeps its id; later ones become `id-2`, `id-3`, ... skipping ids already used.
 * Edges that pointed at the duplicated id keep pointing at the FIRST node with it.
 */
function dedupeIds<T extends { id: string }>(items: T[]): T[] {
  const used = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  return items.map((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      return item;
    }
    let n = 2;
    while (used.has(`${item.id}-${n}`)) n++;
    const id = `${item.id}-${n}`;
    used.add(id);
    seen.add(id);
    return { ...item, id };
  });
}

export function parseCanvas(text: string): { ok: true; doc: CanvasDoc } | { ok: false; reason: string } {
  if (text.trim() === "") return { ok: false, reason: "La pizarra está vacía" };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "El archivo no es JSON válido" };
  }
  if (!isRecord(data)) return { ok: false, reason: "La pizarra debe ser un objeto JSON" };
  if (!Array.isArray(data.nodes)) return { ok: false, reason: "Falta la lista \"nodes\" en la pizarra" };
  const rawEdges = data.edges === undefined ? [] : data.edges;
  if (!Array.isArray(rawEdges)) return { ok: false, reason: "La lista \"edges\" no es válida" };

  for (const [i, n] of data.nodes.entries()) {
    if (!isRecord(n)) return { ok: false, reason: `El nodo ${i + 1} no es un objeto` };
    if (typeof n.id !== "string") return { ok: false, reason: `El nodo ${i + 1} no tiene "id" de texto` };
    if (typeof n.type !== "string") return { ok: false, reason: `El nodo "${n.id}" no tiene "type" de texto` };
    for (const k of ["x", "y", "width", "height"]) {
      if (typeof n[k] !== "number" || !Number.isFinite(n[k])) {
        return { ok: false, reason: `El nodo "${n.id}" tiene "${k}" inválido (debe ser un número)` };
      }
    }
  }
  for (const [i, e] of rawEdges.entries()) {
    if (!isRecord(e)) return { ok: false, reason: `La conexión ${i + 1} no es un objeto` };
    for (const k of ["id", "fromNode", "toNode"]) {
      if (typeof e[k] !== "string") return { ok: false, reason: `La conexión ${i + 1} no tiene "${k}" de texto` };
    }
  }

  return {
    ok: true,
    doc: {
      nodes: dedupeIds(data.nodes as CanvasNode[]),
      edges: dedupeIds(rawEdges as CanvasEdge[]),
    },
  };
}

/**
 * Known keys first (in `order`), then the remaining keys in their original order.
 * Uses own-property checks and defineProperty so fields named like Object.prototype
 * members (`constructor`, `toString`, `__proto__`, ...) survive as own fields.
 */
function orderKeys<T extends Record<string, unknown>>(obj: T, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (k: string) =>
    Object.defineProperty(out, k, { value: obj[k], writable: true, enumerable: true, configurable: true });
  for (const k of order) if (hasOwn(obj, k)) put(k);
  for (const k of Object.keys(obj)) if (!hasOwn(out, k)) put(k);
  return out;
}

export function serializeCanvas(doc: CanvasDoc): string {
  const ordered = {
    nodes: doc.nodes.map((n) => orderKeys(n, NODE_KEY_ORDER)),
    edges: doc.edges.map((e) => orderKeys(e, EDGE_KEY_ORDER)),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Structural equality that ignores object key order. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/** Three-way merge of id-keyed items; null on a real conflict. */
function mergeById<T extends { id: string }>(base: T[], mine: T[], theirs: T[]): T[] | null {
  const b = new Map(base.map((i) => [i.id, i]));
  const m = new Map(mine.map((i) => [i.id, i]));
  const t = new Map(theirs.map((i) => [i.id, i]));

  const ids = [
    ...base.map((i) => i.id),
    ...mine.filter((i) => !b.has(i.id)).map((i) => i.id),
    ...theirs.filter((i) => !b.has(i.id) && !m.has(i.id)).map((i) => i.id),
  ];

  const out: T[] = [];
  for (const id of ids) {
    const bi = b.get(id);
    const mi = m.get(id);
    const ti = t.get(id);

    if (bi === undefined) {
      // Added: one side only is kept; both sides must agree.
      if (mi !== undefined && ti !== undefined) {
        if (!deepEqual(mi, ti)) return null;
        out.push(mi);
      } else {
        out.push((mi ?? ti) as T);
      }
      continue;
    }

    if (mi === undefined && ti === undefined) continue;
    if (mi === undefined) {
      if (!deepEqual(ti, bi)) return null; // they edited what I removed
      continue;
    }
    if (ti === undefined) {
      if (!deepEqual(mi, bi)) return null; // I edited what they removed
      continue;
    }

    if (deepEqual(mi, bi)) out.push(ti);
    else if (deepEqual(ti, bi) || deepEqual(mi, ti)) out.push(mi);
    else return null;
  }
  return out;
}

export function mergeCanvasText(
  base: string,
  mine: string,
  theirs: string,
): { ok: true; text: string } | { ok: false } {
  const b = parseCanvas(base);
  const m = parseCanvas(mine);
  const t = parseCanvas(theirs);
  if (!b.ok || !m.ok || !t.ok) return { ok: false };

  const nodes = mergeById(b.doc.nodes, m.doc.nodes, t.doc.nodes);
  const edges = mergeById(b.doc.edges, m.doc.edges, t.doc.edges);
  if (!nodes || !edges) return { ok: false };
  return { ok: true, text: serializeCanvas({ nodes, edges }) };
}
