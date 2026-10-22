import { useEffect, useState } from "react";

/** Current time, refreshed every minute so "hace 5 min" does not go stale on screen. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
