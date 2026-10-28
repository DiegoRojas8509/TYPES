import { describe, expect, it, vi } from "vitest";
import { toFlowNode, type FlowEdge, type FlowNode } from "./boardModel";
import { historyActions } from "./historyActions";

const node = { id: "a", type: "text", x: 1, y: 2, width: 3, height: 4, text: "t", extra: { k: 1 } };
function setup(editable: boolean) {
  const nodesRef = { current: [toFlowNode(node, () => true)] as FlowNode[] };
  const edgesRef = { current: [] as FlowEdge[] };
  const apply = vi.fn();
  const persist = vi.fn();
  const acts = historyActions({ nodesRef, edgesRef, editableRef: { current: editable }, apply, persist, isKnown: () => true, now: () => new Date(2026, 9, 21) });
  return { acts, apply, persist };
}

describe("historyActions", () => {
  it("archive persists the whole node plus archived; empty reason becomes «archivado a mano»", () => {
    const { acts, persist } = setup(true);
    acts.archive("a", "  ");
    const saved = persist.mock.calls[0][0][0].data;
    expect(saved).toEqual({ ...node, archived: { at: "2026-10-21", reason: "archivado a mano", by: "tu" } });
    expect(persist.mock.calls[0][0][0].hidden).toBe(true);
  });
  it("does nothing when not editable or for an unknown id", () => {
    const off = setup(false);
    off.acts.archive("a", "x");
    off.acts.restore("a");
    expect(off.persist).not.toHaveBeenCalled();
    const on = setup(true);
    on.acts.archive("zzz", "x");
    expect(on.persist).not.toHaveBeenCalled();
    expect(on.apply).not.toHaveBeenCalled();
  });
});
