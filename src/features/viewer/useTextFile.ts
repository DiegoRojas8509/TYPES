import { useCallback, useEffect, useRef, useState } from "react";
import { api, isApiError, errorMessage } from "../../lib/api";
import { useFileVersion } from "./useFileVersion";

export interface TextFile {
  /** Last content read successfully; kept while a newer read is in flight or fails. */
  text: string | null;
  /** Spanish message when the latest read failed; cleared by the next success. */
  error: string | null;
  loading: boolean;
  reload(): void;
}

function readError(e: unknown): string {
  if (isApiError(e) && e.kind === "not_found") return "Este archivo ya no existe.";
  return `No se pudo leer este archivo. ${errorMessage(e)}`;
}

/** Reads a workspace text file and re-reads it when it changes on disk. */
export function useTextFile(path: string): TextFile {
  const version = useFileVersion(path);
  const [manual, setManual] = useState(0);
  const [state, setState] = useState<Omit<TextFile, "reload">>({ text: null, error: null, loading: true });
  const latest = useRef(0);

  useEffect(() => {
    const mine = ++latest.current;
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    api
      .readText(path)
      .then(
        (text) => ({ text, error: null, loading: false }),
        (e: unknown) => ({ error: readError(e), loading: false }),
      )
      .then((patch) => {
        if (mine !== latest.current) return;
        setState((s) => ({ ...s, ...patch }));
      });
  }, [path, version, manual]);

  const reload = useCallback(() => setManual((n) => n + 1), []);
  return { ...state, reload };
}
