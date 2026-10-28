// Rename (F2 / menu) and delete (Supr / menu) for one card, sharing the sidebar's NameInput and ConfirmDelete.
import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { TreeNode } from "../../lib/api";
import { titleOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { ConfirmDelete } from "../sidebar/ConfirmDelete";
import { NameInput } from "../sidebar/NameInput";
import type { MenuItem } from "./CardMenu";
import { isTypingTarget } from "./typing";

export interface EntryActions {
  renaming: boolean;
  renameInput: ReactNode;
  dialog: ReactNode;
  menuItems: MenuItem[];
  onKeyDown(e: KeyboardEvent): void;
}

export function useEntryActions(node: TreeNode): EntryActions {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const isDir = node.kind === "dir";
  const display = isDir ? node.name : titleOf(node.path);

  return {
    renaming,
    renameInput: renaming ? (
      <NameInput
        label="Nuevo nombre"
        initial={display}
        onSubmit={async (name) => {
          const ok = (await useApp.getState().renameEntry(node.path, name)) !== null;
          if (ok) setRenaming(false);
          return ok;
        }}
        onCancel={() => setRenaming(false)}
      />
    ) : null,
    dialog: confirming ? (
      <ConfirmDelete
        name={display}
        isDir={isDir}
        onConfirm={() => {
          setConfirming(false);
          void useApp.getState().deleteEntry(node.path);
        }}
        onCancel={() => setConfirming(false)}
      />
    ) : null,
    menuItems: [
      { label: "Renombrar", onSelect: () => setRenaming(true) },
      { label: "Eliminar", danger: true, onSelect: () => setConfirming(true) },
    ],
    onKeyDown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || confirming) return;
      if ((e.target as Element).closest('[role="menu"]')) return;
      if (e.key === "F2") {
        e.preventDefault();
        setRenaming(true);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setConfirming(true);
      }
    },
  };
}
