import {
  DAY_MS,
  dateFromMs,
  dateFromParts,
  dateParts,
  startOfDay,
  type DateParts,
  type DateValue,
} from "../dates";
import { isDate } from "../dates";
import type { Evaluated } from "../values";
import { dateOf, eager, fail, grid, integer, lazy, text } from "./arguments";
import type { FunctionDefinition } from "./registry";

const SECOND_MS = 1000;

/** Defines a function that gives one calendar part of a date. */
function part(name: keyof DateParts): FunctionDefinition {
  return eager(1, 1, (value) => dateParts(dateOf(value))[name]);
}

/** The same day of the month, some months later. A day the month lacks becomes that month's last day. */
function addMonths(value: DateValue, months: number): DateValue {
  const { year, month, day, hour, minute, second } = dateParts(value);
  const lastDay = dateParts(dateFromParts(year, month + months + 1, 0)).day;
  return dateFromParts(year, month + months, Math.min(day, lastDay), hour, minute, second);
}

/** The number of whole days since the start of the calendar a `DateValue` counts from. */
function dayNumber(value: DateValue): number {
  return Math.floor(value.ms / DAY_MS);
}

/** How many whole months lie between two dates. */
function monthsBetween(start: DateValue, end: DateValue): number {
  const [from, to] = [dateParts(start), dateParts(end)];
  const months = (to.year - from.year) * 12 + (to.month - from.month);
  return addMonths(startOfDay(start), months).ms > startOfDay(end).ms ? months - 1 : months;
}

/** The day numbers of the dates in an optional range of holidays. Cells that are not dates are skipped. */
function holidays(range: Evaluated | undefined): Set<number> {
  if (range === undefined) return new Set();
  return new Set(grid(range).flat().filter(isDate).map(dayNumber));
}

/** Whether a day is Monday to Friday and not a holiday. */
function isWorkday(day: number, off: ReadonlySet<number>): boolean {
  const weekday = dateParts(dateFromMs(day * DAY_MS)).weekday;
  return weekday !== 1 && weekday !== 7 && !off.has(day);
}

// Far more working days than any real schedule, and few enough to count one by one.
const MAX_WORKDAYS = 100_000;

/** The week of the year under ISO 8601: weeks start on Monday, and week 1 holds the year's first Thursday. */
function isoWeek(value: DateValue): number {
  const day = dayNumber(value);
  const sinceMonday = (dateParts(value).weekday + 5) % 7;
  const thursday = dateFromMs((day - sinceMonday + 3) * DAY_MS);
  const newYear = dayNumber(dateFromParts(dateParts(thursday).year, 1, 1));
  return Math.floor((dayNumber(thursday) - newYear) / 7) + 1;
}

export const dateFunctions: Record<string, FunctionDefinition> = {
  /** A time of day as a fraction of a day, so that adding it to a date sets the time. */
  TIME: eager(
    3,
    3,
    (hour, minute, second) =>
      (integer(hour) * 3600 + integer(minute) * 60 + integer(second)) / (DAY_MS / SECOND_MS),
  ),

  /**
   * The whole years (`"Y"`), months (`"M"`), or days (`"D"`) from one date to
   * a later one. `"YM"` gives the months left over after the whole years,
   * and `"MD"` the days left over after the whole months.
   */
  DATEDIF: eager(3, 3, (startValue, endValue, unit) => {
    const [start, end] = [dateOf(startValue), dateOf(endValue)];
    if (dayNumber(end) < dayNumber(start)) fail("#VALUE!", "The end date is before the start date");
    const months = monthsBetween(start, end);
    switch (text(unit).toUpperCase()) {
      case "Y":
        return Math.floor(months / 12);
      case "M":
        return months;
      case "D":
        return dayNumber(end) - dayNumber(start);
      case "YM":
        return months % 12;
      case "MD":
        return dayNumber(end) - dayNumber(addMonths(startOfDay(start), months));
      default:
        return fail("#VALUE!", 'The unit must be "Y", "M", "D", "YM", or "MD"');
    }
  }),

  /** The week of the year, where weeks start on Sunday and January 1 is in week 1. */
  WEEKNUM: eager(1, 1, (value) => {
    const date = dateOf(value);
    const newYear = dateFromParts(dateParts(date).year, 1, 1);
    const offset = dateParts(newYear).weekday - 1;
    return Math.floor((dayNumber(date) - dayNumber(newYear) + offset) / 7) + 1;
  }),
  ISOWEEKNUM: eager(1, 1, (value) => isoWeek(dateOf(value))),

  /** The date a number of working days after a date, skipping weekends and holidays. A negative number counts back. */
  WORKDAY: eager(2, 3, (start, days, off) => {
    const skipped = holidays(off);
    let remaining = integer(days);
    if (Math.abs(remaining) > MAX_WORKDAYS) fail("#VALUE!", "That is too many days to count");
    const step = Math.sign(remaining);
    let day = dayNumber(dateOf(start));
    while (remaining !== 0) {
      day += step;
      if (isWorkday(day, skipped)) remaining -= step;
    }
    return dateFromMs(day * DAY_MS);
  }),

  /** How many working days there are from one date to another, counting both. */
  NETWORKDAYS: eager(2, 3, (start, end, off) => {
    const skipped = holidays(off);
    const [first, last] = [dayNumber(dateOf(start)), dayNumber(dateOf(end))];
    const [from, to] = [Math.min(first, last), Math.max(first, last)];
    if (to - from > MAX_WORKDAYS * 2) fail("#VALUE!", "The dates are too far apart to count");
    let count = 0;
    for (let day = from; day <= to; day += 1) if (isWorkday(day, skipped)) count += 1;
    return first <= last ? count : -count;
  }),

  /** Today's date on the user's clock. */
  TODAY: lazy(0, 0, (_args, context) => startOfDay(dateFromMs(context.now?.() ?? Date.now()))),
  /** The date and time now on the user's clock, to the second. */
  NOW: lazy(0, 0, (_args, context) => {
    const now = context.now?.() ?? Date.now();
    return dateFromMs(Math.floor(now / SECOND_MS) * SECOND_MS);
  }),

  /** A date from a year, month, and day. A month or day outside its range carries over. */
  DATE: eager(3, 3, (year, month, day) =>
    dateFromParts(integer(year), integer(month), integer(day)),
  ),
  /** Reads text written as a date, such as `"2026-09-30"`. */
  DATEVALUE: eager(1, 1, (value) => dateOf(value)),

  YEAR: part("year"),
  MONTH: part("month"),
  DAY: part("day"),
  HOUR: part("hour"),
  MINUTE: part("minute"),
  SECOND: part("second"),
  /** The day of the week as a number, from 1 for Sunday to 7 for Saturday. */
  WEEKDAY: part("weekday"),

  /** How many days the first date is after the second, counting calendar days and ignoring times. */
  DAYS: eager(2, 2, (end, start) =>
    Math.round((startOfDay(dateOf(end)).ms - startOfDay(dateOf(start)).ms) / DAY_MS),
  ),
  /** The date a number of months after a date. */
  EDATE: eager(2, 2, (value, months) => addMonths(dateOf(value), integer(months))),
  /** The last day of the month a number of months after a date. */
  EOMONTH: eager(2, 2, (value, months) => {
    const { year, month } = dateParts(dateOf(value));
    return dateFromParts(year, month + integer(months) + 1, 0);
  }),
};
