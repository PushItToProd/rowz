/** Adds numbers with Neumaier compensation to preserve low-order terms. */
export function compensatedSum(values: Iterable<number>): number {
  let total = 0;
  let correction = 0;

  for (const value of values) {
    if (!Number.isFinite(value) || !Number.isFinite(total)) {
      total += value;
      correction = 0;
      continue;
    }

    const next = total + value;
    if (!Number.isFinite(next)) {
      total = next;
      correction = 0;
      continue;
    }

    correction += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    total = next;
  }

  return total + correction;
}
