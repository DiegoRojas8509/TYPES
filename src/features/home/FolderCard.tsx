import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { TreeNode } from "../../lib/api";
import { changeLine, plural, summarize } from "../../lib/browse";
import { useApp } from "../../store/app";
import { IconFolder } from "../shell/icons";
import { EntryCard } from "./EntryCard";

export const FolderCard = memo(function FolderCard({ node, now }: { node: TreeNode; now: number }) {
  // Selected as a value: equal summaries (fresh objects after every refresh) do not re-render.
  const info = useApp(useShallow((s) => summarize(node, s.activity, s.seen)));
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
});
