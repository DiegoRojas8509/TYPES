const KEY = "types.seen";

export function readSeen(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw)
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => [k.normalize("NFC"), v]),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

export function writeSeen(seen: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* preference only: the dots just come back after a restart */
  }
}
