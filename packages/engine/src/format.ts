import { dateParts, type DateValue } from "./dates";

/**
 * Formats for `TEXT`, in the notation other spreadsheets use.
 *
 * A number format has one run of digit placeholders, such as `#,##0.00`, with
 * optional text around it: `$#,##0.00`, `0.0%`, `0 "items"`. `0` always shows
 * a digit and `#` shows one only when needed. A comma groups thousands. A `%`
 * multiplies by 100.
 *
 * A date format is built from `yyyy yy mmmm mmm mm m dddd ddd dd d hh h ss s`
 * and `AM/PM`. `m` means minutes next to hours or seconds and months elsewhere.
 */
export class FormatError extends Error {}

const PLACEHOLDERS = /[#0][#0,]*(?:\.[#0]+)?|\.[#0]+/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The most decimals a number can be written with. */
const MAX_DECIMALS = 100;

/** The first of the private-use characters that stand for quoted text while a number format is read. */
const HOLDER = 0xe000;

/** Removes the quotes around literal text in a format. */
function literal(text: string): string {
  return text.replace(/"([^"]*)"/g, "$1");
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+$)/g, ",");
}

/** Writes a number in fixed decimal notation without exponent notation. */
function fixed(value: number, decimals: number): string {
  if (!Number.isInteger(value)) return value.toFixed(decimals);

  // Large integers may be unsafe to represent exactly, so preserve JavaScript's
  // shortest round-tripping decimal form instead of exposing binary digits.
  const shown = value.toString();
  const match = /^(\d+)(?:\.(\d+))?e\+(\d+)$/.exec(shown);
  const [, whole = "", fraction = "", exponent = "0"] = match ?? [];
  const digits = match ? (whole + fraction).padEnd(whole.length + Number(exponent), "0") : shown;
  return decimals === 0 ? digits : `${digits}.${"0".repeat(decimals)}`;
}

export function formatNumber(value: number, format: string): string {
  // Quoted text is set aside first, so a digit or `%` inside it is not read as
  // part of the format. Each piece is held by one private-use character.
  const quoted: string[] = [];
  const bare = format.replace(/"([^"]*)"/g, (_, text: string) =>
    String.fromCharCode(HOLDER + quoted.push(text) - 1),
  );
  const found = PLACEHOLDERS.exec(bare);
  if (!found) throw new FormatError(`"${format}" has no 0 or # to show the number`);
  const restore = (text: string): string =>
    Array.from(text, (char) => quoted[char.charCodeAt(0) - HOLDER] ?? char).join("");
  const before = bare.slice(0, found.index);
  const after = bare.slice(found.index + found[0].length);

  const [whole = "", fraction = ""] = found[0].split(".");
  const maxDecimals = fraction.length;
  if (maxDecimals > MAX_DECIMALS) {
    throw new FormatError(`A format can show at most ${String(MAX_DECIMALS)} decimals`);
  }
  const minDecimals = fraction.lastIndexOf("0") + 1;
  const minWhole = whole.replaceAll(/[#,]/g, "").length;

  const scaled = (before + after).includes("%") ? value * 100 : value;
  if (!Number.isFinite(scaled))
    throw new FormatError("The number is too large to show as a percentage");
  const magnitude = Math.abs(scaled);
  const shifted = magnitude * 10 ** maxDecimals;
  // Half away from zero, as ROUND does. A number too large to shift has no decimals to round.
  const rounded = Number.isInteger(magnitude)
    ? magnitude
    : Number.isFinite(shifted)
      ? Math.round(shifted) / 10 ** maxDecimals
      : magnitude;
  const [digits = "0", decimals = ""] = fixed(rounded, maxDecimals).split(".");

  const trimmed = decimals.replace(/0+$/, "").padEnd(minDecimals, "0");
  const padded = (digits === "0" ? "" : digits).padStart(minWhole, "0");
  const shownWhole = whole.includes(",") ? group(padded) : padded;
  const sign = value < 0 && rounded !== 0 ? "-" : "";
  const point = trimmed === "" ? "" : ".";
  return `${sign}${restore(before)}${shownWhole}${point}${trimmed}${restore(after)}`;
}

const DATE_TOKEN = /"[^"]*"|am\/pm|y+|m+|d+|h+|s+|./gi;

export function formatDateAs(value: DateValue, format: string): string {
  const parts = dateParts(value);
  const tokens = format.match(DATE_TOKEN) ?? [];
  const kindOf = (token: string | undefined): string =>
    token !== undefined && /^[ymdhs]+$/i.test(token) ? (token[0] ?? "").toLowerCase() : "";
  // The nearest date part on either side decides whether `m` is a month or minutes.
  const neighbor = (from: number, step: number): string => {
    for (let index = from + step; index >= 0 && index < tokens.length; index += step) {
      const kind = kindOf(tokens[index]);
      if (kind !== "") return kind;
    }
    return "";
  };
  const twelveHour = tokens.some((token) => token.toLowerCase() === "am/pm");
  const hour = twelveHour ? parts.hour % 12 || 12 : parts.hour;
  const pad = (number: number, width: number): string => String(number).padStart(width, "0");

  return tokens
    .map((token, index) => {
      if (token.startsWith('"')) return literal(token);
      if (token.toLowerCase() === "am/pm") {
        const half = parts.hour < 12 ? "AM" : "PM";
        return token === token.toLowerCase() ? half.toLowerCase() : half;
      }
      const width = token.length;
      switch (kindOf(token)) {
        case "y":
          return width <= 2 ? pad(parts.year % 100, 2) : pad(parts.year, 4);
        case "m": {
          const minutes = width <= 2 && (neighbor(index, -1) === "h" || neighbor(index, 1) === "s");
          if (minutes) return pad(parts.minute, width);
          const name = MONTHS[parts.month - 1] ?? "";
          if (width >= 4) return name;
          return width === 3 ? name.slice(0, 3) : pad(parts.month, width);
        }
        case "d": {
          const name = WEEKDAYS[parts.weekday - 1] ?? "";
          if (width >= 4) return name;
          return width === 3 ? name.slice(0, 3) : pad(parts.day, width);
        }
        case "h":
          return pad(hour, Math.min(width, 2));
        case "s":
          return pad(parts.second, Math.min(width, 2));
        default:
          return token;
      }
    })
    .join("");
}
