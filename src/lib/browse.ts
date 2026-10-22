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

export const nfc = (path: string) => path.normalize("NFC");

/** Activity and seen keys are NFC; tree paths may arrive NFD. */
export function activityOf(activity: Record<string, Activity>, path: string): Activity | undefined {
  return activity[nfc(path)];
}

export const isClaudeActor = (a: Activity | undefined) => !!a && (a.by === "claude" || a.by === "claude-cel");

/** Log entries older than the file's mtime by more than this are stale (edited while the app was closed). */
export const STALE_MS = 2000;

export interface Change {
  at: number | null;
  /** Null when only the mtime is known (no entry, or a stale one). */
  by: Activity["by"] | null;
  /** The log entry still describes the file's current content. */
  fresh: boolean;
}

/** The ONE rule for "when and by whom": a stale entry is ignored in favour of `modified`, with no actor. */
export function changeOf(a: Activity | undefined, modified: number | null | undefined): Change {
  const mod = modified ?? null;
  if (a && !(mod !== null && mod > a.at + STALE_MS)) return { at: a.at, by: a.by, fresh: true };
  return { at: mod, by: null, fresh: false };
}

export function isUnseen(
  activity: Record<string, Activity>,
  seen: Record<string, number>,
  path: string,
  modified?: number | null,
): boolean {
  const a = activityOf(activity, path);
  const c = changeOf(a, modified);
  return c.fresh && isClaudeActor(a) && a!.at > (seen[nfc(path)] ?? 0);
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
    const c = changeOf(activityOf(activity, f.path), f.modified);
    if (c.at !== null && (at === null || c.at > at)) {
      at = c.at;
      by = c.by;
    }
    if (isUnseen(activity, seen, f.path, f.modified)) unseen = true;
  }
  return { at, by, unseen, boards };
}

const ACTOR_LABEL: Record<Activity["by"], string> = {
  tu: "tú",
  claude: "Claude",
  "claude-cel": "Claude desde el cel",
  fuera: "fuera de la app",
};

/** Why "Claude desde el cel" is only a guess (tooltip on the actor text). */
export const CEL_NOTE = "Se atribuye al cel porque el control remoto estaba activo; puede haber sido otro programa.";

/** "hace 2 h · Claude"; just the time when the actor is unknown; "" when nothing is known. */
export function changeLine(at: number | null, by: Activity["by"] | null, now: number): string {
  if (at === null) return "";
  const when = timeAgo(at, now);
  return by ? `${when} · ${ACTOR_LABEL[by]}` : when;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
