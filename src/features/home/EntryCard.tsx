import type { DragEvent, ReactNode } from "react";
import type { TreeNode } from "../../lib/api";
import type { Activity } from "../../lib/api";
import { CEL_NOTE } from "../../lib/browse";
import { TREE_PATH_MIME } from "../../lib/paths";
import { CardMenu } from "./CardMenu";
import { useEntryActions } from "./useEntryActions";

interface Props {
  node: TreeNode;
  className: string;
  media: ReactNode;
  title: string;
  /** Secondary lines under the name (count, "hace 2 h · Claude"). */
  lines: string[];
  /** Claude changed something here that Diego has not opened yet. */
  unseen: boolean;
  onOpen(): void;
  /** Who made the latest change shown in `lines`; "claude-cel" is a guess and says so. */
  actor?: Activity["by"] | null;
  /** Set for images so they can be dragged onto a board, like in the tree. */
  draggablePath?: string;
}

/** One focusable card (the open button) plus a separate "⋯" menu. Shared by board, folder and file cards. */
export function EntryCard({ node, className, media, title, lines, unseen, actor, onOpen, draggablePath }: Props) {
  const actions = useEntryActions(node);
  const text = lines.filter(Boolean);
  const viaCel = actor === "claude-cel";

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(TREE_PATH_MIME, draggablePath!);
    e.dataTransfer.effectAllowed = "copyLink";
  };

  const body = (
    <>
      <span className="card-media">{media}</span>
      <span className="card-body">
        {actions.renaming ? (
          actions.renameInput
        ) : (
          <span className="card-name">
            {unseen && <span className="card-dot" aria-hidden="true" />}
            <span className="card-title">{title}</span>
          </span>
        )}
        {text.map((line, i) => (
          <span key={line} className="card-meta" title={viaCel && i === text.length - 1 ? CEL_NOTE : undefined}>
            {line}
          </span>
        ))}
        {unseen && <span className="home-sr">{(viaCel ? "Claude (o el cel) lo cambió" : "Claude lo cambió") + " y todavía no lo abres"}</span>}
      </span>
    </>
  );

  return (
    <div
      role="listitem"
      className={`card ${className}${unseen ? " is-unseen" : ""}`}
      draggable={draggablePath ? true : undefined}
      onDragStart={draggablePath ? onDragStart : undefined}
      onKeyDown={actions.onKeyDown}
    >
      {actions.renaming ? (
        <div className="card-main">{body}</div>
      ) : (
        <button type="button" data-card className="card-main" onClick={onOpen}>
          {body}
        </button>
      )}
      <CardMenu label={`Opciones de ${title}`} items={actions.menuItems} />
      {actions.dialog}
    </div>
  );
}
