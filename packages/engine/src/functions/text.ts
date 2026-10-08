import { isDate } from "../dates";
import { formatDateAs, FormatError, formatNumber } from "../format";
import { isRange, parseNumber, toText, type Evaluated, type Scalar } from "../values";
import {
  array,
  boolean,
  eager,
  element,
  fail,
  grid,
  integer,
  items,
  limitCells,
  MAX_ARRAY_CELLS,
  number,
  scalar,
  text,
} from "./arguments";
import {
  graphemeLength,
  graphemes,
  isAscii,
  offsetAtGrapheme,
  positionAtGrapheme,
  sliceGraphemes,
} from "./graphemes";
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

interface TextMatch {
  start: number;
  end: number;
}

interface FoldedText {
  value: string;
  originalOffset(offset: number): number | undefined;
  foldedOffset(offset: number): number | undefined;
}

/** Case folds text and maps offsets when a character's lowercase form changes its length. */
function foldText(value: string): FoldedText {
  const folded = value.toLowerCase();
  if (folded.length === value.length) {
    return {
      value: folded,
      originalOffset: (offset) => offset,
      foldedOffset: (offset) => offset,
    };
  }

  const originalOffsets = new Map<number, number>([[0, 0]]);
  const foldedOffsets = new Map<number, number>([[0, 0]]);
  let originalOffset = 0;
  let foldedOffset = 0;
  for (const character of value) {
    originalOffset += character.length;
    foldedOffset += character.toLowerCase().length;
    originalOffsets.set(foldedOffset, originalOffset);
    foldedOffsets.set(originalOffset, foldedOffset);
  }

  return {
    value: folded,
    originalOffset: (offset) => originalOffsets.get(offset),
    foldedOffset: (offset) => foldedOffsets.get(offset),
  };
}

/** Finds one delimiter occurrence in either direction without splitting a delimiter. */
function delimiterSearch(source: string, delimiter: string, ignoreCase: boolean) {
  const foldedSource = ignoreCase ? foldText(source) : foldTextIdentity(source);
  const foldedDelimiter = ignoreCase ? delimiter.toLowerCase() : delimiter;

  function next(from: number): TextMatch | undefined {
    let fromFolded = foldedSource.foldedOffset(from);
    if (fromFolded === undefined) return undefined;
    let index = foldedSource.value.indexOf(foldedDelimiter, fromFolded);
    while (index !== -1) {
      const start = foldedSource.originalOffset(index);
      const end = foldedSource.originalOffset(index + foldedDelimiter.length);
      if (start !== undefined && end !== undefined && start >= from) return { start, end };
      fromFolded = index + 1;
      index = foldedSource.value.indexOf(foldedDelimiter, fromFolded);
    }
    return undefined;
  }

  function previous(before: number): TextMatch | undefined {
    let beforeFolded = foldedSource.foldedOffset(before);
    if (beforeFolded === undefined) return undefined;
    let index = foldedSource.value.lastIndexOf(
      foldedDelimiter,
      beforeFolded - foldedDelimiter.length,
    );
    while (index !== -1) {
      const start = foldedSource.originalOffset(index);
      const end = foldedSource.originalOffset(index + foldedDelimiter.length);
      if (start !== undefined && end !== undefined && end <= before) return { start, end };
      beforeFolded = index - 1;
      index = foldedSource.value.lastIndexOf(
        foldedDelimiter,
        beforeFolded - foldedDelimiter.length,
      );
    }
    return undefined;
  }

  return { next, previous };
}

function foldTextIdentity(value: string): FoldedText {
  return {
    value,
    originalOffset: (offset) => offset,
    foldedOffset: (offset) => offset,
  };
}

/** Returns the selected occurrence, including the optional delimiter at the search endpoint. */
function delimiterMatch(
  source: string,
  delimiter: string,
  instance: number,
  ignoreCase: boolean,
  matchEnd: boolean,
): TextMatch | undefined {
  if (delimiter === "") {
    const length = graphemeLength(source);
    const position =
      instance > 0
        ? offsetAtGrapheme(source, instance - 1)
        : offsetAtGrapheme(source, length - Math.abs(instance) + 1);
    return { start: position, end: position };
  }

  const search = delimiterSearch(source, delimiter, ignoreCase);
  const directionalMatch = matchEnd
    ? instance > 0
      ? { start: source.length, end: source.length }
      : { start: 0, end: 0 }
    : undefined;

  if (instance > 0) {
    let remaining = instance;
    let from = 0;
    while (remaining > 0) {
      const found = search.next(from);
      if (!found) return remaining === 1 ? directionalMatch : undefined;
      if (remaining === 1) return found;
      remaining -= 1;
      from = found.end;
    }
    return undefined;
  }

  let remaining = Math.abs(instance);
  let before = source.length;
  while (remaining > 0) {
    const found = search.previous(before);
    if (!found) return remaining === 1 ? directionalMatch : undefined;
    if (remaining === 1) return found;
    remaining -= 1;
    before = found.start;
  }
  return undefined;
}

function textBeforeOrAfter(
  source: string,
  delimiter: string,
  instance: number,
  ignoreCase: boolean,
  matchEnd: boolean,
  ifNotFound: Scalar | undefined,
  after: boolean,
): Scalar {
  if (instance === 0) fail("#VALUE!", "instance_num cannot be 0");
  const length = graphemeLength(source);
  if (Math.abs(instance) > length) {
    fail(
      "#VALUE!",
      `The absolute value of instance_num ${String(instance)} exceeds the text length ${String(length)}`,
    );
  }

  const match = delimiterMatch(source, delimiter, instance, ignoreCase, matchEnd);
  if (!match) {
    if (ifNotFound !== undefined) return ifNotFound;
    return fail("#N/A", "The delimiter was not found in the text");
  }
  return after ? source.slice(match.end) : source.slice(0, match.start);
}

function textBeforeAfter(after: boolean): FunctionDefinition {
  return eager(2, 6, (value, delimiter, ...optional) => {
    const [instance = 1, matchMode = 0, matchEnd = 0, ifNotFound] = optional;
    const separator = text(delimiter);
    const occurrence = integer(instance);
    const mode = integer(matchMode);
    const ending = integer(matchEnd);
    const fallback = ifNotFound === undefined ? undefined : scalar(ifNotFound);
    if (mode !== 0 && mode !== 1) fail("#VALUE!", "match_mode must be 0 or 1");
    if (ending !== 0 && ending !== 1) fail("#VALUE!", "match_end must be 0 or 1");

    const extract = (cell: Evaluated): Scalar =>
      textBeforeOrAfter(
        text(cell),
        separator,
        occurrence,
        mode === 1,
        ending === 1,
        fallback,
        after,
      );

    if (!isRange(value)) return extract(value);
    const rows = grid(value);
    limitCells(rows.reduce((total, row) => total + row.length, 0));
    return array(rows.map((row) => row.map((cell) => element(() => extract(cell)))));
  });
}

/** Finds `needle` in `haystack` from a 1-based position, and gives a 1-based position. */
function find(needle: string, haystack: string, from: number): number {
  if (from < 1) fail("#VALUE!", "The start position must be 1 or more");
  if (isAscii(haystack)) {
    const index = haystack.indexOf(needle, from - 1);
    return index === -1 ? fail("#VALUE!", `"${needle}" was not found`) : index + 1;
  }
  const index = haystack.indexOf(needle, offsetAtGrapheme(haystack, from - 1));
  return index === -1
    ? fail("#VALUE!", `"${needle}" was not found`)
    : positionAtGrapheme(haystack, index);
}

/** Finds text without case sensitivity while returning a position in the original text. */
function search(needle: string, haystack: string, from: number): number {
  if (from < 1) fail("#VALUE!", "The start position must be 1 or more");
  const folded = haystack.toLowerCase();
  const foldedNeedle = needle.toLowerCase();
  if (isAscii(haystack) && isAscii(needle)) {
    const index = folded.indexOf(foldedNeedle, from - 1);
    return index === -1 ? fail("#VALUE!", `"${needle}" was not found`) : index + 1;
  }
  const starts: number[] = [];
  let foldedOffset = 0;
  for (const character of graphemes(haystack)) {
    starts.push(foldedOffset);
    foldedOffset += character.toLowerCase().length;
  }
  const start = starts[from - 1] ?? folded.length;
  const index = folded.indexOf(foldedNeedle, start);
  if (index === -1) return fail("#VALUE!", `"${needle}" was not found`);
  if (index === folded.length) return starts.length + 1;

  // Find the grapheme whose lowercased text contains this match offset.
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((starts[middle] ?? Infinity) <= index) low = middle + 1;
    else high = middle;
  }
  return low;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encodes UTF-8 bytes with the standard Base64 alphabet. */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    if (first === undefined) continue;
    const second = bytes[i + 1];
    const third = bytes[i + 2];
    encoded += BASE64_ALPHABET.charAt(first >> 2);
    encoded += BASE64_ALPHABET.charAt(((first & 0b11) << 4) | ((second ?? 0) >> 4));
    encoded +=
      second === undefined
        ? "=="
        : third === undefined
          ? BASE64_ALPHABET.charAt((second & 0b1111) << 2) + "="
          : BASE64_ALPHABET.charAt(((second & 0b1111) << 2) | (third >> 6)) +
            BASE64_ALPHABET.charAt(third & 0b111111);
  }
  return encoded;
}

/** Decodes standard Base64 as UTF-8, rejecting malformed Base64 and UTF-8. */
function decodeBase64(value: string): string {
  const compact = value.replace(/[\t\n\f\r ]/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    return fail("#VALUE!", "The text is not valid Base64");
  }

  const paddingAt = compact.indexOf("=");
  const unpadded = paddingAt === -1 ? compact : compact.slice(0, paddingAt);
  const givenPadding = compact.length - unpadded.length;
  const remainder = unpadded.length % 4;
  if (remainder === 1) return fail("#VALUE!", "The text is not valid Base64");
  const padding = (4 - remainder) % 4;
  if (givenPadding > 0 && (compact.length % 4 !== 0 || givenPadding !== padding)) {
    return fail("#VALUE!", "The text is not valid Base64");
  }
  const lastValue = BASE64_ALPHABET.indexOf(unpadded.at(-1) ?? "A");
  if (
    (remainder === 2 && (lastValue & 0b1111) !== 0) ||
    (remainder === 3 && (lastValue & 0b11) !== 0)
  ) {
    return fail("#VALUE!", "The text is not valid Base64");
  }

  const normalized = unpadded + "=".repeat(padding);
  const bytes = new Uint8Array((normalized.length / 4) * 3 - padding);
  let byteIndex = 0;
  for (let i = 0; i < normalized.length; i += 4) {
    const first = BASE64_ALPHABET.indexOf(normalized.charAt(i));
    const second = BASE64_ALPHABET.indexOf(normalized.charAt(i + 1));
    const third =
      normalized.charAt(i + 2) === "=" ? 0 : BASE64_ALPHABET.indexOf(normalized.charAt(i + 2));
    const fourth =
      normalized.charAt(i + 3) === "=" ? 0 : BASE64_ALPHABET.indexOf(normalized.charAt(i + 3));
    bytes[byteIndex++] = (first << 2) | (second >> 4);
    if (normalized.charAt(i + 2) !== "=")
      bytes[byteIndex++] = ((second & 0b1111) << 4) | (third >> 2);
    if (normalized.charAt(i + 3) !== "=") bytes[byteIndex++] = ((third & 0b11) << 6) | fourth;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail("#VALUE!", "The Base64 text does not contain valid UTF-8");
  }
}

/** Parses an absolute URL with a host. */
function absoluteUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail("#VALUE!", "Expected an absolute URL with a host");
  }
  if (!parsed.hostname) return fail("#VALUE!", "Expected an absolute URL with a host");
  return parsed;
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
    // One piece past the limit is enough to tell that there are too many.
    const pieces = text(value).split(at, MAX_ARRAY_CELLS + 1);
    limitCells(pieces.length);
    return array([pieces.map((piece) => parseNumber(piece) ?? piece)]);
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
  /** Replaces runs of punctuation and spaces with hyphens and removes diacritics. */
  SLUGIFY: textFunction((value) =>
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, ""),
  ),
  /** Decodes text written for a URL component. */
  DECODEURL: textFunction((value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return fail("#VALUE!", "The text is not valid URL-encoded text");
    }
  }),
  /** Encodes text as standard Base64 using UTF-8. */
  BASE64: textFunction(encodeBase64),
  /** Decodes standard Base64 text as UTF-8. */
  BASE64DECODE: textFunction(decodeBase64),
  /** The host name of an absolute URL, without its port. */
  DOMAIN: textFunction((value) => absoluteUrl(value).hostname),
  /** The path, query, and fragment of an absolute URL. */
  RELATIVE_URL: textFunction((value) => {
    const parsed = absoluteUrl(value);
    return parsed.pathname + parsed.search + parsed.hash;
  }),
  /** A zero-based, end-exclusive part of text. Negative indexes count from the end. */
  SLICE: eager(2, 3, (value, start, ...endValues) => {
    const source = text(value);
    const end = endValues.at(0);
    return sliceGraphemes(source, integer(start), end === undefined ? undefined : integer(end));
  }),
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
  LEN: textFunction(graphemeLength),
  UPPER: textFunction((value) => value.toUpperCase()),
  LOWER: textFunction((value) => value.toLowerCase()),
  /** Removes leading and trailing spaces and collapses runs of spaces between words. */
  TRIM: textFunction((value) => value.trim().replace(/ {2,}/g, " ")),
  LEFT: eager(1, 2, (value, length = 1) =>
    sliceGraphemes(text(value), 0, count(length, "The length")),
  ),
  RIGHT: eager(1, 2, (value, length = 1) => {
    const taken = count(length, "The length");
    return taken === 0 ? "" : sliceGraphemes(text(value), -taken);
  }),
  MID: eager(3, 3, (value, start, length) => {
    const from = integer(start);
    if (from < 1) fail("#VALUE!", "The start position must be 1 or more");
    return sliceGraphemes(text(value), from - 1, from - 1 + count(length, "The length"));
  }),
  /** The position of one text inside another, matching letter case. */
  FIND: eager(2, 3, (needle, haystack, start = 1) =>
    find(text(needle), text(haystack), integer(start)),
  ),
  /** The position of one text inside another, ignoring letter case. */
  SEARCH: eager(2, 3, (needle, haystack, start = 1) =>
    search(text(needle), text(haystack), integer(start)),
  ),
  /** Text before the selected occurrence of one delimiter. */
  TEXTBEFORE: textBeforeAfter(false),
  /** Text after the selected occurrence of one delimiter. */
  TEXTAFTER: textBeforeAfter(true),
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
