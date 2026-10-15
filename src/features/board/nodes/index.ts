import "./nodes.css";
import type { NodeTypes } from "@xyflow/react";
import { FALLBACK_TYPE } from "../boardModel";
import { GroupNode } from "./GroupNode";
import { ImageNode } from "./ImageNode";
import { NoteNode } from "./NoteNode";
import { UnknownNode } from "./UnknownNode";

/**
 * Block components keyed by canvas node `type`. Tasks adding a block type
 * register it here. Defined at module level on purpose: React Flow needs a
 * stable `nodeTypes` identity.
 */
export const nodeTypes: NodeTypes = {
  text: NoteNode,
  file: ImageNode,
  group: GroupNode,
  default: UnknownNode,
};

/**
 * What the board hands to React Flow: the registered blocks plus the card for
 * every canvas type without one (`toFlowNode` maps those to FALLBACK_TYPE).
 */
export const flowNodeTypes: NodeTypes = { ...nodeTypes, [FALLBACK_TYPE]: UnknownNode };
