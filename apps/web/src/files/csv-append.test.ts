import type { TableRecord } from "../api/client";
import { describe, expect, it } from "vitest";
import { prepareCsvAppend } from "./csv-append";

const columns: NonNullable<TableRecord["columns"]> = [
  { name: "Item", type: "text" },
  { name: "Qty", type: "number" },
  { name: "Paid", type: "checkbox" },
  { name: "Notes", type: "any" },
];

describe("prepareCsvAppend", () => {
  it("maps names without case sensitivity, ignores unknown headers, and leaves missing columns blank", () => {
    const prepared = prepareCsvAppend("qTy,item,Extra\n007,Pen,unused\n2,Pencil,also unused", {
      columns,
      colCount: 4,
    });

    expect(prepared).toMatchObject({
      dataRows: 2,
      matchedColumns: ["Qty", "Item"],
      ignoredColumns: ["Extra"],
      rows: [
        ["Pen", "007", "", ""],
        ["Pencil", "2", "", ""],
      ],
    });
  });

  it("keeps the first duplicate header and reports later duplicates as ignored", () => {
    const prepared = prepareCsvAppend("Qty,qTy,Item\n2,999,Pen", { columns, colCount: 4 });

    expect(prepared).toMatchObject({
      matchedColumns: ["Qty", "Item"],
      duplicateColumnsIgnored: ["qTy"],
      rows: [["Pen", "2", "", ""]],
    });
  });

  it("keeps typed inputs as written for the engine to coerce as it does after paste", () => {
    const prepared = prepareCsvAppend("Paid,Qty\nTRUE,007\nFALSE,12", { columns, colCount: 4 });

    if (!("rows" in prepared)) throw new Error("The headers should match");
    expect(prepared.rows).toEqual([
      ["", "007", "TRUE", ""],
      ["", "12", "FALSE", ""],
    ]);
  });

  it("refuses a named table file with no matching header", () => {
    expect(prepareCsvAppend("Unknown,Also unknown\na,b", { columns, colCount: 4 })).toMatchObject({
      noMatchingColumns: true,
    });
  });

  it("keeps every plain-grid row and maps its columns by position", () => {
    const prepared = prepareCsvAppend("name,qty\nPen,2", { columns: null, colCount: 4 });

    expect(prepared).toMatchObject({
      dataRows: 2,
      rows: [
        ["name", "qty"],
        ["Pen", "2"],
      ],
    });
  });
});
