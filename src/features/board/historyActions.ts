// archive / restore for the board: same persist path as `update`, so they respect the
// live `editableRef` and never write on open. Kept out of BoardView to keep it small.
import type { MutableRefObject } from "react";
import { archiveNode, restoreNode, type CanvasNode } from "../../lib/canvas";
import type { BoardActions } from "./boardActions";
import { toFlowNode, fromFlowNode, type FlowEdge, type FlowNode } from "./boardModel";

export const MANUAL_REASON = "archivado a mano";

export function historyActions(deps: {
  nodesRef: MutableRefObject<FlowNode[]>;
  edgesRef: MutableRefObject<FlowEdge[]>;
  editableRef: MutableRefObject<boolean>;
  apply(n: FlowNode[], e: FlowEdge[]): void;
  persist(n: FlowNode[], e: FlowEdge[]): void;
  isKnown(type: string): boolean;
  now?: () => Date;
}): Pick<BoardActions, "archive" | "restore"> {
  const { nodesRef, edgesRef, editableRef, apply, persist, isKnown, now = () => new Date() } = deps;
  function change(id: string, fn: (n: CanvasNode) => CanvasNode) {
    if (!editableRef.current || !nodesRef.current.some((n) => n.id === id)) return;
    const next = nodesRef.current.map((n) =>
      n.id === id ? { ...toFlowNode(fn(fromFlowNode(n)), isKnown), selected: false, measured: n.measured } : n,
    );
    apply(next, edgesRef.current);
    persist(next, edgesRef.current);
  }
  return {
    archive: (id, reason) => change(id, (n) => archiveNode(n, reason?.trim() || MANUAL_REASON, "tu", now())),
    restore: (id) => change(id, restoreNode),
  };
}
