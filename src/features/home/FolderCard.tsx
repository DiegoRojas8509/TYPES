import { useMemo } from "react";
import type { TreeNode } from "../../lib/api";
import { changeLine, plural, summarize } from "../../lib/browse";
import { useApp } from "../../store/app";
import { IconFolder } from "../shell/icons";
import { EntryCard } from "./EntryCard";

export function FolderCard({ node, now }: { node: TreeNode; now: number }) {
  const activity = useApp((s) => s.activity);
  const seen = useApp((s) => s.seen);
  const info = useMemo(() => summarize(node, activity, seen), [node, activity, seen]);
  return (
    <EntryCard
      node={node}
      className="folder-card"
      media={
        <span className="folder-icon">
          <IconFolder />
        </span>
      }
      title={node.name}
      lines={[plural(info.boards, "pizarra", "pizarras"), changeLine(info.at, info.by, now)]}
      unseen={info.unseen}
      onOpen={() => useApp.getState().browse(node.path)}
    />
  );
}
