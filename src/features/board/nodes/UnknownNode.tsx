import type { NodeProps } from "@xyflow/react";
import type { FlowNode } from "../boardModel";
import { BlockShell } from "./BlockShell";
import { GlyphUnknown } from "./glyphs";

/**
 * Card for node types this app has no block for (made by Claude or other tools).
 * Read-only on purpose: it never calls `update`, so the node's fields stay as they are on disk.
 */
export function UnknownNode({ id, data, selected }: NodeProps<FlowNode>) {
  return (
    <BlockShell id={id} selected={selected} title={data.type} glyph={<GlyphUnknown />} color={data.color} className="block-unknown">
      <p className="block-note">Bloque de tipo «{data.type}» no soportado: se conserva sin cambios</p>
    </BlockShell>
  );
}
