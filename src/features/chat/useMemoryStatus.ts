import { useEffect, useRef, useState } from "react";
import { api, type MemoryStatus } from "../../lib/api";
import { useChats } from "./conversations";
import { useMemoryUi } from "./memoryUi";

/** The cronista writes a few seconds after each response: look again shortly and once more later. */
export const REFRESH_AFTER_RUN_MS = [8_000, 30_000];

/** Memory status of a space. Refetches on mount, space change, close-topic and after a chat run ends. */
export function useMemoryStatus(space: string): { status: MemoryStatus | null; failed: boolean } {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const tick = useMemoryUi((s) => s.tick);
  const running = useChats((s) => s.conversations[space]?.running ?? false);
  const wasRunning = useRef(running);
  const [runEnds, setRunEnds] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    api
      .memoryStatus(space)
      .then((s) => {
        if (mine !== seq.current) return;
        setStatus(s);
        setFailed(false);
      })
      .catch(() => mine === seq.current && setFailed(true));
  }, [space, tick, runEnds]);

  useEffect(() => {
    if (wasRunning.current && !running) {
      const timers = REFRESH_AFTER_RUN_MS.map((ms) => setTimeout(() => setRunEnds((n) => n + 1), ms));
      wasRunning.current = running;
      return () => timers.forEach(clearTimeout);
    }
    wasRunning.current = running;
  }, [running]);

  return { status, failed };
}
