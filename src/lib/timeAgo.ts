const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Relative time in Spanish: "ahora", "hace 5 min", "hace 2 h", "ayer", "hace 3 días", then "12 oct". Pure. */
export function timeAgo(ms: number, now: number): string {
  const diff = now - ms;
  if (diff < MIN) return "ahora";
  if (diff < HOUR) return `hace ${Math.floor(diff / MIN)} min`;
  if (diff < DAY) return `hace ${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  const d = new Date(ms);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
