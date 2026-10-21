import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveNode, archivedOf, mergeCanvasText, newId, parseCanvas, restoreNode, serializeCanvas, type CanvasDoc } from "./canvas";

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  ...extra,
});

const text = (doc: CanvasDoc) => serializeCanvas(doc);

function parsed(src: string): CanvasDoc {
  const r = parseCanvas(src);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}

describe("parseCanvas", () => {
  it("rejects empty and invalid JSON", () => {
    expect(parseCanvas("")).toEqual({ ok: false, reason: "La pizarra está vacía" });
    expect(parseCanvas("   \n")).toMatchObject({ ok: false });
    const r = parseCanvas("{");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/JSON/);
  });

  it("accepts an empty canvas", () => {
    const r = parseCanvas('{"nodes":[],"edges":[]}');
    expect(r).toEqual({ ok: true, doc: { nodes: [], edges: [] } });
  });

  it("treats a missing edges array as empty", () => {
    expect(parseCanvas('{"nodes":[]}')).toEqual({ ok: true, doc: { nodes: [], edges: [] } });
  });

  it("rejects wrong shapes with a Spanish reason", () => {
    expect(parseCanvas("[]")).toMatchObject({ ok: false });
    expect(parseCanvas('{"edges":[]}')).toMatchObject({ ok: false });
    expect(parseCanvas('{"nodes":{}}')).toMatchObject({ ok: false });
    expect(parseCanvas('{"nodes":[{"id":"a","type":"text","x":"0","y":0,"width":1,"height":1}]}')).toMatchObject({
      ok: false,
    });
    expect(parseCanvas('{"nodes":[{"type":"text","x":0,"y":0,"width":1,"height":1}]}')).toMatchObject({ ok: false });
    expect(parseCanvas('{"nodes":[],"edges":[{"id":"e","fromNode":"a"}]}')).toMatchObject({ ok: false });
  });

  it("renames duplicate ids without losing any node", () => {
    const doc = parsed(JSON.stringify({ nodes: [node("a"), node("a"), node("a")], edges: [] }));
    expect(doc.nodes.map((n) => n.id)).toEqual(["a", "a-2", "a-3"]);
  });

  it("skips ids that already exist when renaming duplicates", () => {
    const doc = parsed(JSON.stringify({ nodes: [node("a"), node("a"), node("a-2")], edges: [] }));
    expect(doc.nodes.map((n) => n.id)).toEqual(["a", "a-3", "a-2"]);
  });

  it("renames duplicate edge ids too", () => {
    const e = { id: "e", fromNode: "a", toNode: "b" };
    const doc = parsed(JSON.stringify({ nodes: [], edges: [e, e] }));
    expect(doc.edges.map((x) => x.id)).toEqual(["e", "e-2"]);
  });
});

describe("serializeCanvas", () => {
  it("preserves unknown node types and fields through a round trip", () => {
    const src = JSON.stringify({ nodes: [{ ...node("n1"), type: "raro", foo: 1, nested: { a: [1, 2] } }], edges: [] });
    const original = parsed(src).nodes[0];
    const doc = parsed(serializeCanvas(parsed(src)));
    expect(doc.nodes[0]).toEqual(original);
    expect(doc.nodes[0]).toEqual({ ...node("n1"), type: "raro", foo: 1, nested: { a: [1, 2] } });
  });

  it("preserves fields named like Object.prototype members, including __proto__", () => {
    const src =
      '{"nodes":[{"id":"a","type":"x","x":0,"y":0,"width":1,"height":1,' +
      '"constructor":"keep","toString":1,"__proto__":{"z":1}}],"edges":[]}';
    const first = parsed(src).nodes[0];
    for (const k of ["constructor", "toString", "__proto__"]) expect(Object.prototype.hasOwnProperty.call(first, k)).toBe(true);

    const out = serializeCanvas(parsed(src));
    expect(out).toContain('"constructor": "keep"');
    expect(out).toContain('"toString": 1');
    expect(out).toContain('"__proto__"');

    const again = parsed(out).nodes[0];
    for (const k of ["constructor", "toString", "__proto__"]) expect(Object.prototype.hasOwnProperty.call(again, k)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(again, "__proto__")?.value).toEqual({ z: 1 });
    expect(Object.getPrototypeOf(again)).toBe(Object.prototype);
    expect(serializeCanvas(parsed(out))).toBe(out);
  });

  it("puts id,type,x,y,width,height first and keeps the rest in order", () => {
    const messy = { zeta: 1, height: 5, color: "2", width: 4, y: 3, x: 2, type: "text", alpha: 2, id: "n" };
    const out = serializeCanvas({ nodes: [messy as never], edges: [] });
    const keys = Object.keys(JSON.parse(out).nodes[0]);
    expect(keys).toEqual(["id", "type", "x", "y", "width", "height", "zeta", "color", "alpha"]);
  });

  it("orders edge keys with id,fromNode,toNode first", () => {
    const out = serializeCanvas({ nodes: [], edges: [{ label: "l", toNode: "b", extra: 1, fromNode: "a", id: "e" }] });
    expect(Object.keys(JSON.parse(out).edges[0])).toEqual(["id", "fromNode", "toNode", "label", "extra"]);
  });

  it("is idempotent, indented with 2 spaces and ends with a newline", () => {
    const d = { nodes: [node("a", { text: "hola", color: "1" })], edges: [{ id: "e", fromNode: "a", toNode: "a" }] };
    const once = serializeCanvas(d);
    expect(serializeCanvas(parsed(once))).toBe(once);
    expect(once.endsWith("}\n")).toBe(true);
    expect(once).toContain('\n  "nodes": [');
  });

  // The Rust side (`EMPTY_CANVAS` in templates.rs) writes this exact text for a new board:
  // if the two ever differ, the first edit of a new board reformats the file.
  it("an empty board serializes to exactly what a new board file contains", () => {
    expect(serializeCanvas({ nodes: [], edges: [] })).toBe('{\n  "nodes": [],\n  "edges": []\n}\n');
  });
});

describe("newId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns 8 characters and is not constant", () => {
    expect(newId()).toHaveLength(8);
    expect(newId()).not.toBe(newId());
  });

  it("uses randomUUID when the webview has it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "a1b2c3d4-0000-4000-8000-000000000000" });
    expect(newId()).toBe("a1b2c3d4");
  });

  it("falls back to getRandomValues when randomUUID is missing (insecure context)", () => {
    const getRandomValues = vi.fn((a: Uint8Array) => a.fill(37));
    vi.stubGlobal("crypto", { getRandomValues });
    const id = newId();
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(id).toBe("bbbbbbbb"); // 37 % 36 = 1 -> "b"
  });

  it("falls back to Math.random when there is no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    const ids = new Set(Array.from({ length: 20 }, newId));
    expect(ids.size).toBeGreaterThan(1);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("mergeCanvasText", () => {
  const base = text({ nodes: [node("n1", { text: "base" })], edges: [] });

  it("combines a move by me with a node added by them", () => {
    const mine = text({ nodes: [node("n1", { text: "base", x: 50 })], edges: [] });
    const theirs = text({ nodes: [node("n1", { text: "base" }), node("n2")], edges: [] });
    const r = mergeCanvasText(base, mine, theirs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const doc = parsed(r.text);
      expect(doc.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
      expect(doc.nodes[0].x).toBe(50);
    }
  });

  it("conflicts when both change the same node differently", () => {
    const mine = text({ nodes: [node("n1", { text: "mío" })], edges: [] });
    const theirs = text({ nodes: [node("n1", { text: "suyo" })], edges: [] });
    expect(mergeCanvasText(base, mine, theirs)).toEqual({ ok: false });
  });

  it("conflicts when both add the same new id with different content", () => {
    const mine = text({ nodes: [node("n1", { text: "base" }), node("n2", { text: "a" })], edges: [] });
    const theirs = text({ nodes: [node("n1", { text: "base" }), node("n2", { text: "b" })], edges: [] });
    expect(mergeCanvasText(base, mine, theirs)).toEqual({ ok: false });
  });

  it("merge output is already in canonical serialized form", () => {
    const mine = text({ nodes: [node("n1", { text: "base", x: 50 })], edges: [] });
    const theirs = text({ nodes: [node("n1", { text: "base" }), node("n2", { zeta: 1, color: "3" })], edges: [] });
    const r = mergeCanvasText(base, mine, theirs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializeCanvas(parsed(r.text))).toBe(r.text);
  });

  it("is fine when both make the same change", () => {
    const same = text({ nodes: [node("n1", { text: "igual" })], edges: [] });
    const r = mergeCanvasText(base, same, same);
    expect(r.ok).toBe(true);
    if (r.ok) expect(parsed(r.text).nodes[0].text).toBe("igual");
  });

  it("removes a node deleted by them when I did not touch it", () => {
    const theirs = text({ nodes: [], edges: [] });
    const r = mergeCanvasText(base, base, theirs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(parsed(r.text).nodes).toHaveLength(0);
  });

  it("removes a node deleted by me when they did not touch it", () => {
    const mine = text({ nodes: [], edges: [] });
    const r = mergeCanvasText(base, mine, base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(parsed(r.text).nodes).toHaveLength(0);
  });

  it("conflicts when they delete a node I edited", () => {
    const mine = text({ nodes: [node("n1", { text: "editado" })], edges: [] });
    const theirs = text({ nodes: [], edges: [] });
    expect(mergeCanvasText(base, mine, theirs)).toEqual({ ok: false });
    expect(mergeCanvasText(base, theirs, mine)).toEqual({ ok: false });
  });

  it("orders nodes: base, then added by me, then added by them", () => {
    const mine = text({ nodes: [node("n1", { text: "base" }), node("m1")], edges: [] });
    const theirs = text({ nodes: [node("t1"), node("n1", { text: "base" })], edges: [] });
    const r = mergeCanvasText(base, mine, theirs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(parsed(r.text).nodes.map((n) => n.id)).toEqual(["n1", "m1", "t1"]);
  });

  it("merges edges by id the same way", () => {
    const e = { id: "e1", fromNode: "n1", toNode: "n1" };
    const b = text({ nodes: [node("n1")], edges: [e] });
    const mine = text({ nodes: [node("n1")], edges: [{ ...e, label: "x" }] });
    const theirs = text({ nodes: [node("n1")], edges: [e, { id: "e2", fromNode: "n1", toNode: "n1" }] });
    const r = mergeCanvasText(b, mine, theirs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const doc = parsed(r.text);
      expect(doc.edges.map((x) => x.id)).toEqual(["e1", "e2"]);
      expect(doc.edges[0].label).toBe("x");
    }
    const conflictTheirs = text({ nodes: [node("n1")], edges: [{ ...e, label: "y" }] });
    expect(mergeCanvasText(b, mine, conflictTheirs)).toEqual({ ok: false });
  });

  it("fails when any of the three texts is invalid", () => {
    expect(mergeCanvasText("{", base, base)).toEqual({ ok: false });
    expect(mergeCanvasText(base, "", base)).toEqual({ ok: false });
    expect(mergeCanvasText(base, base, "nope")).toEqual({ ok: false });
  });
});

describe("archived", () => {
  const n = (archived: unknown) => node("a", { archived });
  it("reads a valid archived field", () => {
    expect(archivedOf(n({ at: "2026-10-21", reason: "viejo", by: "claude" }))).toEqual({ at: "2026-10-21", reason: "viejo", by: "claude" });
    expect(archivedOf(n({ at: "2026-10-21", reason: "" }))).toEqual({ at: "2026-10-21", reason: "" });
  });
  it.each([
    ["missing", undefined],
    ["malformed at", { at: "21/10/2026", reason: "x" }],
    ["at with extra text", { at: "2026-10-21T10:00", reason: "x" }],
    ["reason not a string", { at: "2026-10-21", reason: 3 }],
    ["not an object", "2026-10-21"],
    ["array", []],
    ["null", null],
  ])("is null when %s", (_n, v) => {
    expect(archivedOf(n(v))).toBeNull();
  });
  it("drops an unknown `by` but keeps the entry", () => {
    expect(archivedOf(n({ at: "2026-10-21", reason: "x", by: "robot" }))).toEqual({ at: "2026-10-21", reason: "x" });
  });
  const rich = node("a", { text: "hola", color: "3", extra: { k: [1, { z: null }] }, "weird-key": 7 });
  it("archiveNode adds the field with the local date and keeps every other field", () => {
    const out = archiveNode(rich, "reemplazado", "tu", new Date(2026, 9, 5, 23, 59));
    expect(out).toEqual({ ...rich, archived: { at: "2026-10-05", reason: "reemplazado", by: "tu" } });
    expect(rich).not.toHaveProperty("archived");
  });
  it("restoreNode removes only archived", () => {
    const out = restoreNode(archiveNode(rich, "x", "claude", new Date(2026, 0, 2)));
    expect(out).toEqual(rich);
    expect(out).not.toHaveProperty("archived");
  });
  it("restoreNode also clears a malformed archived field", () => {
    expect(restoreNode(n("junk"))).not.toHaveProperty("archived");
  });
  it("archive and restore on one block while another changes on disk lose neither", () => {
    const a = node("a", { text: "A" });
    const b = node("b", { text: "B" });
    const base = serializeCanvas({ nodes: [a, b], edges: [] });
    const mine = serializeCanvas({ nodes: [archiveNode(a, "x", "tu", new Date(2026, 9, 21)), b], edges: [] });
    const theirs = serializeCanvas({ nodes: [a, { ...b, text: "B2" }], edges: [] });
    const merged = mergeCanvasText(base, mine, theirs);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const doc = parseCanvas(merged.text);
    if (!doc.ok) throw new Error("bad");
    expect(doc.doc.nodes[0]).toMatchObject({ id: "a", text: "A", archived: { at: "2026-10-21" } });
    expect(doc.doc.nodes[1]).toMatchObject({ id: "b", text: "B2" });
  });
  it("both sides touching the same block is a conflict", () => {
    const a = node("a", { text: "A" });
    const base = serializeCanvas({ nodes: [a], edges: [] });
    const mine = serializeCanvas({ nodes: [archiveNode(a, "x", "tu", new Date(2026, 9, 21))], edges: [] });
    const theirs = serializeCanvas({ nodes: [{ ...a, text: "A2" }], edges: [] });
    expect(mergeCanvasText(base, mine, theirs)).toEqual({ ok: false });
  });
});
