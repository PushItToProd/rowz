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
import {
  array,
  dateOf,
  eager,
  fail,
  grid,
  integer,
  lazy,
  limitCells,
  number,
  text,
} from "./arguments";
import type { Argument, FunctionDefinition } from "./registry";

const SECOND_MS = 1000;
const SECONDS_PER_DAY = DAY_MS / SECOND_MS;
const UNIX_EPOCH_MS = dateFromParts(1970, 1, 1).ms;
const SHEETS_EPOCH_MS = dateFromParts(1899, 12, 30).ms;

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

/** The year fraction under the Actual/Actual day-count convention. */
function actualActual(startDay: number, endDay: number): number {
  let fraction = 0;
  let day = startDay;
  while (day < endDay) {
    const year = dateParts(dateFromMs(day * DAY_MS)).year;
    const endOfYear = year === 9999 ? endDay : dayNumber(dateFromParts(year + 1, 1, 1));
    const next = Math.min(endDay, endOfYear);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    fraction += (next - day) / (leap ? 366 : 365);
    day = next;
  }
  return fraction;
}

function lastDayOfFebruary({ year, month, day }: DateParts): boolean {
  if (month !== 2) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day === (leap ? 29 : 28);
}

/** The US (NASD) 30/360 convention, returned as a non-negative fraction. */
function usThirty360(start: DateValue, end: DateValue): number {
  const from = dateParts(start);
  const to = dateParts(end);
  let startDay = from.day;
  let endDay = to.day;
  const startIsFebruaryEnd = lastDayOfFebruary(from);
  const endIsFebruaryEnd = lastDayOfFebruary(to);
  if (startDay === 31 || startIsFebruaryEnd) startDay = 30;
  if (endDay === 31 && startDay === 30) endDay = 30;
  if (endIsFebruaryEnd && startIsFebruaryEnd) endDay = 30;
  return ((to.year - from.year) * 360 + (to.month - from.month) * 30 + endDay - startDay) / 360;
}

/** A year fraction using the spreadsheet day-count conventions 0 through 4. */
function yearFraction(start: DateValue, end: DateValue, basis: number): number {
  const first = dayNumber(start);
  const last = dayNumber(end);
  if (first === last) return 0;
  const sign = first < last ? 1 : -1;
  const [from, to] = sign > 0 ? [start, end] : [end, start];
  const [fromDay, toDay] = sign > 0 ? [first, last] : [last, first];
  switch (basis) {
    case 0:
      return sign * usThirty360(from, to);
    case 1:
      return sign * actualActual(fromDay, toDay);
    case 2:
      return (sign * (toDay - fromDay)) / 360;
    case 3:
      return (sign * (toDay - fromDay)) / 365;
    case 4: {
      const startParts = dateParts(from);
      const endParts = dateParts(to);
      const days =
        (endParts.year - startParts.year) * 360 +
        (endParts.month - startParts.month) * 30 +
        Math.min(endParts.day, 30) -
        Math.min(startParts.day, 30);
      return (sign * days) / 360;
    }
    default:
      return fail("#VALUE!", "The basis must be between 0 and 4");
  }
}

/** Converts time text in 24-hour or 12-hour clock form to a fraction of a day. */
function timeValue(value: Evaluated): number {
  const input = text(value).trim();
  const match = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d)(?:\.(\d+))?)?\s*(AM|PM)?$/i.exec(input);
  if (!match) return fail("#VALUE!", `${input || "An empty cell"} is not a time`);
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0) + Number(match[4] ? `0.${match[4]}` : 0);
  const meridiem = match[5]?.toUpperCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return fail("#VALUE!", `${input} is not a time`);
    hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
  } else if (hour > 23) {
    return fail("#VALUE!", `${input} is not a time`);
  }
  return (hour * 3600 + minute * 60 + second) / SECONDS_PER_DAY;
}

/** A range with inclusive start and end dates, stored as one row of two cells. */
function dateInterval(start: DateValue, end: DateValue): Evaluated {
  limitCells(2);
  return array([[start, end]]);
}

function positiveCount(value: Evaluated, unit: string): number {
  const count = integer(value);
  if (count < 1) return fail("#VALUE!", `The number of ${unit} must be at least 1`);
  return count;
}

function requiredArgument(argument: Argument | undefined): Evaluated {
  if (argument === undefined) return fail("#ERROR!", "A required argument is missing");
  return argument();
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
  /** A year fraction under one of the spreadsheet day-count conventions. */
  YEARFRAC: eager(2, 3, (startValue, endValue, basisValue = 0) =>
    yearFraction(dateOf(startValue), dateOf(endValue), integer(basisValue)),
  ),
  /** A time of day written in 24-hour or AM/PM form, as a fraction of a day. */
  TIMEVALUE: eager(1, 1, timeValue),
  /** A Google Sheets date serial: days from 1899-12-30, including a fractional time. */
  TO_DATE: eager(1, 1, (value) => dateFromMs(SHEETS_EPOCH_MS + number(value) * DAY_MS)),
  /** The Unix timestamp of a date, in seconds. */
  UNIXTIME: eager(1, 1, (value) => (dateOf(value).ms - UNIX_EPOCH_MS) / SECOND_MS),
  /** A date from a Unix timestamp in seconds. */
  UNIX2DATE: eager(1, 1, (value) => dateFromMs(UNIX_EPOCH_MS + number(value) * SECOND_MS)),
  /** A range from the date `days - 1` days ago through today, inclusive. */
  LASTXDAYS: lazy(1, 1, ([countArg], context) => {
    const today = startOfDay(dateFromMs(context.now?.() ?? Date.now()));
    const days = positiveCount(requiredArgument(countArg), "days");
    return dateInterval(dateFromMs(today.ms - (days - 1) * DAY_MS), today);
  }),
  /** A range of the last `weeks` seven-day periods through today, inclusive. */
  LASTXWEEKS: lazy(1, 1, ([countArg], context) => {
    const today = startOfDay(dateFromMs(context.now?.() ?? Date.now()));
    const days = positiveCount(requiredArgument(countArg), "weeks") * 7;
    return dateInterval(dateFromMs(today.ms - (days - 1) * DAY_MS), today);
  }),
  /** A range from one day after the date `months` calendar months ago through today, inclusive. */
  LASTXMONTHS: lazy(1, 1, ([countArg], context) => {
    const today = startOfDay(dateFromMs(context.now?.() ?? Date.now()));
    const months = positiveCount(requiredArgument(countArg), "months");
    const start = addMonths(today, -months);
    return dateInterval(dateFromMs(start.ms + DAY_MS), today);
  }),
  /** An inclusive range from the given start date through the end date. */
  DATEINTERVAL: eager(2, 2, (startValue, endValue) =>
    dateInterval(dateOf(startValue), dateOf(endValue)),
  ),

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
