import type { ConditionalRule } from "@spreadsheet-app/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Change, SpreadsheetSummary } from "./app";
import {
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  rowIds,
  startTestServer,
  withClientId,
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

/** A table of ten rows and eight columns holding numbers in A, with the ids of its rows and columns. */
async function table() {
  const snapshot = await createSpreadsheet(user);
  const tableId = snapshot.tables[0]!.id;
  await user.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A1: "1", A2: "5", A3: "9" }));
  const current = async () => {
    const read = await readSnapshot(user, snapshot.id);
    return { read, table: read.tables.find((candidate) => candidate.id === tableId)! };
  };
  const { read, table: first } = await current();
  const rows = rowIds(read, tableId);
  const range = (
    startRow: number,
    endRow: number | null,
    startCol = 0,
    endCol: number | null = 0,
  ) => ({
    startRowId: rows[startRow]!,
    endRowId: endRow === null ? null : rows[endRow]!,
    startColId: first.colIds[startCol]!,
    endColId: endCol === null ? null : first.colIds[endCol]!,
  });
  const put = (rules: object[], status = 200) =>
    user.json<Change>("PUT", `/tables/${tableId}/conditional-formats`, { rules }, status);
  const rules = async (): Promise<ConditionalRule[]> => (await current()).table.conditionalFormats;
  return { id: snapshot.id, tableId, rows, colIds: first.colIds, range, put, rules, current };
}

const criterion = (range: object, text: string, format: object = { fill: "green" }) => ({
  range,
  kind: "criterion",
  criterion: text,
  format,
});

describe("a table's conditional formats", () => {
  it("start empty", async () => {
    const { rules } = await table();
    expect(await rules()).toEqual([]);
  });

  it("are stored as positions, for both kinds of rule", async () => {
    const { range, put, rules } = await table();
    await put([
      criterion(range(0, null), ">3"),
      { range: range(1, 2, 1, 1), kind: "scale", low: null, high: "blue" },
    ]);
    expect(await rules()).toEqual([
      {
        startRow: 0,
        endRow: null,
        startCol: 0,
        endCol: 0,
        kind: "criterion",
        criterion: ">3",
        format: { fill: "green" },
      },
      { startRow: 1, endRow: 2, startCol: 1, endCol: 1, kind: "scale", low: null, high: "blue" },
    ]);
  });

  it("replace the whole list", async () => {
    const { range, put, rules } = await table();
    await put([criterion(range(0, null), ">3")]);
    await put([]);
    expect(await rules()).toEqual([]);
  });

  it("are refused past 50 rules, for a criterion that is too long, and for a range that ends before it starts", async () => {
    const { range, put, rules } = await table();
    await put(
      Array.from({ length: 51 }, () => criterion(range(0, null), ">3")),
      400,
    );
    // The schema limits a criterion to the length the wildcard matcher takes.
    await put([criterion(range(0, null), "a".repeat(256))], 400);
    await put([criterion(range(2, 0), ">3")], 400);
    await put([criterion({ ...range(0, null), startRowId: crypto.randomUUID() }, ">3")], 409);
    expect(await rules()).toEqual([]);
  });

  it("are refused for a color a client cannot write, such as a shade", async () => {
    const { range, put } = await table();
    await put([criterion(range(0, null), ">3", { shade: { low: null, high: "red", at: 1 } })], 400);
  });

  it("follow the cells when rows and columns are inserted and deleted", async () => {
    const { id, tableId, rows, colIds, range, put, rules } = await table();
    await put([criterion(range(1, 2), ">3")]);
    await user.json("POST", `/tables/${tableId}/edits`, {
      axis: "row",
      kind: "insert",
      beforeId: rows[0],
      ids: [crypto.randomUUID()],
    });
    expect(await rules()).toMatchObject([{ startRow: 2, endRow: 3 }]);
    await user.json("POST", `/tables/${tableId}/edits`, {
      axis: "col",
      kind: "insert",
      beforeId: colIds[0],
      ids: [crypto.randomUUID()],
    });
    expect(await rules()).toMatchObject([{ startCol: 1, endCol: 1 }]);
    await user.json("POST", `/tables/${tableId}/edits`, {
      axis: "row",
      kind: "delete",
      ids: [rows[1], rows[2]],
    });
    expect(await rules()).toEqual([]);
    expect(id).toBeDefined();
  });

  it("are undone and redone as one step", async () => {
    const { id, tableId, range, rules } = await table();
    const client = withClientId(user);
    await client.json("PUT", `/tables/${tableId}/conditional-formats`, {
      rules: [criterion(range(0, null), ">3")],
    });
    await client.json("POST", `/spreadsheets/${id}/undo`);
    expect(await rules()).toEqual([]);
    await client.json("POST", `/spreadsheets/${id}/redo`);
    expect(await rules()).toHaveLength(1);
  });

  it("are imported from a file and come back when a version is copied", async () => {
    const rule = {
      startRow: 0,
      endRow: null,
      startCol: 0,
      endCol: 0,
      kind: "criterion",
      criterion: "Done",
      format: { fill: "green" },
    };
    const file = (conditionalFormats: object[]) => ({
      format: "spreadsheet-app",
      version: 1,
      name: "Conditional",
      pages: [
        {
          name: "Data",
          blocks: [
            { type: "table", name: "T", rowCount: 2, colCount: 2, conditionalFormats, cells: [] },
          ],
        },
      ],
    });
    const summary = await user.json<SpreadsheetSummary>(
      "POST",
      "/spreadsheets/import",
      file([
        rule,
        {
          startRow: 0,
          endRow: 1,
          startCol: 1,
          endCol: 1,
          kind: "scale",
          low: "red",
          high: "green",
        },
      ]),
      201,
    );
    const imported = (await readSnapshot(user, summary.id)).tables[0]!;
    expect(imported.conditionalFormats).toHaveLength(2);
    await user.json(
      "POST",
      "/spreadsheets/import",
      file([{ ...rule, criterion: "a".repeat(256) }]),
      400,
    );

    // A change keeps a version, and copying it carries the rules.
    await user.json("PUT", `/tables/${imported.id}/cells`, cellsBody({ A1: "x" }));
    const history = await user.json<{ id: string }[]>(
      "GET",
      `/spreadsheets/${summary.id}/versions`,
    );
    const copy = await user.json<SpreadsheetSummary>(
      "POST",
      `/spreadsheets/${summary.id}/versions/${history.at(-1)!.id}/copy`,
      undefined,
      201,
    );
    expect((await readSnapshot(user, copy.id)).tables[0]!.conditionalFormats).toEqual(
      imported.conditionalFormats,
    );
  });
});
