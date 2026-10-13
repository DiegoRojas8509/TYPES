import { useEffect, useState } from "react";
import { assetUrl } from "../../lib/api";
import { absolutePath, baseName } from "../../lib/paths";
import { useApp } from "../../store/app";
import { useFileVersion } from "./useFileVersion";

interface Shown {
  src: string;
  width: number;
  height: number;
}

/** Image fitted to the pane. Mount with `key={path}`. */
export function ImageViewer({ path }: { path: string }) {
  const root = useApp((s) => s.settings?.workspaceRoot ?? null);
  const version = useFileVersion(path);
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!root) return;
    // The asset URL is cached by the webview; a query string busts it (the protocol ignores it).
    const src = `${assetUrl(absolutePath(root, path))}?v=${version}`;
    // Preload so the previous image stays on screen until the new one is ready.
    const probe = new Image();
    let live = true;
    probe.onload = () => {
      if (!live) return;
      setShown({ src, width: probe.naturalWidth, height: probe.naturalHeight });
      setError(null);
    };
    probe.onerror = () => {
      if (live) setError("No se pudo mostrar la imagen. Puede que el archivo ya no exista o esté dañado.");
    };
    probe.src = src;
    return () => {
      live = false;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [root, path, version]);

  return (
    <div className="viewer">
      <div className="pane-header">
        <span className="pane-title" title={path}>
          {baseName(path)}
        </span>
        {shown && (
          <span className="viewer-meta">
            {shown.width} × {shown.height} px
          </span>
        )}
      </div>
      {error && (
        <div className="banner banner-warn" role="alert">
          <span>{error}</span>
        </div>
      )}
      <div className="image-stage">
        {shown ? (
          <img src={shown.src} alt={baseName(path)} />
        ) : !error ? (
          <span className="viewer-status" role="status">
            Abriendo…
          </span>
        ) : null}
      </div>
    </div>
  );
}
