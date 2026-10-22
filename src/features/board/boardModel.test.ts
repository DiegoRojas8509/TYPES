import { describe, expect, it } from "vitest";
import type { NodeChange } from "@xyflow/react";
import { archiveNode, parseCanvas, serializeCanvas, type CanvasNode } from "../../lib/canvas";
import {
  FALLBACK_TYPE,
  fromFlow,
  isUserEdit,
  patchFlowNode,
  roundChanges,
  toFlowEdge,
  toFlowNode,
  visibleEdges,
  type FlowNode,
} from "./boardModel";

const none = () => false;
const all = () => true;
const node: CanvasNode = { id: "a", type: "text", x: 1, y: 2, width: 30, height: 40, text: "hola", extra: { k: [1] } };

describe("boardModel", () => {
  it("round-trips a node with its unknown fields untouched", () => {
    const back = fromFlow([toFlowNode(node, all)], []);
    expect(back.nodes[0]).toEqual(node);
  });

  it("zones sit behind the blocks and only their label bar drags them", () => {
    const zone = toFlowNode({ ...node, id: "z", type: "group", label: "Zona" }, all);
    expect(zone.zIndex).toBeLessThan(toFlowNode(node, all).zIndex ?? 0);
    expect(zone.dragHandle).toBe(".zone-head");
    expect(toFlowNode(node, all).dragHandle).toBeUndefined();
    // The handle is a view concern: it never reaches the file.
    expect(fromFlow([zone], []).nodes[0]).not.toHaveProperty("dragHandle");
  });

  it("unregistered types use the fallback renderer but keep their canvas type", () => {
    const f = toFlowNode(node, none);
    expect(f.type).toBe(FALLBACK_TYPE);
    expect(fromFlow([f], []).nodes[0].type).toBe("text");
  });

  it("reads position and size back from the live flow state", () => {
    const f: FlowNode = { ...toFlowNode(node, all), position: { x: 100, y: 200 }, width: 55, height: 66 };
    expect(fromFlow([f], []).nodes[0]).toMatchObject({ x: 100, y: 200, width: 55, height: 66, text: "hola" });
  });

  it("keeps edge extras and hides only the dangling ones on screen", () => {
    const edges = [
      toFlowEdge({ id: "e1", fromNode: "a", toNode: "a", label: "x", weight: 3 }),
      toFlowEdge({ id: "e2", fromNode: "a", toNode: "ghost" }),
    ];
    const nodes = [toFlowNode(node, all)];
    expect(visibleEdges(nodes, edges).map((e) => e.id)).toEqual(["e1"]);
    expect(fromFlow(nodes, edges).edges[0]).toEqual({ id: "e1", fromNode: "a", toNode: "a", label: "x", weight: 3 });
    expect(fromFlow(nodes, edges).edges).toHaveLength(2);
  });

  it("patches merge into the node and keep selection and live position", () => {
    const f: FlowNode = { ...toFlowNode(node, all), position: { x: 9, y: 8 }, selected: true };
    const p = patchFlowNode(f, { text: "nuevo", width: 99 }, all);
    expect(p.selected).toBe(true);
    expect(fromFlow([p], []).nodes[0]).toMatchObject({ x: 9, y: 8, width: 99, height: 40, text: "nuevo", extra: { k: [1] } });
    expect(patchFlowNode(f, { id: "zzz" }, all).id).toBe("a");
  });

  it("a patch keeps React Flow's measured size and selection", () => {
    const f: FlowNode = { ...toFlowNode(node, all), selected: true, measured: { width: 120, height: 45 } };
    const p = patchFlowNode(f, { text: "nuevo" }, all);
    expect(p.measured).toEqual({ width: 120, height: 45 });
    expect(p.selected).toBe(true);
    expect(patchFlowNode(toFlowNode(node, all), { text: "x" }, all).measured).toBeUndefined();
  });

  it("rounds positions and attribute-setting dimensions only", () => {
    const changes = [
      { id: "a", type: "position", position: { x: 1.6, y: -2.4 }, dragging: true },
      { id: "a", type: "dimensions", dimensions: { width: 10.5, height: 20.4 }, setAttributes: true, resizing: true },
      { id: "a", type: "dimensions", dimensions: { width: 10.5, height: 20.4 } },
    ] as NodeChange<FlowNode>[];
    const out = roundChanges(changes) as unknown as { position?: unknown; dimensions?: unknown }[];
    expect(out[0].position).toEqual({ x: 2, y: -2 });
    expect(out[1].dimensions).toEqual({ width: 11, height: 20 });
    expect(out[2].dimensions).toEqual({ width: 10.5, height: 20.4 });
  });

  it("only the end of a drag or resize and deletions count as user edits", () => {
    const c = (x: unknown) => x as NodeChange<FlowNode>;
    expect(isUserEdit(c({ id: "a", type: "position", position: { x: 1, y: 1 }, dragging: true }))).toBe(false);
    expect(isUserEdit(c({ id: "a", type: "position", position: { x: 1, y: 1 }, dragging: false }))).toBe(true);
    expect(isUserEdit(c({ id: "a", type: "dimensions", resizing: true }))).toBe(false);
    expect(isUserEdit(c({ id: "a", type: "dimensions", dimensions: { width: 1, height: 1 } }))).toBe(false);
    expect(isUserEdit(c({ id: "a", type: "dimensions", resizing: false }))).toBe(true);
    expect(isUserEdit(c({ id: "a", type: "select", selected: true }))).toBe(false);
    expect(isUserEdit(c({ id: "a", type: "remove" }))).toBe(true);
  });
});

describe("archived nodes in the flow", () => {
  const archived = archiveNode(node, "viejo", "tu", new Date(2026, 9, 21));
  it("hides only a validly archived node", () => {
    expect(toFlowNode(archived, all).hidden).toBe(true);
    expect(toFlowNode(node, all).hidden).toBeUndefined();
    expect(toFlowNode({ ...node, archived: { at: "ayer", reason: "x" } }, all).hidden).toBeUndefined();
    expect(toFlowNode({ ...node, archived: "x" }, all).hidden).toBeUndefined();
  });
  it("patchFlowNode keeps the hidden state in sync", () => {
    const f = toFlowNode(archived, all);
    expect(patchFlowNode(f, { text: "x" }, all).hidden).toBe(true);
    expect(patchFlowNode(f, { archived: undefined }, all).hidden).toBeUndefined();
  });
  it("edges touching an archived node are not shown but are saved", () => {
    const b: CanvasNode = { ...node, id: "b" };
    const nodes = [toFlowNode(archived, all), toFlowNode(b, all)];
    const edges = [toFlowEdge({ id: "e", fromNode: "a", toNode: "b" }), toFlowEdge({ id: "f", fromNode: "b", toNode: "b" })];
    expect(visibleEdges(nodes, edges).map((e) => e.id)).toEqual(["f"]);
    expect(fromFlow(nodes, edges).edges.map((e) => e.id)).toEqual(["e", "f"]);
  });
  it("the saved JSON has the whole node plus archived and never `hidden`", () => {
    const text = serializeCanvas(fromFlow([toFlowNode(archived, all)], []));
    expect(text).not.toContain("hidden");
    const parsed = parseCanvas(text);
    expect(parsed.ok && parsed.doc.nodes[0]).toEqual(archived);
  });
  it("fromFlowNode ignores hidden set on the flow node", () => {
    const f = { ...toFlowNode(node, all), hidden: true };
    expect(fromFlow([f], []).nodes[0]).toEqual(node);
  });
});
