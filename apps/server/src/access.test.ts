import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Snapshot, SpreadsheetSummary } from "./app";
import { spreadsheets, workspaceMembers, type Role } from "./db/schema";
import {
  cellsBody,
  createSpreadsheet,
  startTestServer,
  type TestClient,
  type TestServer,
  type TestUser,
} from "./testing";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let server: TestServer;
let owner: TestUser;
let snapshot: Snapshot;
beforeAll(async () => {
  server = await startTestServer();
  owner = await server.signUp("Owner");
  const created = await createSpreadsheet(owner, "Private");
  await owner.json(
    "PUT",
    `/tables/${created.tables[0]!.id}/cells`,
    cellsBody({ A1: '=BUTTON("Go", EXECUTE(1, B1))', A2: "=CHECKBOX(B2)" }),
    204,
  );
  await owner.json("POST", `/pages/${created.pages[0]!.id}/views`, { kind: "chart" }, 201);
  snapshot = await owner.json<Snapshot>("GET", `/spreadsheets/${created.id}`);
});
afterAll(() => server.close());

type Route = [method: string, path: string, body?: unknown];

/** Every route that reads the spreadsheet. */
function readRoutes(): Route[] {
  return [
    ["GET", `/spreadsheets/${snapshot.id}`],
    ["GET", `/spreadsheets/${snapshot.id}/versions`],
    ["GET", `/spreadsheets/${snapshot.id}/members`],
    ["POST", `/spreadsheets/${snapshot.id}/versions/${UNKNOWN_ID}/copy`],
  ];
}

/** Every route that changes the spreadsheet, least destructive first so each still has a target. */
function writeRoutes(): Route[] {
  const page = snapshot.pages[0]!.id;
  const table = snapshot.tables[0]!.id;
  const view = snapshot.views[0]!.id;
  return [
    ["POST", `/spreadsheets/${snapshot.id}/versions/${UNKNOWN_ID}/restore`],
    ["PATCH", `/spreadsheets/${snapshot.id}`, { name: "Taken over" }],
    ["POST", `/spreadsheets/${snapshot.id}/pages`, {}],
    ["POST", `/spreadsheets/${snapshot.id}/undo`],
    ["POST", `/spreadsheets/${snapshot.id}/redo`],
    ["PATCH", `/pages/${page}`, { name: "Taken over" }],
    ["PUT", `/pages/${page}/order`, { blocks: [view, table] }],
    ["PUT", `/spreadsheets/${snapshot.id}/pages/order`, { pages: [page] }],
    // The page they are on already, which is refused only once the caller may write.
    ["PUT", `/tables/${table}/page`, { pageId: page }],
    ["PUT", `/views/${view}/page`, { pageId: page }],
    ["POST", `/pages/${page}/tables`, {}],
    ["PATCH", `/tables/${table}`, { name: "Taken over" }],
    ["PUT", `/tables/${table}/cells`, cellsBody({ C3: "written" })],
    // Below the button in A1, so the click that follows still finds it.
    ["POST", `/tables/${table}/edits`, { axis: "row", kind: "insert", index: 5 }],
    ["POST", `/tables/${table}/cells/0/0/click`],
    ["POST", `/tables/${table}/cells/1/0/input`, { value: true }],
    [
      "POST",
      `/tables/${table}/formats`,
      { range: { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }, format: { bold: true } },
    ],
    ["POST", `/tables/${table}/columns`, { headerRow: false }],
    ["PATCH", `/tables/${table}/columns/2`, { name: "Renamed", type: "text" }],
    ["DELETE", `/tables/${table}/columns`],
    ["POST", `/pages/${page}/views`, { kind: "text" }],
    ["PATCH", `/views/${view}`, { source: "A1:B2", chartType: "pie" }],
    ["DELETE", `/views/${view}`],
    ["DELETE", `/tables/${table}`],
    ["DELETE", `/pages/${page}`],
    [
      "PUT",
      `/spreadsheets/${snapshot.id}/members`,
      { email: "nobody@example.com", role: "viewer" },
    ],
    ["DELETE", `/spreadsheets/${snapshot.id}/members/someone`],
    ["DELETE", `/spreadsheets/${snapshot.id}`],
  ];
}

async function statuses(client: TestClient, routes: Route[]): Promise<number[]> {
  const result: number[] = [];
  for (const [method, path, body] of routes) {
    result.push((await client.request(method, path, body)).status);
  }
  return result;
}

async function expectUnchanged(): Promise<void> {
  expect(await owner.json("GET", `/spreadsheets/${snapshot.id}`)).toEqual(snapshot);
}

/** Adds a user to the workspace that holds the spreadsheet. There is no API for this yet. */
async function addMember(user: TestUser, role: Role): Promise<void> {
  const [row] = await server.db
    .select({ workspaceId: spreadsheets.workspaceId })
    .from(spreadsheets)
    .where(eq(spreadsheets.id, snapshot.id));
  await server.db
    .insert(workspaceMembers)
    .values({ workspaceId: row!.workspaceId, userId: user.userId, role });
}

describe("without a session", () => {
  it("answers 401 on every route and changes nothing", async () => {
    const routes: Route[] = [
      ["GET", "/spreadsheets"],
      ["POST", "/spreadsheets", { name: "x" }],
      ["POST", "/spreadsheets/import", {}],
      ...readRoutes(),
      ...writeRoutes(),
    ];
    const result = await statuses(server.anonymous, routes);
    expect(result).toEqual(routes.map(() => 401));
    await expectUnchanged();
  });
});

describe("a page of another origin", () => {
  // A sibling subdomain is the same site, so the browser sends the owner's session cookie with its requests.
  const elsewhere = { origin: "https://evil.localhost:5173" };

  it("is refused on every route that changes something, even with the owner's session", async () => {
    for (const [method, path, body] of writeRoutes()) {
      const response = await owner.request(method, path, body, elsewhere);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "cross_origin" } });
    }
    await expectUnchanged();
  });

  it("can still read, which the browser keeps from the page that asked", async () => {
    const response = await owner.request(
      "GET",
      `/spreadsheets/${snapshot.id}`,
      undefined,
      elsewhere,
    );
    expect(response.status).toBe(200);
  });
});

describe("a user outside the workspace", () => {
  it("gets 404 on every route, as if the spreadsheet did not exist, and changes nothing", async () => {
    const stranger = await server.signUp("Stranger");
    const routes = [...readRoutes(), ...writeRoutes()];
    expect(await statuses(stranger, routes)).toEqual(routes.map(() => 404));
    await expectUnchanged();
  });

  it("does not see the spreadsheet in their list", async () => {
    const stranger = await server.signUp("Stranger");
    await createSpreadsheet(stranger, "Mine");
    const listed = await stranger.json<SpreadsheetSummary[]>("GET", "/spreadsheets");
    expect(listed.map((item) => item.name)).toEqual(["Mine"]);
  });
});

describe("a viewer", () => {
  it("can read, gets 403 on every write, and changes nothing", async () => {
    const viewer = await server.signUp("Viewer");
    await addMember(viewer, "viewer");

    expect(await viewer.json("GET", `/spreadsheets/${snapshot.id}`)).toEqual({
      ...snapshot,
      role: "viewer",
    });
    const listed = await viewer.json<SpreadsheetSummary[]>("GET", "/spreadsheets");
    expect(listed.map((item) => item.id)).toEqual([snapshot.id]);

    const routes = writeRoutes();
    expect(await statuses(viewer, routes)).toEqual(routes.map(() => 403));
    await expectUnchanged();
  });
});

describe("an editor", () => {
  // Runs last: it carries out the writes, including the deletes.
  it("can read and make every change to the contents, and cannot share or delete the spreadsheet", async () => {
    const editor = await server.signUp("Editor");
    await addMember(editor, "editor");

    expect(await editor.json("GET", `/spreadsheets/${snapshot.id}`)).toMatchObject({
      role: "editor",
    });
    // The restore names a version that does not exist. The page order leaves out the page just
    // added, and each move names the page the block is on. Sharing and deleting are the owner's.
    expect(await statuses(editor, writeRoutes())).toEqual([
      404, 204, 201, 200, 200, 200, 204, 409, 422, 422, 201, 200, 204, 200, 200, 200, 200, 200, 200,
      200, 201, 200, 204, 204, 204, 403, 403, 403,
    ]);
    await owner.json("DELETE", `/spreadsheets/${snapshot.id}`, undefined, 204);
    await editor.json("GET", `/spreadsheets/${snapshot.id}`, undefined, 404);
  });
});
