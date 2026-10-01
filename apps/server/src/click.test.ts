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
