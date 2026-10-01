import { describe, expect, it } from "vitest";
import type { CellId, CellRange } from "./address";
import { DependencyIndex, evaluationOrder } from "./graph";

function order(
  root: string,
  edges: Record<string, string[]>,
): { order: string[]; cyclic: string[] } {
  const result = evaluationOrder(root, (node) => edges[node] ?? []);
  return { order: result.order, cyclic: [...result.cyclic].sort() };
}

describe("evaluationOrder", () => {
  it("returns a lone node", () => {
    expect(order("a", {})).toEqual({ order: ["a"], cyclic: [] });
  });

  it("puts dependencies before dependents", () => {
    const result = order("a", { a: ["b", "c"], b: ["d"], c: ["d"] });
    expect(result.cyclic).toEqual([]);
    expect(result.order).toHaveLength(4);
    for (const [dependent, dependency] of [
      ["a", "b"],
      ["a", "c"],
      ["b", "d"],
      ["c", "d"],
    ] as const) {
      expect(result.order.indexOf(dependency)).toBeLessThan(result.order.indexOf(dependent));
    }
  });

  it("leaves out nodes the root cannot reach", () => {
    expect(order("b", { a: ["b"], b: ["c"] }).order).toEqual(["c", "b"]);
  });

  it("marks a self-reference as cyclic", () => {
    expect(order("a", { a: ["a"] })).toEqual({ order: ["a"], cyclic: ["a"] });
  });

  it("marks every node of a loop and not the node that depends on the loop", () => {
    const result = order("top", { top: ["a"], a: ["b"], b: ["c"], c: ["a"] });
    expect(result.cyclic).toEqual(["a", "b", "c"]);
    expect(result.order.at(-1)).toBe("top");
  });

  it("does not mark a node that a loop depends on", () => {
    expect(order("a", { a: ["b", "leaf"], b: ["a"] }).cyclic).toEqual(["a", "b"]);
  });

  // `c` is on the loop a -> c -> d -> a, but a depth-first walk from `a` closes
  // the loop through `b` first and reaches `c` only after `d` is finished.
  it.each(["a", "b", "c", "d"])(
    "marks a whole component whichever node is asked for: %s",
    (root) => {
      const edges = { a: ["b", "c"], b: ["d"], c: ["d"], d: ["a"] };
      expect(order(root, edges).cyclic).toEqual(["a", "b", "c", "d"]);
    },
  );

  it("separates two loops joined by a one-way edge", () => {
    const result = order("a", { a: ["b"], b: ["a", "x"], x: ["y"], y: ["x"] });
    expect(result.cyclic).toEqual(["a", "b", "x", "y"]);
    expect(Math.max(result.order.indexOf("x"), result.order.indexOf("y"))).toBeLessThan(
      Math.min(result.order.indexOf("a"), result.order.indexOf("b")),
    );
  });

  it("handles a chain far longer than the call stack allows for recursion", () => {
    const length = 200_000;
    const result = evaluationOrder(0, (node) => (node < length ? [node + 1] : []));
    expect(result.order).toHaveLength(length + 1);
    expect(result.order[0]).toBe(length);
    expect(result.order.at(-1)).toBe(0);
    expect(result.cyclic.size).toBe(0);
  });
});

describe("DependencyIndex", () => {
  const cell = (row: number, col: number, tableId = "t"): CellId => ({ tableId, row, col });
  const range = (
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): CellRange => ({
    tableId: "t",
    startRow,
    startCol,
    endRow,
    endCol,
  });
  const single = (row: number, col: number): CellRange => range(row, col, row, col);

  it("finds direct and indirect dependents", () => {
    const index = new DependencyIndex();
    index.set(cell(0, 1), [single(0, 0)]);
    index.set(cell(0, 2), [single(0, 1)]);
    index.set(cell(5, 5), [single(9, 9)]);
    expect(index.transitiveDependents(cell(0, 0))).toEqual([cell(0, 1), cell(0, 2)]);
  });

  it("matches cells inside a range and not outside it", () => {
    const index = new DependencyIndex();
    index.set(cell(9, 9), [range(0, 0, 2, 2)]);
    expect(index.transitiveDependents(cell(2, 2))).toEqual([cell(9, 9)]);
    expect(index.transitiveDependents(cell(3, 2))).toEqual([]);
    expect(index.transitiveDependents(cell(2, 2, "other"))).toEqual([]);
  });

  it("follows dependencies across tables", () => {
    const index = new DependencyIndex();
    index.set(cell(0, 0, "other"), [single(0, 0)]);
    expect(index.transitiveDependents(cell(0, 0))).toEqual([cell(0, 0, "other")]);
  });

  it("replaces a cell's precedents when set again", () => {
    const index = new DependencyIndex();
    index.set(cell(1, 1), [single(0, 0)]);
    index.set(cell(1, 1), [single(0, 1)]);
    expect(index.transitiveDependents(cell(0, 0))).toEqual([]);
    expect(index.transitiveDependents(cell(0, 1))).toEqual([cell(1, 1)]);
  });

  it("replaces a range precedent and keeps other cells' ranges", () => {
    const index = new DependencyIndex();
    index.set(cell(8, 8), [range(0, 0, 2, 2)]);
    index.set(cell(9, 9), [range(0, 0, 2, 2)]);
    index.set(cell(9, 9), [range(5, 5, 6, 6)]);
    expect(index.transitiveDependents(cell(1, 1))).toEqual([cell(8, 8)]);
    expect(index.transitiveDependents(cell(5, 5))).toEqual([cell(9, 9)]);
  });

  it("forgets a removed cell and keeps the others", () => {
    const index = new DependencyIndex();
    index.set(cell(1, 1), [single(0, 0)]);
    index.set(cell(2, 2), [single(0, 0)]);
    index.remove(cell(1, 1));
    index.remove(cell(7, 7));
    expect(index.transitiveDependents(cell(0, 0))).toEqual([cell(2, 2)]);
  });

  it("forgets everything when cleared", () => {
    const index = new DependencyIndex();
    index.set(cell(1, 1), [single(0, 0)]);
    index.clear();
    expect(index.transitiveDependents(cell(0, 0))).toEqual([]);
  });

  it("terminates on a loop and leaves the changed cell out of its own dependents", () => {
    const index = new DependencyIndex();
    index.set(cell(0, 0), [single(0, 1)]);
    index.set(cell(0, 1), [single(0, 0)]);
    expect(index.transitiveDependents(cell(0, 0))).toEqual([cell(0, 1)]);
  });
});
