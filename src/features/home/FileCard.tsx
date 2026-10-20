import type { TreeNode } from "../../lib/api";
import { activityOf, changeLine, isUnseen } from "../../lib/browse";
import { kindOf, titleOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { IconCode, IconImage, IconPage } from "../shell/icons";
import { EntryCard } from "./EntryCard";

export function FileCard({ node, now }: { node: TreeNode; now: number }) {
  const activity = useApp((s) => s.activity);
  const seen = useApp((s) => s.seen);
  const kind = kindOf(node.path);
  const a = activityOf(activity, node.path);
  return (
    <EntryCard
      node={node}
      className="file-card"
      media={<span className="folder-icon">{kind === "image" ? <IconImage /> : kind === "html" ? <IconCode /> : <IconPage />}</span>}
      title={titleOf(node.path)}
      lines={[changeLine(a?.at ?? node.modified ?? null, a?.by ?? null, now)]}
      unseen={isUnseen(activity, seen, node.path)}
      onOpen={() => useApp.getState().open(node.path)}
      draggablePath={kind === "image" ? node.path : undefined}
    />
  );
}
