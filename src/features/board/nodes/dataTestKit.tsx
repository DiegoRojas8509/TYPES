// Shared harness of the data-block tests: mounts one node the way BoardView does.
import { vi } from "vitest";
import { ReactFlow, ReactFlowProvider, type NodeTypes } from "@xyflow/react";
import type { ReactElement } from "react";
import type { CanvasNode } from "../../../lib/canvas";
import { BoardActionsContext, BoardContext } from "../boardActions";
import { toFlowNode, type FlowNode } from "../boardModel";
import { flowNodeTypes, nodeTypes } from "./index";

export const update = vi.fn();
export const isKnown = (t: string) => Object.prototype.hasOwnProperty.call(nodeTypes, t);
export const make = (extra: Partial<CanvasNode> & { type: string }): CanvasNode => ({ id: "n1", x: 0, y: 0, width: 360, height: 240, ...extra });

export function board(node: CanvasNode, selected = false, types: NodeTypes = flowNodeTypes): ReactElement {
  const flowNode: FlowNode = { ...toFlowNode(node, (t) => Object.prototype.hasOwnProperty.call(types, t)), selected };
  return (
    <BoardContext.Provider value={{ boardPath: "Ropa/Plan.canvas" }}>
      <BoardActionsContext.Provider value={{ update }}>
        <ReactFlowProvider>
          <div style={{ width: 800, height: 600 }}>
            <ReactFlow nodes={[flowNode]} edges={[]} nodeTypes={types} />
          </div>
        </ReactFlowProvider>
      </BoardActionsContext.Provider>
    </BoardContext.Provider>
  );
}
