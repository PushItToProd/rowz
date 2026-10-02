import { MAX_FORMAT_RULES } from "@spreadsheet-app/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpreadsheetSummary, TableRecord } from "./app";
import { tables } from "./db/schema";
import {
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  startTestServer,
  type TestServer,
  type TestUser,
} from "./testing";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp();
});
afterAll(() => server.close());

type Range = [startRow: number, endRow: number | null, startCol: number, endCol: number | null];

async function start() {
  const snapshot = await createSpreadsheet(user);
  const table = snapshot.tables[0]!;
  const current = async (): Promise<TableRecord> =>
    (await readSnapshot(user, snapshot.id)).tables[0]!;
  /** Formats a range. Resolves to the table as it then is, or to the refusal. */
  const format = async (
    [startRow, endRow, startCol, endCol]: Range,
    patch: object,
    extra: object = {},
    status = 200,
  ): Promise<TableRecord> => {
    const answer = await user.json<TableRecord>(
      "POST",
      `/tables/${table.id}/formats`,
      { range: { startRow, endRow, startCol, endCol }, format: patch, ...extra },
      status,
    );
    return status === 200 ? current() : answer;
  };
  return { id: snapshot.id, table, format, current };
}

describe("formatting cells", () => {
  it("starts a table with no formats", async () => {
    const { table } = await start();
    expect(table.formats).toEqual([]);
  });

  it("gives a block of cells a format, and keeps it", async () => {
    const { format, current } = await start();
    const updated = await format([0, 2, 1, 1], { bold: true, numberFormat: "0.00" });
    const rule = {
      startRow: 0,
      endRow: 2,
      startCol: 1,
      endCol: 1,
      format: { bold: true, numberFormat: "0.00" },
    };
    expect(updated.formats).toEqual([rule]);
    expect((await current()).formats).toEqual([rule]);
  });

  it("adds a format to what the cells have, and replaces a rule it overrides", async () => {
    const { format } = await start();
    await format([0, 0, 0, 0], { bold: true });
    await format([0, null, 0, 0], { color: "red" });
    const updated = await format([0, 5, 0, 5], { bold: false });
    expect(updated.formats.map((rule) => rule.format)).toEqual([{ color: "red" }, { bold: false }]);
  });

  it("clears the formats of a block with a reset", async () => {
    const { format } = await start();
    await format([0, 0, 0, 0], { bold: true });
    await format([5, 5, 5, 5], { italic: true });
    const updated = await format([0, 2, 0, 2], {}, { reset: true });
    expect(updated.formats).toEqual([
      { startRow: 5, endRow: 5, startCol: 5, endCol: 5, format: { italic: true } },
    ]);
  });

  it("moves formats with their cells when a row or column is inserted or deleted", async () => {
    const { table, format, current } = await start();
    await format([2, 2, 1, 1], { fill: "yellow" });
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "insert", index: 0 });
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "insert", index: 0 });
    expect((await current()).formats).toMatchObject([
      { startRow: 3, endRow: 3, startCol: 2, endCol: 2 },
    ]);
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "delete", index: 3 });
    expect((await current()).formats).toEqual([]);
  });

  it("moves formats up when the first row becomes the column names", async () => {
    const { table, format, current } = await start();
    await format([1, 1, 0, 0], { bold: true });
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A2: "kept" }));
    await user.json("POST", `/tables/${table.id}/columns`, { headerRow: true });
    expect((await current()).formats).toMatchObject([{ startRow: 0, endRow: 0 }]);
  });

  it.each<[string, object]>([
    [
      "an unknown property",
      { range: { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }, format: { size: 12 } },
    ],
    [
      "an unknown color",
      { range: { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }, format: { color: "#ff0000" } },
    ],
    [
      "a range that ends before it starts",
      { range: { startRow: 3, endRow: 1, startCol: 0, endCol: 0 }, format: { bold: true } },
    ],
    ["no range", { format: { bold: true } }],
    [
      "an empty number format",
      { range: { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }, format: { numberFormat: "" } },
    ],
  ])("refuses %s", async (_, body) => {
    const { table } = await start();
    await user.json("POST", `/tables/${table.id}/formats`, body, 400);
  });

  it("refuses more separate formats than the limit", async () => {
    const { table, format } = await start();
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: 600 });
    // Stored directly: making this many through the API would take as many requests.
    const formats = Array.from({ length: MAX_FORMAT_RULES }, (_, row) => ({
      startRow: row,
      endRow: row,
      startCol: 0,
      endCol: 0,
      format: { bold: true },
    }));
    await server.db.update(tables).set({ formats }).where(eq(tables.id, table.id));
    expect(await format([550, 550, 1, 1], { italic: true }, {}, 422)).toMatchObject({
      error: { code: "too_many_formats" },
    });
    // Clearing them makes room again.
    expect((await format([0, null, 0, null], {}, { reset: true })).formats).toEqual([]);
  });

  it("carries formats in a spreadsheet file", async () => {
    const formats = [{ startRow: 0, endRow: null, startCol: 0, endCol: 0, format: { bold: true } }];
    const file = {
      format: "spreadsheet-app",
      version: 1,
      name: "Imported",
      pages: [
        {
          name: "P",
          blocks: [{ type: "table", name: "T", rowCount: 2, colCount: 2, formats, cells: [] }],
        },
      ],
    };
    const summary = await user.json<SpreadsheetSummary>("POST", "/spreadsheets/import", file, 201);
    const snapshot = await readSnapshot(user, summary.id);
    expect(snapshot.tables[0]?.formats).toEqual(formats);
  });
});
