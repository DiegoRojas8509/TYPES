import { useEffect } from "react";

interface Props {
  name: string;
  isDir: boolean;
  onConfirm(): void;
  onCancel(): void;
}

// In-app dialog: the webview's native confirm() is not reliable inside Tauri.
export function ConfirmDelete({ name, isDir, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dialog-scrim" onClick={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-delete-title">
          {isDir ? "¿Eliminar la carpeta" : "¿Eliminar"} «{name}»?
        </h2>
        <p>Se moverá a la papelera. {isDir ? "Incluye todo lo que contiene." : "Podrás recuperarla desde ahí."}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn btn-danger" autoFocus onClick={onConfirm}>
            Mover a la papelera
          </button>
        </div>
      </div>
    </div>
  );
}
