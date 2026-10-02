import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickResult } from "./app";
import {
  addTable,
  addView,
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  startTestServer,
  storedInputs,
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

/** A new spreadsheet with a script holding `source`, and cells in its first table. */
async function sheetWith(source: string, inputs: Record<string, string> = {}) {
  const snapshot = await createSpreadsheet(user);
  const pageId = snapshot.pages[0]!.id;
  const tableId = snapshot.tables[0]!.id;
  const script = await addView(user, pageId, "script");
  await user.json("PATCH", `/views/${script.id}`, { source });
  if (Object.keys(inputs).length > 0) {
    await user.json("PUT", `/tables/${tableId}/cells`, cellsBody(inputs));
  }
  return { spreadsheetId: snapshot.id, pageId, tableId, script };
}

describe("scripts", () => {
  it("are created with the next free name among the page's tables and scripts", async () => {
    const { pageId, script } = await sheetWith("");
    expect(script).toMatchObject({ kind: "script", name: "Script 1" });
    await addTable(user, pageId, { name: "Script 2" });
    expect(await addView(user, pageId, "script")).toMatchObject({ name: "Script 3" });
  });

  it("cannot share a name with a table on the same page", async () => {
    const { pageId, script } = await sheetWith("");
    await user.json("PATCH", `/views/${script.id}`, { name: "table 1" }, 409);
    await user.json("POST", `/pages/${pageId}/tables`, { name: "SCRIPT 1" }, 409);
  });

  it("rewrite the formulas that qualify a name when renamed", async () => {
    const { spreadsheetId, tableId, script } = await sheetWith("Total = 5", {
      A1: "='Script 1'!Total + 1",
    });
    await user.json("PATCH", `/views/${script.id}`, { name: "Totals" });
    expect(await storedInputs(user, spreadsheetId, tableId)).toEqual({
      "0:0": "=Totals!Total + 1",
    });
  });

  it("give their names to a button's action when it is clicked", async () => {
    const { spreadsheetId, tableId } = await sheetWith("Total = 5", {
      B1: '=BUTTON("Go", EXECUTE(Total + 1, A1))',
    });
    await user.json<ClickResult>("POST", `/tables/${tableId}/cells/0/1/click`);
    expect(await storedInputs(user, spreadsheetId, tableId)).toMatchObject({ "0:0": "6" });
  });

  it("are imported from a file", async () => {
    const imported = await user.json<{ id: string }>(
      "POST",
      "/spreadsheets/import",
      fileWith("Totals"),
      201,
    );
    const snapshot = await readSnapshot(user, imported.id);
    expect(snapshot.views).toMatchObject([{ kind: "script", name: "Totals", source: "Total = 5" }]);
  });

  it("refuse a file whose script has the name of a table on its page", async () => {
    await user.json("POST", "/spreadsheets/import", fileWith("table 1"), 422);
  });
});

function fileWith(scriptName: string): object {
  return {
    format: "spreadsheet-app",
    version: 1,
    name: "Imported",
    pages: [
      {
        name: "Page 1",
        blocks: [
          { type: "table", name: "Table 1", rowCount: 1, colCount: 1, cells: [] },
          { type: "script", name: scriptName, source: "Total = 5" },
        ],
      },
    ],
  };
}
