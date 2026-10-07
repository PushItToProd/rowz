import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentSearchResponse } from "@spreadsheet-app/shared";
import {
  addView,
  cellsBody,
  createSpreadsheet,
  startTestServer,
  type TestServer,
  type TestUser,
} from "./testing";

let server: TestServer;
let owner: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  owner = await server.signUp("Search owner");
});
afterAll(() => server.close());

async function search(user: TestUser, q: string, limit?: number): Promise<DocumentSearchResponse> {
  const query = new URLSearchParams({ q });
  if (limit !== undefined) query.set("limit", String(limit));
  return user.json("GET", `/search?${query.toString()}`);
}

describe("cross-document search", () => {
  it("finds every supported content kind and returns stored cell addresses and offsets", async () => {
    const snapshot = await createSpreadsheet(owner, "Document NeedleName");
    const page = snapshot.pages[0]!;
    const table = snapshot.tables[0]!;

    await owner.json("PATCH", `/pages/${page.id}`, { name: "Page NeedlePage" });
    await owner.json("PATCH", `/tables/${table.id}`, { name: "Table NeedleTable" });
    await owner.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A1: "NeedleColumn", A3: "cell value NeedleCell after emoji 😀" }),
    );
    await owner.json("POST", `/tables/${table.id}/columns`, { headerRow: true });

    const text = await addView(owner, page.id, "text");
    const script = await addView(owner, page.id, "script");
    const chart = await addView(owner, page.id, "chart");
    await owner.json("PATCH", `/views/${text.id}`, { source: "Template NeedleText" });
    await owner.json("PATCH", `/views/${script.id}`, { source: 'Report = "NeedleScript"' });
    await owner.json("PATCH", `/views/${chart.id}`, { source: '="NeedleChart"' });

    const cases = [
      ["NeedleName", "name"],
      ["NeedlePage", "page"],
      ["NeedleTable", "table"],
      ["NeedleColumn", "column"],
      ["NeedleCell", "cell"],
      ["NeedleText", "text"],
      ["NeedleScript", "script"],
      ["NeedleChart", "chart"],
    ] as const;
    for (const [q, kind] of cases) {
      const results = await search(owner, q.toLowerCase());
      expect(results).toHaveLength(1);
      expect(results[0]!.matches[0]!.kind).toBe(kind);
    }

    const cellMatch = (await search(owner, "needlecell"))[0]!.matches[0]!;
    expect(cellMatch).toMatchObject({
      kind: "cell",
      pageName: "Page NeedlePage",
      blockName: "Table NeedleTable",
      address: "A2",
    });
    expect(cellMatch.snippet.slice(cellMatch.matchStart, cellMatch.matchEnd)).toBe("NeedleCell");
    expect((await search(owner, "needle"))[0]!.matches).toHaveLength(5);
  });

  it("matches percent and underscore literally", async () => {
    const literal = await createSpreadsheet(owner, "Literal source");
    const other = await createSpreadsheet(owner, "Other source");
    await owner.json(
      "PUT",
      `/tables/${literal.tables[0]!.id}/cells`,
      cellsBody({ A1: "a%b_needle" }),
    );
    await owner.json(
      "PUT",
      `/tables/${other.tables[0]!.id}/cells`,
      cellsBody({ A1: "axbXneedle" }),
    );

    const results = await search(owner, "a%b_");
    expect(results.map(({ spreadsheetId }) => spreadsheetId)).toEqual([literal.id]);
  });

  it("returns shared documents to a sharee and never returns unreadable documents", async () => {
    const visible = await createSpreadsheet(owner, "Shared searchable document");
    const hidden = await createSpreadsheet(owner, "Private searchable document");
    await owner.json(
      "PUT",
      `/tables/${visible.tables[0]!.id}/cells`,
      cellsBody({ A1: "SharedScopeToken" }),
    );
    await owner.json(
      "PUT",
      `/tables/${hidden.tables[0]!.id}/cells`,
      cellsBody({ A1: "SharedScopeToken" }),
    );
    const sharee = await server.signUp("Search sharee");
    const stranger = await server.signUp("Search stranger");
    await owner.json("PUT", `/spreadsheets/${visible.id}/members`, {
      email: sharee.email,
      role: "viewer",
    });

    expect(
      (await search(sharee, "SharedScopeToken")).map(({ spreadsheetId }) => spreadsheetId),
    ).toEqual([visible.id]);
    expect(await search(stranger, "SharedScopeToken")).toEqual([]);
  });

  it("requires two to 200 query characters and applies document limits", async () => {
    expect(await owner.request("GET", "/search?q=x")).toHaveProperty("status", 400);
    expect(await owner.request("GET", "/search")).toHaveProperty("status", 400);
    expect(await owner.request("GET", `/search?q=${"x".repeat(201)}`)).toHaveProperty(
      "status",
      400,
    );

    for (let index = 0; index < 22; index++) {
      await createSpreadsheet(owner, `LimitResultToken ${String(index)}`);
    }
    expect(await search(owner, "LimitResultToken")).toHaveLength(20);
    expect(await search(owner, "LimitResultToken", 1)).toHaveLength(1);
    expect(await search(owner, "LimitResultToken", 50)).toHaveLength(22);
    expect(await owner.request("GET", "/search?q=LimitResultToken&limit=51")).toHaveProperty(
      "status",
      400,
    );
  });
});
