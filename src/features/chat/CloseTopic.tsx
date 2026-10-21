import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, errorMessage, type CloseTopicResult, type MemoryChange } from "../../lib/api";
import { MemoryBadge } from "./MemoryBadge";
import { closeTopicBlocker, fileTitle, useMemoryUi } from "./memoryUi";
import type { ChatState } from "./reducer";

export const TRIGGER_ID = "close-topic-trigger";
const ACTION_LABEL: Record<string, string> = { nuevo: "Nuevo", actualizado: "Actualizado", eliminado: "Eliminado" };

/** Header button. Disabled (with the reason as tooltip) when closing makes no sense. */
export function CloseTopicButton({ conv }: { conv: Pick<ChatState, "items" | "sessionId" | "running"> }) {
  const closing = useMemoryUi((s) => s.closing);
  const blocker = closeTopicBlocker(conv, closing);
  return (
    <button
      id={TRIGGER_ID}
      className="btn"
      disabled={blocker !== null}
      title={blocker ?? "Guarda lo importante de esta conversación en la memoria"}
      onClick={() => useMemoryUi.getState().openClose()}
    >
      Cerrar tema
    </button>
  );
}

type Phase = { kind: "saving" } | { kind: "done"; result: CloseTopicResult } | { kind: "failed"; message: string };

function ChangeItem({ change }: { change: MemoryChange }) {
  const [open, setOpen] = useState(false);
  const hasLines = change.added.length > 0 || change.removed.length > 0;
  return (
    <li className="topic-change">
      <div className="topic-change-head">
        <strong>{fileTitle(change.file)}</strong>
        <span className="topic-action" data-action={change.action}>
          {ACTION_LABEL[change.action] ?? change.action}
        </span>
      </div>
      <p className="topic-summary">{change.summary}</p>
      {hasLines && (
        <button className="topic-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Ver cambios
        </button>
      )}
      {open && (
        <ul className="topic-lines" aria-label={`Cambios en ${fileTitle(change.file)}`}>
          {change.added.map((l, i) => (
            <li key={`a${i}`} className="line-added">
              {"+ " + l}
            </li>
          ))}
          {change.removed.map((l, i) => (
            <li key={`r${i}`} className="line-removed">
              {"− " + l}
            </li>
          ))}
          {change.truncated && <li className="topic-more">…hay más cambios</li>}
        </ul>
      )}
    </li>
  );
}

interface DialogProps {
  space: string;
  sessionId: string;
  running: boolean;
  /** The existing «Nueva conversación» action. */
  onNewConversation(): void;
}

export function CloseTopicDialog({ space, sessionId, running, onNewConversation }: DialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "saving" });
  const mounted = useRef(true);
  const started = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => useMemoryUi.getState().dismissClose(), []);

  const run = useCallback(async () => {
    const ui = useMemoryUi.getState();
    ui.setClosing(true);
    if (mounted.current) setPhase({ kind: "saving" });
    let next: Phase;
    try {
      const result = await api.memoryCloseTopic(space, sessionId);
      next = result.ok
        ? { kind: "done", result }
        : { kind: "failed", message: result.error ?? "No se pudo guardar el tema." };
    } catch (e) {
      next = { kind: "failed", message: errorMessage(e) };
    }
    useMemoryUi.getState().setClosing(false);
    useMemoryUi.getState().bump();
    if (mounted.current) setPhase(next);
  }, [space, sessionId]);

  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void run();
    }
    return () => {
      mounted.current = false;
      document.getElementById(TRIGGER_ID)?.focus();
    };
  }, [run]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // A memory panel opened on top handles its own Esc.
      if (e.key === "Escape" && !useMemoryUi.getState().panelOpen) dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  useEffect(() => {
    if (phase.kind === "saving") box.current?.querySelector<HTMLElement>("button")?.focus();
    else primary.current?.focus();
  }, [phase.kind]);

  // Keep Tab inside the dialog.
  const trap = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const saving = phase.kind === "saving";
  const changes = phase.kind === "done" ? phase.result.changes.filter((c) => c.action !== "sin-cambios") : [];
  const upToDate = phase.kind === "done" && (phase.result.nothingToSave || changes.length === 0);

  return (
    <div className="dialog-scrim" onClick={dismiss}>
      <div
        className="dialog topic-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-topic-title"
        ref={box}
        onKeyDown={trap}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="close-topic-title">Cerrar tema</h2>
        {saving && (
          <>
            <p className="topic-saving" role="status">
              <span className="remote-spinner" aria-hidden="true" /> Guardando lo importante…
            </p>
            <p className="memory-muted">Se termina de guardar en segundo plano.</p>
          </>
        )}
        {phase.kind === "failed" && (
          <div className="topic-error" role="alert">
            <p>{phase.message}</p>
            <button className="btn" onClick={() => void run()}>
              Reintentar
            </button>
          </div>
        )}
        {upToDate && (
          <>
            <p>No hay nada nuevo que guardar: la memoria ya está al día.</p>
            <MemoryBadge space={space} withButton={false} />
          </>
        )}
        {changes.length > 0 && (
          <ul className="topic-changes">
            {changes.map((c) => (
              <ChangeItem key={c.file} change={c} />
            ))}
          </ul>
        )}
        <div className="dialog-actions topic-actions">
          {saving ? (
            <button className="btn" onClick={dismiss}>
              Cancelar
            </button>
          ) : (
            <>
              <button className="btn topic-full" onClick={() => useMemoryUi.getState().openPanel()}>
                Ver memoria completa
              </button>
              <button className="btn" onClick={dismiss}>
                Mantener esta conversación
              </button>
              <button
                ref={primary}
                className="btn btn-primary"
                disabled={running}
                title={running ? "Espera a que Claude termine de responder." : undefined}
                onClick={() => {
                  dismiss();
                  onNewConversation();
                }}
              >
                Listo, abrir conversación nueva
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
