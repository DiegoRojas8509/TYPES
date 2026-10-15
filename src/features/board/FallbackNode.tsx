import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "./boardModel";

/** Minimal card for node types without a block component, so nothing is invisible. */
export function FallbackNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className="board-fallback">
      <Handle type="target" position={Position.Left} />
      <span className="board-fallback-type">{data.type}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
