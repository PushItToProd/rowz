import { describe, expect, it } from "vitest";
import { contextMenuPosition } from "./contextMenuPosition";

describe("contextMenuPosition", () => {
  it("keeps a menu at its anchor when it fits", () => {
    expect(
      contextMenuPosition(40, 60, 180, 120, { left: 0, top: 0, width: 800, height: 600 }),
    ).toEqual({ left: 40, top: 60 });
  });

  it("shifts left and flips above when the menu would overflow right and bottom", () => {
    expect(
      contextMenuPosition(280, 340, 100, 80, { left: 0, top: 0, width: 350, height: 400 }),
    ).toEqual({ left: 180, top: 260 });
  });

  it("clamps within an offset visual viewport", () => {
    const position = contextMenuPosition(240, 130, 180, 100, {
      left: 100,
      top: 150,
      width: 300,
      height: 200,
    });

    expect(position).toEqual({ left: 160, top: 180 });
    expect(position.left).toBeGreaterThanOrEqual(104);
    expect(position.top).toBeGreaterThanOrEqual(154);
    expect(position.left + 180).toBeLessThanOrEqual(396);
    expect(position.top + 100).toBeLessThanOrEqual(346);
  });
});
