import { describe, expect, it } from "vitest";
import { addItem, moveItem, removeItem, setItemField, timelineProgress, timelineView, todayISO } from "./timelineData";

const raw = (items: unknown) => ({ items });

describe("timelineView", () => {
  it("reads well-formed items in stored order", () => {
    expect(timelineView(raw([{ date: "2026-10-01", title: "Muestra", detail: "Con botones", status: "hecho" }]))).toEqual([
      { date: "2026-10-01", title: "Muestra", detail: "Con botones", status: "hecho", known: true },
    ]);
  });
  it("copes with missing items, non-array items and strings or nulls as items", () => {
    expect(timelineView({})).toEqual([]);
    expect(timelineView(raw("oops"))).toEqual([]);
    expect(timelineView(raw(["Cortar tela", null, 7]))).toEqual([
      { date: "", title: "Cortar tela", detail: "", status: "pendiente", known: true },
      { date: "", title: "", detail: "", status: "pendiente", known: true },
      { date: "", title: "7", detail: "", status: "pendiente", known: true },
    ]);
  });
  it("defaults missing date, title and status and keeps free-form dates as stored", () => {
    expect(timelineView(raw([{ date: "octubre" }, { date: 5 }, {}]))).toMatchObject([
      { date: "octubre", title: "", status: "pendiente", known: true },
      { date: "5", title: "" },
      { date: "", title: "" },
    ]);
  });
  it("keeps an unknown status as text and flags it", () => {
    expect(timelineView(raw([{ title: "x", status: "bloqueado" }, { title: "y", status: 3 }]))).toMatchObject([
      { status: "bloqueado", known: false },
      { status: "3", known: false },
    ]);
  });
});

describe("timelineProgress", () => {
  it("counts hecho over the total", () => {
    const rows = timelineView(raw([{ status: "hecho" }, { status: "en curso" }, { status: "hecho" }, "x"]));
    expect(timelineProgress(rows)).toEqual({ done: 2, total: 4 });
    expect(timelineProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe("todayISO", () => {
  it("is the local date as YYYY-MM-DD with zero padding", () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayISO(new Date(2026, 9, 14))).toBe("2026-10-14");
  });
});

describe("item patches write the RAW items and never mutate", () => {
  const items = [
    { date: "2026-10-01", title: "A", status: "hecho", extra: { k: 1 } },
    "texto suelto",
    null,
    { title: "D", status: "bloqueado", owner: "Diego" },
  ];
  const input = raw(items);
  const frozen = JSON.stringify(input);

  it("setItemField patches only that item and keeps its unknown fields", () => {
    const out = setItemField(input, 0, "title", "A2");
    expect(out[0]).toEqual({ date: "2026-10-01", title: "A2", status: "hecho", extra: { k: 1 } });
    expect(out[1]).toBe(items[1]);
    expect(out[3]).toBe(items[3]);
    expect(out).not.toBe(items);
    expect(JSON.stringify(input)).toBe(frozen);
  });
  it("does not add fields the item did not have", () => {
    expect(setItemField(raw([{ title: "x" }]), 0, "date", "hoy")).toEqual([{ title: "x", date: "hoy" }]);
  });
  it("an unknown status survives edits to other fields and other items", () => {
    const out = setItemField(input, 0, "title", "A2");
    expect(out[3]).toEqual({ title: "D", status: "bloqueado", owner: "Diego" });
    expect(setItemField(input, 3, "status", "hecho")[3]).toEqual({ title: "D", status: "hecho", owner: "Diego" });
  });
  it("a string or null item is rebuilt from what is shown, keeping its text", () => {
    expect(setItemField(input, 1, "date", "hoy")[1]).toEqual({ date: "hoy", title: "texto suelto", status: "pendiente" });
    expect(setItemField(input, 2, "title", "nuevo")[2]).toEqual({ date: "", title: "nuevo", status: "pendiente" });
  });
  it("works when items is missing", () => {
    expect(setItemField({}, 0, "title", "x")).toEqual([]);
  });
  it("addItem appends a pendiente item with the given date and keeps everything else", () => {
    const out = addItem(input, "2026-10-14");
    expect(out).toHaveLength(5);
    expect(out[4]).toEqual({ date: "2026-10-14", title: "", status: "pendiente" });
    expect(out.slice(0, 4)).toEqual(items);
    expect(addItem({}, "2026-10-14")).toEqual([{ date: "2026-10-14", title: "", status: "pendiente" }]);
    expect(JSON.stringify(input)).toBe(frozen);
  });
  it("removeItem drops only that position, whatever it holds", () => {
    expect(removeItem(input, 1)).toEqual([items[0], null, items[3]]);
    expect(JSON.stringify(input)).toBe(frozen);
  });
  it("moveItem swaps neighbours, keeps entries as found, and ignores moves off either end", () => {
    const down = moveItem(input, 0, 1);
    expect(down[0]).toBe(items[1]);
    expect(down[1]).toBe(items[0]);
    expect(moveItem(input, 3, -1)[2]).toBe(items[3]);
    expect(moveItem(input, 0, -1)).toEqual(items);
    expect(moveItem(input, 3, 1)).toEqual(items);
    expect(moveItem(input, 0, -1)).not.toBe(items);
    expect(JSON.stringify(input)).toBe(frozen);
  });
});
