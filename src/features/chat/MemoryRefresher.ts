import { useEffect, useRef } from "react";
import { useChats } from "./conversations";
import { useMemoryUi } from "./memoryUi";

/** The cronista writes a few seconds after each response: look again shortly and once more later. */
export const REFRESH_AFTER_RUN_MS = [8_000, 30_000];

/** Stays mounted for the whole space chat (the empty-state badge does not), bumping the memory tick after each run. */
export function useMemoryRefresh(space: string) {
  const running = useChats((s) => s.conversations[space]?.running ?? false);
  const was = useRef(running);
  useEffect(() => {
    const ended = was.current && !running;
    was.current = running;
    if (!ended) return;
    const timers = REFRESH_AFTER_RUN_MS.map((ms) => setTimeout(() => useMemoryUi.getState().bump(), ms));
    return () => timers.forEach(clearTimeout);
  }, [running, space]);
}
