import { describe, expect, it } from "vitest";
import { addOption, addPoint, decisionView, removeOption, removePoint, setOptionName, setPoint, toggleChosen } from "./decisionData";

const opts = [
  { name: "Proveedor A", pros: ["Barato", "Cerca"], cons: ["Lento"], nota: "ojo" },
  { name: "Proveedor B", pros: [], cons: ["Caro"] },
];
const node = (extra: Record<string, unknown> = {}) => ({ question: "¿Quién?", options: opts, ...extra });

describe("decisionView", () => {
  it("reads a well-formed decision", () => {
    expect(decisionView(node({ chosen: "Proveedor B", rationale: "Calidad" }))).toEqual({
      question: "¿Quién?",
      options: [
        { name: "Proveedor A", pros: ["Barato", "Cerca"], cons: ["Lento"] },
        { name: "Proveedor B", pros: [], cons: ["Caro"] },
      ],
      chosen: "Proveedor B",
      chosenFound: true,
      rationale: "Calidad",
      duplicates: [],
    });
  });
  it("copes with an empty node", () => {
    expect(decisionView({})).toEqual({ question: "", options: [], chosen: "", chosenFound: true, rationale: "", duplicates: [] });
  });
  it("coerces string, null and half-built options and non-array pros/cons", () => {
    const v = decisionView({ options: ["Solo nombre", null, { name: 5, pros: "x", cons: [1, null, "ok"] }] });
    expect(v.options).toEqual([
      { name: "Solo nombre", pros: [], cons: [] },
      { name: "", pros: [], cons: [] },
      { name: "5", pros: [], cons: ["1", "", "ok"] },
    ]);
  });
  it("reports a chosen that names no option, without clearing anything", () => {
    expect(decisionView(node({ chosen: "Fantasma" }))).toMatchObject({ chosen: "Fantasma", chosenFound: false });
  });
  it("treats an empty or non-string chosen as no choice", () => {
    expect(decisionView(node({ chosen: "" }))).toMatchObject({ chosen: "", chosenFound: true });
    expect(decisionView(node({ chosen: 4 }))).toMatchObject({ chosen: "", chosenFound: true });
  });
  it("lists duplicated non-empty option names once", () => {
    const v = decisionView({ options: [{ name: "A" }, { name: "A" }, { name: "A" }, { name: "" }, { name: "" }, { name: "B" }] });
    expect(v.duplicates).toEqual(["A"]);
  });
});

describe("option patches write the RAW options and never mutate", () => {
  const input = node({ chosen: "Proveedor A" });
  const frozen = JSON.stringify(input);

  it("setOptionName keeps extra fields and untouched options by identity", () => {
    const out = setOptionName(input, 1, "Proveedor C");
    expect(out.options[0]).toBe(opts[0]);
    expect(out.options[1]).toEqual({ name: "Proveedor C", pros: [], cons: ["Caro"] });
    expect("chosen" in out).toBe(false);
    expect(JSON.stringify(input)).toBe(frozen);
  });
  it("renaming the chosen option moves chosen to the new name in the same patch", () => {
    const out = setOptionName(input, 0, "Taller A");
    expect(out.options[0]).toEqual({ ...opts[0], name: "Taller A" });
    expect(out.chosen).toBe("Taller A");
  });
  it("renaming a duplicate of the chosen name leaves chosen alone (another option still has it)", () => {
    const dup = { options: [{ name: "A" }, { name: "A" }], chosen: "A" };
    expect("chosen" in setOptionName(dup, 0, "B")).toBe(false);
  });
  it("renaming never makes an unnamed option chosen", () => {
    expect("chosen" in setOptionName({ options: [{ name: "" }], chosen: "" }, 0, "X")).toBe(false);
    expect("chosen" in setOptionName({ options: [{ name: "" }] }, 0, "X")).toBe(false);
  });
  it("a chosen that names no option is not touched by renames", () => {
    expect("chosen" in setOptionName(node({ chosen: "Fantasma" }), 0, "Z")).toBe(false);
  });
  it("a string or null option is rebuilt around what is shown", () => {
    expect(setOptionName({ options: ["Texto"] }, 0, "Nuevo").options[0]).toEqual({ name: "Nuevo", pros: [], cons: [] });
    expect(setOptionName({ options: [null] }, 0, "Nuevo").options[0]).toEqual({ name: "Nuevo", pros: [], cons: [] });
  });
  it("toggleChosen chooses by name, and choosing the chosen one again clears it", () => {
    expect(toggleChosen(node(), 1)).toEqual({ chosen: "Proveedor B" });
    expect(toggleChosen(input, 1)).toEqual({ chosen: "Proveedor B" });
    const cleared = toggleChosen(input, 0);
    expect(cleared).toStrictEqual({ chosen: undefined });
  });
  it("toggleChosen marks by name: a duplicate toggles all of them off together", () => {
    const dup = { options: [{ name: "A" }, { name: "A" }], chosen: "A" };
    expect(toggleChosen(dup, 1)).toStrictEqual({ chosen: undefined });
  });
  it("toggleChosen does nothing for an unnamed option", () => {
    expect(toggleChosen({ options: [{ name: "" }, null] }, 0)).toBeNull();
    expect(toggleChosen({ options: [{ name: "" }, null] }, 1)).toBeNull();
  });
  it("addOption appends the default and keeps everything", () => {
    const out = addOption(input);
    expect(out.options).toHaveLength(3);
    expect(out.options[2]).toEqual({ name: "Opción 3", pros: [], cons: [] });
    expect(out.options.slice(0, 2)).toEqual(opts);
    expect(addOption({}).options).toEqual([{ name: "Opción 1", pros: [], cons: [] }]);
    expect(JSON.stringify(input)).toBe(frozen);
  });
  it("removeOption drops only that one; removing the chosen option clears chosen", () => {
    const out = removeOption(input, 1);
    expect(out.options).toEqual([opts[0]]);
    expect("chosen" in out).toBe(false);
    const gone = removeOption(input, 0);
    expect(gone.options).toEqual([opts[1]]);
    expect(gone).toHaveProperty("chosen", undefined);
    expect(JSON.stringify(input)).toBe(frozen);
  });
  it("removing one of two same-named options keeps chosen; removing a string option works", () => {
    const dup = { options: [{ name: "A" }, { name: "A" }], chosen: "A" };
    expect("chosen" in removeOption(dup, 0)).toBe(false);
    expect(removeOption({ options: ["x", { name: "y" }] }, 0).options).toEqual([{ name: "y" }]);
  });
  it("leaves a dangling chosen alone when removing an unrelated option", () => {
    expect("chosen" in removeOption(node({ chosen: "Fantasma" }), 0)).toBe(false);
  });
});

describe("pros and cons patches", () => {
  const input = {
    options: [{ name: "A", pros: ["x", 7, null, "z"], cons: "raro", extra: 1 }, "texto", null],
  };
  const frozen = JSON.stringify(input);

  it("addPoint appends an empty point and keeps non-string entries untouched", () => {
    const out = addPoint(input, 0, "pros");
    expect(out[0]).toEqual({ name: "A", pros: ["x", 7, null, "z", ""], cons: "raro", extra: 1 });
    expect(out[1]).toBe(input.options[1]);
    expect(JSON.stringify(input)).toBe(frozen);
  });
  it("setPoint changes one entry and leaves the rest as found", () => {
    expect(setPoint(input, 0, "pros", 3, "zz")[0]).toEqual({ name: "A", pros: ["x", 7, null, "zz"], cons: "raro", extra: 1 });
  });
  it("removePoint drops only that entry", () => {
    expect(removePoint(input, 0, "pros", 1)[0]).toEqual({ name: "A", pros: ["x", null, "z"], cons: "raro", extra: 1 });
  });
  it("a non-array side is replaced only when the user adds to it", () => {
    expect(addPoint(input, 0, "cons")[0]).toMatchObject({ cons: [""] });
  });
  it("a string or null option is rebuilt when a point is added", () => {
    expect(addPoint(input, 1, "cons")[1]).toEqual({ name: "texto", pros: [], cons: [""] });
    expect(addPoint(input, 2, "pros")[2]).toEqual({ name: "", pros: [""], cons: [] });
  });
  it("works when options is missing", () => {
    expect(addPoint({}, 0, "pros")).toEqual([]);
  });
});
