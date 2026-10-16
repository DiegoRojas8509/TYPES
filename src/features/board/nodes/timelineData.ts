// Pure data helpers of the timeline block. The `items` of a `.canvas` can be
// hand-written or edited by Claude, so they may be missing, hold strings or nulls,
// lack a date or title, or carry an unknown `status`.
//
// Two separate paths, as in chartData.ts:
//  - DISPLAY goes through `timelineView`, which hardens and coerces.
//  - WRITES patch the node's RAW `items`: only the touched item changes, its
//    unknown fields survive, and every other entry (even a string or null) is
//    carried over by identity. Each helper returns a NEW array and never mutates.

import { isObj, list, text, type Raw } from "./raw";

export const STATUSES = ["hecho", "en curso", "pendiente"] as const;
export type Status = (typeof STATUSES)[number];
export type ItemField = "date" | "title" | "detail" | "status";

export interface TimelineRow {
  /** Free text exactly as stored ("2026-10", "octubre"): never normalized. */
  date: string;
  title: string;
  detail: string;
  /** A valid status, or an unknown stored value shown as text (`known: false`). */
  status: string;
  known: boolean;
}

const rawItems = (raw: Raw): unknown[] => list(raw.items);

function rowOf(item: unknown): TimelineRow {
  if (!isObj(item)) return { date: "", title: text(item), detail: "", status: "pendiente", known: true };
  const stored = item.status;
  const known = stored === undefined || stored === null || stored === "" || STATUSES.includes(stored as Status);
  return {
    date: text(item.date),
    title: text(item.title),
    detail: text(item.detail),
    status: known ? (STATUSES.includes(stored as Status) ? (stored as string) : "pendiente") : text(stored) || String(stored),
    known,
  };
}

export const timelineView = (raw: Raw): TimelineRow[] => rawItems(raw).map(rowOf);

export function timelineProgress(rows: TimelineRow[]): { done: number; total: number } {
  return { done: rows.filter((r) => r.status === "hecho").length, total: rows.length };
}

/** Local date as YYYY-MM-DD (what "+ avance" stamps on a new item). */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Sets one field of one item. An item that is an object keeps all its other
 * fields (known or not) and gets no field it did not have. A string/null/number
 * item is rebuilt from what is shown (its text becomes the title), since the user
 * touched it. An index past the end changes nothing.
 */
export function setItemField(raw: Raw, index: number, field: ItemField, value: string): unknown[] {
  return rawItems(raw).map((item, i) => {
    if (i !== index) return item;
    if (isObj(item)) return { ...item, [field]: value };
    const row = rowOf(item);
    return { date: row.date, title: row.title, status: row.status, [field]: value };
  });
}

export const addItem = (raw: Raw, today: string): unknown[] => [...rawItems(raw), { date: today, title: "", status: "pendiente" }];

export const removeItem = (raw: Raw, index: number): unknown[] => rawItems(raw).filter((_, i) => i !== index);

/** Swaps the item with its neighbour (`delta` -1 up, +1 down). Off either end it returns the same order. */
export function moveItem(raw: Raw, index: number, delta: -1 | 1): unknown[] {
  const items = [...rawItems(raw)];
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items;
  [items[index], items[to]] = [items[to], items[index]];
  return items;
}
