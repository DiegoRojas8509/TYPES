import { describe, expect, it } from "vitest";
import type { NodeChange } from "@xyflow/react";
import type { CanvasNode } from "../../lib/canvas";
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
