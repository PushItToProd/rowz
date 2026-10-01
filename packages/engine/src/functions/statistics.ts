import { identityOf, type Evaluated } from "../values";
import { boolean, eager, fail, grid, items, number, numbers, scalar } from "./arguments";
import type { FunctionDefinition } from "./registry";

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** The sum of squared distances from the mean. */
function squaredDeviations(values: readonly number[]): number {
  const center = mean(values);
  return values.reduce((total, value) => total + (value - center) ** 2, 0);
}

/**
 * Variance. A sample divides by one less than the count, because the mean was
 * estimated from the same values. A whole population divides by the count.
 */
function variance(values: readonly number[], sample: boolean): number {
  const divisor = sample ? values.length - 1 : values.length;
  return divisor < 1
    ? fail("#DIV/0!", sample ? "A sample needs at least two numbers" : "No numbers were given")
    : squaredDeviations(values) / divisor;
}

function spread(sample: boolean, root: boolean): FunctionDefinition {
  return eager(1, Infinity, (...values) => {
    const result = variance(numbers(values), sample);
    return root ? Math.sqrt(result) : result;
  });
}

/** The value a fraction of the way through sorted numbers, between neighbors when it falls between two. */
function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) fail("#VALUE!", "No numbers were given");
  if (fraction < 0 || fraction > 1) fail("#VALUE!", "The fraction must be between 0 and 1");
  const sorted = values.toSorted((a, b) => a - b);
  const position = fraction * (sorted.length - 1);
  const below = Math.floor(position);
  const [low = 0, high = low] = [sorted[below], sorted[below + 1]];
  return low + (high - low) * (position - below);
}

/** The pairs of numbers at the same positions of two ranges. A pair with a cell that is not a number is skipped. */
function pairs(first: Evaluated, second: Evaluated): [number, number][] {
  const [a, b] = [grid(first).flat(), grid(second).flat()];
  if (a.length !== b.length) fail("#VALUE!", "The two ranges must be the same size");
  return a.flatMap((value, index): [number, number][] => {
    const other = b[index];
    return typeof value === "number" && typeof other === "number" ? [[value, other]] : [];
  });
}

function covariance(both: readonly [number, number][], sample: boolean): number {
  const divisor = sample ? both.length - 1 : both.length;
  if (divisor < 1) {
    fail(
      "#DIV/0!",
      sample ? "A sample needs at least two pairs of numbers" : "No pairs of numbers were given",
    );
  }
  const [meanX, meanY] = [mean(both.map(([x]) => x)), mean(both.map(([, y]) => y))];
  return both.reduce((total, [x, y]) => total + (x - meanX) * (y - meanY), 0) / divisor;
}

/** The straight line through pairs of numbers that leaves the least squared distance to them. */
function fit(ys: Evaluated, xs: Evaluated): { slope: number; intercept: number } {
  // `pairs` gives each pair in the order of its arguments: y first here.
  const both = pairs(ys, xs);
  if (both.length < 2) fail("#DIV/0!", "A line needs at least two pairs of numbers");
  const [meanY, meanX] = [mean(both.map(([y]) => y)), mean(both.map(([, x]) => x))];
  const spreadX = both.reduce((total, [, x]) => total + (x - meanX) ** 2, 0);
  if (spreadX === 0) fail("#DIV/0!", "The x values are all the same");
  const slope = both.reduce((total, [y, x]) => total + (x - meanX) * (y - meanY), 0) / spreadX;
  return { slope, intercept: meanY - slope * meanX };
}

export const statisticsFunctions: Record<string, FunctionDefinition> = {
  /** The number that occurs most often. Of several that tie, the one that appears first. */
  MODE: eager(1, Infinity, (...values) => {
    const counts = new Map<number, number>();
    for (const value of numbers(values)) counts.set(value, (counts.get(value) ?? 0) + 1);
    const [most] = [...counts].sort(([, a], [, b]) => b - a);
    return most && most[1] > 1 ? most[0] : fail("#N/A", "No number occurs more than once");
  }),
  STDEV: spread(true, true),
  STDEVP: spread(false, true),
  VAR_S: spread(true, false),
  VAR_P: spread(false, false),
  PERCENTILE: eager(2, 2, (range, fraction) => percentile(numbers([range]), number(fraction))),
  QUARTILE: eager(2, 2, (range, quarter) => {
    const which = number(quarter);
    if (!Number.isInteger(which)) fail("#VALUE!", "The quartile must be 0, 1, 2, 3, or 4");
    return percentile(numbers([range]), which / 4);
  }),

  /** The position of a number among the numbers of a range, counting from the largest unless `ascending`. */
  RANK: eager(2, 3, (value, range, ascending = false) => {
    const wanted = number(value);
    const among = numbers([range]);
    if (!among.includes(wanted)) fail("#N/A", `${String(wanted)} is not in the range`);
    const ahead = boolean(ascending)
      ? among.filter((other) => other < wanted)
      : among.filter((other) => other > wanted);
    return ahead.length + 1;
  }),

  /** How closely two ranges move together, from -1 to 1. */
  CORREL: eager(2, 2, (first, second) => {
    const both = pairs(first, second);
    const [xs, ys] = [both.map(([x]) => x), both.map(([, y]) => y)];
    if (both.length < 2) fail("#DIV/0!", "CORREL needs at least two pairs of numbers");
    const [meanX, meanY] = [mean(xs), mean(ys)];
    const together = both.reduce((total, [x, y]) => total + (x - meanX) * (y - meanY), 0);
    const scale = Math.sqrt(squaredDeviations(xs) * squaredDeviations(ys));
    return scale === 0 ? fail("#DIV/0!", "One of the ranges does not vary") : together / scale;
  }),

  /** How much two ranges vary together, for a sample or for a whole population. */
  COVARIANCE_S: eager(2, 2, (first, second) => covariance(pairs(first, second), true)),
  COVARIANCE_P: eager(2, 2, (first, second) => covariance(pairs(first, second), false)),

  /** The slope of the straight line that best fits ys against xs. */
  SLOPE: eager(2, 2, (ys, xs) => fit(ys, xs).slope),
  /** Where that line crosses x = 0. */
  INTERCEPT: eager(2, 2, (ys, xs) => fit(ys, xs).intercept),
  /** The y that line gives for an x. */
  FORECAST: eager(3, 3, (x, ys, xs) => {
    const { slope, intercept } = fit(ys, xs);
    return intercept + slope * number(x);
  }),

  /** How many different values there are. Empty cells are not counted, and text is compared without regard to case. */
  COUNTUNIQUE: eager(1, Infinity, (...values) => {
    const seen = new Set<string>();
    for (const { value } of items(values)) {
      const single = scalar(value);
      if (single !== null) seen.add(identityOf(single));
    }
    return seen.size;
  }),

  /** How many cells are empty. A cell holding empty text counts. */
  COUNTBLANK: eager(
    1,
    Infinity,
    (...values) => items(values).filter(({ value }) => value === null || value === "").length,
  ),
};
