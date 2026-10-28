import { useEffect, useRef, useState } from "react";
import { api, type MemoryStatus } from "../../lib/api";
import { useMemoryUi } from "./memoryUi";

/** Memory status of a space. Refetches on mount, space change, close-topic and after a chat run ends. */
export function useMemoryStatus(space: string): { status: MemoryStatus | null; failed: boolean } {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const tick = useMemoryUi((s) => s.tick);
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
  }, [space, tick]);

  return { status, failed };
}
