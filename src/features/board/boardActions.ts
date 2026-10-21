import { createContext, useContext } from "react";
import type { CanvasNode } from "../../lib/canvas";

export interface BoardActions {
  /** Merges `patch` into the node with that id and persists the board. */
  update(id: string, patch: Partial<CanvasNode>): void;
  /** Moves the node to the history layer (`archived`, by "tu"); empty reason becomes «archivado a mano». */
  archive(id: string, reason?: string): void;
  /** Brings an archived node back to the board. */
  restore(id: string): void;
  /** True when the board cannot be edited: blocks hide their write controls. */
  readOnly?: boolean;
}

export const BoardActionsContext = createContext<BoardActions>({ update() {}, archive() {}, restore() {} });

/** Block components import this (never BoardView) to edit their own node. */
export function useBoardActions(): BoardActions {
  return useContext(BoardActionsContext);
}

export interface BoardInfo {
  /** Workspace-relative path of the open `.canvas` (blocks resolve relative files against its folder). */
  boardPath: string;
}

export const BoardContext = createContext<BoardInfo>({ boardPath: "" });

/** Facts about the board a block lives in. */
export function useBoardContext(): BoardInfo {
  return useContext(BoardContext);
}
