// Helpers shared by the data modules (table, chart, timeline, decision). A `.canvas`
// can be hand-written or edited by Claude, so everything read from a node is
// `unknown` until one of these narrows it. One copy on purpose: divergent local
// versions of `text` are how a lossy table edit once slipped in.

export type Raw = Record<string, unknown>;

export const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** An array as is, anything else as an empty list. Never copies. */
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Strict display text: strings as they are, numbers as text, anything else empty. */
export const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Lenient display text: `String(v)`, with null/undefined as empty (chart labels and names). */
export const cellText = (v: unknown): string => String(v ?? "");
