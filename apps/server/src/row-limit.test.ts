import { randomUUID } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FILE_FORMAT, keysAfter, LIMITS, type SpreadsheetFile } from "@spreadsheet-app/shared";
import type { UndoResult } from "./app";
import { pages, tableRows, tables } from "./db/schema";
import {
  cellsBody,
  createSpreadsheet,
  startTestServer,
  withClientId,
  type TestServer,
  type TestUser,
  readSnapshot,
} from "./testing";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp("Row limits");
});
afterAll(async () => server.close());

/** Adds rows to the end of a table directly, past what the API would allow. */
async function seedRows(tableId: string, count: number): Promise<void> {
  const [last] = await server.db
    .select({ orderKey: tableRows.orderKey })
    .from(tableRows)
    .where(eq(tableRows.tableId, tableId))
    .orderBy(desc(tableRows.orderKey))
    .limit(1);
  const keys = keysAfter(last?.orderKey ?? null, count);
  await server.db.insert(tableRows).values(keys.map((orderKey) => ({ tableId, orderKey })));
}

/** Seed empty grids directly so each test need not make a hundred requests. */
async function atLimit() {
  const snapshot = await createSpreadsheet(user);
  const others = await server.db
    .insert(pages)
    .values([
      { spreadsheetId: snapshot.id, name: "Other 1", position: 1 },
      { spreadsheetId: snapshot.id, name: "Other 2", position: 2 },
    ])
    .returning({ id: pages.id });
  const inserted = await server.db
    .insert(tables)
    .values(
      Array.from({ length: 100 }, (_, index) => ({
        pageId: index < 49 ? snapshot.pages[0]!.id : others[index < 99 ? 0 : 1]!.id,
        name: `Grid ${String(index)}`,
        position: index < 49 ? index + 1 : index < 99 ? index - 49 : 0,
        colIds: [randomUUID()],
      })),
    )
    .returning({ id: tables.id });
  // One statement for all the rows, with the keys the first migration gave existing rows.
  const spare = inserted.at(-1)!.id;
  await server.db.execute(sql`
    INSERT INTO table_rows (table_id, order_key)
    SELECT ${tables.id}, 'f' || lpad(n::text, 5, '0') || 'V'
    FROM ${tables}
    CROSS JOIN LATERAL generate_series(0, CASE WHEN ${tables.id} = ${spare} THEN 979 ELSE 999 END) n
    WHERE ${inArray(
      tables.id,
      inserted.map((table) => table.id),
    )}
  `);
  return {
    snapshot,
    tableId: snapshot.tables[0]!.id,
    spareId: inserted.at(-1)!.id,
    pageId: others[1]!.id,
  };
}

// Each case seeds 100,000 rows; allow for CPU contention in the full suite.
describe("spreadsheet row limit", { timeout: 15_000 }, () => {
  it("refuses insert, resize, and table creation atomically at the limit", async () => {
    const { snapshot, tableId, pageId } = await atLimit();
    for (const [method, path, body] of [
      ["POST", `/tables/${tableId}/edits`, { axis: "row", kind: "insert", index: 0 }],
      ["PATCH", `/tables/${tableId}`, { rowCount: 21 }],
      ["POST", `/pages/${pageId}/tables`, {}],
    ] as const) {
      const response = await user.request(method, path, body);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: "too_many_rows" } });
    }
    const current = await readSnapshot(user, snapshot.id);
    expect(current.tables.reduce((sum, table) => sum + table.rowCount, 0)).toBe(
      LIMITS.spreadsheetRows,
    );
    expect(current.tables.find((table) => table.id === tableId)?.rowCount).toBe(20);
  });

  it("allows shrinking and adding rows up to the limit", async () => {
    const { snapshot, tableId } = await atLimit();
    await user.json("PATCH", `/tables/${tableId}`, { rowCount: 19 });
    await user.json("POST", `/tables/${tableId}/edits`, { axis: "row", kind: "insert", index: 0 });
    const current = await readSnapshot(user, snapshot.id);
    expect(current.tables.reduce((sum, table) => sum + table.rowCount, 0)).toBe(
      LIMITS.spreadsheetRows,
    );
  });

  it("lets a legacy spreadsheet above the limit lose rows", async () => {
    const { tableId } = await atLimit();
    await seedRows(tableId, 2);
    await user.json("PATCH", `/tables/${tableId}`, { rowCount: 21 });
    const response = await user.request("PATCH", `/tables/${tableId}`, { rowCount: 22 });
    expect(response.status).toBe(422);
  });

  it("refuses an action's growth and rolls back its cell writes", async () => {
    const { snapshot, tableId } = await atLimit();
    await user.json(
      "PUT",
      `/tables/${tableId}/cells`,
      cellsBody({
        A20: "last",
        D1: '=BUTTON("Add", APPEND_ROW(A:A, "new"))',
      }),
    );
    const result = await user.json("POST", `/tables/${tableId}/cells/0/3/click`);
    expect(result).toMatchObject({ status: "failed", change: null });
    const current = await readSnapshot(user, snapshot.id);
    expect(current.tables.find((table) => table.id === tableId)?.rowCount).toBe(20);
    expect(current.cells.some((cell) => cell.input === "new")).toBe(false);
  });

  it("refuses an import with too many rows, even when all cells are empty", async () => {
    const file: SpreadsheetFile = {
      format: FILE_FORMAT,
      version: 1,
      name: "Too many rows",
      pages: Array.from({ length: 3 }, (_, page) => ({
        name: `Page ${String(page)}`,
        blocks: Array.from({ length: page < 2 ? 50 : 1 }, (_, index) => ({
          type: "table",
          name: `Table ${String(index)}`,
          rowCount: 1000,
          colCount: 1,
          cells: [],
        })),
      })),
    };
    const response = await user.request("POST", "/spreadsheets/import", file);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_file" } });
  });

  it("refuses undo when restoring rows would exceed the limit", async () => {
    const { snapshot, tableId, spareId } = await atLimit();
    const client = withClientId(user);
    await client.json("PATCH", `/tables/${tableId}`, { rowCount: 19 });
    // Consume the freed row without introducing a later structural conflict.
    await seedRows(spareId, 1);
    const result = await client.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/undo`);
    expect(result).toMatchObject({
      outcome: "refused",
      error: "This change would exceed the spreadsheet row limit",
    });
    const current = await readSnapshot(user, snapshot.id);
    expect(current.tables.find((table) => table.id === tableId)?.rowCount).toBe(19);
  });

  it("allows undo that reduces the row count of a legacy spreadsheet above the limit", async () => {
    const { snapshot, tableId, spareId } = await atLimit();
    const client = withClientId(user);
    await client.json("PATCH", `/tables/${tableId}`, { rowCount: 19 });
    await client.json("PATCH", `/tables/${tableId}`, { rowCount: 20 });
    await seedRows(spareId, 3);
    const result = await client.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/undo`);
    expect(result.outcome).toBe("done");
    const current = await readSnapshot(user, snapshot.id);
    expect(current.tables.reduce((sum, table) => sum + table.rowCount, 0)).toBe(
      LIMITS.spreadsheetRows + 2,
    );
  });
});
