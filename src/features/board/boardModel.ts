// Pure conversions between the `.canvas` model and React Flow's node/edge shape.
// The full CanvasNode/CanvasEdge travels in `data`, so fields this app does not
// know (added by Claude or other tools) survive any edit untouched. Only
// position and size are read back from React Flow's own state.
import type { Edge, Node, NodeChange } from "@xyflow/react";
import type { CanvasDoc, CanvasEdge, CanvasNode } from "../../lib/canvas";

export type FlowNode = Node<CanvasNode>;
export type FlowEdge = Edge<CanvasEdge>;

/** React Flow type used for canvas types without a registered block component. */
export const FALLBACK_TYPE = "__unknown";

export function toFlowNode(n: CanvasNode, isKnown: (type: string) => boolean): FlowNode {
  return {
    id: n.id,
    type: isKnown(n.type) ? n.type : FALLBACK_TYPE,
    position: { x: n.x, y: n.y },
    width: n.width,
    height: n.height,
    // Zones sit behind the blocks they group.
    zIndex: n.type === "group" ? 0 : 1,
    // A zone is big and mostly empty: only its label bar drags it, so dragging
    // inside it pans the board like any empty area.
    ...(n.type === "group" ? { dragHandle: ".zone-head" } : {}),
    data: n,
  };
}

export function toFlowEdge(e: CanvasEdge): FlowEdge {
  return { id: e.id, source: e.fromNode, target: e.toNode, data: e };
}

/** The node as the file stores it: original fields plus the live position and size. */
export function fromFlowNode(n: FlowNode): CanvasNode {
  return {
    ...n.data,
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.width ?? n.data.width,
    height: n.height ?? n.data.height,
  };
}

export function fromFlowEdge(e: FlowEdge): CanvasEdge {
  const base = e.data ?? ({} as CanvasEdge);
  return { ...base, id: e.id, fromNode: e.source, toNode: e.target };
}

export function fromFlow(nodes: FlowNode[], edges: FlowEdge[]): CanvasDoc {
  return { nodes: nodes.map(fromFlowNode), edges: edges.map(fromFlowEdge) };
}

/** Edges whose endpoints exist. Dangling ones stay in the file, just not on screen. */
export function visibleEdges(nodes: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
}

/** Merges a block's patch into a node, keeping selection and its live position. */
export function patchFlowNode(n: FlowNode, patch: Partial<CanvasNode>, isKnown: (type: string) => boolean): FlowNode {
  const merged: CanvasNode = { ...fromFlowNode(n), ...patch, id: n.id };
  return { ...toFlowNode(merged, isKnown), selected: n.selected };
}

/** Rounds to an integer; NaN and Infinity become 0 so a position can never corrupt the file. */
export const whole = (v: number) => (Number.isFinite(v) ? Math.round(v) : 0);

/** Integer positions and sizes in the file: no `12.3456789` after dragging at odd zoom levels. */
export function roundChanges(changes: NodeChange<FlowNode>[]): NodeChange<FlowNode>[] {
  return changes.map((c) => {
    if (c.type === "position" && c.position) return { ...c, position: { x: whole(c.position.x), y: whole(c.position.y) } };
    if (c.type === "dimensions" && c.setAttributes && c.dimensions) {
      return { ...c, dimensions: { width: whole(c.dimensions.width), height: whole(c.dimensions.height) } };
    }
    return c;
  });
}

/** True for changes that come from the user editing the board (drop of a drag, end of a resize, delete). */
export function isUserEdit(c: NodeChange<FlowNode>): boolean {
  if (c.type === "remove") return true;
  if (c.type === "position") return c.dragging === false;
  if (c.type === "dimensions") return c.resizing === false;
  return false;
}
