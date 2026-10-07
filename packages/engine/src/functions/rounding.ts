/** How to handle the discarded part of a decimal number. */
export type RoundingMode = "halfAwayFromZero" | "awayFromZero" | "towardZero";

interface Decimal {
  negative: boolean;
  coefficient: bigint;
  exponent: number;
}

type RoundedDecimal = Decimal;

function parseDecimal(value: number, powerOfTen = 0): Decimal {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw new Error(`Cannot parse finite number ${text}`);

  const [, sign = "", whole = "0", fraction = "", exponent = "0"] = match;
  const digits = `${whole}${fraction}`.replace(/^0+/, "") || "0";
  return {
    negative: sign === "-" || Object.is(value, -0),
    coefficient: BigInt(digits),
    exponent: Number(exponent) - fraction.length + powerOfTen,
  };
}

function decimalPower(power: number): bigint {
  return 10n ** BigInt(power);
}

/**
 * Rounds the shortest decimal representation of a number at the given place.
 * The returned parts still describe a decimal exactly; no binary scaling is
 * used to decide which side of a rounding boundary the value falls on.
 */
function roundedDecimal(
  value: number,
  places: number,
  mode: RoundingMode,
  powerOfTen = 0,
): RoundedDecimal {
  const decimal = parseDecimal(value, powerOfTen);
  if (decimal.coefficient === 0n) return decimal;

  const shift = decimal.exponent + places;
  if (shift >= 0) return decimal;

  const discardedPlaces = -shift;
  const digits = decimal.coefficient.toString();
  let rounded = 0n;
  let hasRemainder = true;
  let atLeastHalf = false;

  if (discardedPlaces <= digits.length) {
    const divisor = decimalPower(discardedPlaces);
    const quotient = decimal.coefficient / divisor;
    const remainder = decimal.coefficient % divisor;
    rounded = quotient;
    hasRemainder = remainder !== 0n;
    atLeastHalf = remainder * 2n >= divisor;
  }

  const increase =
    mode === "awayFromZero" ? hasRemainder : mode === "halfAwayFromZero" && atLeastHalf;
  if (increase) rounded += 1n;

  return { negative: decimal.negative, coefficient: rounded, exponent: -places };
}

function exponentText(exponent: number): string {
  return BigInt(exponent).toString();
}

function decimalText(decimal: RoundedDecimal): string {
  const sign = decimal.negative ? "-" : "";
  return `${sign}${decimal.coefficient.toString()}e${exponentText(decimal.exponent)}`;
}

/** Rounds a finite number's shortest decimal representation and returns a Number. */
export function roundDecimal(
  value: number,
  places: number,
  mode: RoundingMode,
  powerOfTen = 0,
): number {
  return Number(decimalText(roundedDecimal(value, places, mode, powerOfTen)));
}

/**
 * Rounds a number's shortest decimal representation and writes exactly the
 * requested nonnegative number of decimal places. `powerOfTen` scales the
 * decimal value before rounding, as a percent number format does.
 */
export function roundDecimalToFixed(
  value: number,
  places: number,
  mode: RoundingMode,
  powerOfTen = 0,
): string {
  const decimal = roundedDecimal(value, places, mode, powerOfTen);
  const scaledExponent = decimal.exponent + places;
  const scaled = decimal.coefficient * decimalPower(scaledExponent);
  const digits = scaled.toString().padStart(places + 1, "0");
  const sign = decimal.negative ? "-" : "";
  if (places === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

function quotientParts(
  value: Decimal,
  divisor: Decimal,
): {
  negative: boolean;
  quotient: bigint;
  remainder: bigint;
  denominator: bigint;
} {
  let numerator = value.coefficient;
  let denominator = divisor.coefficient;
  const shift = value.exponent - divisor.exponent;
  if (shift >= 0) numerator *= decimalPower(shift);
  else denominator *= decimalPower(-shift);

  return {
    negative: value.negative !== divisor.negative,
    quotient: numerator / denominator,
    remainder: numerator % denominator,
    denominator,
  };
}

function multipleResult(coefficient: bigint, exponent: number, negative: boolean): number {
  return Number(`${negative ? "-" : ""}${coefficient.toString()}e${exponentText(exponent)}`);
}

/** Rounds to a signed multiple using exact decimal quotient and product arithmetic. */
export function roundToMultiple(
  value: number,
  significance: number,
  direction: "floor" | "ceil",
): number {
  if (significance === 0) return 0;

  const decimal = parseDecimal(value);
  const step = parseDecimal(significance);
  if (decimal.coefficient === 0n) return Object.is(value, -0) ? -0 : 0;

  const ratio = quotientParts(decimal, step);
  const hasRemainder = ratio.remainder !== 0n;
  let quotient = ratio.quotient;
  if (ratio.negative) {
    if (direction === "floor" && hasRemainder) quotient += 1n;
    quotient = -quotient;
  } else if (direction === "ceil" && hasRemainder) {
    quotient += 1n;
  }

  const negative = quotient < 0n !== step.negative;
  const result = (quotient < 0n ? -quotient : quotient) * step.coefficient;
  return multipleResult(result, step.exponent, negative);
}

/** Rounds to the nearest absolute multiple, with halves away from zero. */
export function roundToNearestMultiple(value: number, multiple: number): number {
  if (multiple === 0) return 0;

  const decimal = parseDecimal(value);
  const step = parseDecimal(multiple);
  const ratio = quotientParts({ ...decimal, negative: false }, { ...step, negative: false });
  let quotient = ratio.quotient;
  if (ratio.remainder * 2n >= ratio.denominator) quotient += 1n;

  return multipleResult(quotient * step.coefficient, step.exponent, decimal.negative);
}
