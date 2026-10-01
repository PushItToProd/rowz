import { LIMITS } from "@spreadsheet-app/shared";
import { desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClickResult, PageRecord, Snapshot, TableRecord } from "./app";
import { actionRuns } from "./db/schema";
import {
  cellsBody,
  createSpreadsheet,
  startTestServer,
  storedInputs,
  type TestClient,
  type TestServer,
  type TestUser,
} from "./testing";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer({ emailRunsPerHour: 3 });
  user = await server.signUp();
});
afterEach(() => {
  server.failSending(false);
  server.sent.length = 0;
  vi.restoreAllMocks();
});
afterAll(() => server.close());

interface Sheet {
  spreadsheetId: string;
  pageId: string;
  tableId: string;
}

/** Creates a spreadsheet whose first table holds `inputs`. */
async function sheetWith(inputs: Record<string, string>, as: TestClient = user): Promise<Sheet> {
  const snapshot = await createSpreadsheet(as);
  const tableId = snapshot.tables[0]!.id;
  if (Object.keys(inputs).length > 0) {
    await as.json("PUT", `/tables/${tableId}/cells`, cellsBody(inputs), 204);
  }
  return { spreadsheetId: snapshot.id, pageId: snapshot.pages[0]!.id, tableId };
}

function click(
  sheet: Sheet,
  row: number,
  col: number,
  as: TestClient = user,
): Promise<ClickResult> {
  return as.json<ClickResult>(
    "POST",
    `/tables/${sheet.tableId}/cells/${String(row)}/${String(col)}/click`,
  );
}

async function runsFor(sheet: Sheet): Promise<(typeof actionRuns.$inferSelect)[]> {
  return server.db
    .select()
    .from(actionRuns)
    .where(eq(actionRuns.spreadsheetId, sheet.spreadsheetId))
    .orderBy(desc(actionRuns.createdAt));
}

describe("clicking an EXECUTE button", () => {
  it("writes the value, reports the changed cell, and records the run", async () => {
    const sheet = await sheetWith({
      A1: "1",
      A2: "2",
      A4: '=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))',
    });

    const result = await click(sheet, 3, 0);
    expect(result).toEqual({
      runId: expect.any(String),
      status: "succeeded",
      error: null,
      cells: [{ tableId: sheet.tableId, row: 2, col: 0, input: "3" }],
      tables: [],
      emailsSent: 0,
    });
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "2:0": "3",
    });
    expect(await runsFor(sheet)).toMatchObject([
      {
        id: result.runId,
        tableId: sheet.tableId,
        row: 3,
        col: 0,
        userId: user.userId,
        status: "succeeded",
        error: null,
        effects: [{ type: "setCell", tableId: sheet.tableId, row: 2, col: 0, input: "3" }],
      },
    ]);
  });

  it("reads the value the previous click wrote", async () => {
    const sheet = await sheetWith({ A1: "0", B1: '=BUTTON("Add one", EXECUTE(A1+1, A1))' });
    await click(sheet, 0, 1);
    await click(sheet, 0, 1);
    expect(await click(sheet, 0, 1)).toMatchObject({ cells: [{ input: "3" }] });
  });

  it("counts every click when several arrive at once", async () => {
    const sheet = await sheetWith({ A1: "0", B1: '=BUTTON("Add one", EXECUTE(A1+1, A1))' });
    await Promise.all(Array.from({ length: 5 }, () => click(sheet, 0, 1)));
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "0:0": "5",
    });
  });

  it("writes to a table on another page", async () => {
    const sheet = await sheetWith({});
    const created = await user.json<{ page: PageRecord; table: TableRecord }>(
      "POST",
      `/spreadsheets/${sheet.spreadsheetId}/pages`,
      { name: "Log" },
      201,
    );
    await user.json(
      "PUT",
      `/tables/${sheet.tableId}/cells`,
      cellsBody({ A1: '=BUTTON("Log it", EXECUTE("done", Log!\'Table 1\'!B2))' }),
      204,
    );

    expect(await click(sheet, 0, 0)).toMatchObject({
      status: "succeeded",
      cells: [{ tableId: created.table.id, row: 1, col: 1, input: "done" }],
    });
    expect(await storedInputs(user, sheet.spreadsheetId, created.table.id)).toEqual({
      "1:1": "done",
    });
  });
});

describe("clicks that do nothing", () => {
  it.each([
    ["an empty cell", 5, 5],
    ["a number", 0, 0],
    ["a formula that is not a button", 0, 1],
    ["a bare action", 0, 2],
    ["a broken button", 0, 3],
  ])("refuses %s with 422 and records no run", async (_what, row, col) => {
    const sheet = await sheetWith({
      A1: "1",
      B1: "=A1+1",
      C1: "=EXECUTE(1, A1)",
      D1: '=BUTTON("x", 5)',
    });
    const response = await user.json(
      "POST",
      `/tables/${sheet.tableId}/cells/${String(row)}/${String(col)}/click`,
      undefined,
      422,
    );
    expect(response).toMatchObject({ error: { code: "not_a_button" } });
    expect(await runsFor(sheet)).toEqual([]);
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "0:0": "1",
    });
  });

  it.each(["x/0", "0/x", "-1/0", "1.5/0"])("rejects the cell position %s", async (position) => {
    const sheet = await sheetWith({});
    await user.json("POST", `/tables/${sheet.tableId}/cells/${position}/click`, undefined, 400);
  });

  it("reports an action whose arguments fail, writes nothing, and records the failed run", async () => {
    const sheet = await sheetWith({ A1: '=BUTTON("Divide", EXECUTE(1/0, B1))' });
    const result = await click(sheet, 0, 0);
    expect(result).toMatchObject({
      status: "failed",
      error: "#DIV/0! Division by zero",
      cells: [],
      emailsSent: 0,
    });
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).not.toHaveProperty("0:1");
    expect(await runsFor(sheet)).toMatchObject([
      { id: result.runId, status: "failed", error: "#DIV/0! Division by zero", effects: [] },
    ]);
  });

  it("reports a write outside the target table and records the failed run", async () => {
    const sheet = await sheetWith({ A1: '=BUTTON("Too far", EXECUTE(1, Z99))' });
    expect(await click(sheet, 0, 0)).toMatchObject({
      status: "failed",
      error: "Z99 is outside the table Table 1",
      cells: [],
    });
    expect(await runsFor(sheet)).toMatchObject([
      { status: "failed", effects: [{ type: "setCell", row: 98, col: 25 }] },
    ]);
  });
});

describe("clicking a SEND_EMAIL button", () => {
  const EMAIL = '=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3,A4))';

  it("sends the message built from the cells and records the run", async () => {
    const sender = await server.signUp();
    const sheet = await sheetWith(
      {
        A1: "ada@example.com",
        A2: "Hello",
        A3: "The total is 3",
        A4: "bob@example.com",
        B1: EMAIL,
      },
      sender,
    );

    const result = await click(sheet, 0, 1, sender);
    expect(result).toMatchObject({ status: "succeeded", error: null, cells: [], emailsSent: 1 });
    expect(server.sent).toEqual([
      {
        to: ["ada@example.com"],
        cc: ["bob@example.com"],
        subject: "Hello",
        body: "The total is 3",
      },
    ]);
    expect(await runsFor(sheet)).toMatchObject([
      { status: "succeeded", error: null, effects: [{ type: "sendEmail", subject: "Hello" }] },
    ]);
  });

  it("sends nothing when the recipient is not an address", async () => {
    const sender = await server.signUp();
    const sheet = await sheetWith({ A1: "nobody", A2: "s", A3: "b", B1: EMAIL }, sender);
    expect(await click(sheet, 0, 1, sender)).toMatchObject({
      status: "failed",
      error: '#VALUE! "nobody" is not an email address',
    });
    expect(server.sent).toEqual([]);
  });

  it("reports a mail failure and records the failed run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sender = await server.signUp();
    const sheet = await sheetWith({ A1: "ada@example.com", A2: "s", A3: "b", B1: EMAIL }, sender);
    server.failSending(true);

    expect(await click(sheet, 0, 1, sender)).toMatchObject({
      status: "failed",
      error: "The email could not be sent",
      emailsSent: 0,
    });
    expect(await runsFor(sheet)).toMatchObject([
      { status: "failed", error: "The email could not be sent" },
    ]);
  });

  it("stops a user at the hourly limit without affecting other users or other actions", async () => {
    const sender = await server.signUp();
    const sheet = await sheetWith(
      {
        A1: "ada@example.com",
        A2: "s",
        A3: "b",
        B1: EMAIL,
        C1: '=BUTTON("Write", EXECUTE(1, D1))',
      },
      sender,
    );
    for (let sent = 0; sent < 3; sent += 1) {
      expect(await click(sheet, 0, 1, sender)).toMatchObject({ status: "succeeded" });
    }

    const refused = await click(sheet, 0, 1, sender);
    expect(refused).toMatchObject({
      status: "failed",
      error: "Email limit reached: 3 per hour",
      emailsSent: 0,
    });
    expect(server.sent).toHaveLength(3);
    expect((await runsFor(sheet)).map((run) => run.status).sort()).toEqual([
      "failed",
      "succeeded",
      "succeeded",
      "succeeded",
    ]);

    expect(await click(sheet, 0, 2, sender)).toMatchObject({ status: "succeeded" });

    const other = await server.signUp();
    const otherSheet = await sheetWith(
      { A1: "ada@example.com", A2: "s", A3: "b", B1: EMAIL },
      other,
    );
    expect(await click(otherSheet, 0, 1, other)).toMatchObject({ status: "succeeded" });
  });

  it("does not count failed sends toward the limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sender = await server.signUp();
    const sheet = await sheetWith({ A1: "ada@example.com", A2: "s", A3: "b", B1: EMAIL }, sender);
    server.failSending(true);
    for (let attempt = 0; attempt < 4; attempt += 1) await click(sheet, 0, 1, sender);
    server.failSending(false);
    expect(await click(sheet, 0, 1, sender)).toMatchObject({ status: "succeeded" });
  });
});

describe("actions that add rows, clear cells, and combine", () => {
  it("appends a row, growing the table when it is full", async () => {
    const sheet = await sheetWith({
      A1: "name",
      B1: "qty",
      D1: '=BUTTON("Add", APPEND_ROW(A:B, "pear", 3))',
    });
    await user.json("PATCH", `/tables/${sheet.tableId}`, { rowCount: 2 });

    const first = await click(sheet, 0, 3);
    expect(first).toMatchObject({
      status: "succeeded",
      tables: [],
      cells: [
        { row: 1, col: 0, input: "pear" },
        { row: 1, col: 1, input: "3" },
      ],
    });

    const second = await click(sheet, 0, 3);
    expect(second).toMatchObject({
      status: "succeeded",
      tables: [{ id: sheet.tableId, rowCount: 3 }],
      cells: [
        { row: 2, col: 0, input: "pear" },
        { row: 2, col: 1, input: "3" },
      ],
    });
    const snapshot = await user.json<Snapshot>("GET", `/spreadsheets/${sheet.spreadsheetId}`);
    expect(snapshot.tables[0]).toMatchObject({ rowCount: 3 });
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "1:0": "pear",
      "2:0": "pear",
      "2:1": "3",
    });
  });

  it("refuses to grow a table past the row limit, and writes nothing", async () => {
    const sheet = await sheetWith({ D1: '=BUTTON("Add", APPEND_ROW(A:A, "x"))' });
    await user.json("PATCH", `/tables/${sheet.tableId}`, { rowCount: LIMITS.tableRows });
    await user.json(
      "PUT",
      `/tables/${sheet.tableId}/cells`,
      { cells: [{ row: LIMITS.tableRows - 1, col: 0, input: "last" }] },
      204,
    );

    expect(await click(sheet, 0, 3)).toMatchObject({
      status: "failed",
      error: `Table 1 cannot have more than ${String(LIMITS.tableRows)} rows`,
      cells: [],
      tables: [],
    });
    const snapshot = await user.json<Snapshot>("GET", `/spreadsheets/${sheet.spreadsheetId}`);
    expect(snapshot.tables[0]).toMatchObject({ rowCount: LIMITS.tableRows });
  });

  it("saves a form to a log and resets it in one click", async () => {
    const sheet = await sheetWith({
      A1: "pear",
      A2: "3",
      C1: '=BUTTON("Save", DO(APPEND_ROW(E:F, A1, A2), CLEAR(A1:A2)))',
    });
    const result = await click(sheet, 0, 2);
    expect(result.status).toBe("succeeded");
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toEqual({
      "0:2": '=BUTTON("Save", DO(APPEND_ROW(E:F, A1, A2), CLEAR(A1:A2)))',
      "0:4": "pear",
      "0:5": "3",
    });
    expect(await runsFor(sheet)).toMatchObject([
      {
        status: "succeeded",
        effects: [{ type: "ensureRows" }, {}, {}, { input: "" }, { input: "" }],
      },
    ]);
  });

  it("reports the stored value when one click writes a cell twice", async () => {
    const sheet = await sheetWith({
      A1: '=BUTTON("Twice", DO(EXECUTE("first", B1), EXECUTE("second", B1)))',
    });
    expect(await click(sheet, 0, 0)).toMatchObject({
      cells: [{ row: 0, col: 1, input: "second" }],
    });
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "0:1": "second",
    });
  });

  it("writes an array as a block of cells", async () => {
    const sheet = await sheetWith({ A1: '=BUTTON("Fill", EXECUTE(SEQUENCE(2, 2), C3))' });
    expect((await click(sheet, 0, 0)).cells).toHaveLength(4);
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "2:2": "1",
      "2:3": "2",
      "3:2": "3",
      "3:3": "4",
    });
  });
});

describe("changing a control", () => {
  function choose(sheet: Sheet, row: number, col: number, value: unknown, status = 200) {
    return user.json<ClickResult>(
      "POST",
      `/tables/${sheet.tableId}/cells/${String(row)}/${String(col)}/input`,
      { value },
      status,
    );
  }

  it("writes TRUE or FALSE from a checkbox to its cell, and records the run", async () => {
    const sheet = await sheetWith({ B1: '=CHECKBOX(A1, "Done")' });
    expect(await choose(sheet, 0, 1, true)).toMatchObject({
      status: "succeeded",
      cells: [{ tableId: sheet.tableId, row: 0, col: 0, input: "TRUE" }],
    });
    await choose(sheet, 0, 1, false);
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "0:0": "FALSE",
    });
    expect(await runsFor(sheet)).toHaveLength(2);
  });

  it("writes a dropdown's choice, and refuses a value that is not a choice", async () => {
    const sheet = await sheetWith({ A1: "low", A2: "high", C1: "=DROPDOWN(A1:A2, B1)" });
    expect(await choose(sheet, 0, 2, "high")).toMatchObject({
      status: "succeeded",
      cells: [{ row: 0, col: 1, input: "high" }],
    });
    expect(await choose(sheet, 0, 2, "medium")).toMatchObject({
      status: "failed",
      error: "#VALUE! medium is not one of the choices",
      cells: [],
    });
    expect(await choose(sheet, 0, 2, null)).toMatchObject({ cells: [{ input: "" }] });
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).not.toHaveProperty("0:1");
  });

  it("refuses a cell that is not a control with 422", async () => {
    const sheet = await sheetWith({ A1: "1", B1: '=BUTTON("x", EXECUTE(1, C1))' });
    for (const [row, col] of [
      [0, 0],
      [0, 1],
      [5, 5],
    ] as const) {
      expect(await choose(sheet, row, col, true, 422)).toMatchObject({
        error: { code: "not_a_control" },
      });
    }
    expect(await runsFor(sheet)).toEqual([]);
  });

  it("refuses a checkbox value that is not TRUE or FALSE", async () => {
    const sheet = await sheetWith({ B1: "=CHECKBOX(A1)" });
    expect(await choose(sheet, 0, 1, "yes")).toMatchObject({
      status: "failed",
      error: "#VALUE! A checkbox takes TRUE or FALSE",
    });
  });

  it.each([{}, { value: [1] }, { value: { a: 1 } }])(
    "rejects the malformed body %j",
    async (body) => {
      const sheet = await sheetWith({ B1: "=CHECKBOX(A1)" });
      await user.json("POST", `/tables/${sheet.tableId}/cells/0/1/input`, body, 400);
    },
  );
});

describe("snapshot after a click", () => {
  it("returns the written cell to a later reader", async () => {
    const sheet = await sheetWith({ A1: '=BUTTON("Stamp", EXECUTE("stamped", B1))' });
    await click(sheet, 0, 0);
    const snapshot = await user.json<Snapshot>("GET", `/spreadsheets/${sheet.spreadsheetId}`);
    expect(snapshot.cells).toContainEqual({
      tableId: sheet.tableId,
      row: 0,
      col: 1,
      input: "stamped",
    });
  });
});
