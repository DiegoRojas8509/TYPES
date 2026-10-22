import { useEffect, useRef, useState } from "react";
import { isWithin } from "../../lib/paths";
import { useApp } from "../../store/app";

/**
 * Image URL that recovers by itself: when an fs change touches the image's
 * workspace path (e.g. a deleted image was restored at the same path) the failed
 * flag is cleared and `?v=<seq>` busts the webview cache. Unrelated changes keep
 * the URL stable, so nothing flickers.
 */
export function useImageUrl(rel: string | null, base: string) {
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const handled = useRef(useApp.getState().fsChange?.seq ?? 0);

  useEffect(() => setFailed(false), [base]);

  const change = useApp((s) => s.fsChange);
  useEffect(() => {
    if (!change || change.seq === handled.current) return;
    handled.current = change.seq;
    if (rel !== null && change.paths.some((p) => p === rel || isWithin(rel, p))) {
      setFailed(false);
      setVersion(change.seq);
    }
  }, [change, rel]);

  const src = base === "" || version === null ? base : `${base}?v=${version}`;
  return { src, failed, setFailed };
}
