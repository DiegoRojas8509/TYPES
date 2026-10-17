import { useEffect, useMemo, useRef } from "react";
import { errorMessage, openWithDefaultApp } from "../../lib/api";
import { absolutePath, baseName } from "../../lib/paths";
import { useApp } from "../../store/app";
import { useTextFile } from "./useTextFile";

/**
 * Appended to the srcdoc only (never to the file). The frame has an opaque
 * origin, so the parent cannot read its scroll; the frame reports it instead
 * and gets it back after each reload so the view does not jump to the top.
 */
function scrollKeeper(x: number, y: number): string {
  return `<script>(function(){var p=[${Math.round(x)},${Math.round(y)}];function r(){window.scrollTo(p[0],p[1])}addEventListener("DOMContentLoaded",r);addEventListener("load",r);var t;addEventListener("scroll",function(){clearTimeout(t);t=setTimeout(function(){parent.postMessage({typesScroll:[window.scrollX,window.scrollY]},"*")},100)},{passive:true})})()</script>`;
}

/**
 * Renders a machine-generated HTML file isolated: `sandbox="allow-scripts"` and
 * no `allow-same-origin`, so the page gets an opaque origin and cannot reach the
 * app's DOM, storage or Tauri IPC. Mount with `key={path}`.
 */
export function HtmlViewer({ path }: { path: string }) {
  const file = useTextFile(path);
  const root = useApp((s) => s.settings?.workspaceRoot ?? null);
  const notify = useApp((s) => s.notify);
  const frame = useRef<HTMLIFrameElement>(null);
  const scroll = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const s = (e.data as { typesScroll?: unknown } | null)?.typesScroll;
      if (Array.isArray(s) && typeof s[0] === "number" && typeof s[1] === "number") scroll.current = [s[0], s[1]];
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const html = file.text;
  const srcDoc = useMemo(
    () => (html === null ? null : html + scrollKeeper(scroll.current[0], scroll.current[1])),
    [html],
  );

  const openInBrowser = () => {
    if (!root) return;
    openWithDefaultApp(absolutePath(root, path)).catch((e) => notify(errorMessage(e)));
  };

  return (
    <div className="viewer">
      <div className="pane-header">
        <span className="pane-title" title={path}>
          {baseName(path)}
        </span>
        <span className="viewer-actions">
          <button type="button" className="btn" onClick={file.reload}>
            Recargar
          </button>
          <button type="button" className="btn" onClick={openInBrowser} disabled={!root}>
            Abrir en el navegador
          </button>
        </span>
      </div>
      {file.error && (
        <div className="banner banner-warn" role="alert">
          <span>{file.error}</span>
        </div>
      )}
      {srcDoc !== null ? (
        <iframe
          ref={frame}
          className="viewer-frame"
          title={baseName(path)}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
        />
      ) : file.loading ? (
        <div className="viewer-status" role="status">
          Abriendo…
        </div>
      ) : null}
    </div>
  );
}
