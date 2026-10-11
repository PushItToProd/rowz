import { describe, expect, it } from "vitest";
import { dropPlace, type Box, type DragLine } from "./blockDrag";

const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  right,
  bottom,
});

/** A table, then a row holding two blocks side by side, then a chart. */
const PAGE: DragLine[] = [
  { id: "t1", box: box(0, 0, 800, 100), row: null },
  {
    id: "br1",
    box: box(0, 120, 800, 320),
    row: {
      area: box(10, 160, 790, 310),
      blocks: [box(10, 160, 394, 310), box(406, 160, 790, 310)],
    },
  },
  { id: "c1", box: box(0, 340, 800, 440), row: null },
];

describe("dropPlace", () => {
  it.each([
    [10, 0],
    [60, 1],
    [140, 1],
    [330, 2],
    [400, 3],
    [900, 3],
  ])("puts a block released at height %i before line %i of the page", (y, index) => {
    expect(dropPlace({ x: 400, y }, PAGE, false)?.place).toEqual({ blockRowId: null, index });
  });

  it.each([
    [20, 0],
    [300, 1],
    [700, 2],
  ])("puts a block released over a row's blocks at %i into the row at %i", (x, index) => {
    expect(dropPlace({ x, y: 200 }, PAGE, false)?.place).toEqual({ blockRowId: "br1", index });
  });

  it("keeps a row of blocks on the page when it is released over another row", () => {
    expect(dropPlace({ x: 300, y: 200 }, PAGE, true)?.place).toEqual({
      blockRowId: null,
      index: 1,
    });
  });

  it("orders the blocks of a row by height where they stack", () => {
    const stacked: DragLine[] = [
      {
        id: "br1",
        box: box(0, 0, 300, 400),
        row: {
          area: box(10, 40, 290, 390),
          blocks: [box(10, 40, 290, 200), box(10, 212, 290, 390)],
        },
      },
    ];
    expect(dropPlace({ x: 20, y: 250 }, stacked, false)).toEqual({
      place: { blockRowId: "br1", index: 1 },
      mark: box(10, 204, 290, 208),
    });
  });

  it("puts a block into an empty row", () => {
    const empty: DragLine[] = [
      { id: "br1", box: box(0, 0, 800, 100), row: { area: box(10, 40, 790, 90), blocks: [] } },
    ];
    expect(dropPlace({ x: 400, y: 60 }, empty, false)?.place).toEqual({
      blockRowId: "br1",
      index: 0,
    });
  });

  it("draws the bar in the gap the block would go to", () => {
    expect(dropPlace({ x: 400, y: 330 }, PAGE, false)?.mark).toEqual(box(0, 328, 800, 332));
    expect(dropPlace({ x: 300, y: 200 }, PAGE, false)?.mark).toEqual(box(398, 160, 402, 310));
  });

  it("has nowhere to put a block on a page with nothing drawn", () => {
    expect(dropPlace({ x: 0, y: 0 }, [], false)).toBeNull();
  });
});
