import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  keyBetween,
  keysAfter,
  MAX_ORDER_KEY_LENGTH,
  toSpreadsheetFile,
} from "@spreadsheet-app/shared";
import type { UndoResult } from "./app";
import { journal, tableRows } from "./db/schema";
import {
  cellsBody,
  createSpreadsheet,
  startTestServer,
  withClientId,
  type TestServer,
  readSnapshot,
} from "./testing";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => server.close());

const orderedRows = (tableId: string) =>
  server.db
    .select()
    .from(tableRows)
    .where(eq(tableRows.tableId, tableId))
    .orderBy(asc(tableRows.orderKey));

it("keeps existing row and column IDs when inserting and deleting in the middle", async () => {
  const owner = await server.signUp();
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  const before = await orderedRows(table.id);
  await owner.json("POST", `/tables/${table.id}/edits`, {
    axis: "row",
    kind: "insert",
    index: 3,
    count: 5,
  });
  const inserted = await orderedRows(table.id);
  expect(inserted.slice(0, 3)).toEqual(before.slice(0, 3));
  expect(inserted.slice(8)).toEqual(before.slice(3));
  expect(new Set(inserted.map((row) => row.id)).size).toBe(inserted.length);
  await owner.json("POST", `/tables/${table.id}/edits`, {
    axis: "row",
    kind: "delete",
    index: 3,
    count: 5,
  });
  expect(await orderedRows(table.id)).toEqual(before);
  await owner.json("POST", `/tables/${table.id}/edits`, {
    axis: "col",
    kind: "insert",
    index: 2,
    count: 3,
  });
  const after = await readSnapshot(owner, snapshot.id);
  expect(after.tables[0]!.colIds.slice(0, 2)).toEqual(table.colIds.slice(0, 2));
  expect(after.tables[0]!.colIds.slice(5)).toEqual(table.colIds.slice(2));
  await owner.json("POST", `/tables/${table.id}/edits`, {
    axis: "col",
    kind: "delete",
    index: 2,
    count: 3,
  });
  const restored = await readSnapshot(owner, snapshot.id);
  expect(restored.tables[0]!.colIds).toEqual(table.colIds);
});

it("rebalances long keys without replacing IDs and clears every tab's history", async () => {
  const owner = await server.signUp();
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  const first = withClientId(owner);
  const second = withClientId(owner);
  await first.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "first" }), 200);
  await second.json("PUT", `/tables/${table.id}/cells`, cellsBody({ B1: "second" }), 200);
  const before = await orderedRows(table.id);
  const upper = "a0" + "0".repeat(61) + "1";
  expect(upper).toHaveLength(64);
  expect(keyBetween("a0", upper).length).toBeGreaterThan(MAX_ORDER_KEY_LENGTH);
  await server.db.update(tableRows).set({ orderKey: upper }).where(eq(tableRows.id, before[1]!.id));
  await first.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "insert", index: 1 });
  const after = await orderedRows(table.id);
  expect(
    after.filter((row) => before.some((original) => original.id === row.id)).map((row) => row.id),
  ).toEqual(before.map((row) => row.id));
  expect(after.every((row) => row.orderKey.length <= MAX_ORDER_KEY_LENGTH)).toBe(true);
  // The rebalance itself is not undoable: its history marker has no recorded state.
  const entries = await server.db
    .select()
    .from(journal)
    .where(eq(journal.spreadsheetId, snapshot.id));
  expect(entries.every((entry) => entry.data === null)).toBe(true);
  expect(await second.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/undo`)).toMatchObject({
    outcome: "nothing",
  });
});

it("allocates a large batch between two neighbors without making long keys", async () => {
  const owner = await server.signUp();
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  await owner.json("POST", `/tables/${table.id}/edits`, {
    axis: "row",
    kind: "insert",
    index: 1,
    count: 980,
  });
  const rows = await orderedRows(table.id);
  expect(rows).toHaveLength(1000);
  expect(rows.every((row) => row.orderKey.length <= MAX_ORDER_KEY_LENGTH)).toBe(true);
});

it("creates new identities on file import and version restore", async () => {
  const owner = await server.signUp();
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  const imported = await owner.json<{ id: string }>(
    "POST",
    "/spreadsheets/import",
    toSpreadsheetFile(snapshot.name, snapshot.pages, snapshot.tables, snapshot.views, (candidate) =>
      snapshot.cells.filter((cell) => cell.tableId === candidate.id),
    ),
    201,
  );
  const importedSnapshot = await readSnapshot(owner, imported.id);
  const importedTable = importedSnapshot.tables[0]!;
  expect(await orderedRows(importedTable.id)).toHaveLength(table.rowCount);
  expect(importedTable.colIds).toHaveLength(table.colCount);
  expect(importedTable.colIds.some((id) => table.colIds.includes(id))).toBe(false);
  const original = await orderedRows(table.id);
  const versions = await owner.json<{ id: string }[]>(
    "GET",
    `/spreadsheets/${snapshot.id}/versions`,
  );
  await owner.json(
    "POST",
    `/spreadsheets/${snapshot.id}/versions/${versions[0]!.id}/restore`,
    undefined,
    200,
  );
  const restored = await readSnapshot(owner, snapshot.id);
  const newTable = restored.tables[0]!;
  const rows = await orderedRows(newTable.id);
  expect(rows).toHaveLength(table.rowCount);
  expect(newTable.colIds).toHaveLength(table.colCount);
  expect(newTable.colIds.some((id) => table.colIds.includes(id))).toBe(false);
  expect(rows.some((row) => original.some((old) => old.id === row.id))).toBe(false);
  expect(
    await server.db
      .select()
      .from(tableRows)
      .where(
        inArray(
          tableRows.id,
          original.map((row) => row.id),
        ),
      ),
  ).toEqual([]);
  expect(rows.map((row) => row.orderKey)).toEqual(keysAfter(null, table.rowCount));
});
