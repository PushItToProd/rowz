import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Change, ClickResult, UndoResult } from "./app";
import {
  addTable,
  addView,
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  rowIds,
  startTestServer,
  storedInputs,
  withClientId,
  type TestServer,
} from "./testing";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => server.close());

for (const axis of ["row", "col"] as const) {
  it(`a save, click, and control input follow IDs across a ${axis} insertion`, async () => {
    const owner = await server.signUp();
    const snapshot = await createSpreadsheet(owner);
    const table = snapshot.tables[0]!;
    const rowId = rowIds(snapshot, table.id)[1]!;
    const target = table.colIds[0]!;
    const button = table.colIds[1]!;
    const control = table.colIds[2]!;
    await owner.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A2: "1", B2: '=BUTTON("Increment", EXECUTE(A2+1, A2))', C2: "=CHECKBOX(A2)" }),
    );
    await owner.json("POST", `/tables/${table.id}/edits`, { axis, kind: "insert", index: 0 });
    await owner.json(
      "PUT",
      `/tables/${table.id}/cells`,
      { cells: [{ rowId, colId: target, input: "4" }] }, 200,
    );
    const clicked = await owner.json<ClickResult>(
      "POST",
      `/tables/${table.id}/cells/${rowId}/${button}/click`,
    );
    expect(clicked.status).toBe("succeeded");
    const row = axis === "row" ? 2 : 1;
    const col = axis === "col" ? 1 : 0;
    expect(await storedInputs(owner, snapshot.id, table.id)).toMatchObject({
      [`${String(row)}:${String(col)}`]: "5",
    });
    const chosen = await owner.json<ClickResult>(
      "POST",
      `/tables/${table.id}/cells/${rowId}/${control}/input`,
      { value: true },
    );
    expect(chosen.status).toBe("succeeded");
    expect(await storedInputs(owner, snapshot.id, table.id)).toMatchObject({
      [`${String(row)}:${String(col)}`]: "TRUE",
    });
  });

  it(`refuses the whole request when its ${axis} ID was deleted`, async () => {
    const owner = await server.signUp();
    const snapshot = await createSpreadsheet(owner);
    const table = snapshot.tables[0]!;
    const [firstRow, rowId] = rowIds(snapshot, table.id) as [string, string];
    const colId = table.colIds[1]!;
    await owner.json("POST", `/tables/${table.id}/edits`, { axis, kind: "delete", index: 1 });
    const code = axis === "row" ? "row_deleted" : "column_deleted";
    expect(
      await owner.json(
        "PUT",
        `/tables/${table.id}/cells`,
        {
          cells: [
            { rowId: firstRow, colId: table.colIds[0], input: "must roll back" },
            { rowId, colId, input: "lost" },
          ],
        },
        409,
      ),
    ).toMatchObject({ error: { code } });
    for (const suffix of ["click", "input"]) {
      expect(
        await owner.json(
          "POST",
          `/tables/${table.id}/cells/${rowId}/${colId}/${suffix}`,
          suffix === "input" ? { value: true } : undefined,
          409,
        ),
      ).toMatchObject({ error: { code } });
    }
    expect((await readSnapshot(owner, snapshot.id)).cells).toEqual([]);
  });
}

it("deletes only the captured row IDs when a concurrent insert separates them, and restores them with undo", async () => {
  const owner = await server.signUp();
  const ada = withClientId(owner);
  const grace = withClientId(owner);
  const before = await createSpreadsheet(owner);
  const table = before.tables[0]!;
  const original = rowIds(before, table.id);
  const selected = original.slice(1, 4);
  await owner.json(
    "PUT",
    `/tables/${table.id}/cells`,
    cellsBody({ A2: "2", A3: "3", A4: "4", A6: "6", B1: "=SUM(A2:A6)" }),
  );
  await grace.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "insert", index: 2 });
  const inserted = rowIds(await readSnapshot(owner, before.id), table.id);
  const [newRow] = inserted.filter((id) => !original.includes(id));
  await ada.json("POST", `/tables/${table.id}/edits`, {
    axis: "row",
    kind: "delete",
    ids: selected,
  });
  const after = rowIds(await readSnapshot(owner, before.id), table.id);
  expect(after).toEqual(inserted.filter((id) => !selected.includes(id)));
  expect(after).toContain(newRow);
  // The formula is as deleting row 2, and then rows 4 and 5, would leave it.
  expect(await storedInputs(owner, before.id, table.id)).toEqual({
    "3:0": "6",
    "0:1": "=SUM(A2:A4)",
  });
  const undone = await ada.json<UndoResult>("POST", `/spreadsheets/${before.id}/undo`);
  expect(undone.outcome).toBe("done");
  expect(rowIds(await readSnapshot(owner, before.id), table.id)).toEqual(inserted);
});

it("updates a captured column and formats a captured range after rows and columns are inserted", async () => {
  const owner = await server.signUp();
  const before = await createSpreadsheet(owner);
  const table = before.tables[0]!;
  const rows = rowIds(before, table.id);
  await owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A3: "keeps three rows" }));
  await owner.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
  await owner.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "insert", index: 0 });
  await owner.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "insert", index: 0 });
  await owner.json("PATCH", `/tables/${table.id}/columns/${table.colIds[1]!}`, {
    name: "Captured",
    type: "formula",
    formula: "=1+1",
  });
  await owner.json("POST", `/tables/${table.id}/formats`, {
    range: {
      startRowId: rows[1],
      endRowId: rows[2],
      startColId: table.colIds[0],
      endColId: table.colIds[1],
    },
    format: { bold: true },
  });
  const after = await readSnapshot(owner, before.id);
  expect(after.tables[0]!.columns![2]).toMatchObject({
    name: "Captured",
    type: "formula",
    formula: "=1+1",
  });
  expect(after.tables[0]!.formats).toContainEqual({
    startRow: 2,
    endRow: 3,
    startCol: 1,
    endCol: 2,
    format: { bold: true },
  });
});

it("answers 409 to a column change, a format, and an edit that name something deleted", async () => {
  const owner = await server.signUp();
  const before = await createSpreadsheet(owner);
  const table = before.tables[0]!;
  const rows = rowIds(before, table.id);
  await owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A3: "keeps three rows" }));
  await owner.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
  await owner.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "delete", index: 1 });
  await owner.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "delete", index: 1 });
  const [goneRow, goneCol] = [rows[1]!, table.colIds[1]!];

  expect(
    await owner.json("PATCH", `/tables/${table.id}/columns/${goneCol}`, { name: "x" }, 409),
  ).toMatchObject({ error: { code: "column_deleted" } });
  const range = { startRowId: rows[0], endRowId: null, startColId: table.colIds[0], endColId: null };
  for (const [gone, code] of [
    [{ startRowId: goneRow }, "row_deleted"],
    [{ endRowId: goneRow }, "row_deleted"],
    [{ startColId: goneCol }, "column_deleted"],
    [{ endColId: goneCol }, "column_deleted"],
  ] as const) {
    expect(
      await owner.json(
        "POST",
        `/tables/${table.id}/formats`,
        { range: { ...range, ...gone }, format: { bold: true } },
        409,
      ),
    ).toMatchObject({ error: { code } });
  }
  const edits = `/tables/${table.id}/edits`;
  const insert = { kind: "insert", ids: [randomUUID()] };
  expect(
    await owner.json("POST", edits, { axis: "row", ...insert, beforeId: goneRow }, 409),
  ).toMatchObject({ error: { code: "row_deleted" } });
  expect(
    await owner.json("POST", edits, { axis: "col", ...insert, beforeId: goneCol }, 409),
  ).toMatchObject({ error: { code: "column_deleted" } });
  expect(
    await owner.json("POST", edits, { axis: "row", kind: "delete", ids: [rows[0], goneRow] }, 409),
  ).toMatchObject({ error: { code: "row_deleted" } });
  // Nothing of a refused delete was applied.
  expect(rowIds(await readSnapshot(owner, before.id), table.id)).toEqual([rows[0], rows[2]]);
});

describe("rows a save adds", () => {
  async function start() {
    const owner = await server.signUp();
    const client = withClientId(owner);
    const snapshot = await createSpreadsheet(owner);
    const table = snapshot.tables[0]!;
    const [colId] = table.colIds as [string];
    const path = `/tables/${table.id}/cells`;
    const rows = async () => rowIds(await readSnapshot(owner, snapshot.id), table.id);
    const save = (rowId: string, input: string, status = 200) =>
      client.json<Change>(
        "PUT",
        path,
        { appendRows: [rowId], cells: [{ rowId, colId, input }] },
        status,
      );
    const history = (direction: "undo" | "redo") =>
      client.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/${direction}`);
    return { owner, client, snapshot, table, colId, path, rows, save, history };
  }

  it("adds the row at the end with its cell, as one change", async () => {
    const { snapshot, table, rows, save } = await start();
    const before = await rows();
    const rowId = randomUUID();
    const change = await save(rowId, "new");
    expect(change.changed).toMatchObject({
      rows: [{ id: rowId, tableId: table.id, orderKey: expect.any(String) }],
      cells: [{ rowId, input: "new" }],
    });
    expect(await rows()).toEqual([...before, rowId]);
  });

  it("adds the row once when the save is repeated", async () => {
    const { rows, save } = await start();
    const before = await rows();
    const rowId = randomUUID();
    await save(rowId, "new");
    await save(rowId, "new again");
    expect(await rows()).toEqual([...before, rowId]);
  });

  it("refuses a save repeated after its row was deleted, and stores nothing", async () => {
    const { owner, snapshot, table, rows, save } = await start();
    const before = await rows();
    const rowId = randomUUID();
    await save(rowId, "new");
    await owner.json("POST", `/tables/${table.id}/edits`, {
      axis: "row",
      kind: "delete",
      ids: [rowId],
    });
    expect(await save(rowId, "back again", 409)).toMatchObject({ error: { code: "row_deleted" } });
    expect(await rows()).toEqual(before);
    expect((await readSnapshot(owner, snapshot.id)).cells).toEqual([]);
  });

  it("refuses a save repeated after the step that added its row was undone, until the step is redone", async () => {
    const { owner, snapshot, rows, save, history } = await start();
    const before = await rows();
    const rowId = randomUUID();
    await save(rowId, "new");
    expect((await history("undo")).outcome).toBe("done");
    expect(await save(rowId, "back again", 409)).toMatchObject({ error: { code: "row_deleted" } });
    expect(await rows()).toEqual(before);

    expect((await history("redo")).outcome).toBe("done");
    expect(await rows()).toEqual([...before, rowId]);
    expect((await readSnapshot(owner, snapshot.id)).cells.map((cell) => cell.input)).toEqual([
      "new",
    ]);
    // The row exists again, so a save that names it is an ordinary save.
    await save(rowId, "changed");
  });

  it("refuses an id that is a row of another table, without saying where it is", async () => {
    const { owner, snapshot, rows, save } = await start();
    const before = await rows();
    const other = await addTable(owner, snapshot.pages[0]!.id);
    const [taken] = rowIds(await readSnapshot(owner, snapshot.id), other.id);
    expect(await save(taken!, "stolen", 409)).toEqual({
      error: { code: "conflict", message: "A new row has an id that is already in use" },
    });
    const stranger = await server.signUp();
    const elsewhere = await createSpreadsheet(stranger);
    const [foreign] = rowIds(elsewhere, elsewhere.tables[0]!.id);
    expect(await save(foreign!, "stolen", 409)).toEqual({
      error: { code: "conflict", message: "A new row has an id that is already in use" },
    });
    expect(await rows()).toEqual(before);
  });

  it("refuses rows past the size limit of a table", async () => {
    const { owner, table, path } = await start();
    await owner.json("PATCH", `/tables/${table.id}`, { rowCount: 1000 });
    expect(await owner.json("PUT", path, { appendRows: [randomUUID()], cells: [] }, 422)).toEqual({
      error: { code: "table_full", message: "A table can have at most 1000 rows" },
    });
  });
});

describe("a formula written before rows or columns changed", () => {
  async function start() {
    const owner = await server.signUp();
    const snapshot = await createSpreadsheet(owner);
    const table = snapshot.tables[0]!;
    const [rowId] = rowIds(snapshot, table.id) as [string];
    const [colId, other] = table.colIds as [string, string];
    const save = (input: string, revision: number | undefined, status = 200, col = colId) =>
      owner.json<Change>(
        "PUT",
        `/tables/${table.id}/cells`,
        { cells: [{ rowId, colId: col, input }], ...(revision === undefined ? {} : { revision }) },
        status,
      );
    const insertRow = () =>
      owner.json<Change>("POST", `/tables/${table.id}/edits`, {
        axis: "row",
        kind: "insert",
        index: 0,
      });
    const stale = { error: { code: "stale_formula" } };
    return { owner, snapshot, table, other, save, insertRow, stale };
  }

  it("is refused, while a value written then is stored", async () => {
    const { snapshot, table, owner, other, save, insertRow, stale } = await start();
    const opened = snapshot.revision;
    // The table holds no formula, and the insert still changes what A6 means.
    const { revision } = await insertRow();
    expect(await save("=A6", opened, 409)).toMatchObject(stale);
    await save("typed", opened);
    expect(await storedInputs(owner, snapshot.id, table.id)).toEqual({ "1:0": "typed" });

    // A formula written against the spreadsheet as it is now is stored.
    await save("=A6", revision, 200, other);
    expect(await storedInputs(owner, snapshot.id, table.id)).toMatchObject({ "1:1": "=A6" });
  });

  it("is stored when only values changed since, and when no revision is given", async () => {
    const { snapshot, save } = await start();
    await save("typed", undefined);
    await save("=A6", snapshot.revision);
    await save("=A7", undefined);
  });

  it("is refused after a rename and a move too", async () => {
    const { owner, snapshot, table, save, stale } = await start();
    const renamed = await owner.json<Change>("PATCH", `/tables/${table.id}`, { name: "Sales" });
    expect(await save("=Sales!A1", snapshot.revision, 409)).toMatchObject(stale);
    const { page } = await owner.json<{ page: { id: string } }>(
      "POST",
      `/spreadsheets/${snapshot.id}/pages`,
      {},
      201,
    );
    const view = await addView(owner, snapshot.pages[0]!.id);
    await owner.json("PUT", `/views/${view.id}/page`, { pageId: page.id });
    expect(await save("=Sales!A1", renamed.revision + 2, 409)).toMatchObject(stale);
  });

  it("is refused as the formula of a formula column and as the source of a view", async () => {
    const { owner, snapshot, table, insertRow, stale } = await start();
    await owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "1" }));
    await owner.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
    const view = await addView(owner, snapshot.pages[0]!.id);
    const opened = await owner.json<Change>("PATCH", `/views/${view.id}`, { name: "Report" });
    const { revision } = await insertRow();

    const column = `/tables/${table.id}/columns/${table.colIds[1]!}`;
    const formula = { type: "formula", formula: "=A1" };
    expect(
      await owner.json("PATCH", column, { ...formula, revision: opened.revision }, 409),
    ).toMatchObject(stale);
    // A change that writes no formula is not checked.
    await owner.json("PATCH", column, { name: "Renamed", revision: opened.revision });
    await owner.json("PATCH", column, { ...formula, revision: revision + 1 });

    const source = "{{ 'Table 1'!A1 }}";
    expect(
      await owner.json("PATCH", `/views/${view.id}`, { source, revision: opened.revision }, 409),
    ).toMatchObject(stale);
    await owner.json("PATCH", `/views/${view.id}`, { name: "Still", revision: opened.revision });
    const current = (await readSnapshot(owner, snapshot.id)).revision;
    await owner.json("PATCH", `/views/${view.id}`, { source, revision: current });
  });
});
