import { useEffect, useRef, useState } from "react";
import { baseName } from "../../lib/paths";
import { useApp } from "../../store/app";
import { useRemote } from "./remote";

const PhoneIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <rect x="4.5" y="1.8" width="7" height="12.4" rx="1.6" />
    <path d="M7 12h2" />
  </svg>
);

/** «Cel» button: starts/stops the remote-control session and explains each state in a small popover. */
export function RemoteButton() {
  const status = useRemote((s) => s.status);
  const root = useApp((s) => s.settings?.workspaceRoot);
  const folder = root ? baseName(root.replace(/\/+$/, "")) : "espacios";
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const { state } = status;

  useEffect(() => {
    void useRemote.getState().init();
  }, []);

  // Problems need Diego's attention: show the explanation as soon as they appear.
  useEffect(() => {
    if (state === "untrusted" || state === "error") setOpen(true);
    if (state === "off" || state === "starting") setOpen(false);
  }, [state]);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const onClick = () => {
    if (state === "off") void useRemote.getState().start();
    else if (state !== "starting") setOpen((o) => !o);
  };

  const url = status.state === "on" ? status.url : undefined;
  const copy = () => {
    if (url) void navigator.clipboard?.writeText(url).catch(() => {});
  };
  const act = (fn: () => Promise<void>) => () => {
    setOpen(false);
    void fn();
  };
  const { start, stop, trust } = useRemote.getState();

  return (
    <div className="remote" ref={wrap}>
      <button
        ref={trigger}
        className="btn remote-btn"
        aria-label="Control remoto desde el cel"
        aria-haspopup={state === "off" || state === "starting" ? undefined : "dialog"}
        aria-expanded={state === "off" || state === "starting" ? undefined : open}
        disabled={state === "starting"}
        title={state === "off" ? "Controlar a Claude desde el cel" : undefined}
        onClick={onClick}
      >
        <PhoneIcon />
        <span>{state === "starting" ? "Conectando…" : "Cel"}</span>
        {state === "starting" ? (
          <span className="remote-spinner" aria-hidden="true" />
        ) : (
          state !== "off" && <span className="remote-dot" data-state={state} aria-hidden="true" />
        )}
      </button>
      {open && state !== "off" && state !== "starting" && (
        <div className="remote-pop" role="dialog" aria-label="Control remoto" ref={pop}>
          {status.state === "on" && (
            <>
              <p>Activo. Abre la app de Claude → pestaña Code → «{folder}».</p>
              <div className="remote-actions">
                {url && (
                  <button className="btn" onClick={copy}>
                    Copiar enlace
                  </button>
                )}
                <button className="btn" onClick={act(stop)}>
                  Detener
                </button>
              </div>
            </>
          )}
          {status.state === "untrusted" && (
            <>
              <p>
                Primera vez: hay que confiar en la carpeta. Se abrirá Terminal: responde y y Enter a las dos preguntas,
                espera "Connected", cierra con Ctrl+C y vuelve aquí.
              </p>
              <div className="remote-actions">
                <button className="btn" onClick={() => void trust()}>
                  Abrir Terminal
                </button>
                <button className="btn" onClick={act(start)}>
                  Reintentar
                </button>
              </div>
            </>
          )}
          {status.state === "error" && (
            <>
              <p role="alert">{status.message}</p>
              <div className="remote-actions">
                <button className="btn" onClick={act(start)}>
                  Reintentar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
