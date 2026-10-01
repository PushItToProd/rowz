import { compare, isScalar, parseNumber, type CellValue, type Scalar } from "../values";

type Comparison = "=" | "<>" | "<" | ">" | "<=" | ">=";

const OPERATOR = /^(<=|>=|<>|<|>|=)?(.*)$/s;
const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

const HOLDS: Record<Comparison, (order: number) => boolean> = {
  "=": (order) => order === 0,
  "<>": (order) => order !== 0,
  "<": (order) => order < 0,
  ">": (order) => order > 0,
  "<=": (order) => order <= 0,
  ">=": (order) => order >= 0,
};

/** Reads the text after an operator the way a cell entry is read: a number, TRUE or FALSE, or text. */
function operand(text: string): Scalar {
  const number = parseNumber(text);
  if (number !== undefined) return number;
  const upper = text.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  return text;
}

/** Turns text with `*` (any run of characters) and `?` (any one character) into a whole-text matcher. */
function wildcard(pattern: string): RegExp {
  const source = pattern.replace(REGEX_SPECIAL, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${source}$`, "is");
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
  const target = typeof given === "string" ? operand(rest) : given;
  const equality = comparison === "=" || comparison === "<>";

  if (target === null || target === "") {
    // An empty criterion is about emptiness: `""` matches empty cells and `"<>"` the others.
    const wantsEmpty = comparison === "=";
    return (cell) => (cell === null || cell === "") === wantsEmpty;
  }

  if (typeof target === "string" && equality) {
    const matcher = wildcard(target);
    const wantsMatch = comparison === "=";
    return (cell) => (typeof cell === "string" && matcher.test(cell)) === wantsMatch;
  }

  return (cell) => {
    if (!isScalar(cell) || typeof cell !== typeof target) return comparison === "<>";
    return HOLDS[comparison](compare(cell, target));
  };
}
