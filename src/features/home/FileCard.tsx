import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { TreeNode } from "../../lib/api";
import { activityOf, changeLine, changeOf, isUnseen } from "../../lib/browse";
import { kindOf, titleOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { IconCode, IconImage, IconPage } from "../shell/icons";
import { EntryCard } from "./EntryCard";

export const FileCard = memo(function FileCard({ node, now }: { node: TreeNode; now: number }) {
  const a = useApp(useShallow((s) => activityOf(s.activity, node.path) ?? {}));
  const unseen = useApp((s) => isUnseen(s.activity, s.seen, node.path, node.modified));
  const kind = kindOf(node.path);
  const c = changeOf("at" in a ? (a as { at: number; by: never }) : undefined, node.modified);
  return (
    <EntryCard
      node={node}
      className="file-card"
      media={<span className="folder-icon">{kind === "image" ? <IconImage /> : kind === "html" ? <IconCode /> : <IconPage />}</span>}
      title={titleOf(node.path)}
      lines={[changeLine(c.at, c.by, now)]}
      actor={c.by}
      unseen={unseen}
      onOpen={() => useApp.getState().open(node.path)}
      draggablePath={kind === "image" ? node.path : undefined}
    />
  );
});
