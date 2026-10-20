// Pure helpers for the card navigation: tree lookups and "what changed, by whom, unseen?".
import type { Activity, TreeNode } from "./api";
import { isClaudeFile, isImagesDir } from "./claudeFiles";
import { kindOf, parentOf } from "./paths";
import { timeAgo } from "./timeAgo";

export function findNode(tree: TreeNode[], path: string): TreeNode | null {
  for (const n of tree) {
    if (n.path === path) return n;
    if (n.kind === "dir" && path.startsWith(`${n.path}/`)) {
      const hit = findNode(n.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

/** `dir` itself when it is a folder in the tree, else its nearest existing ancestor; null = Inicio. */
export function nearestExistingDir(tree: TreeNode[], dir: string | null): string | null {
  let cur = dir;
  while (cur) {
    if (findNode(tree, cur)?.kind === "dir") return cur;
    cur = parentOf(cur) || null;
  }
  return null;
}

/** Every file under `node` except support material (CLAUDE.md, Imágenes). */
export function contentFiles(node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  for (const c of node.children) {
    if (isClaudeFile(c) || isImagesDir(c)) continue;
    if (c.kind === "dir") out.push(...contentFiles(c));
    else out.push(c);
  }
  return out;
}

/** Activity keys are NFC; tree paths may arrive NFD. */
export function activityOf(activity: Record<string, Activity>, path: string): Activity | undefined {
  return activity[path.normalize("NFC")];
}

export const isClaudeActor = (a: Activity | undefined) => !!a && (a.by === "claude" || a.by === "claude-cel");

export function isUnseen(activity: Record<string, Activity>, seen: Record<string, number>, path: string): boolean {
  const a = activityOf(activity, path);
  return isClaudeActor(a) && a!.at > (seen[path] ?? 0);
}

export interface Summary {
  /** Latest change under a folder (or of a file). `by` is absent when only `modified` is known. */
  at: number | null;
  by: Activity["by"] | null;
  unseen: boolean;
  boards: number;
}

export function summarize(
  node: TreeNode,
  activity: Record<string, Activity>,
  seen: Record<string, number>,
): Summary {
  const files = node.kind === "dir" ? contentFiles(node) : [node];
  let at: number | null = null;
  let by: Summary["by"] = null;
  let unseen = false;
  let boards = 0;
  for (const f of files) {
    if (kindOf(f.path) === "canvas") boards++;
    const a = activityOf(activity, f.path);
    const when = a?.at ?? f.modified ?? null;
    if (when !== null && (at === null || when > at)) {
      at = when;
      by = a?.by ?? null;
    }
    if (isUnseen(activity, seen, f.path)) unseen = true;
  }
  return { at, by, unseen, boards };
}

const ACTOR_LABEL: Record<Activity["by"], string> = {
  tu: "tú",
  claude: "Claude",
  "claude-cel": "Claude desde el cel",
  fuera: "fuera de la app",
};

/** "hace 2 h · Claude"; just the time when the actor is unknown; "" when nothing is known. */
export function changeLine(at: number | null, by: Activity["by"] | null, now: number): string {
  if (at === null) return "";
  const when = timeAgo(at, now);
  return by ? `${when} · ${ACTOR_LABEL[by]}` : when;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
