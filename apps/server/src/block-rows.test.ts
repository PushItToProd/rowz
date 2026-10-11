import { FILE_FORMAT, FILE_LIMITS, type SpreadsheetFile } from "@spreadsheet-app/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Change, Created, PageRecord, SpreadsheetSummary, TableRecord } from "./app";
import {
  addBlockRow,
  addTable,
  addView,
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  startTestServer,
  type TestServer,
  withClientId,
  type TestSnapshot,
  type TestUser,
} from "./testing";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp();
});
afterAll(() => server.close());

/** A new spreadsheet with its first page and table. */
async function start(): Promise<{ id: string; page: PageRecord; table: TableRecord }> {
  const snapshot = await createSpreadsheet(user);
  return { id: snapshot.id, page: snapshot.pages[0]!, table: snapshot.tables[0]! };
}

/**
 * How a page is laid out: the names of what sits on it, in order, with the
 * names of what a row of blocks holds listed after the row's own.
 */
function layout(snapshot: TestSnapshot, pageId: string): (string | string[])[] {
  const leaves = [...snapshot.tables, ...snapshot.views].filter((block) => block.pageId === pageId);
  const inOrder = <T extends { position: number }>(items: T[]): T[] =>
    items.sort((a, b) => a.position - b.position);
  return inOrder([
    ...leaves
      .filter((leaf) => leaf.blockRowId === null)
      .map((leaf): { position: number; shown: string | string[] } => ({
        position: leaf.position,
        shown: leaf.name,
      })),
    ...snapshot.blockRows
      .filter((row) => row.pageId === pageId)
      .map((row) => ({
        position: row.position,
        shown: [
          row.name,
          ...inOrder(leaves.filter((leaf) => leaf.blockRowId === row.id)).map(({ name }) => name),
        ],
      })),
  ]).map(({ shown }) => shown);
}

async function layoutOf(spreadsheetId: string, pageId: string) {
  return layout(await readSnapshot(user, spreadsheetId), pageId);
}

describe("a row of blocks", () => {
  it("is added empty at a place on the page, named Row N", async () => {
    const { id, page } = await start();
    await addView(user, page.id, "chart");
    const created = await user.json<Created<{ blockRow: { name: string } }>>(
      "POST",
      `/pages/${page.id}/block-rows`,
      { position: 1 },
      201,
    );
    expect(created.blockRow.name).toBe("Row 1");
    expect(created.change.changed?.blockRows).toMatchObject([{ blockRow: { name: "Row 1" } }]);
    expect((await addBlockRow(user, page.id)).name).toBe("Row 2");
    expect(await layoutOf(id, page.id)).toEqual(["Table 1", ["Row 1"], "Chart 1", ["Row 2"]]);
  });

  it("takes new tables and views at a place among those it holds", async () => {
    const { id, page } = await start();
    const row = await addBlockRow(user, page.id);
    await user.json("POST", `/pages/${page.id}/views`, { kind: "chart", blockRowId: row.id }, 201);
    await user.json("POST", `/pages/${page.id}/tables`, { blockRowId: row.id }, 201);
    await user.json(
      "POST",
      `/pages/${page.id}/views`,
      { kind: "text", blockRowId: row.id, position: 0 },
      201,
    );
    expect(await layoutOf(id, page.id)).toEqual([
      "Table 1",
      ["Row 1", "Text 1", "Chart 1", "Table 2"],
    ]);
    // A place on the page is not moved by what a row holds.
    await user.json("POST", `/pages/${page.id}/views`, { kind: "script", position: 0 }, 201);
    expect(await layoutOf(id, page.id)).toEqual([
      "Script 1",
      "Table 1",
      ["Row 1", "Text 1", "Chart 1", "Table 2"],
    ]);
  });

  it("refuses a block for a row that is not on the page, or a place past the row's end", async () => {
    const { id, page } = await start();
    const row = await addBlockRow(user, page.id);
    const other = await user.json<Created<{ page: PageRecord }>>(
      "POST",
      `/spreadsheets/${id}/pages`,
      {},
      201,
    );
    await user.json("POST", `/pages/${other.page.id}/tables`, { blockRowId: row.id }, 404);
    await user.json("POST", `/pages/${page.id}/tables`, { blockRowId: UNKNOWN_ID }, 404);
    await user.json(
      "POST",
      `/pages/${page.id}/views`,
      { kind: "text", blockRowId: row.id, position: 1 },
      422,
    );
  });

  it("is rearranged with the page: blocks move in, out, and within it", async () => {
    const { id, page, table } = await start();
    const chart = await addView(user, page.id, "chart");
    const text = await addView(user, page.id, "text");
    const row = await addBlockRow(user, page.id);
    await user.json("PUT", `/pages/${page.id}/order`, {
      blocks: [row.id, text.id],
      rows: [{ id: row.id, blocks: [chart.id, table.id] }],
    });
    expect(await layoutOf(id, page.id)).toEqual([["Row 1", "Chart 1", "Table 1"], "Text 1"]);
    await user.json("PUT", `/pages/${page.id}/order`, {
      blocks: [chart.id, row.id],
      rows: [{ id: row.id, blocks: [table.id, text.id] }],
    });
    expect(await layoutOf(id, page.id)).toEqual(["Chart 1", ["Row 1", "Table 1", "Text 1"]]);
    // Formulas go on reading a table that sits in a row.
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "4" }));
    const snapshot = await readSnapshot(user, id);
    expect(snapshot.cells).toMatchObject([{ tableId: table.id, row: 0, col: 0, input: "4" }]);
  });

  it("refuses an arrangement that drops, repeats, or nests something", async () => {
    const { id, page, table } = await start();
    const chart = await addView(user, page.id, "chart");
    const row = await addBlockRow(user, page.id);
    const other = await addBlockRow(user, page.id);
    const refused = async (body: unknown) => {
      await user.json("PUT", `/pages/${page.id}/order`, body, 409);
    };
    // The chart is in the row, so an order that leaves the row's blocks out drops it.
    await user.json("PUT", `/pages/${page.id}/order`, {
      blocks: [table.id, row.id, other.id],
      rows: [{ id: row.id, blocks: [chart.id] }],
    });
    await refused({ blocks: [table.id, row.id, other.id] });
    await refused({
      blocks: [table.id, chart.id, row.id, other.id],
      rows: [{ id: row.id, blocks: [chart.id] }],
    });
    await refused({
      blocks: [table.id, row.id],
      rows: [{ id: row.id, blocks: [chart.id, other.id] }],
    });
    await refused({
      blocks: [row.id, other.id, chart.id],
      rows: [{ id: table.id, blocks: [] }],
    });
    await refused({
      blocks: [table.id, row.id, other.id],
      rows: [
        { id: row.id, blocks: [chart.id] },
        { id: row.id, blocks: [] },
      ],
    });
    expect(await layoutOf(id, page.id)).toEqual(["Table 1", ["Row 1", "Chart 1"], ["Row 2"]]);
  });

  it("is renamed", async () => {
    const { id, page } = await start();
    const row = await addBlockRow(user, page.id);
    await user.json("PATCH", `/block-rows/${row.id}`, { name: "Summary" });
    expect(await layoutOf(id, page.id)).toEqual(["Table 1", ["Summary"]]);
    await user.json("PATCH", `/block-rows/${UNKNOWN_ID}`, { name: "Summary" }, 404);
  });

  it("leaves its blocks in its place on the page when ungrouped", async () => {
    const { id, page, table } = await start();
    const row = await addBlockRow(user, page.id);
    const chart = await addView(user, page.id, "chart");
    const text = await addView(user, page.id, "text");
    const script = await addView(user, page.id, "script");
    await user.json("PUT", `/pages/${page.id}/order`, {
      blocks: [script.id, row.id, text.id],
      rows: [{ id: row.id, blocks: [chart.id, table.id] }],
    });
    const change = await user.json<Change>("POST", `/block-rows/${row.id}/ungroup`);
    expect(change.changed?.blockRows).toEqual([{ id: row.id, blockRow: null }]);
    expect(await layoutOf(id, page.id)).toEqual(["Script 1", "Chart 1", "Table 1", "Text 1"]);
  });

  it("takes its tables and views with it when deleted, and undo brings them back", async () => {
    const { id, page, table } = await start();
    const kept = await addTable(user, page.id);
    const row = await addBlockRow(user, page.id);
    const chart = await addView(user, page.id, "chart");
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "held" }));
    await user.json("PUT", `/pages/${page.id}/order`, {
      blocks: [kept.id, row.id],
      rows: [{ id: row.id, blocks: [table.id, chart.id] }],
    });
    // Undo reverses the changes of the tab that asks for it.
    const tab = withClientId(user);
    const change = await tab.json<Change>("DELETE", `/block-rows/${row.id}`);
    expect(change.changed?.tables).toEqual([{ id: table.id, table: null }]);
    expect(change.changed?.views).toEqual([{ id: chart.id, view: null }]);
    expect(await layoutOf(id, page.id)).toEqual(["Table 2"]);

    await tab.json("POST", `/spreadsheets/${id}/undo`);
    const restored = await readSnapshot(user, id);
    expect(layout(restored, page.id)).toEqual(["Table 2", ["Row 1", "Table 1", "Chart 1"]]);
    expect(restored.cells).toMatchObject([{ tableId: table.id, input: "held" }]);
  });

  it("is left by a block moved to another page", async () => {
    const { id, page, table } = await start();
    const row = await addBlockRow(user, page.id);
    const chart = await addView(user, page.id, "chart");
    await user.json("PUT", `/pages/${page.id}/order`, {
      blocks: [row.id],
      rows: [{ id: row.id, blocks: [table.id, chart.id] }],
    });
    const other = await user.json<Created<{ page: PageRecord }>>(
      "POST",
      `/spreadsheets/${id}/pages`,
      { name: "Other" },
      201,
    );
    await user.json("PUT", `/views/${chart.id}/page`, { pageId: other.page.id });
    expect(await layoutOf(id, page.id)).toEqual([["Row 1", "Table 1"]]);
    expect(await layoutOf(id, other.page.id)).toEqual(["Table 1", "Chart 1"]);
  });

  it("counts, with what it holds, toward the most blocks a page can have", async () => {
    const { page } = await start();
    const row = await addBlockRow(user, page.id);
    for (let count = 2; count < FILE_LIMITS.blocksPerPage; count += 1) {
      await user.json("POST", `/pages/${page.id}/views`, { kind: "text", blockRowId: row.id }, 201);
    }
    await user.json("POST", `/pages/${page.id}/block-rows`, {}, 422);
    await user.json("POST", `/pages/${page.id}/tables`, { blockRowId: row.id }, 422);
  });

  it("goes with the page it is on when the page is deleted, and comes back with it", async () => {
    const { id } = await start();
    const other = await user.json<Created<{ page: PageRecord; table: TableRecord }>>(
      "POST",
      `/spreadsheets/${id}/pages`,
      { name: "Other" },
      201,
    );
    const row = await addBlockRow(user, other.page.id);
    await user.json("PUT", `/pages/${other.page.id}/order`, {
      blocks: [row.id],
      rows: [{ id: row.id, blocks: [other.table.id] }],
    });
    const tab = withClientId(user);
    await tab.json("DELETE", `/pages/${other.page.id}`);
    expect((await readSnapshot(user, id)).blockRows).toEqual([]);
    await tab.json("POST", `/spreadsheets/${id}/undo`);
    expect(await layoutOf(id, other.page.id)).toEqual([["Row 1", "Table 1"]]);
  });
});

describe("a file", () => {
  it("writes a row of blocks with what it holds, and an import and a copy read it back", async () => {
    const { id, page, table } = await start();
    const row = await addBlockRow(user, page.id);
    const chart = await addView(user, page.id, "chart");
    const text = await addView(user, page.id, "text");
    await user.json("PATCH", `/block-rows/${row.id}`, { name: "Summary" });
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ B2: "held" }));
    await user.json("PUT", `/pages/${page.id}/order`, {
      blocks: [text.id, row.id],
      rows: [{ id: row.id, blocks: [chart.id, table.id] }],
    });

    const copy = await user.json<SpreadsheetSummary>("POST", `/spreadsheets/${id}/copy`, {}, 201);
    const copied = await readSnapshot(user, copy.id);
    expect(layout(copied, copied.pages[0]!.id)).toEqual([
      "Text 1",
      ["Summary", "Chart 1", "Table 1"],
    ]);
    expect(copied.cells).toMatchObject([{ row: 1, col: 1, input: "held" }]);

    const file: SpreadsheetFile = {
      format: FILE_FORMAT,
      version: 1,
      name: "Imported",
      pages: [
        {
          name: "Page 1",
          blocks: [
            {
              type: "row",
              name: "Side by side",
              blocks: [
                { type: "text", name: "Notes", source: "hello" },
                { type: "table", name: "Data", rowCount: 2, colCount: 2, cells: [] },
              ],
            },
            { type: "script", name: "Script 1", source: "" },
          ],
        },
      ],
    };
    const imported = await user.json<SpreadsheetSummary>("POST", "/spreadsheets/import", file, 201);
    const read = await readSnapshot(user, imported.id);
    expect(layout(read, read.pages[0]!.id)).toEqual([
      ["Side by side", "Notes", "Data"],
      "Script 1",
    ]);
  });

  it("is refused when a block in a row has the name of another table on the page", async () => {
    const table = { type: "table" as const, name: "Data", rowCount: 1, colCount: 1, cells: [] };
    const file: SpreadsheetFile = {
      format: FILE_FORMAT,
      version: 1,
      name: "Imported",
      pages: [{ name: "Page 1", blocks: [table, { type: "row", name: "Row 1", blocks: [table] }] }],
    };
    const response = await user.request("POST", "/spreadsheets/import", file);
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Two tables on Page 1 are named Data");
  });
});
