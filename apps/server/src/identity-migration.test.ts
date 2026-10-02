import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";
import { keyBetween } from "@spreadsheet-app/shared";

const directory = new URL("../drizzle/", import.meta.url);

/** Applies the migration files whose names match, in order. */
async function migrate(db: PGlite, pattern: RegExp): Promise<void> {
  for (const name of (await readdir(directory)).filter((name) => pattern.test(name)).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
}

/**
 * A database at the schema before cells were stored by id, with a plain
 * table of three rows and two columns, and a data table of two rows.
 */
async function positional(): Promise<{ db: PGlite; plain: string; data: string; sheet: string }> {
  const db = new PGlite();
  await migrate(db, /^000\d.*\.sql$/);
  const [workspace, sheet, page, plain, data] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ] as const;
  await db.query("INSERT INTO users (id, name, email) VALUES ('u', 'User', 'u@example.com')");
  await db.query("INSERT INTO workspaces (id, name) VALUES ($1, 'Workspace')", [workspace]);
  await db.query("INSERT INTO spreadsheets (id, workspace_id, name) VALUES ($1, $2, 'Sheet')", [
    sheet,
    workspace,
  ]);
  await db.query(
    "INSERT INTO pages (id, spreadsheet_id, name, position) VALUES ($1, $2, 'Page', 0)",
    [page, sheet],
  );
  const cols = (count: number) => JSON.stringify(Array.from({ length: count }, () => randomUUID()));
  await db.query(
    `INSERT INTO tables (id, page_id, name, position, row_count, col_count, col_ids, columns) VALUES
      ($1, $3, 'Plain', 0, 3, 2, $4, NULL),
      ($2, $3, 'Data', 1, 2, 1, $5, '[{"name":"Amount","type":"text"}]')`,
    [plain, data, page, cols(2), cols(1)],
  );
  // Keys that sort by bytes and not by the alphabet: Z is before a.
  for (const [table, keys] of [
    [plain, ["Zz", "a0", "a0V"]],
    [data, ["a0", "a1"]],
  ] as const) {
    for (const key of keys) {
      await db.query("INSERT INTO table_rows (table_id, order_key) VALUES ($1, $2)", [table, key]);
    }
  }
  await db.query(
    `INSERT INTO cells (table_id, row_index, col_index, input) VALUES
      ($1, 0, 0, 'first'), ($1, 2, 1, '=A1'), ($2, 1, 0, '42')`,
    [plain, data],
  );
  return { db, plain, data, sheet };
}

it("stores each cell under the ids of the row and column it was in, and drops the counts", async () => {
  const { db, plain, data, sheet } = await positional();
  try {
    await db.query(
      "INSERT INTO journal (spreadsheet_id, step, user_id, rewrites, label, data, bytes) VALUES ($1, $2, 'u', false, 'Old change', '{}', 2)",
      [sheet, randomUUID()],
    );
    await migrate(db, /^0010.*\.sql$/);

    const stored = await db.query<{
      table_id: string;
      position: string;
      col: string;
      input: string;
    }>(
      `SELECT c.table_id, c.input,
              (SELECT count(*) FROM table_rows r
                WHERE r.table_id = c.table_id
                  AND r.order_key < (SELECT order_key FROM table_rows WHERE id = c.row_id)) AS position,
              (SELECT ordinality - 1 FROM tables t, jsonb_array_elements_text(t.col_ids) WITH ORDINALITY
                WHERE t.id = c.table_id AND value = c.col_id::text) AS col
         FROM cells c ORDER BY c.input`,
    );
    expect(
      stored.rows.map((cell) => [
        cell.table_id,
        Number(cell.position),
        Number(cell.col),
        cell.input,
      ]),
    ).toEqual([
      [data, 1, 0, "42"],
      [plain, 2, 1, "=A1"],
      [plain, 0, 0, "first"],
    ]);
    const columns = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name IN ('cells', 'tables')",
    );
    const names = columns.rows.map((column) => column.column_name);
    expect(names).toEqual(expect.arrayContaining(["row_id", "col_id", "col_ids"]));
    for (const gone of ["row_index", "col_index", "row_count", "col_count"]) {
      expect(names).not.toContain(gone);
    }
    expect((await db.query("SELECT * FROM journal")).rows).toEqual([]);
    expect(
      (await db.query<{ revision: string }>("SELECT revision, rewrite_revision FROM spreadsheets"))
        .rows,
    ).toEqual([{ revision: 0, rewrite_revision: 0 }]);

    // A cell cannot name a row of another table, and goes when its row does.
    const [other] = (
      await db.query<{ id: string }>("SELECT id FROM table_rows WHERE table_id = $1", [data])
    ).rows;
    await expect(
      db.query("INSERT INTO cells (table_id, row_id, col_id, input) VALUES ($1, $2, $3, 'x')", [
        plain,
        other?.id,
        randomUUID(),
      ]),
    ).rejects.toThrow(/cells_row/);
    await db.query("DELETE FROM table_rows WHERE table_id = $1", [data]);
    expect((await db.query("SELECT * FROM cells WHERE table_id = $1", [data])).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

it("repairs a database where migration 0009 was recorded before its backfill was added", async () => {
  const { db, plain, data } = await positional();
  try {
    // This is the state left by an earlier local version of 0009: the schema
    // changes were recorded, but no row or column identities were created.
    await db.query("DELETE FROM table_rows");
    await db.query("UPDATE tables SET col_ids = '[]'::jsonb");

    await migrate(db, /^0010.*\.sql$/);

    const stored = await db.query<{
      table_id: string;
      position: string;
      col: string;
      input: string;
    }>(
      `SELECT c.table_id, c.input,
              (SELECT count(*) FROM table_rows r
                WHERE r.table_id = c.table_id
                  AND r.order_key < (SELECT order_key FROM table_rows WHERE id = c.row_id)) AS position,
              (SELECT ordinality - 1 FROM tables t, jsonb_array_elements_text(t.col_ids) WITH ORDINALITY
                WHERE t.id = c.table_id AND value = c.col_id::text) AS col
         FROM cells c ORDER BY c.input`,
    );
    expect(
      stored.rows.map((cell) => [
        cell.table_id,
        Number(cell.position),
        Number(cell.col),
        cell.input,
      ]),
    ).toEqual([
      [data, 1, 0, "42"],
      [plain, 2, 1, "=A1"],
      [plain, 0, 0, "first"],
    ]);
    expect((await db.query("SELECT count(*) FROM table_rows")).rows).toEqual([{ count: 5 }]);
    const columns = await db.query<{ id: string; col_ids: string[] }>(
      "SELECT id, col_ids FROM tables",
    );
    expect(columns.rows.find((table) => table.id === plain)?.col_ids).toHaveLength(2);
    expect(columns.rows.find((table) => table.id === data)?.col_ids).toHaveLength(1);
  } finally {
    await db.close();
  }
});

it.each([
  ["outside its table's rows", "(table_id, row_index, col_index, input) VALUES ($1, 3, 0, 'lost')"],
  [
    "outside its table's columns",
    "(table_id, row_index, col_index, input) VALUES ($1, 0, 2, 'lost')",
  ],
])("stops, and changes nothing, when a cell is %s", async (_, values) => {
  const { db, plain } = await positional();
  try {
    await db.query(`INSERT INTO cells ${values}`, [plain]);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(await readFile(new URL("0010_cells_by_id.sql", directory), "utf8"));
      }),
    ).rejects.toThrow("1 cells are outside the rows or columns of their table");
    // The server runs a migration in a transaction, so a stop leaves the cells as they were.
    expect((await db.query("SELECT row_index, col_index FROM cells")).rows).toHaveLength(4);
  } finally {
    await db.close();
  }
});

it("backfills stable rows and columns without changing inputs, and clears incompatible history", async () => {
  const db = new PGlite();
  try {
    for (const name of (await readdir(directory))
      .filter((name) => /^000[0-8].*\.sql$/.test(name))
      .sort()) {
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    }
    const workspace = randomUUID();
    const sheet = randomUUID();
    const page = randomUUID();
    const plain = randomUUID();
    const data = randomUUID();
    await db.query("INSERT INTO users (id, name, email) VALUES ('u', 'User', 'u@example.com')");
    await db.query("INSERT INTO workspaces (id, name) VALUES ($1, 'Workspace')", [workspace]);
    await db.query("INSERT INTO spreadsheets (id, workspace_id, name) VALUES ($1, $2, 'Sheet')", [
      sheet,
      workspace,
    ]);
    await db.query(
      "INSERT INTO pages (id, spreadsheet_id, name, position) VALUES ($1, $2, 'Page', 0)",
      [page, sheet],
    );
    await db.query(
      'INSERT INTO tables (id, page_id, name, position, row_count, col_count, columns) VALUES ($1, $3, \'Plain\', 0, 1000, 2, NULL), ($2, $3, \'Data\', 1, 2, 1, \'[{"name":"Amount","type":"text"}]\')',
      [plain, data, page],
    );
    await db.query(
      "INSERT INTO cells (table_id, row_index, col_index, input) VALUES ($1, 999, 1, '=A1'), ($2, 0, 0, '42')",
      [plain, data],
    );
    await db.query(
      "INSERT INTO journal (spreadsheet_id, step, user_id, rewrites, label, data, bytes) VALUES ($1, $2, 'u', false, 'Old change', '{}', 2)",
      [sheet, randomUUID()],
    );
    const before = await db.query("SELECT * FROM cells ORDER BY table_id, row_index, col_index");
    await db.exec(await readFile(new URL("0009_lean_harrier.sql", directory), "utf8"));
    expect(
      (await db.query("SELECT * FROM cells ORDER BY table_id, row_index, col_index")).rows,
    ).toEqual(before.rows);
    const rows = await db.query<{ id: string; table_id: string; order_key: string }>(
      "SELECT * FROM table_rows ORDER BY table_id, order_key",
    );
    expect(rows.rows.filter((row) => row.table_id === plain)).toHaveLength(1000);
    expect(rows.rows.filter((row) => row.table_id === data)).toHaveLength(2);
    expect(new Set(rows.rows.map((row) => row.id)).size).toBe(1002);
    for (const row of rows.rows) expect(keyBetween(row.order_key, null) > row.order_key).toBe(true);
    const columns = await db.query<{ col_ids: string[]; col_count: number }>(
      "SELECT col_ids, col_count FROM tables",
    );
    for (const table of columns.rows) {
      expect(table.col_ids).toHaveLength(table.col_count);
      expect(new Set(table.col_ids).size).toBe(table.col_count);
    }
    expect((await db.query("SELECT * FROM journal")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});
