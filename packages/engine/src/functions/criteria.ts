import { parseDate } from "../dates";
import { fail } from "../errors";
import { compare, isScalar, kindOf, parseNumber, type CellValue, type Scalar } from "../values";

type Comparison = "=" | "<>" | "<" | ">" | "<=" | ">=";

const OPERATOR = /^(<=|>=|<>|<|>|=)?(.*)$/s;

// Matching costs at most the pattern's length times the text's, so a limit on
// the pattern keeps the cost in proportion to the text. 255 is Excel's limit.
const MAX_WILDCARD_PATTERN = 255;

const HOLDS: Record<Comparison, (order: number) => boolean> = {
  "=": (order) => order === 0,
  "<>": (order) => order !== 0,
  "<": (order) => order < 0,
  ">": (order) => order > 0,
  "<=": (order) => order <= 0,
  ">=": (order) => order >= 0,
};

interface Operand {
  value: Scalar;
  quotedText: boolean;
}

/** Reads text after an operator as a cell entry; double quotes mark a text literal and `""` escapes a quote. */
function operand(text: string): Operand {
  const quoted = /^"((?:""|[^"])*)"$/.exec(text.trim())?.[1];
  if (quoted !== undefined) return { value: quoted.replaceAll('""', '"'), quotedText: true };
  const number = parseNumber(text);
  if (number !== undefined) return { value: number, quotedText: false };
  const upper = text.trim().toUpperCase();
  if (upper === "TRUE") return { value: true, quotedText: false };
  if (upper === "FALSE") return { value: false, quotedText: false };
  return { value: parseDate(text) ?? text, quotedText: false };
}

/** The characters of text without their letter case, so that `?` stands for one whole character. */
function folded(text: string): string[] {
  return Array.from(text, (character) => character.toLowerCase());
}

/**
 * Turns text with `*` (any run of characters) and `?` (any one character)
 * into a whole-text matcher that ignores letter case.
 *
 * The matcher is not a regular expression, which can take time exponential in
 * the number of `*`s on text that nearly matches. On a mismatch this goes
 * back only to the last `*` and has it take one more character. An earlier
 * `*` never has to change: it took the fewest characters that let the pattern
 * after it fit, which leaves the most text for the rest. So the work is at
 * most the pattern's length times the text's.
 */
function wildcard(pattern: string): (text: string) => boolean {
  const wanted = folded(pattern);
  if (wanted.length > MAX_WILDCARD_PATTERN && wanted.includes("*")) {
    fail("#VALUE!", `A criterion with * can be at most ${String(MAX_WILDCARD_PATTERN)} characters`);
  }
  return (text) => {
    const given = folded(text);
    let at = 0;
    let next = 0;
    // Where the pattern continues after the last `*` passed, and the text that `*` has not taken.
    let afterStar = -1;
    let untaken = 0;
    while (at < given.length) {
      if (wanted[next] === "*") {
        next += 1;
        afterStar = next;
        untaken = at;
      } else if (wanted[next] === "?" || wanted[next] === given[at]) {
        next += 1;
        at += 1;
      } else if (afterStar !== -1) {
        untaken += 1;
        at = untaken;
        next = afterStar;
      } else {
        return false;
      }
    }
    while (wanted[next] === "*") next += 1;
    return next === wanted.length;
  };
}

/**
 * Builds the test that `SUMIF`, `COUNTIF`, and their relatives apply to each
 * cell. A criterion is a value to equal, or text that starts with a comparison
 * operator: `">5"`, `"<>done"`. Text criteria ignore letter case and may use
 * the wildcards `*` and `?`.
 *
 * A cell only matches a criterion of its own kind: `">5"` matches numbers
 * above 5 and never text. Errors match nothing.
 */
export function criterion(given: Scalar): (cell: CellValue) => boolean {
  const [, written, rest = ""] =
    typeof given === "string" ? (OPERATOR.exec(given) ?? []) : [undefined, undefined, ""];
  const comparison = (written ?? "=") as Comparison;
  const parsed = typeof given === "string" ? operand(rest) : { value: given, quotedText: false };
  const target = parsed.value;
  const equality = comparison === "=" || comparison === "<>";

  if (target === null || target === "") {
    // An empty criterion is about emptiness: `""` matches empty cells and `"<>"` the others.
    const wantsEmpty = comparison === "=";
    return (cell) => (cell === null || cell === "") === wantsEmpty;
  }

  if (typeof target === "string" && equality) {
    const matches = wildcard(target);
    const wantsMatch = comparison === "=";
    return (cell) =>
      (typeof cell === "string" &&
        (parsed.quotedText ? compare(cell, target) === 0 : matches(cell))) === wantsMatch;
  }

  return (cell) => {
    if (!isScalar(cell) || kindOf(cell) !== kindOf(target)) return comparison === "<>";
    return HOLDS[comparison](compare(cell, target));
  };
}
