import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { api, assetUrl, errorMessage } from "../../lib/api";
import { spaceOf, titleOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { createExtensions } from "../../lib/extensions";
import { pathFromAssetUrl, relativeSrc, resolveImageSrc, unresolveImageSrc, unsupportedSyntax } from "../../lib/markdown";
import { SlashCommand } from "./slash";
import { useDocument, type DocStatus, type UseDocument } from "./useDocument";

const STATUS_LABEL: Record<DocStatus, string> = {
  loading: "Abriendo…",
  clean: "Guardado",
  dirty: "Sin guardar",
  saving: "Guardando…",
  conflict: "Claude cambió esta página",
  error: "",
};

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** Markdown page: Tiptap on top of `useDocument`. Mount with `key={path}`. */
export function MarkdownEditor({ path }: { path: string }) {
  const doc = useDocument(path);

  return (
    <div className="editor">
      <div className="pane-header">
        <span className="pane-title" title={path}>
          {titleOf(path)}
        </span>
        {doc.status !== "error" && (
          <span className={`save-status is-${doc.status}`} role="status">
            {STATUS_LABEL[doc.status]}
          </span>
        )}
      </div>
      {doc.status === "conflict" && (
        <div className="banner banner-warn" role="alert">
          <span>Esta página cambió en el disco mientras la editabas. ¿Qué versión quieres conservar?</span>
          <button type="button" className="btn" onClick={doc.reloadFromDisk}>
            Recargar
          </button>
          <button type="button" className="btn" onClick={doc.keepMine}>
            Conservar lo mío
          </button>
        </div>
      )}
      {doc.status === "error" ? (
        <div className="empty" role="status">
          <h2>No se puede mostrar esta página</h2>
          <p>{doc.error}</p>
        </div>
      ) : doc.content === null ? (
        <div className="pane-body editor-loading" aria-busy="true" />
      ) : (
        <EditorSurface key={path} path={path} doc={doc} />
      )}
    </div>
  );
}

function EditorSurface({ path, doc }: { path: string; doc: UseDocument }) {
  const workspaceRoot = useApp((s) => s.settings?.workspaceRoot ?? null);
  const notify = useApp((s) => s.notify);
  const scrollRef = useRef<HTMLDivElement>(null);
  const suppress = useRef(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const editorRef = useRef<TiptapEditor | null>(null);
  const [forceEdit, setForceEdit] = useState(false);

  const unsupported = useMemo(() => unsupportedSyntax(doc.content ?? ""), [doc.content]);
  const locked = unsupported.length > 0 && !forceEdit;

  const extensions = useMemo(
    () => [
      ...createExtensions({
        resolveSrc: (src) => resolveImageSrc(path, src, workspaceRoot, assetUrl),
        toDiskSrc: (src) => unresolveImageSrc(path, src, workspaceRoot, pathFromAssetUrl),
      }),
      SlashCommand,
    ],
    [path, workspaceRoot],
  );

  async function insertImages(files: File[], pos?: number) {
    const space = spaceOf(path);
    if (!path.includes("/") || !space) {
      notify("Las imágenes se guardan dentro de un espacio. Mueve esta página a uno para pegar imágenes.");
      return;
    }
    for (const file of files) {
      try {
        const ext = IMAGE_EXT[file.type] ?? "png";
        const name = file.name || `imagen.${ext}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const saved = await api.saveAttachment(space, name, bytes);
        const editor = editorRef.current;
        if (!editor || editor.isDestroyed) return;
        const alt = name.replace(/\.[^.]+$/, "");
        const node = { type: "image", attrs: { src: relativeSrc(path, saved), alt } };
        if (pos !== undefined) editor.chain().focus().insertContentAt(pos, node).run();
        else editor.chain().focus().insertContent(node).run();
        pos = undefined;
      } catch (e) {
        notify(`No se pudo guardar la imagen: ${errorMessage(e)}`);
      }
    }
  }

  const editor = useEditor(
    {
      extensions,
      editable: !locked,
      editorProps: {
        attributes: { class: "prose", spellcheck: "true", "aria-label": "Contenido de la página" },
        handlePaste(_view, event) {
          const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
          if (files.length === 0) return false;
          event.preventDefault();
          void insertImages(files);
          return true;
        },
        handleDrop(view, event, _slice, moved) {
          if (moved) return false;
          const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
          if (files.length === 0) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          void insertImages(files, at?.pos);
          return true;
        },
      },
      onUpdate({ editor: ed }) {
        // Programmatic loads set `suppress` and use emitUpdate: false; both
        // guards exist so that only real edits ever reach the document.
        if (suppress.current) return;
        docRef.current.onChange(ed.getMarkdown());
      },
    },
    [extensions],
  );
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(!locked, false);
  }, [editor, locked]);

  // (Re)load the editor whenever the document replaces its content.
  useEffect(() => {
    if (!editor || editor.isDestroyed || doc.content === null) return;
    const scroller = scrollRef.current;
    const top = scroller?.scrollTop ?? 0;
    suppress.current = true;
    try {
      editor.commands.setContent(doc.content, { contentType: "markdown", emitUpdate: false });
    } finally {
      suppress.current = false;
    }
    if (scroller) {
      scroller.scrollTop = top;
      requestAnimationFrame(() => {
        scroller.scrollTop = top;
      });
    }
    // `content` is only read when `revision` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc.revision]);

  return (
    <>
      {unsupported.length > 0 && (
        <div className="banner banner-info" role="note">
          <span>
            Esta página usa {unsupported.join(", ")}, que el editor no conserva al guardar.{" "}
            {locked ? "La dejé en solo lectura para no perder nada." : "Si la editas aquí, se perderán."}
          </span>
          {locked && (
            <button type="button" className="btn" onClick={() => setForceEdit(true)}>
              Editar de todos modos
            </button>
          )}
        </div>
      )}
      <div className="pane-body editor-scroll" ref={scrollRef}>
        <EditorContent editor={editor} className="editor-content" />
      </div>
    </>
  );
}
