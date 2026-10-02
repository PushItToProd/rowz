import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { keyBetween, keysAfter, MAX_ORDER_KEY_LENGTH, rebalanceKeys } from "./order-keys";

describe("order keys", () => {
  it("orders mixed insertions strictly between their neighbors", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 500 }), (inserts) => {
        const keys: string[] = [];
        for (const choice of inserts) {
          const index = choice % (keys.length + 1);
          const before = keys[index - 1] ?? null;
          const after = keys[index] ?? null;
          const key = keyBetween(before, after);
          if (before !== null) expect(key > before).toBe(true);
          if (after !== null) expect(key < after).toBe(true);
          keys.splice(index, 0, key);
        }
        expect(keys).toEqual(keys.toSorted());
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  it("grows logarithmically at either end, including integer carries", () => {
    const appended = keysAfter(null, 10_000);
    expect(appended).toEqual(appended.toSorted());
    expect(Math.max(...appended.map((key) => key.length))).toBe(4);
    let first: string | null = null;
    for (let i = 0; i < 10_000; i++) {
      const next = keyBetween(null, first);
      if (first !== null) expect(next < first).toBe(true);
      expect(next.length).toBeLessThanOrEqual(4);
      first = next;
    }
    expect(keyBetween("az", null)).toBe("b00");
    expect(keyBetween(null, "Z0")).toBe("Yzz");
  });

  it("accepts SQL backfill keys with a length prefix and padded row number", () => {
    const backfilled = Array.from(
      { length: 1000 },
      (_, index) => `f${String(index).padStart(5, "0")}V`,
    );
    for (let i = 1; i < backfilled.length; i++) {
      const low = backfilled[i - 1]!;
      const high = backfilled[i]!;
      const key = keyBetween(low, high);
      expect(key > low && key < high).toBe(true);
    }
    expect(keyBetween(null, backfilled[0]!) < backfilled[0]!).toBe(true);
    expect(keyBetween(backfilled.at(-1)!, null) > backfilled.at(-1)!).toBe(true);
  });

  it("keeps a repeatedly split gap ordered and reaches the rebalance threshold", () => {
    const low = "a0";
    let high = "a1";
    let inserts = 0;
    while (high.length <= MAX_ORDER_KEY_LENGTH && inserts < 1000) {
      const key = keyBetween(low, high);
      expect(key > low && key < high).toBe(true);
      high = key;
      inserts++;
    }
    expect(inserts).toBe(311);
    expect(high.length).toBe(65);
    expect(rebalanceKeys(1000)).toEqual(keysAfter(null, 1000));
  });

  it("handles fractional bounds and rejects invalid or reversed keys", () => {
    for (const [low, high] of [
      ["a0", "a0V"],
      ["a0V", "a1"],
      ["a0z", "a1V"],
      ["Zz", "a0"],
    ]) {
      const key = keyBetween(low!, high!);
      expect(key > low! && key < high!).toBe(true);
    }
    for (const key of ["", "000001V", "a", "a0!", "a0V0", "b0"]) {
      expect(() => keyBetween(key, null)).toThrow(RangeError);
    }
    expect(() => keyBetween("a1", "a0")).toThrow(RangeError);
    expect(() => keyBetween("a0", "a0")).toThrow(RangeError);
    expect(() => keysAfter(null, -1)).toThrow(RangeError);
    expect(() => keysAfter(null, 0.5)).toThrow(RangeError);
    expect(keysAfter(null, 0)).toEqual([]);
  });
});
