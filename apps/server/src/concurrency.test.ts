import type { FormatRule } from "@spreadsheet-app/engine";
import { and, eq, ilike, sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Snapshot, TableRecord } from "./app";
import type { Database } from "./db/client";
import { spreadsheets } from "./db/schema";
import { SpreadsheetRepository } from "./repo/spreadsheets";
import {
  cellsBody,
  createSpreadsheet,
  startTestServer,
  storedInputs,
  type TestServer,
  type TestUser,
} from "./testing";

const pgStatActivity = pgTable("pg_stat_activity", {
  datname: text("datname"),
  pid: integer("pid"),
  waitEventType: text("wait_event_type"),
  query: text("query"),
});

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp();
});
afterAll(() => server.close());

/**
 * A repository whose first transaction waits for `other` to finish. That is
 * the order of events when another request commits between this one's lookup
 * of what it is changing and the transaction that changes it.
 */
function overtakenBy(other: () => Promise<unknown>): SpreadsheetRepository {
  let waiting = true;
  const db = new Proxy(server.db, {
    get(target, property) {
      if (property === "transaction") {
        return async (...args: Parameters<Database["transaction"]>) => {
          if (waiting) {
            waiting = false;
            await other();
          }
          return target.transaction(...args);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return new SpreadsheetRepository(db, user.userId);
}

async function start(): Promise<{
  id: string;
  table: TableRecord;
  current(): Promise<TableRecord>;
}> {
  const snapshot = await createSpreadsheet(user);
  const table = snapshot.tables[0]!;
  return {
    id: snapshot.id,
    table,
    current: async () =>
      (await user.json<Snapshot>("GET", `/spreadsheets/${snapshot.id}`)).tables[0]!,
  };
}

/** Names the columns of a table and makes its second column a formula column. */
async function withFormulaColumn(tableId: string, formula: string): Promise<void> {
  await user.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
  await user.json("PATCH", `/tables/${tableId}/columns/1`, { type: "formula", formula });
}

async function waitForSpreadsheetLockWait(db: Database): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [waiting] = await db
      .select({ pid: pgStatActivity.pid })
      .from(pgStatActivity)
      .where(
        and(
          eq(pgStatActivity.datname, sql`current_database()`),
          eq(pgStatActivity.waitEventType, "Lock"),
          ilike(pgStatActivity.query, "%spreadsheets%"),
          ilike(pgStatActivity.query, "%for update%"),
        ),
      )
      .limit(1);
    if (waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Editor write did not wait for the spreadsheet lock");
}

describe("a change that another change overtakes", () => {
  it("refuses a cell that a deleted column left outside the table", async () => {
    const { id, table } = await start();
    const last = table.colCount - 1;
    const repository = overtakenBy(() =>
      user.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "delete", index: 0 }),
    );

    await expect(
      repository.setCells(table.id, [{ row: 0, col: last, input: "late" }]),
    ).rejects.toMatchObject({ code: "cell_out_of_bounds" });
    expect(await storedInputs(user, id, table.id)).toEqual({});
  });

  it("refuses a cell in a column that became a formula column", async () => {
    const { id, table } = await start();
    const repository = overtakenBy(() => withFormulaColumn(table.id, "=1"));

    await expect(
      repository.setCells(table.id, [{ row: 0, col: 1, input: "typed" }]),
    ).rejects.toMatchObject({ code: "formula_column" });
    expect(await storedInputs(user, id, table.id)).toEqual({});
  });

  it("keeps a column's new formula when the table is resized at the same time", async () => {
    const { table, current } = await start();
    await withFormulaColumn(table.id, "=1");
    const repository = overtakenBy(() =>
      user.json("PATCH", `/tables/${table.id}/columns/1`, { formula: "=2" }),
    );

    await repository.updateTable(table.id, { rowCount: 30 });
    expect(await current()).toMatchObject({ rowCount: 30 });
    expect((await current()).columns?.[1]).toMatchObject({ type: "formula", formula: "=2" });
  });

  it("keeps both changes when two columns are changed at the same time", async () => {
    const { table, current } = await start();
    await withFormulaColumn(table.id, "=1");
    const repository = overtakenBy(() =>
      user.json("PATCH", `/tables/${table.id}/columns/1`, { formula: "=2" }),
    );

    await repository.updateColumn(table.id, 0, { name: "First" });
    const { columns } = await current();
    expect(columns?.[0]).toMatchObject({ name: "First" });
    expect(columns?.[1]).toMatchObject({ formula: "=2" });
  });

  it("keeps the column count and the column names in step", async () => {
    const { table, current } = await start();
    await user.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
    const repository = overtakenBy(() =>
      user.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "insert", index: 0 }),
    );

    await repository.updateColumn(table.id, 0, { name: "Renamed" });
    const after = await current();
    expect(after.columns).toHaveLength(after.colCount);
    expect(after.columns?.map((column) => column.name)).toContain("Renamed");
  });

  it("keeps both formats when two are given at the same time", async () => {
    const { table, current } = await start();
    const rule = (row: number, format: FormatRule["format"]): FormatRule => ({
      startRow: row,
      endRow: row,
      startCol: 0,
      endCol: 0,
      format,
    });
    const repository = overtakenBy(() =>
      user.json("POST", `/tables/${table.id}/formats`, {
        range: { startRow: 0, endRow: 0, startCol: 0, endCol: 0 },
        format: { bold: true },
      }),
    );

    await repository.formatCells(table.id, rule(1, { italic: true }));
    expect((await current()).formats).toHaveLength(2);
  });

  it("does not bring back a table that was deleted", async () => {
    const { id, table } = await start();
    await user.json("POST", `/pages/${table.pageId}/tables`, {}, 201);
    const repository = overtakenBy(() =>
      user.json("DELETE", `/tables/${table.id}`, undefined, 204),
    );

    await expect(
      repository.setCells(table.id, cellsBody({ A1: "late" }).cells as never),
    ).rejects.toMatchObject({ status: 404 });
    expect((await user.json<Snapshot>("GET", `/spreadsheets/${id}`)).cells).toEqual([]);
  });
});

describe("access after waiting for a spreadsheet lock", () => {
  it.skipIf(process.env.TEST_DATABASE_URL === undefined)(
    "refuses a write after its editor role is downgraded while it waits",
    async () => {
      const owner = await server.signUp("Owner");
      const editor = await server.signUp("Editor");
      const snapshot = await createSpreadsheet(owner);
      await owner.json("PUT", `/spreadsheets/${snapshot.id}/members`, {
        email: editor.email,
        role: "editor",
      });

      const holder = await server.openConnection?.();
      if (!holder) throw new Error("A second connection requires TEST_DATABASE_URL");

      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signalLocked!: () => void;
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      const holdingLock = holder.db.transaction(async (tx) => {
        await tx
          .select({ id: spreadsheets.id })
          .from(spreadsheets)
          .where(eq(spreadsheets.id, snapshot.id))
          .for("update");
        signalLocked();
        await released;
      });
      await locked;

      const write = editor.request("POST", `/spreadsheets/${snapshot.id}/pages`, {});
      try {
        await waitForSpreadsheetLockWait(server.db);
        await owner.json("PUT", `/spreadsheets/${snapshot.id}/members`, {
          email: editor.email,
          role: "viewer",
        });
        release();
        expect((await write).status).toBe(403);
      } finally {
        release();
        await holdingLock.catch(() => undefined);
        await write.catch(() => undefined);
        await holder.close();
      }
    },
  );

  it.skipIf(process.env.TEST_DATABASE_URL === undefined)(
    "refuses an undo after its editor role is downgraded while it waits",
    async () => {
      const owner = await server.signUp("Undo owner");
      const editor = await server.signUp("Undo editor");
      const snapshot = await createSpreadsheet(owner);
      const table = snapshot.tables[0]!;
      await owner.json("PUT", `/spreadsheets/${snapshot.id}/members`, {
        email: editor.email,
        role: "editor",
      });
      await editor.request("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "saved" }));

      const holder = await server.openConnection?.();
      if (!holder) throw new Error("A second connection requires TEST_DATABASE_URL");

      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signalLocked!: () => void;
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      const holdingLock = holder.db.transaction(async (tx) => {
        await tx
          .select({ id: spreadsheets.id })
          .from(spreadsheets)
          .where(eq(spreadsheets.id, snapshot.id))
          .for("update");
        signalLocked();
        await released;
      });
      await locked;

      const undo = editor.request("POST", `/spreadsheets/${snapshot.id}/undo`);
      try {
        await waitForSpreadsheetLockWait(server.db);
        await owner.json("PUT", `/spreadsheets/${snapshot.id}/members`, {
          email: editor.email,
          role: "viewer",
        });
        release();
        expect((await undo).status).toBe(403);
        expect(await storedInputs(owner, snapshot.id, table.id)).toEqual({ "0:0": "saved" });
      } finally {
        release();
        await holdingLock.catch(() => undefined);
        await undo.catch(() => undefined);
        await holder.close();
      }
    },
  );
});
