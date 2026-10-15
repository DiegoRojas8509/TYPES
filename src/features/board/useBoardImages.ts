// Image paste/drop for the board: saves each image as an attachment and adds a
// `file` node pointing at it. Everything after an `await` re-checks the live
// `editableRef` (through `addNodes`) so a board that became unreadable meanwhile
// is never written over.
import { useCallback, useEffect, useRef, type DragEvent, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import { api, errorMessage } from "../../lib/api";
import type { CanvasNode } from "../../lib/canvas";
import { spaceOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { relativeSrc } from "../../lib/markdown";
import { defaultNode } from "./addMenu";
import { whole } from "./boardModel";

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function useBoardImages({
  path,
  editableRef,
  addNodes,
  viewportCentre,
}: {
  path: string;
  editableRef: RefObject<boolean>;
  addNodes(nodes: CanvasNode[]): void;
  /** Centre of the visible board in flow coordinates (where pasted images land). */
  viewportCentre(): { x: number; y: number };
}) {
  const rf = useReactFlow();
  const notify = useApp((s) => s.notify);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const insertImages = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      const space = spaceOf(path);
      if (!path.includes("/") || !space) {
        notify("Las imágenes se guardan dentro de un espacio. Mueve esta pizarra a uno para pegar imágenes.");
        return;
      }
      let origin = at ?? viewportCentre();
      for (const file of files) {
        try {
          const ext = IMAGE_EXT[file.type] ?? "png";
          const name = file.name || `imagen.${ext}`;
          const saved = await api.saveAttachment(space, name, new Uint8Array(await file.arrayBuffer()));
          if (!mounted.current) return;
          const node = defaultNode("image", whole(origin.x - 150), whole(origin.y - 110));
          addNodes([{ ...node, file: plainRelative(path, saved) }]);
          origin = { x: origin.x + 24, y: origin.y + 24 };
        } catch (e) {
          notify(`No se pudo guardar la imagen: ${errorMessage(e)}`);
        }
      }
    },
    [path, notify, viewportCentre, addNodes],
  );

  // Paste: window-level so it works once the board has been clicked, but never
  // while Diego is typing in a note or table cell.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!editableRef.current) return;
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      const files = imageFiles(e.clipboardData?.files);
      if (files.length === 0) return;
      e.preventDefault();
      void insertImages(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editableRef, insertImages]);

  function onDragOver(e: DragEvent) {
    if (editableRef.current && e.dataTransfer.types.includes("Files")) e.preventDefault();
  }
  function onDrop(e: DragEvent) {
    const files = imageFiles(e.dataTransfer.files);
    if (!editableRef.current || files.length === 0) return;
    e.preventDefault();
    void insertImages(files, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }

  return { onDragOver, onDrop };
}

function imageFiles(list: FileList | undefined | null): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Path of `saved` relative to the board's folder, written plainly (no %20) as the `.canvas` format expects. */
function plainRelative(boardPath: string, saved: string): string {
  return relativeSrc(boardPath, saved).replace(/%20/g, " ").replace(/%28/g, "(").replace(/%29/g, ")");
}
