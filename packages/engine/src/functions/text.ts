import { isDate } from "../dates";
import { formatDateAs, FormatError, formatNumber } from "../format";
import { parseNumber, toText, type Scalar } from "../values";
import { array, boolean, eager, fail, integer, items, number, scalar, text } from "./arguments";
import type { FunctionDefinition } from "./registry";

function textFunction(compute: (value: string) => Scalar): FunctionDefinition {
  return eager(1, 1, (value) => compute(text(value)));
}

/** More decimals than a number can hold. */
const MAX_DECIMALS = 20;

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

const concatenate: FunctionDefinition = eager(1, Infinity, (...values) =>
  items(values)
    .map(({ value }) => text(value))
    .join(""),
);

export const textFunctions: Record<string, FunctionDefinition> = {
  CONCATENATE: concatenate,
  CONCAT: concatenate,
  /** Joins values with a delimiter between them. */
  JOIN: eager(2, Infinity, (delimiter, ...values) =>
    items(values)
      .map(({ value }) => text(value))
      .join(text(delimiter)),
  ),
  /** Cuts text at a delimiter into cells across a row. A piece that reads as a number becomes one. */
  SPLIT: eager(2, 2, (value, delimiter) => {
    const at = text(delimiter);
    if (at === "") fail("#VALUE!", "The delimiter cannot be empty");
    return array([
      text(value)
        .split(at)
        .map((piece) => parseNumber(piece) ?? piece),
    ]);
  }),
  /** Capitalizes the first letter of each word and puts the rest in lower case. */
  PROPER: textFunction((value) =>
    value
      .toLowerCase()
      .replace(
        /(^|[^\p{L}\p{N}'])(\p{L})/gu,
        (_, before: string, letter: string) => before + letter.toUpperCase(),
      ),
  ),
  /** The character with a Unicode number. */
  CHAR: eager(1, 1, (value) => {
    const code = integer(value);
    return code < 1 || code > 0x10ffff
      ? fail("#VALUE!", `${String(code)} is not the number of a character`)
      : String.fromCodePoint(code);
  }),
  /** The Unicode number of the first character of text. */
  CODE: textFunction((value) => value.codePointAt(0) ?? fail("#VALUE!", "The text is empty")),
  /** Writes text so it can be part of a web address. */
  ENCODEURL: textFunction(encodeURIComponent),
  /** Writes a number as text with a fixed number of decimals, grouping thousands unless told not to. */
  FIXED: eager(1, 3, (value, decimals = 2, plain = false) => {
    const places = Math.min(count(decimals, "The number of decimals"), MAX_DECIMALS);
    const whole = boolean(plain) ? "0" : "#,##0";
    return formatNumber(number(value), places === 0 ? whole : `${whole}.${"0".repeat(places)}`);
  }),
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
  /** Text that a cell or a text view shows with its Markdown formatting applied. */
  MARKDOWN: eager(1, 1, (value) => ({ kind: "markdown", text: text(value) })),
  /** Writes a number or date as text in a chosen format. Text and TRUE or FALSE are returned as they are. */
  TEXT: eager(2, 2, (value, format) => {
    const given = scalar(value);
    const pattern = text(format);
    try {
      if (isDate(given)) return formatDateAs(given, pattern);
      return typeof given === "number" ? formatNumber(given, pattern) : toText(given);
    } catch (cause) {
      if (!(cause instanceof FormatError)) throw cause;
      return fail("#VALUE!", cause.message);
    }
  }),
  /** Reads text as a number, the way a typed cell entry is read. */
  VALUE: eager(1, 1, (value) => {
    const given = scalar(value);
    if (typeof given === "number") return given;
    const shown = toText(given);
    return parseNumber(shown) ?? fail("#VALUE!", `"${shown}" is not a number`);
  }),
};
