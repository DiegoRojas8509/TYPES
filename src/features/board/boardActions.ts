import { createContext, useContext } from "react";
import type { CanvasNode } from "../../lib/canvas";

export interface BoardActions {
  /** Merges `patch` into the node with that id and persists the board. */
  update(id: string, patch: Partial<CanvasNode>): void;
}

export const BoardActionsContext = createContext<BoardActions>({ update() {} });

/** Block components import this (never BoardView) to edit their own node. */
export function useBoardActions(): BoardActions {
  return useContext(BoardActionsContext);
}
