import { describe, expect, it } from "vitest";
import { cellStyle, formattedText, textStyle } from "./formatStyle";

describe("textStyle and cellStyle", () => {
  it("give no styles to a cell with no format", () => {
    expect(textStyle({})).toEqual({});
    expect(cellStyle({})).toEqual({});
  });

  it("turn a format into the styles of the text and of the cell", () => {
    expect(
      textStyle({ bold: true, italic: true, align: "center", color: "red", fill: "blue" }),
    ).toEqual({
      fontWeight: "700",
      fontStyle: "italic",
      textAlign: "center",
      color: "#c0362c",
    });
    expect(cellStyle({ bold: true, fill: "yellow" })).toEqual({ background: "#fff3b8" });
  });
});

describe("cellStyle for a color scale", () => {
  it("shades from the low color to the high color by where the cell sits", () => {
    const shade = (at: number) => ({ shade: { low: "red" as const, high: "green" as const, at } });
    expect(cellStyle(shade(0))).toEqual({ background: "rgb(242, 139, 130)" });
    expect(cellStyle(shade(1))).toEqual({ background: "rgb(129, 201, 149)" });
    expect(cellStyle(shade(0.5))).toEqual({ background: "rgb(186, 170, 140)" });
  });

  it("starts from white when there is no low color, and from the cell's own fill when it has one", () => {
    expect(cellStyle({ shade: { low: null, high: "green", at: 0 } })).toEqual({
      background: "rgb(255, 255, 255)",
    });
    expect(cellStyle({ fill: "gray", shade: { low: null, high: "green", at: 0 } })).toEqual({
      background: "rgb(233, 236, 241)",
    });
  });

  it("keeps a position outside the scale on its edge", () => {
    expect(cellStyle({ shade: { low: "red", high: "green", at: 7 } })).toEqual({
      background: "rgb(129, 201, 149)",
    });
  });
});

describe("formattedText", () => {
  const date = { kind: "date" as const, ms: Date.UTC(2026, 8, 30) };

  it("writes a number or a date in the cell's number format", () => {
    expect(formattedText(1234.5, { numberFormat: "#,##0.00" })).toBe("1,234.50");
    expect(formattedText(0.256, { numberFormat: "0%" })).toBe("26%");
    expect(formattedText(date, { numberFormat: "mmm d, yyyy" })).toBe("Sep 30, 2026");
  });

  it("leaves other values, and cells with no number format, to be shown as usual", () => {
    expect(formattedText("text", { numberFormat: "0.00" })).toBeUndefined();
    expect(formattedText(true, { numberFormat: "0.00" })).toBeUndefined();
    expect(formattedText(null, { numberFormat: "0.00" })).toBeUndefined();
    expect(formattedText(5, { bold: true })).toBeUndefined();
  });

  it("falls back when a format has no place for a number", () => {
    expect(formattedText(5, { numberFormat: "mmm" })).toBeUndefined();
  });
});
