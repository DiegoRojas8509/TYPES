import { errorMessage, openWithDefaultApp } from "../../lib/api";
import { absolutePath, baseName, extOf } from "../../lib/paths";
import { useApp } from "../../store/app";

/** Files Types cannot show (csv, pdf, xlsx…): offers the system's default app. */
export function FileFallback({ path }: { path: string }) {
  const root = useApp((s) => s.settings?.workspaceRoot ?? null);
  const notify = useApp((s) => s.notify);
  const ext = extOf(path);

  const open = () => {
    if (!root) return;
    openWithDefaultApp(absolutePath(root, path)).catch((e) => notify(errorMessage(e)));
  };

  return (
    <div className="empty" data-testid="file-fallback">
      <h2 title={path}>{baseName(path)}</h2>
      <p>
        {ext ? `Archivo ${ext.toUpperCase()}.` : "Archivo."} Types no puede mostrarlo aquí, pero puedes abrirlo con otra
        app.
      </p>
      <button type="button" className="btn btn-primary" onClick={open} disabled={!root}>
        Abrir con la app predeterminada
      </button>
    </div>
  );
}
