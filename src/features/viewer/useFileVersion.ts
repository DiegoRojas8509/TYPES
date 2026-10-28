import { useEffect, useRef, useState } from "react";
import { useApp } from "../../store/app";

/** Bursts of changes (the agent rewriting a file) collapse into one reload. */
export const COALESCE_MS = 120;

/**
 * Number that increases whenever `path` changes on disk. Changes to other files
 * are ignored; changes arriving within COALESCE_MS of each other count once.
 */
export function useFileVersion(path: string): number {
  const [version, setVersion] = useState(0);
  const fsChange = useApp((s) => s.fsChange);
  const seen = useRef(fsChange?.seq ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!fsChange || fsChange.seq <= seen.current) return;
    seen.current = fsChange.seq;
    if (!fsChange.paths.includes(path)) return;
    // Not cleared by unrelated events in between: the pending reload still fires.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setVersion((v) => v + 1);
    }, COALESCE_MS);
  }, [fsChange, path]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return version;
}
