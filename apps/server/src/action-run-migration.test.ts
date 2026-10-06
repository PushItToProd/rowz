import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
const directory = new URL("../drizzle/", import.meta.url);

it("backfills existing runs with an unknown kind", async () => {
  const db = new PGlite();
  try {
    for (const name of (await readdir(directory))
      .filter((name) => /^00(0[0-9]|1[0-5])_.*\.sql$/.test(name))
      .sort()) {
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    }

    const workspaceId = randomUUID();
    const spreadsheetId = randomUUID();
    const tableId = randomUUID();
    const viewId = randomUUID();
    await db.query("INSERT INTO users (id, name, email) VALUES ('u', 'User', 'u@example.com')");
    await db.query("INSERT INTO workspaces (id, name) VALUES ($1, 'Workspace')", [workspaceId]);
    await db.query("INSERT INTO spreadsheets (id, workspace_id, name) VALUES ($1, $2, 'Sheet')", [
      spreadsheetId,
      workspaceId,
    ]);
    await db.query(
      `INSERT INTO action_runs
        (spreadsheet_id, table_id, row_index, col_index, user_id, effects, status)
       VALUES ($1, $2, 0, 0, 'u', '[]', 'succeeded')`,
      [spreadsheetId, tableId],
    );
    await db.query(
      `INSERT INTO action_runs
        (spreadsheet_id, table_id, row_index, col_index, view_id, button_index, user_id, effects, status)
       VALUES ($1, NULL, NULL, NULL, $2, 0, 'u', '[]', 'succeeded')`,
      [spreadsheetId, viewId],
    );

    const migration = (await readdir(directory)).find((name) => /^0016_.*\.sql$/.test(name));
    expect(migration).toBeDefined();
    await db.exec(await readFile(new URL(migration!, directory), "utf8"));

    const migrated = await db.query<{ target: string; kind: string }>(
      `SELECT CASE WHEN view_id IS NULL THEN 'cell' ELSE 'view' END AS target, kind
         FROM action_runs ORDER BY target`,
    );
    expect(migrated.rows).toEqual([
      { target: "cell", kind: "unknown" },
      { target: "view", kind: "unknown" },
    ]);
  } finally {
    await db.close();
  }
});
