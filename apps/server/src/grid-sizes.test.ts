import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpreadsheetSummary, UndoResult, VersionRecord } from "./app";
import { journal } from "./db/schema";
import { toSpreadsheetFile } from "@spreadsheet-app/shared";
import {
  createSpreadsheet,
  readSnapshot,
  rowIds,
  startTestServer,
  withClientId,
  type TestServer,
} from "./testing";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

async function fresh() {
  const user = await server.signUp();
  const client = withClientId(user);
  const snapshot = await createSpreadsheet(client);
  const table = snapshot.tables[0]!;
  const current = async () => (await readSnapshot(client, snapshot.id)).tables[0]!;
  const resize = (axis: "row" | "col", ids: string[], size: number | null, status = 200) =>
    client.json("PUT", `/tables/${table.id}/grid-sizes`, { axis, ids, size }, status);
  return { client, snapshot, table, current, resize, rows: rowIds(snapshot, table.id) };
}

describe("grid sizes", () => {
  it("can undo and redo table metadata recorded before sizes existed", async () => {
    const { client, snapshot, table, current } = await fresh();
    await client.json("PATCH", `/tables/${table.id}`, { name: "Renamed" });
    const entries = await server.db
      .select()
      .from(journal)
      .where(eq(journal.spreadsheetId, snapshot.id));
    for (const entry of entries) {
      if (!entry.data) continue;
      for (const change of entry.data.tables) {
        if (change.before) Reflect.deleteProperty(change.before, "gridSizes");
        if (change.after) Reflect.deleteProperty(change.after, "gridSizes");
      }
      await server.db.update(journal).set({ data: entry.data }).where(eq(journal.seq, entry.seq));
    }
    expect(
      (await client.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/undo`)).outcome,
    ).toBe("done");
    expect((await current()).name).toBe(table.name);
    expect((await current()).gridSizes).toEqual({ rows: {}, columns: {} });
    expect(
      (await client.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/redo`)).outcome,
    ).toBe("done");
    expect((await current()).name).toBe("Renamed");
  });

  it("persists several sizes, resets them, and undoes and redoes the reset", async () => {
    const { client, snapshot, table, current, resize, rows } = await fresh();
    expect(table.gridSizes).toEqual({ rows: {}, columns: {} });
    await resize("row", rows.slice(0, 2), 70);
    await resize("col", table.colIds.slice(0, 2), 220);
    const sized = (await current()).gridSizes;
    expect(sized).toEqual({
      rows: { [rows[0]!]: 70, [rows[1]!]: 70 },
      columns: { [table.colIds[0]!]: 220, [table.colIds[1]!]: 220 },
    });
    await resize("row", [rows[0]!], null);
    expect((await current()).gridSizes.rows).toEqual({ [rows[1]!]: 70 });
    expect(
      (await client.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/undo`)).outcome,
    ).toBe("done");
    expect((await current()).gridSizes).toEqual(sized);
    expect(
      (await client.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/redo`)).outcome,
    ).toBe("done");
    expect((await current()).gridSizes.rows).toEqual({ [rows[1]!]: 70 });
  });

  it("follows stable identities through inserts and deletes, including undoing deletion", async () => {
    const { client, snapshot, table, resize, current, rows } = await fresh();
    const rowId = rows[1]!;
    const colId = table.colIds[1]!;
    await resize("row", [rowId], 80);
    await resize("col", [colId], 210);
    const sized = (await current()).gridSizes;
    for (const axis of ["row", "col"])
      await client.json("POST", `/tables/${table.id}/edits`, { axis, kind: "insert", index: 0 });
    const inserted = await current();
    expect(inserted.rows[2]!.id).toBe(rowId);
    expect(inserted.colIds[2]).toBe(colId);
    expect(inserted.gridSizes).toEqual(sized);
    for (const axis of ["row", "col"])
      await client.json("POST", `/tables/${table.id}/edits`, { axis, kind: "delete", index: 2 });
    expect((await current()).gridSizes).toEqual({ rows: {}, columns: {} });
    for (let i = 0; i < 2; i++)
      expect(
        (await client.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/undo`)).outcome,
      ).toBe("done");
    expect((await current()).gridSizes).toEqual(sized);
    await resize("row", [rowId], 90);
    await resize("col", [colId], 240);
  });

  it("refuses deleted or foreign identities atomically and enforces pixel limits", async () => {
    const { table, rows, resize, current } = await fresh();
    await resize("row", [rows[0]!, randomUUID()], 80, 409);
    await resize("col", [table.colIds[0]!, randomUUID()], 200, 409);
    for (const size of [29, 501, 30.5]) await resize("row", [rows[0]!], size, 400);
    for (const size of [39, 1001, 120.5]) await resize("col", [table.colIds[0]!], size, 400);
    expect((await current()).gridSizes).toEqual({ rows: {}, columns: {} });
  });

  it("exports sizes by position and remaps them on import and version copying and restoration", async () => {
    const { client, snapshot, table, rows, resize, current } = await fresh();
    await resize("row", [rows[1]!], 65);
    await resize("col", [table.colIds[2]!], 190);
    const sized = (await current()).gridSizes;
    const read = await readSnapshot(client, snapshot.id);
    const file = toSpreadsheetFile(read.name, read.pages, read.tables, read.views, () => []);
    expect(file.pages[0]!.blocks[0]).toMatchObject({
      gridSizes: { rows: [{ index: 1, size: 65 }], columns: [{ index: 2, size: 190 }] },
    });
    const imported = await client.json<SpreadsheetSummary>(
      "POST",
      "/spreadsheets/import",
      file,
      201,
    );
    async function expectCopied(id: string) {
      const copy = (await readSnapshot(client, id)).tables[0]!;
      expect(copy.colIds[2]).not.toBe(table.colIds[2]);
      expect(copy.gridSizes).toEqual({
        rows: { [copy.rows[1]!.id]: 65 },
        columns: { [copy.colIds[2]!]: 190 },
      });
    }
    await expectCopied(imported.id);
    // Deleting a row keeps a version containing the sizes before deletion.
    await client.json("POST", `/tables/${table.id}/edits`, {
      axis: "row",
      kind: "delete",
      index: 1,
    });
    const versions = await client.json<VersionRecord[]>(
      "GET",
      `/spreadsheets/${snapshot.id}/versions`,
    );
    const kept = versions[0]!;
    const copy = await client.json<SpreadsheetSummary>(
      "POST",
      `/spreadsheets/${snapshot.id}/versions/${kept.id}/copy`,
      {},
      201,
    );
    await expectCopied(copy.id);
    await client.json("POST", `/spreadsheets/${snapshot.id}/versions/${kept.id}/restore`);
    await expectCopied(snapshot.id);
    expect((await current()).gridSizes).not.toEqual(sized);
  });
});
