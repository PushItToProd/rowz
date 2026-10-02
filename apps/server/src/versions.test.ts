import { LIMITS } from "@spreadsheet-app/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickResult, PageRecord, SpreadsheetSummary, VersionRecord } from "./app";
import { versions } from "./db/schema";
import {
  addTable,
  addView,
  cellsBody,
  changedCells,
  createSpreadsheet,
  readSnapshot,
  startTestServer,
  storedInputs,
  type TestServer,
  type TestUser,
} from "./testing";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp("Ada");
});
afterAll(() => server.close());

async function start(cells: Record<string, string> = { A1: "1", A2: "2", B1: "=A1+A2" }) {
  const snapshot = await createSpreadsheet(user);
  const [page, table] = [snapshot.pages[0]!, snapshot.tables[0]!];
  await user.json("PUT", `/tables/${table.id}/cells`, cellsBody(cells), 200);
  const base = `/spreadsheets/${snapshot.id}`;
  return {
    id: snapshot.id,
    page,
    table,
    history: () => user.json<VersionRecord[]>("GET", `${base}/versions`),
    current: () => readSnapshot(user, snapshot.id),
    restore: (versionId: string, status = 200) =>
      user.json("POST", `${base}/versions/${versionId}/restore`, undefined, status),
    /** Makes every kept version look as if it was kept an hour ago. */
    age: () =>
      server.db
        .update(versions)
        .set({ createdAt: sql`${versions.createdAt} - interval '1 hour'` })
        .where(eq(versions.spreadsheetId, snapshot.id)),
  };
}

const reasons = (history: VersionRecord[]): (string | null)[] => history.map((v) => v.reason);

describe("keeping versions", () => {
  it("keeps one of a new spreadsheet, and no more while changes follow closely", async () => {
    const { history, table } = await start();
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ C1: "more" }), 200);
    const kept = await history();
    expect(reasons(kept)).toEqual([null]);
    expect(kept[0]).toMatchObject({ createdBy: "Ada" });
    expect(new Date(kept[0]!.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("keeps another once enough time has passed since the last", async () => {
    const { history, table, age } = await start();
    await age();
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ C1: "later" }), 200);
    expect(reasons(await history())).toEqual([null, null]);
  });

  it.each<[string, (fixture: Awaited<ReturnType<typeof start>>) => Promise<unknown>, string]>([
    [
      "deleting a row",
      ({ table }) =>
        user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "delete", index: 0 }),
      "Before deleting row 1 of Table 1",
    ],
    [
      "deleting several rows",
      ({ table }) =>
        user.json("POST", `/tables/${table.id}/edits`, {
          axis: "row",
          kind: "delete",
          index: 1,
          count: 3,
        }),
      "Before deleting rows 2 to 4 of Table 1",
    ],
    [
      "deleting a column",
      ({ table }) =>
        user.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "delete", index: 1 }),
      "Before deleting column B of Table 1",
    ],
    [
      "making a table smaller",
      ({ table }) => user.json("PATCH", `/tables/${table.id}`, { rowCount: 1 }),
      "Before making Table 1 smaller",
    ],
    [
      "naming columns from the first row",
      ({ table }) => user.json("POST", `/tables/${table.id}/columns`, { headerRow: true }),
      "Before naming the columns of Table 1",
    ],
    [
      "writing many cells at once",
      ({ table }) =>
        user.json(
          "PUT",
          `/tables/${table.id}/cells`,
          {
            cells: Array.from({ length: 20 }, (_, row) => ({ row: row % 20, col: 2, input: "x" })),
          },
          200,
        ),
      "Before changing 20 cells of Table 1",
    ],
    [
      "deleting a table",
      async ({ page, table }) => {
        await addTable(user, page.id);
        await user.json("DELETE", `/tables/${table.id}`, undefined, 200);
      },
      "Before deleting the table Table 1",
    ],
  ])("keeps one before %s", async (_, change, reason) => {
    const fixture = await start();
    await change(fixture);
    expect(reasons(await fixture.history())).toEqual([reason, null]);
  });

  it("keeps one before deleting a page, a view, or column names", async () => {
    const fixture = await start();
    const { page } = await user.json<{ page: PageRecord }>(
      "POST",
      `/spreadsheets/${fixture.id}/pages`,
      { name: "Extra" },
      201,
    );
    const view = await addView(user, page.id, "chart");
    await user.json("DELETE", `/views/${view.id}`, undefined, 200);
    await user.json("DELETE", `/pages/${page.id}`, undefined, 200);
    await user.json("POST", `/tables/${fixture.table.id}/columns`, { headerRow: false });
    await user.json("PATCH", `/tables/${fixture.table.id}/columns/2`, {
      type: "formula",
      formula: "=1",
    });
    await user.json("DELETE", `/tables/${fixture.table.id}/columns`);
    expect(reasons(await fixture.history())).toEqual([
      "Before removing the column names of Table 1",
      "Before making Column 3 a formula column",
      "Before deleting the page Extra",
      "Before deleting Chart 1",
      null,
    ]);
  });

  it("does not keep a second version when nothing changed since the last", async () => {
    const { table, history } = await start();
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "delete", index: 5 });
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "delete", index: 5 });
    // The second delete follows a change, the first delete, so it keeps one too.
    expect(reasons(await history())).toHaveLength(3);
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "insert", index: 0 });
    expect(reasons(await history())).toHaveLength(3);
  });

  it("drops the oldest versions past the limit", async () => {
    const { id, table, history } = await start();
    const [first] = await history();
    const padding = Array.from({ length: LIMITS.versions }, (_, index) => ({
      spreadsheetId: id,
      reason: `filler ${String(index)}`,
      data: { format: "spreadsheet-app" as const, version: 1 as const, name: "x", pages: [] },
      createdAt: new Date(Date.now() - (index + 1) * 60_000),
    }));
    await server.db.insert(versions).values(padding);
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "delete", index: 0 });
    const kept = await history();
    expect(kept).toHaveLength(LIMITS.versions);
    expect(kept[0]?.reason).toBe("Before deleting row 1 of Table 1");
    expect(kept.map((version) => version.id)).toContain(first!.id);
    expect(reasons(kept)).not.toContain(`filler ${String(LIMITS.versions - 1)}`);
  });
});

describe("restoring a version", () => {
  it("puts back cells, formats, columns, views, pages, and the name", async () => {
    const { id, page, table, history, current, restore } = await start();
    await user.json("POST", `/tables/${table.id}/formats`, {
      range: { startRow: 0, endRow: 0, startCol: 0, endCol: 0 },
      format: { bold: true },
    });
    const chart = await addView(user, page.id, "chart");
    await user.json("PATCH", `/views/${chart.id}`, { source: "'Table 1'!A1:B2" });
    await user.json("PATCH", `/spreadsheets/${id}`, { name: "Plan" }, 204);

    // A deleted row keeps a version of everything above.
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "delete", index: 0 });
    await user.json("DELETE", `/views/${chart.id}`, undefined, 200);
    await user.json("PATCH", `/spreadsheets/${id}`, { name: "Changed" }, 204);
    const before = (await history()).find((v) => v.reason === "Before deleting row 1 of Table 1")!;

    await restore(before.id);
    const restored = await current();
    expect(restored.name).toBe("Plan");
    expect(restored.pages.map((p) => p.name)).toEqual(["Page 1"]);
    expect(restored.tables).toMatchObject([
      { name: "Table 1", rowCount: table.rowCount, formats: [{ format: { bold: true } }] },
    ]);
    expect(restored.views).toMatchObject([{ kind: "chart", source: "'Table 1'!A1:B2" }]);
    expect(await storedInputs(user, id, restored.tables[0]!.id)).toEqual({
      "0:0": "1",
      "1:0": "2",
      "0:1": "=A1+A2",
    });
  });

  it("keeps what it replaces, so the restore can be undone", async () => {
    const { id, table, history, current, restore } = await start();
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "delete", index: 0 });
    const [beforeDelete] = await history();
    await restore(beforeDelete!.id);
    const kept = await history();
    expect(kept[0]?.reason).toBe("Before restoring an earlier version");

    await restore(kept[0]!.id);
    const again = await current();
    expect(await storedInputs(user, id, again.tables[0]!.id)).toEqual({ "0:0": "2" });
  });

  it("still computes after a restore: a button reads the restored cells", async () => {
    const { id, table, history, current, restore } = await start({
      A1: "5",
      B1: '=BUTTON("Double", EXECUTE(A1 * 2, C1))',
    });
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: 1 });
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "100" }), 200);
    await restore((await history())[0]!.id);
    const restored = (await current()).tables[0]!;
    const clicked = await user.json<ClickResult>("POST", `/tables/${restored.id}/cells/0/1/click`);
    expect(clicked).toMatchObject({ status: "succeeded" });
    expect(await changedCells(user, id, clicked.change!)).toEqual([
      { tableId: restored.id, row: 0, col: 2, input: "10" },
    ]);
  });

  it("tells sessions to read the spreadsheet again, since everything in it has new ids", async () => {
    const { table, history, current, restore } = await start();
    const before = await current();
    const restored = await restore((await history())[0]!.id);
    expect(restored).toEqual({ revision: before.revision + 1, changed: null });
    const after = await current();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.tables[0]?.id).not.toBe(table.id);
  });

  it("puts back a data table that has no rows", async () => {
    const { table, history, current, restore, age } = await start({ A1: "" });
    await age();
    await user.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
    expect((await current()).tables[0]).toMatchObject({ rowCount: 0 });
    // Naming columns keeps the new empty state after the previous version has aged.
    const [empty] = await history();
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: 3 });
    await restore(empty!.id);
    const restored = (await current()).tables[0]!;
    expect(restored).toMatchObject({ rowCount: 0, colCount: table.colCount });
    expect(restored.columns).toHaveLength(table.colCount);
  });

  it("refuses to restore or copy a version with more rows than a spreadsheet may have", async () => {
    const { id, history, restore } = await start();
    const blocks = Array.from({ length: 50 }, (_, index) => ({
      type: "table" as const,
      name: `Grid ${String(index)}`,
      rowCount: LIMITS.tableRows,
      colCount: 1,
      cells: [],
    }));
    const [legacy] = await server.db
      .insert(versions)
      .values({
        spreadsheetId: id,
        reason: "From before the row limit",
        data: {
          format: "spreadsheet-app",
          version: 1,
          name: "Legacy",
          pages: Array.from({ length: 3 }, (_, page) => ({
            name: `Page ${String(page)}`,
            blocks: page < 2 ? blocks : blocks.slice(0, 1),
          })),
        },
      })
      .returning({ id: versions.id });
    const kept = await history();

    expect(await restore(legacy!.id, 422)).toMatchObject({ error: { code: "too_many_rows" } });
    expect(
      await user.json("POST", `/spreadsheets/${id}/versions/${legacy!.id}/copy`, undefined, 422),
    ).toMatchObject({ error: { code: "too_many_rows" } });
    // Nothing of the refused restore was kept: not the version it would have replaced.
    expect(await history()).toEqual(kept);
  });

  it("refuses a version of another spreadsheet, and one that does not exist", async () => {
    const mine = await start();
    const other = await start();
    const [version] = await other.history();
    expect(await mine.restore(version!.id, 404)).toEqual({
      error: { code: "not_found", message: "Version not found" },
    });
    await mine.restore(UNKNOWN_ID, 404);
    await user.json("POST", `/spreadsheets/${mine.id}/versions/not-an-id/restore`, undefined, 400);
  });
});

describe("copying a version", () => {
  it("makes a new spreadsheet of the version and leaves the original alone", async () => {
    const { id, table, history, current } = await start();
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "delete", index: 0 });
    const [version] = await history();
    const copy = await user.json<SpreadsheetSummary>(
      "POST",
      `/spreadsheets/${id}/versions/${version!.id}/copy`,
      undefined,
      201,
    );
    expect(copy.name).toBe("Budget (copy)");
    expect(copy.id).not.toBe(id);
    const copied = await readSnapshot(user, copy.id);
    expect(await storedInputs(user, copy.id, copied.tables[0]!.id)).toMatchObject({ "0:0": "1" });
    expect((await current()).tables.map((t) => t.rowCount)).toEqual([table.rowCount - 1]);
  });
});
