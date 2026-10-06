import type { Evaluated } from "../values";
import { eager, fail, number, numbers } from "./arguments";
import type { FunctionDefinition } from "./registry";
import { compensatedSum } from "./sum";

/**
 * Loan and savings arithmetic, with the sign convention other spreadsheets
 * use: money paid out is negative and money received is positive. `type` is
 * 0 when payments fall at the end of each period and 1 when at the start.
 */

/** 1 for payments at the start of each period, 0 for the end. */
function timing(type: Evaluated | undefined): number {
  return type !== undefined && number(type) !== 0 ? 1 : 0;
}

/**
 * The value at the end of `periods` of a present value and a payment each
 * period, at a rate per period. The other functions are this equation solved
 * for a different term.
 */
function futureValue(
  rate: number,
  periods: number,
  payment: number,
  present: number,
  due: number,
): number {
  if (rate === 0) return -(present + payment * periods);
  const growth = (1 + rate) ** periods;
  return -(present * growth + (payment * (1 + rate * due) * (growth - 1)) / rate);
}

const MAX_ITERATIONS = 100;
const TOLERANCE = 1e-10;

/**
 * Finds where a function crosses zero by Newton's method with a numeric
 * slope, starting from a guess. Fails when it does not settle.
 */
function solve(f: (x: number) => number, guess: number, what: string): number {
  let x = guess;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const y = f(x);
    if (Math.abs(y) < TOLERANCE) return x;
    const step = Math.max(Math.abs(x), 1) * 1e-7;
    const slope = (f(x + step) - y) / step;
    if (!Number.isFinite(slope) || slope === 0) break;
    const next = x - y / slope;
    // A rate at or below -100% has no meaning, so a step past it is cut short.
    x = next <= -1 ? (x - 1) / 2 : next;
    if (!Number.isFinite(x)) break;
  }
  return fail("#VALUE!", `${what} could not be found. Try a different guess`);
}

function netPresentValue(rate: number, flows: readonly number[], firstPeriod: number): number {
  return compensatedSum(flows.map((flow, index) => flow / (1 + rate) ** (index + firstPeriod)));
}

export const financialFunctions: Record<string, FunctionDefinition> = {
  /** The payment each period that pays off a loan, or reaches a savings goal. */
  PMT: eager(3, 5, (rate, periods, present, future = 0, type) => {
    const [r, n, pv, fv, due] = [
      number(rate),
      number(periods),
      number(present),
      number(future),
      timing(type),
    ];
    if (n === 0) fail("#VALUE!", "The number of periods cannot be 0");
    if (r === 0) return -(pv + fv) / n;
    const growth = (1 + r) ** n;
    return -(r * (pv * growth + fv)) / ((1 + r * due) * (growth - 1));
  }),

  /** What savings or a loan will be worth after a number of periods. */
  FV: eager(3, 5, (rate, periods, payment, present = 0, type) =>
    futureValue(number(rate), number(periods), number(payment), number(present), timing(type)),
  ),

  /** What a series of future payments is worth today. */
  PV: eager(3, 5, (rate, periods, payment, future = 0, type) => {
    const [r, n, pmt, fv, due] = [
      number(rate),
      number(periods),
      number(payment),
      number(future),
      timing(type),
    ];
    if (r === 0) return -(fv + pmt * n);
    const growth = (1 + r) ** n;
    return -(fv + (pmt * (1 + r * due) * (growth - 1)) / r) / growth;
  }),

  /** How many periods it takes to pay off a loan or reach a savings goal. */
  NPER: eager(3, 5, (rate, payment, present, future = 0, type) => {
    const [r, pmt, pv, fv, due] = [
      number(rate),
      number(payment),
      number(present),
      number(future),
      timing(type),
    ];
    if (r === 0) return pmt === 0 ? fail("#DIV/0!") : -(pv + fv) / pmt;
    const adjusted = pmt * (1 + r * due);
    const ratio = (adjusted - fv * r) / (adjusted + pv * r);
    if (!(ratio > 0)) fail("#VALUE!", "These payments never reach the goal");
    return Math.log(ratio) / Math.log(1 + r);
  }),

  /** The interest rate per period of a loan or an investment. */
  RATE: eager(3, 6, (periods, payment, present, future = 0, type, guess = 0.1) => {
    const [n, pmt, pv, fv, due] = [
      number(periods),
      number(payment),
      number(present),
      number(future),
      timing(type),
    ];
    if (n <= 0) fail("#VALUE!", "The number of periods must be above 0");
    return solve((rate) => futureValue(rate, n, pmt, pv, due) - fv, number(guess), "The rate");
  }),

  /** What a series of cash flows, one at the end of each period, is worth today at a discount rate. */
  NPV: eager(2, Infinity, (rate, ...flows) => {
    const r = number(rate);
    if (r === -1) fail("#DIV/0!");
    return netPresentValue(r, numbers(flows), 1);
  }),

  /** The rate of return of a series of cash flows: the discount rate at which they are worth nothing today. */
  IRR: eager(1, 2, (flows, guess = 0.1) => {
    const values = numbers([flows]);
    if (!values.some((value) => value > 0) || !values.some((value) => value < 0)) {
      fail("#VALUE!", "IRR needs at least one payment out and one payment in");
    }
    return solve((rate) => netPresentValue(rate, values, 0), number(guess), "The rate of return");
  }),
};
