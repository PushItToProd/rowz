import { Workbook } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  startTestServer,
  storedInputs,
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

async function namedTable() {
  const snapshot = await createSpreadsheet(user);
  const table = snapshot.tables[0]!;
  await user.json(
    "PUT",
    `/tables/${table.id}/cells`,
    cellsBody({
      A1: "Item",
      B1: "Qty",
      C1: "Paid",
      D1: "Date",
      E1: "Notes",
      A2: "Pen",
      B2: "1",
      C2: "FALSE",
      D2: "2026-10-01",
      E2: "old",
    }),
    200,
  );
  await user.json("POST", `/tables/${table.id}/columns`, { headerRow: true }, 200);
  const current = await readSnapshot(user, snapshot.id);
  return {
    id: snapshot.id,
    table: current.tables[0]!,
  };
}

describe("append CSV rows", () => {
  it("maps headers without case sensitivity and ignores unmatched columns while storing typed inputs", async () => {
    const { id, table } = await namedTable();
    await user.json(
      "PATCH",
      `/tables/${table.id}/columns/${table.colIds[1]!}`,
      { type: "number" },
      200,
    );
    await user.json(
      "PATCH",
      `/tables/${table.id}/columns/${table.colIds[2]!}`,
      { type: "checkbox" },
      200,
    );
    await user.json(
      "PATCH",
      `/tables/${table.id}/columns/${table.colIds[3]!}`,
      { type: "date" },
      200,
    );

    await user.json(
      "POST",
      `/tables/${table.id}/rows/import`,
      {
        rows: [
          ["qTy", "item", "pAID", "DATE", "Unknown"],
          ["007", "Pencil", "TRUE", "2026-10-07", "ignored"],
        ],
      },
      200,
    );

    expect(await storedInputs(user, id, table.id)).toEqual({
      "0:0": "Pen",
      "0:1": "1",
      "0:2": "FALSE",
      "0:3": "2026-10-01",
      "0:4": "old",
      "1:0": "Pencil",
      "1:1": "007",
      "1:2": "TRUE",
      "1:3": "2026-10-07",
    });
    const imported = await readSnapshot(user, id);
    expect(imported.tables[0]?.rowCount).toBe(2);
    const workbook = new Workbook();
    workbook.setStructure({
      pages: imported.pages.map(({ id: pageId, name }) => ({ id: pageId, name })),
      tables: imported.tables.map(
        ({ id: tableId, pageId, name, rowCount, colCount, columns: definitions, display }) => ({
          id: tableId,
          pageId,
          name,
          rowCount,
          colCount,
          columns: definitions,
          ...(display.filter === undefined ? {} : { filter: display.filter }),
        }),
      ),
    });
    for (const cell of imported.cells) {
      workbook.setCell({ tableId: cell.tableId, row: cell.row, col: cell.col }, cell.input);
    }
    expect(workbook.getValue({ tableId: table.id, row: 1, col: 1 })).toBe(7);
    expect(workbook.getValue({ tableId: table.id, row: 1, col: 2 })).toBe(true);
    expect(workbook.getValue({ tableId: table.id, row: 1, col: 3 })).toMatchObject({
      kind: "date",
    });
  });

  it("ignores later duplicate headers so the first value wins", async () => {
    const { id, table } = await namedTable();

    await user.json(
      "POST",
      `/tables/${table.id}/rows/import`,
      {
        rows: [
          ["Qty", "qTy"],
          ["first", "ignored"],
        ],
      },
      200,
    );

    expect(await storedInputs(user, id, table.id)).toMatchObject({
      "1:1": "first",
    });
    expect(await storedInputs(user, id, table.id)).not.toHaveProperty("1:1", "ignored");
  });

  it("appends plain-grid rows below the last stored input and keeps the first CSV row", async () => {
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ B3: "last" }), 200);

    await user.json(
      "POST",
      `/tables/${table.id}/rows/import`,
      {
        rows: [
          ["header", "value"],
          ["first", "1"],
        ],
      },
      200,
    );

    expect(await storedInputs(user, snapshot.id, table.id)).toEqual({
      "2:1": "last",
      "3:0": "header",
      "3:1": "value",
      "4:0": "first",
      "4:1": "1",
    });
  });

  it("refuses a named-table file with no matching header", async () => {
    const { id, table } = await namedTable();
    const response = await user.json<{ error: { code: string; message: string } }>(
      "POST",
      `/tables/${table.id}/rows/import`,
      { rows: [["Unknown"], ["ignored"]] },
      422,
    );

    expect(response.error).toEqual({
      code: "no_matching_columns",
      message: "The first row of the file has no column names that match this table.",
    });
    expect((await readSnapshot(user, id)).tables[0]?.rowCount).toBe(1);
  });

  it("refuses appending past the table row limit", async () => {
    const snapshot = await createSpreadsheet(user);
    let table = snapshot.tables[0]!;
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: LIMITS.tableRows }, 200);
    table = (await readSnapshot(user, snapshot.id)).tables[0]!;
    await user.json(
      "PUT",
      `/tables/${table.id}/cells`,
      {
        cells: table.rows.map((row) => ({
          rowId: row.id,
          colId: table.colIds[0]!,
          input: "value",
        })),
      },
      200,
    );
    await user.json("POST", `/tables/${table.id}/columns`, { headerRow: false }, 200);

    const response = await user.json<{ error: { code: string; message: string } }>(
      "POST",
      `/tables/${table.id}/rows/import`,
      { rows: [["Column 1"], ["overflow"]] },
      422,
    );

    expect(response.error).toEqual({
      code: "table_full",
      message: `A table can have at most ${String(LIMITS.tableRows)} rows`,
    });
    expect((await readSnapshot(user, snapshot.id)).tables[0]?.rowCount).toBe(LIMITS.tableRows);
  });

  it("refuses an append too large to journal and leaves the table unchanged", async () => {
    const limited = await startTestServer({
      repositoryOptions: { journalLimits: { journalEntryBytes: 200 } },
    });
    try {
      const client = await limited.signUp();
      const snapshot = await createSpreadsheet(client);
      const table = snapshot.tables[0]!;
      const before = await readSnapshot(client, snapshot.id);
      const response = await client.request("POST", `/tables/${table.id}/rows/import`, {
        rows: [["x".repeat(500)]],
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: {
          code: "replacement_too_large",
          message: "This replacement is too large to undo. Choose a smaller scope",
        },
      });
      const after = await readSnapshot(client, snapshot.id);
      expect(after.tables[0]?.rowCount).toBe(before.tables[0]?.rowCount);
      expect(after.cells).toEqual(before.cells);
    } finally {
      await limited.close();
    }
  });

  it("refuses a CSV body with more rows than the API accepts", async () => {
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    const response = await user.json<{ error: { message: string } }>(
      "POST",
      `/tables/${table.id}/rows/import`,
      { rows: Array.from({ length: LIMITS.tableRows + 2 }, () => ["x"]) },
      400,
    );

    expect(response.error.message).toContain("A CSV file can have at most 1000 data rows");
    expect((await readSnapshot(user, snapshot.id)).tables[0]?.rowCount).toBe(table.rowCount);
  });
});
