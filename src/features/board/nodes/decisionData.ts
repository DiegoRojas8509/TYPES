// Pure data helpers of the decision block. Options and their pros/cons can be
// hand-written or edited by Claude: options may be strings or null, `pros`/`cons`
// may be missing or hold non-strings, `chosen` may name nothing, names may repeat.
//
// DISPLAY goes through `decisionView` (coerces). WRITES patch the node's RAW
// `options`: only the touched option or point changes, extra fields survive, all
// other entries are carried over by identity. Every helper returns NEW arrays and
// never mutates. `chosen` is keyed by option NAME (that is the file format), so
// duplicate names are shown with a hint, never silently disambiguated.

export type Side = "pros" | "cons";

export interface OptionRow {
  name: string;
  pros: string[];
  cons: string[];
}
export interface DecisionView {
  question: string;
  options: OptionRow[];
  /** The stored choice; "" when there is none (missing, empty or not a string). */
  chosen: string;
  /** False when `chosen` is set but no option has that name. */
  chosenFound: boolean;
  rationale: string;
  /** Non-empty option names used by more than one option, once each. */
  duplicates: string[];
}
/** `chosen` is present only when the edit changes it; `chosen: undefined` clears it. */
export type OptionsPatch = {
  options: unknown[];
  chosen?: string | undefined;
};

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const rawOptions = (raw: Raw): unknown[] => (Array.isArray(raw.options) ? raw.options : []);
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function optionRow(opt: unknown): OptionRow {
  if (!isObj(opt)) return { name: text(opt), pros: [], cons: [] };
  return { name: text(opt.name), pros: list(opt.pros).map(text), cons: list(opt.cons).map(text) };
}

export function decisionView(raw: Raw): DecisionView {
  const options = rawOptions(raw).map(optionRow);
  const chosen = typeof raw.chosen === "string" ? raw.chosen : "";
  const count = new Map<string, number>();
  for (const o of options) if (o.name !== "") count.set(o.name, (count.get(o.name) ?? 0) + 1);
  return {
    question: text(raw.question),
    options,
    chosen,
    chosenFound: chosen === "" || options.some((o) => o.name === chosen),
    rationale: text(raw.rationale),
    duplicates: [...count].filter(([, n]) => n > 1).map(([name]) => name),
  };
}

const chosenOf = (raw: Raw): string => (typeof raw.chosen === "string" ? raw.chosen : "");
const nameOf = (opt: unknown): string => optionRow(opt).name;
const countNamed = (options: unknown[], name: string): number => options.filter((o) => nameOf(o) === name).length;

/** The option as an object to edit: kept as is when it already is one, otherwise rebuilt from what is shown. */
const editable = (opt: unknown): Record<string, unknown> => (isObj(opt) ? opt : { ...optionRow(opt) });

function mapOption(raw: Raw, index: number, fn: (opt: Record<string, unknown>) => Record<string, unknown>): unknown[] {
  return rawOptions(raw).map((opt, i) => (i === index ? fn(editable(opt)) : opt));
}

/**
 * Renames an option. If it is the chosen one (and no other option keeps that
 * name), `chosen` follows to the new name in the same patch. Emptying the name of
 * the chosen option therefore clears the choice (an option without a name cannot
 * be chosen); an unnamed option is never promoted to chosen by a rename.
 */
export function setOptionName(raw: Raw, index: number, name: string): OptionsPatch {
  const options = rawOptions(raw);
  const old = index < options.length ? nameOf(options[index]) : "";
  const patch: OptionsPatch = { options: mapOption(raw, index, (o) => ({ ...o, name })) };
  if (old !== "" && chosenOf(raw) === old && countNamed(options, old) === 1) patch.chosen = name;
  return patch;
}

/**
 * "Elegir esta": chooses the option by its name, and doing it again on the chosen
 * option clears the choice (a toggle). Returns null for an unnamed option.
 */
export function toggleChosen(raw: Raw, index: number): { chosen: string | undefined } | null {
  const options = rawOptions(raw);
  if (index >= options.length) return null;
  const name = nameOf(options[index]);
  if (name === "") return null;
  return { chosen: chosenOf(raw) === name ? undefined : name };
}

export const addOption = (raw: Raw): OptionsPatch => {
  const options = rawOptions(raw);
  return { options: [...options, { name: `Opción ${options.length + 1}`, pros: [], cons: [] }] };
};

/** Removes an option; if it was the only holder of the chosen name, the choice is cleared too. */
export function removeOption(raw: Raw, index: number): OptionsPatch {
  const options = rawOptions(raw);
  const patch: OptionsPatch = { options: options.filter((_, i) => i !== index) };
  const name = index < options.length ? nameOf(options[index]) : "";
  if (name !== "" && chosenOf(raw) === name && countNamed(options, name) === 1) patch.chosen = undefined;
  return patch;
}

// ---- pros and cons ----------------------------------------------------------
// Entries of the side list that are not strings are carried over as found.

export const addPoint = (raw: Raw, index: number, side: Side): unknown[] =>
  mapOption(raw, index, (o) => ({ ...o, [side]: [...list(o[side]), ""] }));

export const setPoint = (raw: Raw, index: number, side: Side, point: number, value: string): unknown[] =>
  mapOption(raw, index, (o) => ({ ...o, [side]: list(o[side]).map((p, j) => (j === point ? value : p)) }));

export const removePoint = (raw: Raw, index: number, side: Side, point: number): unknown[] =>
  mapOption(raw, index, (o) => ({ ...o, [side]: list(o[side]).filter((_, j) => j !== point) }));
