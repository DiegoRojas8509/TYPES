import type { NodeProps } from "@xyflow/react";
import { useEffect, useState } from "react";
import { assetUrl } from "../../../lib/api";
import { resolveImageSrc } from "../../../lib/markdown";
import { baseName } from "../../../lib/paths";
import { useApp } from "../../../store/app";
import { useBoardContext } from "../boardActions";
import type { FlowNode } from "../boardModel";
import { BlockShell } from "./BlockShell";
import { GlyphImage } from "./glyphs";

/**
 * Picture block. `file` is relative to the board's folder; an empty `file` is
 * the placeholder from the "+" menu (dropping or pasting is handled by the board).
 */
export function ImageNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { boardPath } = useBoardContext();
  const root = useApp((s) => s.settings?.workspaceRoot ?? null);
  const file = typeof data.file === "string" ? data.file : "";
  const src = file ? resolveImageSrc(boardPath, file, root, assetUrl) : "";
  const [broken, setBroken] = useState(false);
  // A new path (Claude fixed it, or the image was replaced) deserves a fresh try.
  useEffect(() => setBroken(false), [src]);

  const name = file ? baseName(file) : "";
  return (
    <BlockShell id={id} selected={selected} title={name || "Imagen"} glyph={<GlyphImage />} color={data.color} minHeight={100} className="block-image">
      {!file ? (
        <div className="image-empty">Suelta una imagen aquí o pégala</div>
      ) : broken ? (
        <div className="image-missing">
          <strong>No encuentro la imagen</strong>
          <code>{name}</code>
        </div>
      ) : (
        <img src={src} alt={name} draggable={false} onError={() => setBroken(true)} />
      )}
    </BlockShell>
  );
}
