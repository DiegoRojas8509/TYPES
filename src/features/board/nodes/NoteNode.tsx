import type { NodeProps } from "@xyflow/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../../../lib/api";
import { createExtensions } from "../../../lib/extensions";
import { pathFromAssetUrl, resolveImageSrc, unresolveImageSrc } from "../../../lib/markdown";
import { useApp } from "../../../store/app";
import { useBoardActions, useBoardContext } from "../boardActions";
import type { FlowNode } from "../boardModel";
import { BlockShell } from "./BlockShell";
import { GlyphNote } from "./glyphs";

const FENCE = /^ {0,3}(```|~~~)/;
const HEADING = /^#[ \t]+(\S.*?)(?:[ \t]+#+)?[ \t]*$/;

/** The first `# heading` (outside code fences): it is the card's title, never stored separately. */
export function noteTitle(markdown: string): string | null {
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const f = FENCE.exec(line);
    if (f) {
      fence = fence === null ? f[1] : fence === f[1] ? null : fence;
      continue;
    }
    if (fence !== null) continue;
    const h = HEADING.exec(line);
    if (h) return h[1];
  }
  return null;
}

/**
 * Text card. Shows rendered Markdown; double click (or a click on an already
 * selected note) edits it in place with Tiptap, using the same Markdown
 * extensions as the page editor. The board is the source of truth for `text`.
 */
export function NoteNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { update } = useBoardActions();
  const { boardPath } = useBoardContext();
  const root = useApp((s) => s.settings?.workspaceRoot ?? null);
  const text = typeof data.text === "string" ? data.text : "";
  const [editing, setEditing] = useState(false);

  // Editor callbacks are captured once by Tiptap; refs keep them current.
  const updateRef = useRef(update);
  updateRef.current = update;
  const idRef = useRef(id);
  idRef.current = id;
  // The Markdown the editor currently holds on behalf of the board: what we last
  // loaded into it or last sent out. A different `text` is a change from elsewhere.
  const synced = useRef(text);
  const loading = useRef(false);
  const wasSelected = useRef(false);

  const extensions = useMemo(
    () =>
      createExtensions({
        resolveSrc: (src) => resolveImageSrc(boardPath, src, root, assetUrl),
        toDiskSrc: (src) => unresolveImageSrc(boardPath, src, root, pathFromAssetUrl),
      }),
    [boardPath, root],
  );

  const editor = useEditor(
    {
      extensions,
      content: text,
      contentType: "markdown",
      editable: false,
      editorProps: {
        attributes: { class: "prose note-prose", spellcheck: "true", "aria-label": "Contenido de la nota" },
        handleKeyDown(view, event) {
          if (event.key !== "Escape") return false;
          view.dom.blur();
          return true;
        },
      },
      onUpdate({ editor: ed }) {
        if (loading.current) return;
        const markdown = ed.getMarkdown();
        synced.current = markdown;
        // One call per change is cheap: the board debounces the write to disk.
        updateRef.current(idRef.current, { text: markdown });
      },
      onBlur() {
        setEditing(false);
      },
    },
    [extensions],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editing, false);
    if (editing) editor.commands.focus("end");
  }, [editor, editing]);

  // A text that changed behind our back (Claude edited the note, the file was
  // reloaded) replaces what is shown, but ONLY while not editing: Diego's live
  // text is never clobbered mid-sentence. When editing ends the card re-syncs
  // with the board, whose own conflict handling decides which version stands.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editing || text === synced.current) return;
    synced.current = text;
    loading.current = true;
    try {
      editor.commands.setContent(text, { contentType: "markdown", emitUpdate: false });
    } finally {
      loading.current = false;
    }
  }, [editor, editing, text]);

  const startEditing = () => setEditing(true);

  return (
    <BlockShell
      id={id}
      selected={selected}
      title={noteTitle(text) ?? "Nota"}
      glyph={<GlyphNote />}
      color={data.color}
      minHeight={90}
      className="block-note-card"
    >
      <div
        className={editing ? "note-body is-editing nodrag nowheel nopan" : "note-body"}
        data-editing={editing ? "true" : "false"}
        // A click only edits a note that was ALREADY selected when the press began,
        // so the click that selects it (or ends a drag) never opens the editor.
        onPointerDownCapture={() => {
          wasSelected.current = selected;
        }}
        onClick={() => {
          if (!editing && wasSelected.current) startEditing();
        }}
        onDoubleClick={() => {
          if (!editing) startEditing();
        }}
      >
        {text.trim() === "" && !editing && <p className="note-hint">Doble clic para escribir</p>}
        <EditorContent editor={editor} />
      </div>
    </BlockShell>
  );
}
