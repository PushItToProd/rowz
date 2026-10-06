import { describe, expect, it } from "vitest";
import { compensatedSum } from "./sum";

describe("compensatedSum", () => {
  it("keeps small terms when larger terms cancel", () => {
    expect(compensatedSum([1e16, 1, -1e16])).toBe(1);
  });

  it("returns zero for an empty collection", () => {
    expect(compensatedSum([])).toBe(0);
  });
});
