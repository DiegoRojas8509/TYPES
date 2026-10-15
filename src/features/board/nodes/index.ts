import type { NodeTypes } from "@xyflow/react";

/**
 * Block components keyed by canvas node `type`. Types missing here fall back to
 * a plain card in `BoardView`, so no node is ever invisible. Defined at module
 * level on purpose: React Flow needs a stable `nodeTypes` identity.
 */
export const nodeTypes: NodeTypes = {};
