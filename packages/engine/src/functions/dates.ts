import {
  DAY_MS,
  dateFromMs,
  dateFromParts,
  dateParts,
  startOfDay,
  type DateParts,
  type DateValue,
} from "../dates";
import { dateOf, eager, integer, lazy } from "./arguments";
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

export const dateFunctions: Record<string, FunctionDefinition> = {
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
