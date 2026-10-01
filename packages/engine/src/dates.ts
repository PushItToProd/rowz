import { fail } from "./errors";

/**
 * A date, with or without a time of day. It is a moment on a clock on the
 * wall, in no time zone: the date and time are stored as written, counted in
 * milliseconds from the start of 1970.
 */
export interface DateValue {
  kind: "date";
  ms: number;
}

export const DAY_MS = 86_400_000;
const SECOND_MS = 1000;

// The calendar runs from year 0 through year 9999: the years `formatDate`
// writes and `parseDate` reads back.
const FIRST_MS = -62_167_219_200_000;
const END_MS = 253_402_300_800_000;

/** Makes a date, and fails for a moment outside the calendar, so that every `DateValue` has calendar parts. */
export function dateFromMs(ms: number): DateValue {
  const rounded = Math.round(ms);
  // Written so that a moment that is not a number fails too.
  if (!(rounded >= FIRST_MS && rounded < END_MS)) {
    fail("#VALUE!", "The date is outside the years 0 to 9999");
  }
  return { kind: "date", ms: rounded };
}

export function isDate(value: unknown): value is DateValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "date";
}

export interface DateParts {
  year: number;
  /** 1 for January. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 for Sunday through 7 for Saturday. */
  weekday: number;
}

export function dateParts({ ms }: DateValue): DateParts {
  // The UTC fields of a JavaScript date are plain calendar arithmetic, with no time zone applied.
  const clock = new Date(ms);
  return {
    year: clock.getUTCFullYear(),
    month: clock.getUTCMonth() + 1,
    day: clock.getUTCDate(),
    hour: clock.getUTCHours(),
    minute: clock.getUTCMinutes(),
    second: clock.getUTCSeconds(),
    weekday: clock.getUTCDay() + 1,
  };
}

function msFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const clock = new Date(0);
  // setUTCFullYear takes years below 100 as written. Date.UTC would read them as 19xx.
  clock.setUTCFullYear(year, month - 1, day);
  clock.setUTCHours(hour, minute, second, 0);
  return clock.getTime();
}

/**
 * Builds a date from calendar parts. A part outside its usual range carries
 * over, so month 13 is January of the next year and day 0 is the last day of
 * the month before.
 */
export function dateFromParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): DateValue {
  return dateFromMs(msFromParts(year, month, day, hour, minute, second));
}

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Reads a date written as `2026-09-30`, optionally followed by a time as
 * `14:05` or `14:05:09`. Other ways of writing dates are ambiguous between
 * countries and are not read.
 */
export function parseDate(text: string): DateValue | undefined {
  const match = DATE_TEXT.exec(text.trim());
  if (!match) return undefined;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match
    .slice(1)
    // The time parts are missing from the match when no time was written.
    .map((part: string | undefined) => Number(part ?? 0));
  const ms = msFromParts(year, month, day, hour, minute, second);
  // A date that does not exist, such as February 30, would have carried over into another.
  const read = dateParts({ kind: "date", ms });
  const exists =
    read.year === year &&
    read.month === month &&
    read.day === day &&
    read.hour === hour &&
    read.minute === minute &&
    read.second === second;
  return exists ? dateFromMs(ms) : undefined;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** Writes a date the way `parseDate` reads it. The time is left out at midnight, and seconds when they are zero. */
export function formatDate(value: DateValue): string {
  const { year, month, day, hour, minute, second } = dateParts(value);
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  if (value.ms % DAY_MS === 0) return date;
  const time = `${pad(hour)}:${pad(minute)}`;
  return value.ms % (60 * SECOND_MS) === 0 ? `${date} ${time}` : `${date} ${time}:${pad(second)}`;
}

/** The date with its time of day removed. */
export function startOfDay({ ms }: DateValue): DateValue {
  return dateFromMs(Math.floor(ms / DAY_MS) * DAY_MS);
}
