import { LIMITS } from "@spreadsheet-app/shared";
import { desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CellInput } from "@spreadsheet-app/shared";
import type { ClickResult, PageRecord, TableRecord } from "./app";
import { actionRuns } from "./db/schema";
import {
  cellsBody,
  changedCells,
  createSpreadsheet,
  addView,
  readSnapshot,
  rowIds,
  startTestServer,
  storedInputs,
  type TestClient,
  type TestServer,
  type TestUser,
} from "./testing";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer({ emailsPerHour: 3 });
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
    await as.json("PUT", `/tables/${tableId}/cells`, cellsBody(inputs), 200);
  }
  return { spreadsheetId: snapshot.id, pageId: snapshot.pages[0]!.id, tableId };
}

/** The answer to a click, with the cells it changed by the positions they now have. */
interface Clicked extends ClickResult {
  cells: (CellInput & { tableId: string })[];
}

async function clicked(sheet: Sheet, result: ClickResult, as: TestClient): Promise<Clicked> {
  const cells = result.change ? await changedCells(as, sheet.spreadsheetId, result.change) : [];
  return { ...result, cells };
}

async function click(
  sheet: Sheet,
  row: number,
  col: number,
  as: TestClient = user,
): Promise<Clicked> {
  const result = await as.json<ClickResult>(
    "POST",
    `/tables/${sheet.tableId}/cells/${String(row)}/${String(col)}/click`,
  );
  return clicked(sheet, result, as);
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
      change: { revision: expect.any(Number), changed: expect.any(Object) },
      cells: [{ tableId: sheet.tableId, row: 2, col: 0, input: "3" }],
      emailsSent: 0,
    });
    expect(result.change?.changed).toMatchObject({ pages: [], tables: [], views: [], rows: [] });
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
      change: null,
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
      change: null,
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
    expect(result).toMatchObject({ status: "succeeded", error: null, change: null, emailsSent: 1 });
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

  it("counts every recipient of every message of one click", async () => {
    const sender = await server.signUp();
    const two = 'SEND_EMAIL("a@example.com; b@example.com", "s", "b")';
    const one = 'SEND_EMAIL("c@example.com", "s", "b", "d@example.com")';
    const sheet = await sheetWith(
      {
        A1: `=BUTTON("Four", DO(${two}, ${one}))`,
        A2: `=BUTTON("Two", ${two})`,
        A3: `=BUTTON("One", SEND_EMAIL("e@example.com", "s", "b"))`,
      },
      sender,
    );

    // Four emails are more than the limit of three, so none of them goes.
    expect(await click(sheet, 0, 0, sender)).toMatchObject({
      status: "failed",
      error: "Email limit reached: 3 per hour",
    });
    expect(server.sent).toEqual([]);

    expect(await click(sheet, 1, 0, sender)).toMatchObject({ status: "succeeded", emailsSent: 1 });
    expect(await click(sheet, 1, 0, sender)).toMatchObject({ status: "failed" });
    expect(await click(sheet, 2, 0, sender)).toMatchObject({ status: "succeeded" });
    expect(await click(sheet, 2, 0, sender)).toMatchObject({ status: "failed" });
    expect(server.sent.flatMap(({ to, cc }) => [...to, ...cc])).toHaveLength(3);
    expect((await runsFor(sheet)).map((run) => run.emails).sort()).toEqual([0, 0, 0, 1, 2]);
  });

  it("holds a user to the limit when clicks on several spreadsheets arrive at once", async () => {
    const sender = await server.signUp();
    const sheets = await Promise.all(
      Array.from({ length: 6 }, () =>
        sheetWith({ A1: "ada@example.com", A2: "s", A3: "b", B1: EMAIL }, sender),
      ),
    );
    const results = await Promise.all(sheets.map((sheet) => click(sheet, 0, 1, sender)));
    expect(results.filter((result) => result.status === "succeeded")).toHaveLength(3);
    expect(server.sent).toHaveLength(3);
  });

  it("counts the messages that went out before one failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sender = await server.signUp();
    const message = (to: string): string => `SEND_EMAIL("${to}", "s", "b")`;
    const sheet = await sheetWith(
      {
        A1: `=BUTTON("Two", DO(${message("a@example.com")}, ${message("fails@example.com")}))`,
        A2: `=BUTTON("Three", DO(${["c", "d", "e"].map((name) => message(`${name}@example.com`)).join(", ")}))`,
        A3: `=BUTTON("Two", DO(${message("f@example.com")}, ${message("g@example.com")}))`,
      },
      sender,
    );
    server.failSending("fails@example.com");
    expect(await click(sheet, 0, 0, sender)).toMatchObject({ status: "failed", emailsSent: 0 });
    expect(server.sent).toHaveLength(1);
    server.failSending(false);

    // One email went out, so three more would pass the limit and two would not.
    expect(await click(sheet, 1, 0, sender)).toMatchObject({
      status: "failed",
      error: "Email limit reached: 3 per hour",
    });
    expect(await click(sheet, 2, 0, sender)).toMatchObject({ status: "succeeded" });
    expect(server.sent).toHaveLength(3);
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

describe("clicking a text view button", () => {
  it("selects the rendered occurrence and derives its action from the stored view", async () => {
    const sheet = await sheetWith({ A1: "2" });
    const view = await addView(user, sheet.pageId);
    await user.json("PATCH", `/views/${view.id}`, {
      source:
        `{{ BUTTON("Increment", EXECUTE('Table 1'!A1 + 1, 'Table 1'!A1)) }}` +
        ` {{ BUTTON("Set to nine", EXECUTE(9, 'Table 1'!A1)) }}`,
    });

    const result = await user.json<ClickResult>("POST", `/views/${view.id}/buttons/1/click`, {
      action: "EXECUTE(999, 'Table 1'!A1)",
    });
    expect(result).toMatchObject({ status: "succeeded", error: null, emailsSent: 0 });
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "0:0": "9",
    });
    expect(await runsFor(sheet)).toMatchObject([
      {
        id: result.runId,
        tableId: null,
        row: null,
        col: null,
        viewId: view.id,
        buttonIndex: 1,
        effects: [{ type: "setCell", tableId: sheet.tableId, row: 0, col: 0, input: "9" }],
      },
    ]);

    const next = await user.json<ClickResult>("POST", `/views/${view.id}/buttons/0/click`);
    expect(next.status).toBe("succeeded");
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "0:0": "10",
    });
  });

  it("answers 409 when the button or its view no longer exists", async () => {
    const sheet = await sheetWith({});
    const view = await addView(user, sheet.pageId);
    await user.json("PATCH", `/views/${view.id}`, {
      source: `{{ BUTTON("Go", EXECUTE(1, 'Table 1'!A1)) }}`,
    });
    await user.json("PATCH", `/views/${view.id}`, { source: "The button was removed." });

    const missingButton = await user.request("POST", `/views/${view.id}/buttons/0/click`);
    expect(missingButton.status).toBe(409);
    await user.json("DELETE", `/views/${view.id}`, undefined, 200);
    const missingView = await user.request("POST", `/views/${view.id}/buttons/0/click`);
    expect(missingView.status).toBe(409);
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
      change: { changed: { rows: [] } },
      cells: [
        { row: 1, col: 0, input: "pear" },
        { row: 1, col: 1, input: "3" },
      ],
    });

    const second = await click(sheet, 0, 3);
    const snapshot = await readSnapshot(user, sheet.spreadsheetId);
    expect(snapshot.tables[0]).toMatchObject({ rowCount: 3 });
    // The row the table grew by and the cells written into it are one change.
    expect(second).toMatchObject({
      status: "succeeded",
      change: {
        changed: {
          rows: [
            {
              id: rowIds(snapshot, sheet.tableId)[2],
              tableId: sheet.tableId,
              orderKey: expect.any(String),
            },
          ],
        },
      },
      cells: [
        { row: 2, col: 0, input: "pear" },
        { row: 2, col: 1, input: "3" },
      ],
    });
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
      200,
    );

    expect(await click(sheet, 0, 3)).toMatchObject({
      status: "failed",
      error: `A table can have at most ${String(LIMITS.tableRows)} rows`,
      change: null,
    });
    const snapshot = await readSnapshot(user, sheet.spreadsheetId);
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

describe("the clock an action sees", () => {
  function clickAt(sheet: Sheet, offsetMinutes: string | undefined): Promise<Response> {
    const headers: Record<string, string> =
      offsetMinutes === undefined ? {} : { "x-utc-offset-minutes": offsetMinutes };
    return user.request("POST", `/tables/${sheet.tableId}/cells/0/0/click`, undefined, headers);
  }

  async function stamped(sheet: Sheet): Promise<string> {
    return (await storedInputs(user, sheet.spreadsheetId, sheet.tableId))["0:1"] ?? "";
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the clock of the browser that sent the request", async () => {
    const sheet = await sheetWith({ A1: '=BUTTON("Stamp", EXECUTE(NOW(), B1))' });
    vi.useFakeTimers({ now: new Date("2026-10-01T02:30:00Z"), toFake: ["Date"] });

    // 420 minutes behind UTC: still the evening of September 30.
    await clickAt(sheet, "420");
    expect(await stamped(sheet)).toBe("2026-09-30 19:30");
    // 120 minutes ahead of UTC.
    await clickAt(sheet, "-120");
    expect(await stamped(sheet)).toBe("2026-10-01 04:30");
  });

  it.each([undefined, "soon", "99999", "1.5"])("is UTC when the offset is %j", async (offset) => {
    const sheet = await sheetWith({ A1: '=BUTTON("Stamp", EXECUTE(TODAY(), B1))' });
    vi.useFakeTimers({ now: new Date("2026-10-01T02:30:00Z"), toFake: ["Date"] });
    await clickAt(sheet, offset);
    expect(await stamped(sheet)).toBe("2026-10-01");
  });
});

describe("changing a control", () => {
  async function choose(sheet: Sheet, row: number, col: number, value: unknown, status = 200) {
    const result = await user.json<ClickResult>(
      "POST",
      `/tables/${sheet.tableId}/cells/${String(row)}/${String(col)}/input`,
      { value },
      status,
    );
    // A refusal is the whole answer, which the caller compares.
    return status === 200 ? clicked(sheet, result, user) : (result as Clicked);
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
      change: null,
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

describe("actions on a data table", () => {
  /**
   * A spreadsheet with a data table of two columns, Name and Count, holding
   * `rows`, and a second table whose A1 holds the button. The button's formula
   * names the data table as `Data`.
   */
  async function dataTable(rows: [string, string][], action: string, plain = false) {
    const snapshot = await createSpreadsheet(user);
    const [page, buttons] = [snapshot.pages[0]!, snapshot.tables[0]!];
    const { table } = await user.json<{ table: TableRecord }>(
      "POST",
      `/pages/${page.id}/tables`,
      { name: "Data" },
      201,
    );
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: rows.length + 1, colCount: 2 });
    const cells = Object.fromEntries(
      ([["Name", "Count"], ...rows] satisfies [string, string][]).flatMap(([name, count], row) => [
        [`A${String(row + 1)}`, name],
        [`B${String(row + 1)}`, count],
      ]),
    );
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody(cells));
    if (!plain) await user.json("POST", `/tables/${table.id}/columns`, { headerRow: true });
    else
      await user.json("POST", `/tables/${table.id}/edits`, {
        axis: "row",
        kind: "delete",
        index: 0,
      });
    await user.json(
      "PUT",
      `/tables/${buttons.id}/cells`,
      cellsBody({ A1: `=BUTTON("Go", ${action})`, C1: "new", D1: "9", C2: "ann", D2: "7" }),
    );
    const sheet = { spreadsheetId: snapshot.id, pageId: page.id, tableId: buttons.id };
    const data = async () => {
      const now = await readSnapshot(user, snapshot.id);
      return {
        rows: rowIds(now, table.id),
        size: now.tables.find(({ id }) => id === table.id)?.rowCount,
        cells: await storedInputs(user, snapshot.id, table.id),
      };
    };
    return { sheet, table, data };
  }
  const TWO: [string, string][] = [
    ["ann", "1"],
    ["bob", "2"],
  ];

  it.each([
    ["APPEND_ROW", 'APPEND_ROW(Data!A:B, "new", 9)'],
    ["INSERT", "INSERT(C1:D1, Data!A:B)"],
    ["UPDATE", "UPDATE(C1:D1, 1, Data!A:B)"],
  ])("%s adds a row at the end, and leaves no unused row", async (_, action) => {
    const { sheet, data } = await dataTable(TWO, action);
    const before = await data();
    expect(before.size).toBe(2);
    expect(await click(sheet, 0, 0)).toMatchObject({ status: "succeeded" });
    const after = await data();
    expect(after.rows.slice(0, 2)).toEqual(before.rows);
    expect(after.size).toBe(3);
    expect(after.cells).toEqual({ ...before.cells, "2:0": "new", "2:1": "9" });
  });

  it.each([
    ["APPEND_ROW", 'APPEND_ROW(Data!A:B, "new", 9)'],
    ["INSERT", "INSERT(C1:D1, Data!A:B)"],
    ["UPDATE", "UPDATE(C1:D1, 1, Data!A:B)"],
  ])("%s leaves a cleared row at the end as it is, and adds a row after it", async (_, action) => {
    const { sheet, table, data } = await dataTable(TWO, action);
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A2: "", B2: "" }));
    const before = await data();
    await click(sheet, 0, 0);
    const after = await data();
    // The cleared row keeps its id and stays empty: something may point at it.
    expect(after.rows).toEqual([...before.rows, expect.any(String)]);
    expect(after.cells).toEqual({ "0:0": "ann", "0:1": "1", "2:0": "new", "2:1": "9" });
  });

  it("writes into a cleared row of a plain grid, which has rows nobody used", async () => {
    const { sheet, table, data } = await dataTable(TWO, 'APPEND_ROW(Data!A:B, "new", 9)', true);
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A2: "", B2: "" }));
    const before = await data();
    await click(sheet, 0, 0);
    const after = await data();
    expect(after.rows).toEqual(before.rows);
    expect(after.cells).toEqual({ "0:0": "ann", "0:1": "1", "1:0": "new", "1:1": "9" });
  });

  it("UPDATE writes over the row that matches, where it is", async () => {
    const { sheet, data } = await dataTable(TWO, "UPDATE(C2:D2, 1, Data!A:B)");
    const before = await data();
    await click(sheet, 0, 0);
    const after = await data();
    expect(after.rows).toEqual(before.rows);
    expect(after.cells).toEqual({ ...before.cells, "0:1": "7" });
  });

  it("adds the first row of a table that has none", async () => {
    const { sheet, data } = await dataTable([], 'APPEND_ROW(Data!A:B, "new", 9)');
    expect((await data()).size).toBe(0);
    expect(await click(sheet, 0, 0)).toMatchObject({ status: "succeeded" });
    expect(await data()).toMatchObject({ size: 1, cells: { "0:0": "new", "0:1": "9" } });
  });

  it("OVERWRITE deletes the rows it empties, so no empty row is left", async () => {
    const three: [string, string][] = [...TWO, ["cy", "3"]];
    const { sheet, data } = await dataTable(three, "OVERWRITE(C1:D1, Data!A:B)");
    const before = await data();
    const result = await click(sheet, 0, 0);
    expect(result).toMatchObject({ status: "succeeded" });
    const after = await data();
    expect(after).toEqual({ rows: [before.rows[0]], size: 1, cells: { "0:0": "new", "0:1": "9" } });
    // The rows that went are named. The cells in them are not: they went with their rows.
    expect(result.change?.changed?.rows).toHaveLength(2);
    expect(result.change?.changed?.rows).toEqual(
      expect.arrayContaining(
        before.rows.slice(1).map((id) => ({ id, tableId: expect.any(String), orderKey: null })),
      ),
    );
    expect(result.cells).toHaveLength(2);
  });

  it("deletes overlapping surplus rows once when DO runs multiple OVERWRITE actions", async () => {
    const three: [string, string][] = [...TWO, ["cy", "3"]];
    const action = "DO(OVERWRITE(C1:D1, Data!A:B), OVERWRITE(C2:D2, Data!A:B))";
    const { sheet, data } = await dataTable(three, action);
    const before = await data();

    const result = await click(sheet, 0, 0);

    expect(result).toMatchObject({ status: "succeeded" });
    expect(await data()).toEqual({
      rows: [before.rows[0]],
      size: 1,
      cells: { "0:0": "ann", "0:1": "7" },
    });
  });

  it("OVERWRITE with no data leaves a data table with no rows", async () => {
    const { sheet, data } = await dataTable(TWO, "OVERWRITE(C5:D9, Data!A:B)");
    expect(await click(sheet, 0, 0)).toMatchObject({ status: "succeeded" });
    expect(await data()).toEqual({ rows: [], size: 0, cells: {} });
  });

  it("OVERWRITE of part of a table's width empties cells and deletes no row", async () => {
    const { sheet, data } = await dataTable(TWO, "OVERWRITE(C1, Data!A:A)");
    const before = await data();
    await click(sheet, 0, 0);
    const after = await data();
    expect(after.rows).toEqual(before.rows);
    expect(after.cells).toEqual({ "0:0": "new", "0:1": "1", "1:1": "2" });
  });

  it("rewrites what read a row that OVERWRITE deleted, in cells and in views, in the same change", async () => {
    const three: [string, string][] = [...TWO, ["cy", "3"]];
    const { sheet, data } = await dataTable(three, "OVERWRITE(C1:D1, Data!A:B)");
    await user.json(
      "PUT",
      `/tables/${sheet.tableId}/cells`,
      cellsBody({ E1: "=SUM(Data!B1:B3)", E2: "=Data!B3" }),
    );
    const { view } = await user.json<{ view: { id: string } }>(
      "POST",
      `/pages/${sheet.pageId}/views`,
      { kind: "text" },
      201,
    );
    await user.json("PATCH", `/views/${view.id}`, {
      source: "{{ Data!A3 }} of {{ ROWS(Data!A:A) }}",
    });

    const result = await click(sheet, 0, 0);
    expect((await data()).size).toBe(1);
    expect(await storedInputs(user, sheet.spreadsheetId, sheet.tableId)).toMatchObject({
      "0:4": "=SUM(Data!B1:B1)",
      "1:4": "=#REF!",
    });
    // Another tab hears of the view through the change, which holds its rewritten source.
    expect(result.change?.changed?.views).toMatchObject([
      { id: view.id, view: { source: "{{ #REF! }} of {{ ROWS(Data!A:A) }}" } },
    ]);
  });

  it("makes one revision and one change of a click that grows a table and writes into two", async () => {
    const { sheet, table, data } = await dataTable(
      TWO,
      'DO(APPEND_ROW(Data!A:B, "new", 9), EXECUTE("logged", B1))',
    );
    const before = await readSnapshot(user, sheet.spreadsheetId);
    const result = await click(sheet, 0, 0);
    expect(result.change?.revision).toBe(before.revision + 1);
    expect((await readSnapshot(user, sheet.spreadsheetId)).revision).toBe(before.revision + 1);
    expect(result.change?.changed?.rows).toEqual([
      { id: (await data()).rows[2], tableId: table.id, orderKey: expect.any(String) },
    ]);
    expect(result.cells).toEqual(
      expect.arrayContaining([
        { tableId: table.id, row: 2, col: 0, input: "new" },
        { tableId: table.id, row: 2, col: 1, input: "9" },
        { tableId: sheet.tableId, row: 0, col: 1, input: "logged" },
      ]),
    );
  });

  it("makes no revision of a click whose writes are refused", async () => {
    const { sheet, data } = await dataTable(
      TWO,
      'DO(APPEND_ROW(Data!A:B, "new", 9), EXECUTE("too far", Z99))',
    );
    const before = await readSnapshot(user, sheet.spreadsheetId);
    expect(await click(sheet, 0, 0)).toMatchObject({ status: "failed", change: null });
    expect((await readSnapshot(user, sheet.spreadsheetId)).revision).toBe(before.revision);
    expect((await data()).size).toBe(2);
  });
});

describe("snapshot after a click", () => {
  it("returns the written cell to a later reader", async () => {
    const sheet = await sheetWith({ A1: '=BUTTON("Stamp", EXECUTE("stamped", B1))' });
    await click(sheet, 0, 0);
    const snapshot = await readSnapshot(user, sheet.spreadsheetId);
    expect(snapshot.cells).toContainEqual({
      tableId: sheet.tableId,
      row: 0,
      col: 1,
      input: "stamped",
    });
  });
});
