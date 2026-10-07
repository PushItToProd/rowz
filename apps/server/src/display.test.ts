import { randomUUID } from "node:crypto";
import type { SpreadsheetFile } from "@spreadsheet-app/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Change, SpreadsheetSummary } from "./app";
import {
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  startTestServer,
  storedInputs,
  withClientId,
  type TestServer,
  type TestUser,
} from "./testing";
import type { VersionRecord } from "./repo/spreadsheets";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp();
});
afterAll(() => server.close());

/** A data table of Item, Price, and Qty with three rows. */
async function sales() {
  const snapshot = await createSpreadsheet(user);
  const tableId = snapshot.tables[0]!.id;
  const { id } = snapshot;
  await user.json(
    "PUT",
    `/tables/${tableId}/cells`,
    cellsBody({
      A1: "Item",
      B1: "Price",
      C1: "Qty",
      A2: "pen",
      B2: "2",
      C2: "10",
      A3: "ink",
      B3: "5",
      C3: "3",
      A4: "cap",
      B4: "1",
      C4: "7",
    }),
  );
  await user.json("POST", `/tables/${tableId}/columns`, { headerRow: true });
  const table = async () =>
    (await readSnapshot(user, id)).tables.find((candidate) => candidate.id === tableId)!;
  const [price, qty] = (await table()).colIds.slice(1, 3) as [string, string];
  const put = async (body: object, status = 200) =>
    user.json<Change>("PUT", `/tables/${tableId}/display`, body, status);
  const revision = async () => (await readSnapshot(user, id)).revision;
  return { id, tableId, table, price, qty, put, revision };
}

describe("a table's display", () => {
  it("starts with no sort and no filter", async () => {
    const { table } = await sales();
    expect((await table()).display).toEqual({ sort: [] });
  });

  it("stores a sort and a filter and leaves the stored rows and cells alone", async () => {
    const { id, tableId, table, price, put, revision } = await sales();
    const before = await storedInputs(user, id, tableId);
    const rowsBefore = (await readSnapshot(user, id)).rows;
    await put({
      sort: [{ colId: price, descending: true }],
      filter: "[Qty] > 3",
      revision: await revision(),
    });
    expect((await table()).display).toEqual({
      sort: [{ colId: price, descending: true }],
      filter: "=[Qty] > 3",
    });
    expect(await storedInputs(user, id, tableId)).toEqual(before);
    expect((await readSnapshot(user, id)).rows).toEqual(rowsBefore);
  });

  it("replaces the whole display, and clears the filter when none is given", async () => {
    const { table, price, qty, put, revision } = await sales();
    await put({
      sort: [{ colId: price, descending: false }],
      filter: "=[Qty] > 3",
      revision: await revision(),
    });
    await put({ sort: [{ colId: qty, descending: true }] });
    expect((await table()).display).toEqual({ sort: [{ colId: qty, descending: true }] });
  });

  it("accepts a filter without a revision", async () => {
    const { put } = await sales();
    await put({ sort: [], filter: "=[Qty] > 3" });
  });

  it("updates freeze counts through the table patch route and preserves them with sorting", async () => {
    const snapshot = await createSpreadsheet(user);
    const tableId = snapshot.tables[0]!.id;
    await user.json("PATCH", `/tables/${tableId}`, { freezeRows: 3, freezeColumns: 2 });
    expect((await readSnapshot(user, snapshot.id)).tables[0]?.display).toMatchObject({
      sort: [],
      freezeRows: 3,
      freezeColumns: 2,
    });

    await user.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
    await user.json("PUT", `/tables/${tableId}/display`, { sort: [] });
    expect((await readSnapshot(user, snapshot.id)).tables[0]?.display).toMatchObject({
      freezeRows: 1,
      freezeColumns: 2,
    });
  });

  it("limits a data table to its named header row and existing columns", async () => {
    const { id, tableId, table } = await sales();
    await user.json("PATCH", `/tables/${tableId}`, { freezeRows: 1, freezeColumns: 2 });
    await user.json("PUT", `/tables/${tableId}/display`, { sort: [] });
    expect((await table()).display).toMatchObject({ freezeRows: 1, freezeColumns: 2 });
    await user.json("PATCH", `/tables/${tableId}`, { freezeRows: 2 }, 422);
    await user.json("PATCH", `/tables/${tableId}`, { freezeColumns: 9 }, 422);
    expect(
      (await readSnapshot(user, id)).tables.find(({ id: table }) => table === tableId)?.display,
    ).toMatchObject({ freezeRows: 1, freezeColumns: 2 });
  });

  it("accepts a filter written before the last rewrite literally", async () => {
    const { id, tableId, put, revision } = await sales();
    const written = await revision();
    await user.json("POST", `/tables/${tableId}/edits`, {
      axis: "row",
      kind: "insert",
      beforeId: null,
      ids: [randomUUID()],
    });
    await put({ sort: [], filter: "=[Qty] > 3", revision: written });
    expect(
      (await readSnapshot(user, id)).tables.find((table) => table.id === tableId)?.display.filter,
    ).toBe("=[Qty] > 3");
    // Sort-only updates continue to work with the same old revision.
    await put({ sort: [], revision: written });
  });

  it("refuses a column that is not in the table", async () => {
    const { put, revision } = await sales();
    await put(
      { sort: [{ colId: randomUUID(), descending: false }], revision: await revision() },
      409,
    );
  });

  it("refuses a table with no named columns", async () => {
    const snapshot = await createSpreadsheet(user);
    const response = await user.request("PUT", `/tables/${snapshot.tables[0]!.id}/display`, {
      sort: [],
    });
    expect(response.status).toBe(422);
  });

  it("refuses a sort that names a column twice", async () => {
    const { price, put } = await sales();
    await put(
      {
        sort: [
          { colId: price, descending: false },
          { colId: price, descending: true },
        ],
      },
      400,
    );
  });

  it("follows a column rename in the filter, and keeps the sort", async () => {
    const { table, price, put, revision, tableId } = await sales();
    await put({
      sort: [{ colId: price, descending: false }],
      filter: "=[Price] > 1",
      revision: await revision(),
    });
    await user.json("PATCH", `/tables/${tableId}/columns/${price}`, { name: "Cost" });
    expect((await table()).display).toEqual({
      sort: [{ colId: price, descending: false }],
      filter: "=[Cost] > 1",
    });
  });

  it("follows a table rename in the filter", async () => {
    const { table, put, revision, tableId } = await sales();
    await put({ sort: [], filter: "=[Price] > COUNT(Table 1[Qty])", revision: await revision() });
    await put({ sort: [], filter: "=[Price] > COUNT('Table 1'[Qty])", revision: await revision() });
    await user.json("PATCH", `/tables/${tableId}`, { name: "Orders" });
    expect((await table()).display.filter).toBe("=[Price] > COUNT(Orders[Qty])");
  });

  it("drops the sort keys of a deleted column and keeps the rest", async () => {
    const { table, price, qty, put, revision, tableId } = await sales();
    await put({
      sort: [
        { colId: price, descending: false },
        { colId: qty, descending: true },
      ],
      revision: await revision(),
    });
    await user.json("POST", `/tables/${tableId}/edits`, {
      axis: "col",
      kind: "delete",
      ids: [price],
    });
    expect((await table()).display).toEqual({ sort: [{ colId: qty, descending: true }] });
  });

  it("keeps the filter text when a column it names is deleted, and the filter then shows an error", async () => {
    const { table, price, put, revision, tableId } = await sales();
    await put({ sort: [], filter: "=[Price] > 1", revision: await revision() });
    await user.json("POST", `/tables/${tableId}/edits`, {
      axis: "col",
      kind: "delete",
      ids: [price],
    });
    expect((await table()).display.filter).toBe("=[Price] > 1");
  });

  it("is reset when the table becomes a plain table", async () => {
    const { table, price, put, revision, tableId } = await sales();
    await put({
      sort: [{ colId: price, descending: false }],
      filter: "=[Price] > 1",
      revision: await revision(),
    });
    await user.json("DELETE", `/tables/${tableId}/columns`);
    expect((await table()).display).toEqual({ sort: [] });
  });

  it("is undone and redone as one step", async () => {
    const { id, table, price, tableId, revision } = await sales();
    const client = withClientId(user);
    const display = { sort: [{ colId: price, descending: true }], filter: "=[Qty] > 3" };
    await client.json("PUT", `/tables/${tableId}/display`, {
      ...display,
      revision: await revision(),
    });
    await client.json("POST", `/spreadsheets/${id}/undo`);
    expect((await table()).display).toEqual({ sort: [] });
    await client.json("POST", `/spreadsheets/${id}/redo`);
    expect((await table()).display).toEqual(display);
  });
});

describe("a table's display in a file", () => {
  function file(display: unknown, columns = true): SpreadsheetFile {
    return {
      format: "spreadsheet-app",
      version: 1,
      name: "Display",
      pages: [
        {
          name: "Data",
          blocks: [
            {
              type: "table",
              name: "Sales",
              rowCount: 2,
              colCount: 3,
              ...(columns
                ? {
                    columns: [
                      { name: "Item", type: "text" },
                      { name: "Price", type: "number" },
                      { name: "Qty", type: "number" },
                    ],
                  }
                : {}),
              display,
              cells: [
                { row: 0, col: 0, input: "pen" },
                { row: 1, col: 0, input: "ink" },
              ],
            },
          ],
        },
      ],
    } as SpreadsheetFile;
  }

  const importFile = async (contents: SpreadsheetFile, status = 201) =>
    user.json<SpreadsheetSummary>("POST", "/spreadsheets/import", contents, status);

  it("is imported, with sort keys resolved to the new column ids", async () => {
    const summary = await importFile(
      file({ sort: [{ column: 2, descending: true }], filter: "[Price] > 1" }),
    );
    const [table] = (await readSnapshot(user, summary.id)).tables;
    expect(table!.display).toEqual({
      sort: [{ colId: table!.colIds[2], descending: true }],
      filter: "=[Price] > 1",
    });
  });

  it("is refused for a sort key outside the table, a repeated key, or a plain table", async () => {
    await importFile(file({ sort: [{ column: 3, descending: false }] }), 422);
    await importFile(
      file({
        sort: [
          { column: 1, descending: false },
          { column: 1, descending: true },
        ],
      }),
      422,
    );
    await importFile(file({ sort: [] }, false), 422);
  });

  it("is kept in a version and comes back when the version is copied", async () => {
    const summary = await importFile(
      file({ sort: [{ column: 1, descending: true }], filter: "=[Qty] > 0" }),
    );
    const [table] = (await readSnapshot(user, summary.id)).tables;
    await user.json("PUT", `/tables/${table!.id}/display`, {
      sort: [{ colId: table!.colIds[2], descending: false }],
      revision: (await readSnapshot(user, summary.id)).revision,
    });
    const history = await user.json<VersionRecord[]>("GET", `/spreadsheets/${summary.id}/versions`);
    const copy = await user.json<SpreadsheetSummary>(
      "POST",
      `/spreadsheets/${summary.id}/versions/${history.at(-1)!.id}/copy`,
      undefined,
      201,
    );
    const [copied] = (await readSnapshot(user, copy.id)).tables;
    expect(copied!.display).toEqual({
      sort: [{ colId: copied!.colIds[1], descending: true }],
      filter: "=[Qty] > 0",
    });
  });
});
