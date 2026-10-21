// Shared chrome of every board block: the "graphic card" look in one place.
//
//   <BlockShell id={id} selected={selected} title="Telas" glyph={<GlyphNote />} color={data.color}>
//     ...body...
//   </BlockShell>
//
// Props
//   id        node id (React Flow's `id` prop); scopes the resizer and handles to this node.
//   selected  React Flow's `selected` prop: draws the selection ring and shows the resize handles.
//   title     text of the header strip. Pass a fallback ("Nota"), never an empty string.
//   glyph     small icon in front of the title (see glyphs.tsx).
//   color     the node's optional `color`: JSON Canvas preset "1".."6" or a hex string; anything
//             else is neutral. Presets map to `--block-1..6` (tokens.css, themed light/dark);
//             hex travels as the inline `--block-accent`.
//   titleSlot optional replacement for the title text (an inline title input, see TitleInput.tsx).
//             `title` stays the fallback and the accessible name.
//   actions   optional node placed at the right end of the header.
//   minWidth/minHeight  resize limits (defaults 160 x 80).
//   className extra classes for the card (e.g. "is-editing").
//   children  the body; it scrolls inside the card when it overflows.
//
// Styling lives in nodes.css under `.block*`. New block types only add a body.
import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { CSSProperties, ReactNode } from "react";
import { ArchiveControl } from "./ArchiveControl";

const PRESET = /^[1-6]$/;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Validated accent of a node colour. Unknown values are neutral, so nothing odd reaches the CSS. */
export function accentOf(color: unknown): { preset?: string; hex?: string } {
  if (typeof color !== "string") return {};
  if (PRESET.test(color)) return { preset: color };
  if (HEX.test(color)) return { hex: color };
  return {};
}

/** `data-accent` / `--block-accent` attributes shared by every kind of block (cards and zones). */
export function accentProps(color: unknown): { "data-accent"?: string; style?: CSSProperties } {
  const { preset, hex } = accentOf(color);
  if (preset) return { "data-accent": preset };
  if (hex) return { style: { "--block-accent": hex } as CSSProperties };
  return {};
}

/** Resize handles (only while selected) and the connection points. Used by BlockShell and GroupNode. */
export function BlockConnectors({ id, selected, minWidth, minHeight }: { id: string; selected: boolean; minWidth: number; minHeight: number }) {
  return (
    <>
      <NodeResizer
        nodeId={id}
        isVisible={selected}
        minWidth={minWidth}
        minHeight={minHeight}
        lineClassName="block-resize-line"
        handleClassName="block-resize-handle"
      />
      <Handle id="in" type="target" position={Position.Left} className="block-handle" />
      <Handle id="out" type="source" position={Position.Right} className="block-handle" />
    </>
  );
}

export function BlockShell({
  id,
  selected,
  title,
  glyph,
  color,
  titleSlot,
  actions,
  minWidth = 160,
  minHeight = 80,
  className,
  children,
}: {
  id: string;
  selected: boolean;
  title: string;
  glyph: ReactNode;
  color?: unknown;
  titleSlot?: ReactNode;
  actions?: ReactNode;
  minWidth?: number;
  minHeight?: number;
  className?: string;
  children: ReactNode;
}) {
  const accent = accentProps(color);
  return (
    <div
      className={className ? `block ${className}` : "block"}
      data-selected={selected ? "true" : "false"}
      role="group"
      aria-labelledby={`${id}-title`}
      {...accent}
    >
      <BlockConnectors id={id} selected={selected} minWidth={minWidth} minHeight={minHeight} />
      <header className="block-head">
        <span className="block-glyph" aria-hidden="true">
          {glyph}
        </span>
        <span className={titleSlot ? "block-title is-editable" : "block-title"} id={`${id}-title`}>
          {titleSlot ?? title}
        </span>
        {actions}
        <ArchiveControl id={id} title={title} />
      </header>
      <div className="block-body">{children}</div>
    </div>
  );
}
