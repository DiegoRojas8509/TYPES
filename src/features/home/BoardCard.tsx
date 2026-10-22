import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { TreeNode } from "../../lib/api";
import { activityOf, changeLine, changeOf, isUnseen } from "../../lib/browse";
import { titleOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { BoardThumb } from "./BoardThumb";
import { EntryCard } from "./EntryCard";

/** Subscribes to its own path only, so activity elsewhere never re-renders it. */
export const BoardCard = memo(function BoardCard({ node, now }: { node: TreeNode; now: number }) {
  const a = useApp(useShallow((s) => activityOf(s.activity, node.path) ?? {}));
  const unseen = useApp((s) => isUnseen(s.activity, s.seen, node.path, node.modified));
  const c = changeOf("at" in a ? (a as { at: number; by: never }) : undefined, node.modified);
  return (
    <EntryCard
      node={node}
      className="board-card"
      media={<BoardThumb path={node.path} modified={node.modified} />}
      title={titleOf(node.path)}
      lines={[changeLine(c.at, c.by, now)]}
      actor={c.by}
      unseen={unseen}
      onOpen={() => useApp.getState().open(node.path)}
    />
  );
});
