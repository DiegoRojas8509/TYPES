import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { TreeNode } from "../../lib/api";
import { kindOf } from "../../lib/paths";
import {
  IconChevron,
  IconCode,
  IconFolder,
  IconFolderPlus,
  IconImage,
  IconPage,
  IconPencil,
  IconPlus,
  IconTrash,
} from "../shell/icons";

export type Editing =
  | { kind: "create-space" }
  | { kind: "create-page"; dir: string }
  | { kind: "create-folder"; dir: string }
  | { kind: "rename"; path: string };

/** Markdown pages hide their extension; everything else shows its full name. */
export function displayName(node: TreeNode): string {
  return node.kind === "file" && kindOf(node.path) === "markdown" ? node.name.replace(/\.(md|markdown)$/i, "") : node.name;
}

function fileIcon(path: string): ReactNode {
  const k = kindOf(path);
  return k === "image" ? <IconImage /> : k === "html" ? <IconCode /> : <IconPage />;
}

interface Props {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  activeSpace: boolean;
  /** Replaces the label while renaming. */
  renaming?: ReactNode;
  onActivate(): void;
  onNewPage(): void;
  onNewFolder(): void;
  onRename(): void;
  onDelete(): void;
}

function Action({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      className="icon-btn"
      aria-label={label}
      title={label}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function TreeItem(p: Props) {
  const { node, depth } = p;
  const isDir = node.kind === "dir";
  const name = displayName(node);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      p.onActivate();
    } else if (e.key === "F2") {
      p.onRename();
    }
  };

  return (
    <div
      className="tree-row"
      role="treeitem"
      tabIndex={0}
      aria-selected={p.selected}
      aria-expanded={isDir ? p.expanded : undefined}
      data-space={depth === 0 && isDir}
      data-active-space={p.activeSpace}
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={p.onActivate}
      onKeyDown={onKeyDown}
    >
      <span className="tree-chevron" data-open={isDir && p.expanded} style={{ visibility: isDir ? "visible" : "hidden" }}>
        <IconChevron />
      </span>
      <span className="tree-icon">{isDir ? <IconFolder /> : fileIcon(node.path)}</span>
      {p.renaming ?? <span className="tree-name">{name}</span>}
      {!p.renaming && (
        <span className="tree-actions">
          {isDir && (
            <>
              <Action label={`Nueva página en ${name}`} onClick={p.onNewPage}>
                <IconPlus />
              </Action>
              <Action label={`Nueva carpeta en ${name}`} onClick={p.onNewFolder}>
                <IconFolderPlus />
              </Action>
            </>
          )}
          <Action label={`Renombrar ${name}`} onClick={p.onRename}>
            <IconPencil />
          </Action>
          <Action label={`Eliminar ${name}`} onClick={p.onDelete}>
            <IconTrash />
          </Action>
        </span>
      )}
    </div>
  );
}
