import { describe, expect, it } from "vitest";
import { cellText, isObj, list, text } from "./raw";

describe("raw helpers", () => {
  it("isObj is true only for plain objects", () => {
    expect([{}, { a: 1 }].every(isObj)).toBe(true);
    expect([null, undefined, [], "x", 1].some(isObj)).toBe(false);
  });
  it("list returns an array as is (same identity) and anything else as empty", () => {
    const a = [1];
    expect(list(a)).toBe(a);
    expect(list("x")).toEqual([]);
    expect(list(null)).toEqual([]);
  });
  it("text is strict: strings and numbers only", () => {
    expect([text("a"), text(3), text(null), text({}), text(true)]).toEqual(["a", "3", "", "", ""]);
  });
  it("cellText is lenient: String(v), with null and undefined empty", () => {
    expect([cellText("a"), cellText(3), cellText(null), cellText(undefined), cellText(true)]).toEqual(["a", "3", "", "", "true"]);
  });
});
