import type { TreeNode } from "../../lib/api";
import { activityOf, changeLine, isUnseen } from "../../lib/browse";
import { titleOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { BoardThumb } from "./BoardThumb";
import { EntryCard } from "./EntryCard";

export function BoardCard({ node, now }: { node: TreeNode; now: number }) {
  const activity = useApp((s) => s.activity);
  const seen = useApp((s) => s.seen);
  const a = activityOf(activity, node.path);
  return (
    <EntryCard
      node={node}
      className="board-card"
      media={<BoardThumb path={node.path} modified={node.modified} />}
      title={titleOf(node.path)}
      lines={[changeLine(a?.at ?? node.modified ?? null, a?.by ?? null, now)]}
      unseen={isUnseen(activity, seen, node.path)}
      onOpen={() => useApp.getState().open(node.path)}
    />
  );
}
