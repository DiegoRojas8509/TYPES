import type { NodeProps } from "@xyflow/react";
import type { ChangeEvent } from "react";
import { useBoardActions } from "../boardActions";
import type { FlowNode } from "../boardModel";
import { accentProps, BlockConnectors } from "./BlockShell";
import { GlyphZone } from "./glyphs";

/**
 * Dashed zone that frames related blocks. It sits behind them (zIndex in
 * boardModel) and only its label bar drags it (`dragHandle` in boardModel), so
 * dragging inside the zone pans the board and never moves the zone by accident.
 */
export function GroupNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { update } = useBoardActions();
  const label = typeof data.label === "string" ? data.label : "";
  return (
    <div className="zone" data-selected={selected ? "true" : "false"} {...accentProps(data.color)}>
      <BlockConnectors id={id} selected={selected} minWidth={120} minHeight={80} />
      <div className="zone-head">
        <span className="block-glyph" aria-hidden="true">
          <GlyphZone />
        </span>
        <input
          className="zone-label nodrag"
          aria-label="Nombre de la zona"
          placeholder="Zona"
          size={Math.max(label.length, 4)}
          value={label}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update(id, { label: e.target.value })}
        />
      </div>
    </div>
  );
}
