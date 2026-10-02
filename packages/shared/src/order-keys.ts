/** ASCII order is also the order used by PostgreSQL's C collation. */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = BigInt(DIGITS.length);
export const MAX_ORDER_KEY_LENGTH = 64;

function encodeInteger(value: bigint): string {
  const negative = value < 0n;
  let magnitude = negative ? -value - 1n : value;
  let width = 1;
  let capacity = BASE;
  while (magnitude >= capacity) {
    magnitude -= capacity;
    width++;
    capacity *= BASE;
  }
  if (width > 26) throw new RangeError("Order key integer exhausted");
  let remaining = negative ? capacity - 1n - magnitude : magnitude;
  let digits = "";
  for (let i = 0; i < width; i++) {
    digits = DIGITS.charAt(Number(remaining % BASE)) + digits;
    remaining /= BASE;
  }
  return String.fromCharCode((negative ? 91 : 96) + (negative ? -width : width)) + digits;
}

function splitKey(key: string): { integer: string; value: bigint; fraction: string } {
  const head = key.charCodeAt(0);
  const negative = head >= 65 && head <= 90;
  const width = negative ? 91 - head : head >= 97 && head <= 122 ? head - 96 : 0;
  if (width === 0 || key.length < width + 1) throw new RangeError("Invalid order key");
  const integer = key.slice(0, width + 1);
  let value = 0n;
  for (const digit of key.slice(1)) {
    if (!DIGITS.includes(digit)) throw new RangeError("Invalid order key");
  }
  for (const digit of integer.slice(1)) value = value * BASE + BigInt(DIGITS.indexOf(digit));
  const fraction = key.slice(width + 1);
  if (fraction.endsWith("0")) throw new RangeError("Order key fraction ends in zero");
  let offset = 0n;
  for (let i = 1; i < width; i++) offset += BASE ** BigInt(i);
  value = negative ? value - BASE ** BigInt(width) - offset : value + offset;
  if (encodeInteger(value) !== integer) throw new RangeError("Noncanonical order key integer");
  return { integer, value, fraction };
}

/** A fractional suffix strictly between two suffixes; null is an unbounded end. */
function midpoint(before: string, after: string | null): string {
  let prefix = "";
  let offset = 0;
  for (;;) {
    const low = offset < before.length ? DIGITS.indexOf(before.charAt(offset)) : 0;
    const high = after === null ? DIGITS.length : DIGITS.indexOf(after.charAt(offset));
    if (high - low > 1) return prefix + DIGITS.charAt(Math.floor((low + high) / 2));
    prefix += DIGITS.charAt(low);
    offset++;
    // Once the upper digit exceeds the lower, every extension of the
    // lower prefix is below the upper bound.
    if (high > low) after = null;
  }
}

/**
 * Makes a key between neighboring keys. At either end it counts integers,
 * so growth is logarithmic. Only insertion into a fixed gap adds fractions.
 * Callers rebalance a table when the result exceeds MAX_ORDER_KEY_LENGTH.
 */
export function keyBetween(before: string | null, after: string | null): string {
  const low = before === null ? null : splitKey(before);
  const high = after === null ? null : splitKey(after);
  if (before !== null && after !== null && before >= after) {
    throw new RangeError("Order key bounds must increase");
  }
  if (low === null) return encodeInteger(high === null ? 0n : high.value - 1n);
  if (high === null) return encodeInteger(low.value + 1n);
  if (low.integer === high.integer) {
    return low.integer + midpoint(low.fraction, high.fraction);
  }
  const next = encodeInteger(low.value + 1n);
  if (after !== null && next < after) return next;
  return low.integer + midpoint(low.fraction, null);
}

/** Makes consecutive keys after the last row, or for a new table. */
export function keysAfter(last: string | null, count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Invalid row count");
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    last = keyBetween(last, null);
    keys.push(last);
  }
  return keys;
}

/** Gives existing rows compact, equally spaced keys without changing their order. */
export function rebalanceKeys(count: number): string[] {
  return keysAfter(null, count);
}
