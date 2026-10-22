import { useEffect, useRef, useState } from "react";
import { api, type PreviewNode } from "../../lib/api";
import { IconBoard } from "../shell/icons";

/** Outlines per (path, modified): a board is only re-read when it changed on disk. */
const cache = new Map<string, PreviewNode[]>();
const CACHE_MAX = 300;

function remember(key: string, nodes: PreviewNode[]) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, nodes);
}

/** Test hook: forget every cached outline. */
export function clearThumbCache() {
  cache.clear();
}

// Calm, grey: kind only changes opacity and outline, never colour.
const LOOK: Record<string, { opacity: number; outline?: boolean }> = {
  text: { opacity: 0.22 },
  file: { opacity: 0.3 },
  link: { opacity: 0.16 },
  group: { opacity: 0.5, outline: true },
};
const W = 100;
const H = 58;
const PAD = 6;

/** Grey rectangles of the board's blocks. Loads only once the card scrolls into view. */
export function BoardThumb({ path, modified }: { path: string; modified?: number }) {
  const key = `${path}\u0000${modified ?? 0}`;
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [shown, setShown] = useState<{ key: string; nodes: PreviewNode[] } | null>(() => {
    const hit = cache.get(key);
    return hit ? { key, nodes: hit } : null;
  });

  useEffect(() => {
    if (visible || !box.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    });
    io.observe(box.current);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const hit = cache.get(key);
    if (hit) {
      setShown({ key, nodes: hit });
      return;
    }
    let live = true;
    Promise.resolve()
      .then(() => api.boardPreview(path))
      .then((p) => p.nodes)
      .catch((): PreviewNode[] => [])
      .then((nodes) => {
        remember(key, nodes);
        if (live) setShown({ key, nodes });
      });
    return () => {
      live = false;
    };
  }, [visible, key, path]);

  const nodes = shown?.nodes ?? [];
  return (
    <div className="thumb" ref={box} aria-hidden="true">
      {nodes.length === 0 ? (
        <span className="thumb-empty">
          <IconBoard />
        </span>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" focusable="false">
          {nodes.map((n, i) => {
            const look = LOOK[n.kind] ?? LOOK.text;
            return (
              <rect
                key={i}
                x={PAD + n.x * (W - 2 * PAD)}
                y={PAD + n.y * (H - 2 * PAD)}
                width={Math.max(n.w * (W - 2 * PAD), 2)}
                height={Math.max(n.h * (H - 2 * PAD), 2)}
                rx={1.5}
                fill={look.outline ? "none" : "currentColor"}
                fillOpacity={look.outline ? 0 : look.opacity}
                stroke={look.outline ? "currentColor" : "none"}
                strokeOpacity={look.outline ? 0.4 : 0}
                strokeWidth={0.6}
                strokeDasharray={look.outline ? "2 1.5" : undefined}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
