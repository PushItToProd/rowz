import { parseNumber, toText, type Scalar } from "../values";
import { boolean, eager, fail, integer, items, scalar, text } from "./arguments";
import type { FunctionDefinition } from "./registry";

function textFunction(compute: (value: string) => Scalar): FunctionDefinition {
  return eager(1, 1, (value) => compute(text(value)));
}

/** A count of characters, which cannot be negative. */
function count(value: Parameters<typeof integer>[0], what: string): number {
  const length = integer(value);
  return length < 0 ? fail("#VALUE!", `${what} cannot be negative`) : length;
}

/** Finds `needle` in `haystack` from a 1-based position, and gives a 1-based position. */
function find(needle: string, haystack: string, from: number): number {
  if (from < 1) fail("#VALUE!", "The start position must be 1 or more");
  const index = haystack.indexOf(needle, from - 1);
  return index === -1 ? fail("#VALUE!", `"${needle}" was not found`) : index + 1;
}

export const textFunctions: Record<string, FunctionDefinition> = {
  CONCATENATE: eager(1, Infinity, (...values) =>
    items(values)
      .map(({ value }) => text(value))
      .join(""),
  ),
  /** Joins values with a delimiter between them, optionally skipping empty ones. */
  TEXTJOIN: eager(3, Infinity, (delimiter, skipEmpty, ...values) => {
    const skip = boolean(skipEmpty);
    return items(values)
      .map(({ value }) => text(value))
      .filter((part) => !skip || part !== "")
      .join(text(delimiter));
  }),
  LEN: textFunction((value) => value.length),
  UPPER: textFunction((value) => value.toUpperCase()),
  LOWER: textFunction((value) => value.toLowerCase()),
  /** Removes leading and trailing spaces and collapses runs of spaces between words. */
  TRIM: textFunction((value) => value.trim().replace(/ {2,}/g, " ")),
  LEFT: eager(1, 2, (value, length = 1) => text(value).slice(0, count(length, "The length"))),
  RIGHT: eager(1, 2, (value, length = 1) => {
    const taken = count(length, "The length");
    return taken === 0 ? "" : text(value).slice(-taken);
  }),
  MID: eager(3, 3, (value, start, length) => {
    const from = integer(start);
    if (from < 1) fail("#VALUE!", "The start position must be 1 or more");
    return text(value).slice(from - 1, from - 1 + count(length, "The length"));
  }),
  /** The position of one text inside another, matching letter case. */
  FIND: eager(2, 3, (needle, haystack, start = 1) =>
    find(text(needle), text(haystack), integer(start)),
  ),
  /** The position of one text inside another, ignoring letter case. */
  SEARCH: eager(2, 3, (needle, haystack, start = 1) =>
    find(text(needle).toLowerCase(), text(haystack).toLowerCase(), integer(start)),
  ),
  SUBSTITUTE: eager(3, 3, (value, old, replacement) => {
    const target = text(old);
    return target === "" ? text(value) : text(value).replaceAll(target, text(replacement));
  }),
  REPT: eager(2, 2, (value, times) => text(value).repeat(count(times, "The count"))),
  /** Reads text as a number, the way a typed cell entry is read. */
  VALUE: eager(1, 1, (value) => {
    const given = scalar(value);
    if (typeof given === "number") return given;
    const shown = toText(given);
    return parseNumber(shown) ?? fail("#VALUE!", `"${shown}" is not a number`);
  }),
};
