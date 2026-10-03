import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickResult } from "./app";
import {
  addTable,
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

/** A new spreadsheet whose first table holds `names` and `inputs`. */
async function sheetWith(names: { name: string; formula: string }[], inputs = {}) {
  const snapshot = await createSpreadsheet(user);
  const tableId = snapshot.tables[0]!.id;
  const pageId = snapshot.pages[0]!.id;
  if (Object.keys(inputs).length > 0) {
    await user.json("PUT", `/tables/${tableId}/cells`, cellsBody(inputs));
  }
  await user.json("PUT", `/tables/${tableId}/names`, { names });
  return { spreadsheetId: snapshot.id, pageId, tableId };
}

const namesOf = async (spreadsheetId: string, tableId: string) =>
  (await readSnapshot(user, spreadsheetId)).tables.find((table) => table.id === tableId)?.names;

describe("names a table holds", () => {
  it("are stored with the table and replaced as a list", async () => {
    const { spreadsheetId, tableId } = await sheetWith([{ name: "Corner", formula: "A1" }]);
    expect(await namesOf(spreadsheetId, tableId)).toEqual([{ name: "Corner", formula: "A1" }]);
    await user.json("PUT", `/tables/${tableId}/names`, { names: [] });
    expect(await namesOf(spreadsheetId, tableId)).toEqual([]);
  });

  it("are refused when they read as a cell, a value, or a function, or repeat", async () => {
    const { tableId } = await sheetWith([]);
    for (const name of ["AB12", "TRUE", "Sum"]) {
      await user.json("PUT", `/tables/${tableId}/names`, { names: [{ name, formula: "1" }] }, 422);
    }
    const twice = [
      { name: "Fee", formula: "1" },
      { name: "fee", formula: "2" },
    ];
    await user.json("PUT", `/tables/${tableId}/names`, { names: twice }, 409);
  });

  it("are refused on a data table, and keep a table from becoming one", async () => {
    const { tableId } = await sheetWith([{ name: "Corner", formula: "A1" }]);
    await user.json("POST", `/tables/${tableId}/columns`, { headerRow: false }, 409);
    await user.json("PUT", `/tables/${tableId}/names`, { names: [] });
    await user.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
    const names = [{ name: "Corner", formula: "A1" }];
    await user.json("PUT", `/tables/${tableId}/names`, { names }, 409);
  });

  it("give their values to formulas when a button is clicked", async () => {
    const { spreadsheetId, tableId } = await sheetWith([{ name: "Step", formula: "A2 * 2" }], {
      A2: "3",
      B1: '=BUTTON("Go", EXECUTE(Step, A1))',
    });
    await user.json<ClickResult>("POST", `/tables/${tableId}/cells/0/1/click`);
    expect(await storedInputs(user, spreadsheetId, tableId)).toMatchObject({ "0:0": "6" });
  });

  it("follow a row inserted above the cells they read", async () => {
    const { spreadsheetId, tableId } = await sheetWith([{ name: "Corner", formula: "=A2 + B2" }]);
    await user.json("POST", `/tables/${tableId}/edits`, { axis: "row", kind: "insert", index: 0 });
    expect(await namesOf(spreadsheetId, tableId)).toEqual([
      { name: "Corner", formula: "=A3 + B3" },
    ]);
  });

  it("follow a rename of the table they read, and a move of the table to another page", async () => {
    const { spreadsheetId, pageId, tableId } = await sheetWith([]);
    const other = await addTable(user, pageId, { name: "Costs" });
    await user.json("PUT", `/tables/${tableId}/names`, {
      names: [{ name: "Cost", formula: "Costs!A1" }],
    });
    await user.json("PATCH", `/tables/${other.id}`, { name: "Prices" });
    expect(await namesOf(spreadsheetId, tableId)).toEqual([{ name: "Cost", formula: "Prices!A1" }]);

    const created = await user.json<{ page: { id: string } }>(
      "POST",
      `/spreadsheets/${spreadsheetId}/pages`,
      { name: "Elsewhere" },
      201,
    );
    const page = created.page;
    await user.json("PUT", `/tables/${other.id}/page`, { pageId: page.id });
    expect(await namesOf(spreadsheetId, tableId)).toEqual([
      { name: "Cost", formula: "Elsewhere!Prices!A1" },
    ]);
  });

  it("are saved in a file and read back from it", async () => {
    const { spreadsheetId, tableId } = await sheetWith([{ name: "Corner", formula: "A1" }]);
    const snapshot = await readSnapshot(user, spreadsheetId);
    expect(snapshot.tables.find((table) => table.id === tableId)?.names).toHaveLength(1);
    const imported = await user.json<{ id: string }>(
      "POST",
      "/spreadsheets/import",
      {
        format: "spreadsheet-app",
        version: 1,
        name: "Imported",
        pages: [
          {
            name: "Page 1",
            blocks: [
              {
                type: "table",
                name: "Table 1",
                rowCount: 1,
                colCount: 1,
                names: [{ name: "Corner", formula: "A1" }],
                cells: [],
              },
            ],
          },
        ],
      },
      201,
    );
    const table = (await readSnapshot(user, imported.id)).tables[0];
    expect(table?.names).toEqual([{ name: "Corner", formula: "A1" }]);
  });
});
