import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { timeAgo } from "../../lib/timeAgo";
import { MemoryBadge } from "./MemoryBadge";
import { useMemoryUi } from "./memoryUi";
import { useMemoryStatus } from "./useMemoryStatus";

const INDEX = "MEMORY.md";

/** Splits a leading `---` YAML block from the body. Both stay plain text. */
export function splitFrontmatter(text: string): { front: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? { front: m[0].trimEnd(), body: text.slice(m[0].length) } : { front: "", body: text };
}

/** Read-only view of what a new conversation in the space already knows. Diego edits files outside the app. */
export function MemoryPanel({ space }: { space: string }) {
  const { status } = useMemoryStatus(space);
  const initial = useMemoryUi((s) => s.panelFile);
  const [file, setFile] = useState(initial ?? INDEX);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const box = useRef<HTMLDivElement>(null);
  const tick = useMemoryUi((s) => s.tick);

  useEffect(() => {
    let live = true;
    setText(null);
    setError(null);
    api
      .memoryRead(space, file)
      .then((t) => live && setText(t))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [space, file, tick]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button")?.focus();
    const target = opener.current;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useMemoryUi.getState().closePanel();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, []);

  const entries = (status?.entries ?? []).filter((e) => e.file !== INDEX);
  const { front, body } = text === null ? { front: "", body: "" } : splitFrontmatter(text);
  const close = () => useMemoryUi.getState().closePanel();

  return (
    <div className="dialog-scrim memory-scrim" onClick={close}>
      <div
        className="dialog memory-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-panel-title"
        ref={box}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="memory-panel-head">
          <h2 id="memory-panel-title">Memoria de {space}</h2>
          <button className="btn" onClick={close}>
            Cerrar
          </button>
        </div>
        <MemoryBadge space={space} withButton={false} />
        <div className="memory-panel-body">
          <ul className="memory-list" aria-label="Archivos de memoria">
            {[{ file: INDEX, title: "Índice", description: "Lo que se carga al empezar", updated: null as number | null }, ...entries].map(
              (e) => (
                <li key={e.file}>
                  <button className="memory-entry" aria-current={e.file === file} onClick={() => setFile(e.file)}>
                    <span className="memory-entry-title">{e.title || e.file}</span>
                    {e.description && <span className="memory-entry-desc">{e.description}</span>}
                    {e.updated !== null && <span className="memory-entry-time">{timeAgo(e.updated, Date.now())}</span>}
                  </button>
                </li>
              ),
            )}
          </ul>
          <div className="memory-file" aria-label={`Contenido de ${file}`}>
            {error && <p role="alert">{error}</p>}
            {text === null && !error && <p className="memory-muted">Leyendo…</p>}
            {front && <pre className="memory-front">{front}</pre>}
            {text !== null && <pre className="memory-text">{body}</pre>}
          </div>
        </div>
        {status && (
          <p className="memory-muted memory-path">
            Esto es lo que cualquier conversación nueva en {space} sabrá de entrada. Para corregir algo, edita el
            archivo en <code>{status.dir}</code>{" "}
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(status.dir).catch(() => {})}>
              Copiar ruta
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
