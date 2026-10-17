import type { NodeProps } from "@xyflow/react";
import { assetUrl } from "../../../lib/api";
import { resolveWorkspacePath } from "../../../lib/markdown";
import { baseName } from "../../../lib/paths";
import { useApp } from "../../../store/app";
import { useBoardContext } from "../boardActions";
import type { FlowNode } from "../boardModel";
import { useImageUrl } from "../useImageUrl";
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
  // Only a path that stays inside the workspace ever becomes a URL. Absolute
  // paths, http(s)/data/javascript values and `..` escapes resolve to null and
  // are treated as a missing image, never handed to <img> raw.
  const rel = file && root ? resolveWorkspacePath(boardPath, file) : null;
  const base = rel !== null && root ? assetUrl(`${root.replace(/\/+$/, "")}/${rel}`) : "";
  // A new path, or an fs change on this very file (e.g. a restore), deserves a fresh try.
  const { src, failed, setFailed } = useImageUrl(rel, base);
  const broken = failed || (file !== "" && src === "");

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
        <img src={src} alt={name} draggable={false} onError={() => setFailed(true)} />
      )}
    </BlockShell>
  );
}
