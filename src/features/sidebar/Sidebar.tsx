import { useState } from "react";
import type { TreeNode } from "../../lib/api";
import { countClaudeFiles, getShowClaudeFiles, setShowClaudeFiles, withoutClaudeFiles } from "../../lib/claudeFiles";
import { useApp } from "../../store/app";
import { IconCode, IconPlus } from "../shell/icons";
import { ConfirmDelete } from "./ConfirmDelete";
import { NameInput } from "./NameInput";
import { displayName, TreeItem, type Editing } from "./TreeItem";

export function Sidebar() {
  const allNodes = useApp((s) => s.tree);
  const treeLoaded = useApp((s) => s.treeLoaded);
  const expanded = useApp((s) => s.expanded);
  const openPath = useApp((s) => s.openPath);
  const activeSpace = useApp((s) => s.activeSpace);
  const app = useApp.getState;

  const [editing, setEditing] = useState<Editing | null>(null);
  const [toDelete, setToDelete] = useState<TreeNode | null>(null);
  const [showClaude, setShowClaude] = useState(getShowClaudeFiles);

  const hiddenClaude = countClaudeFiles(allNodes);
  const tree = showClaude ? allNodes : withoutClaudeFiles(allNodes);
  const spaces = tree.filter((n) => n.kind === "dir");
  const looseFiles = tree.filter((n) => n.kind === "file");
  const creatingSpace = editing?.kind === "create-space";

  const done = async (p: Promise<string | null>) => {
    const ok = (await p) !== null;
    if (ok) setEditing(null);
    return ok;
  };

  function renderCreate(dir: string, depth: number) {
    if (!editing || editing.kind === "rename" || editing.kind === "create-space" || editing.dir !== dir) return null;
    const isPage = editing.kind === "create-page";
    return (
      <div className="name-input-row" style={{ paddingLeft: 4 + depth * 14 + 16 }}>
        <NameInput
          label={isPage ? "Nombre de la página" : "Nombre de la carpeta"}
          onSubmit={(name) => done(isPage ? app().createPage(dir, name) : app().createFolder(dir, name))}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  function renderNode(node: TreeNode, depth: number) {
    const isDir = node.kind === "dir";
    const isOpen = !!expanded[node.path];
    const renaming = editing?.kind === "rename" && editing.path === node.path;
    return (
      <div key={node.path} role="group">
        <TreeItem
          node={node}
          depth={depth}
          expanded={isOpen}
          selected={node.path === openPath}
          activeSpace={depth === 0 && node.path === activeSpace}
          renaming={
            renaming ? (
              <NameInput
                label="Nuevo nombre"
                initial={displayName(node)}
                onSubmit={(name) => done(app().renameEntry(node.path, name))}
                onCancel={() => setEditing(null)}
              />
            ) : undefined
          }
          onActivate={() => {
            if (isDir) {
              app().toggleExpanded(node.path);
              if (depth === 0) app().selectSpace(node.path);
            } else {
              app().open(node.path);
            }
          }}
          onNewPage={() => {
            app().setExpanded(node.path, true);
            setEditing({ kind: "create-page", dir: node.path });
          }}
          onNewFolder={() => {
            app().setExpanded(node.path, true);
            setEditing({ kind: "create-folder", dir: node.path });
          }}
          onRename={() => setEditing({ kind: "rename", path: node.path })}
          onDelete={() => setToDelete(node)}
        />
        {isDir && isOpen && (
          <>
            {renderCreate(node.path, depth + 1)}
            {node.children.map((c) => renderNode(c, depth + 1))}
            {node.children.length === 0 && !editing && (
              <div className="sidebar-label" style={{ padding: `2px 0 2px ${4 + (depth + 1) * 14 + 36}px`, textTransform: "none", letterSpacing: 0 }}>
                Vacía
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <nav className="sidebar" aria-label="Espacios y páginas">
      <div className="sidebar-head">
        <span className="sidebar-title">Types</span>
        <span className="sidebar-head-actions">
          {hiddenClaude > 0 && (
            <button
              className="icon-btn"
              aria-label={showClaude ? "Ocultar archivos de contexto" : "Mostrar archivos de contexto"}
              title={
                showClaude
                  ? "Ocultar los CLAUDE.md"
                  : "Mostrar los CLAUDE.md (el contexto que lee Claude; sigue activo aunque no se vean)"
              }
              aria-pressed={showClaude}
              onClick={() => {
                setShowClaude(!showClaude);
                setShowClaudeFiles(!showClaude);
              }}
            >
              <IconCode />
            </button>
          )}
          <button className="icon-btn" aria-label="Nuevo espacio" title="Nuevo espacio" onClick={() => setEditing({ kind: "create-space" })}>
            <IconPlus />
          </button>
        </span>
      </div>

      <div className="sidebar-list" role="tree">
        {creatingSpace && (
          <div className="name-input-row" style={{ paddingLeft: 20 }}>
            <NameInput
              label="Nombre del espacio"
              onSubmit={(name) => done(app().createSpace(name))}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}

        {treeLoaded && spaces.length === 0 && !creatingSpace && (
          <div className="sidebar-empty">
            <h2>Crea tu primer espacio</h2>
            <p>Un espacio es un negocio o proyecto. Ahí viven sus páginas y lo que Claude genere.</p>
            <button className="btn btn-primary" onClick={() => setEditing({ kind: "create-space" })}>
              Crear espacio
            </button>
          </div>
        )}

        {spaces.map((n) => renderNode(n, 0))}

        {looseFiles.length > 0 && (
          <>
            <div className="sidebar-label">General</div>
            {looseFiles.map((n) => renderNode(n, 0))}
          </>
        )}
      </div>

      {toDelete && (
        <ConfirmDelete
          name={displayName(toDelete)}
          isDir={toDelete.kind === "dir"}
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            const path = toDelete.path;
            setToDelete(null);
            void app().deleteEntry(path);
          }}
        />
      )}
    </nav>
  );
}
