import "./imagePanel.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { api, assetUrl, errorMessage } from "../../lib/api";
import { TREE_PATH_MIME, absolutePath, baseName, parentOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import type { TreeNode } from "../../lib/api";
import { boardImageFiles, countBoardsUsing } from "./imageUsage";

type Tab = "board" | "all";
const REFRESH_MS = 150;

function findDir(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.kind === "dir" && path.startsWith(`${n.path}/`)) return findDir(n.children, path);
  }
  return null;
}

const Icon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="2" />
    <circle cx="5.6" cy="6" r="1.1" />
    <path d="M2.5 12l3.4-3.4 2.6 2.6 2-2 3 3" strokeLinejoin="round" />
  </svg>
);

/** Toolbar button + right-hand panel with the board folder's images. Never writes the board. */
export function ImagePanel({
  path,
  editable,
  nodes,
}: {
  path: string;
  editable: boolean;
  /** The board's live nodes (only `type` and `file` are read). */
  nodes: { type?: string; file?: unknown }[];
}) {
  const folder = parentOf(path);
  const root = useApp((s) => s.settings?.workspaceRoot ?? "");
  const fsSeq = useApp((s) => s.fsChange?.seq ?? 0);
  const notify = useApp((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("board");
  const [all, setAll] = useState<string[] | null>(null);
  const [tick, setTick] = useState(0);
  const [asking, setAsking] = useState<{ image: string; count: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const inBoard = useMemo(() => boardImageFiles(path, nodes), [path, nodes]);

  // Debounced refresh on any file change while the panel is open.
  useEffect(() => {
    if (!open || fsSeq === 0) return;
    const t = setTimeout(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearTimeout(t);
  }, [open, fsSeq]);

  useEffect(() => {
    if (!open || !folder) return;
    let live = true;
    api
      .listImages(folder)
      .then((list) => live && setAll(list))
      .catch((e) => live && notify(`No se pudieron listar las imágenes: ${errorMessage(e)}`));
    return () => {
      live = false;
    };
  }, [open, folder, tick, notify]);

  const upload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      for (const file of files) {
        try {
          await api.saveImage(folder, file.name || "imagen.png", new Uint8Array(await file.arrayBuffer()));
        } catch (err) {
          notify(`No se pudo subir la imagen: ${errorMessage(err)}`);
        }
      }
      setTick((n) => n + 1);
    },
    [folder, notify],
  );

  async function askDelete(image: string) {
    const siblings = (findDir(useApp.getState().tree, folder)?.children ?? []).filter(
      (n) => n.kind === "file" && n.name.toLowerCase().endsWith(".canvas"),
    );
    const texts: [string, string][] = [];
    for (const b of siblings) {
      try {
        texts.push([b.path, await api.readText(b.path)]);
      } catch {
        // An unreadable sibling cannot be counted; the delete is still restorable with ⌘Z.
      }
    }
    setAsking({ image, count: countBoardsUsing(texts, image) });
  }

  function confirmDelete() {
    if (!asking) return;
    const image = asking.image;
    setAsking(null);
    void useApp.getState().deleteEntry(image);
  }

  const inFolder = folder !== "";
  const label = "Imágenes";
  const shown = tab === "board" ? inBoard : (all ?? []);
  const empty =
    tab === "board" ? "Esta pizarra aún no tiene imágenes." : all === null ? "" : "Suelta o sube imágenes para empezar.";

  return (
    <>
      <button
        type="button"
        className="btn image-panel-toggle"
        aria-label={label}
        aria-pressed={open}
        title={inFolder ? "Imágenes de esta carpeta" : "Las imágenes viven dentro de un espacio; mueve la pizarra a uno"}
        disabled={!inFolder}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon />
      </button>
      {open && inFolder && (
        <aside className="image-panel" aria-label={label}>
          <div className="image-panel-head">
            <div className="image-tabs" role="tablist">
              {(["board", "all"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className="image-tab"
                  onClick={() => setTab(t)}
                >
                  {t === "board" ? "En esta pizarra" : "Todas"}
                </button>
              ))}
            </div>
            {editable && (
              <>
                <button type="button" className="btn image-upload" onClick={() => input.current?.click()}>
                  + Subir
                </button>
                <input
                  ref={input}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  aria-label="Subir imágenes"
                  onChange={(e) => void upload(e)}
                />
              </>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="image-empty">{empty}</p>
          ) : (
            <ul className="image-grid" role="list">
              {shown.map((rel) => (
                <Thumb
                  key={rel}
                  rel={rel}
                  src={assetUrl(absolutePath(root, rel))}
                  draggable={editable}
                  deletable={editable && tab === "all"}
                  onDelete={() => void askDelete(rel)}
                />
              ))}
            </ul>
          )}
        </aside>
      )}
      {asking && <ConfirmTrash image={asking.image} count={asking.count} onCancel={() => setAsking(null)} onConfirm={confirmDelete} />}
    </>
  );
}

function Thumb({
  rel,
  src,
  draggable,
  deletable,
  onDelete,
}: {
  rel: string;
  src: string;
  draggable: boolean;
  deletable: boolean;
  onDelete(): void;
}) {
  const name = baseName(rel);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(TREE_PATH_MIME, rel);
    e.dataTransfer.effectAllowed = "copyLink";
  };

  return (
    <li className="image-item" draggable={draggable ? true : undefined} onDragStart={draggable ? onDragStart : undefined} title={name}>
      <div className="image-thumb">
        {failed ? (
          <span className="image-thumb-missing" aria-hidden="true" />
        ) : (
          <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
        )}
        {deletable && (
          <button type="button" className="image-del" aria-label={`Mandar «${name}» a la papelera`} onClick={onDelete}>
            ×
          </button>
        )}
      </div>
      <span className="image-name">{name}</span>
    </li>
  );
}

function ConfirmTrash({ image, count, onCancel, onConfirm }: { image: string; count: number; onCancel(): void; onConfirm(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dialog-scrim" onClick={onCancel}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-image-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-image-title">¿Mandar «{baseName(image)}» a la papelera?</h2>
        <p>
          {count > 0
            ? `Esta imagen se usa en ${count} ${count === 1 ? "pizarra" : "pizarras"}. Si la mandas a la papelera, esos bloques mostrarán «No encuentro la imagen». Puedes deshacerlo con ⌘Z.`
            : "Podrás recuperarla desde la papelera. Puedes deshacerlo con ⌘Z."}
        </p>
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
