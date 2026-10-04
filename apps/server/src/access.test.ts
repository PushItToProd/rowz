import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Change, Snapshot, SpreadsheetSummary } from "./app";
import { spreadsheets, workspaceMembers, type Role } from "./db/schema";
import {
  cellsBody,
  createSpreadsheet,
  routeOf,
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
  );
  await owner.json("POST", `/pages/${created.pages[0]!.id}/views`, { kind: "chart" }, 201);
  snapshot = await owner.json<Snapshot>("GET", `/spreadsheets/${created.id}`);
});
afterAll(() => server.close());

type Route = [method: string, path: string, body?: unknown];

/** Every route that is not about one spreadsheet. Each needs a session and nothing more. */
const accountRoutes: Route[] = [
  ["GET", "/spreadsheets"],
  ["POST", "/spreadsheets", { name: "x" }],
  ["POST", "/spreadsheets/import", {}],
];

/** Every route that reads the spreadsheet. */
function readRoutes(): Route[] {
  return [
    ["GET", `/spreadsheets/${snapshot.id}`],
    ["GET", `/spreadsheets/${snapshot.id}/events`],
    ["GET", `/spreadsheets/${snapshot.id}/versions`],
    ["GET", `/spreadsheets/${snapshot.id}/members`],
    ["POST", `/spreadsheets/${snapshot.id}/copy`],
    ["POST", `/spreadsheets/${snapshot.id}/versions/${UNKNOWN_ID}/copy`],
  ];
}

/**
 * The routes other than a GET that change no spreadsheet the caller was given.
 * Each makes a new spreadsheet that belongs to the caller, and the last reads
 * an existing one to do it. Every other such route must be in `writeRoutes`.
 */
const CHANGES_NO_SPREADSHEET = [
  "POST /spreadsheets",
  "POST /spreadsheets/import",
  "POST /spreadsheets/:spreadsheetId/copy",
  "POST /spreadsheets/:spreadsheetId/versions/:versionId/copy",
];

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
    ["POST", `/pages/${page}/tables`, { position: 0 }],
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
    ["PUT", `/tables/${table}/conditional-formats`, { rules: [] }],
    [
      "PUT",
      `/tables/${table}/grid-sizes`,
      { axis: "col", ids: [snapshot.tables[0]!.colIds[0]], size: 180 },
    ],
    ["POST", `/tables/${table}/columns`, { headerRow: false }],
    ["PATCH", `/tables/${table}/columns/2`, { name: "Renamed", type: "text" }],
    ["PUT", `/tables/${table}/display`, { sort: [] }],
    ["DELETE", `/tables/${table}/columns`],
    // After the columns are dropped again, since a data table holds no names.
    ["PUT", `/tables/${table}/names`, { names: [{ name: "Corner", formula: "A1" }] }],
    ["PATCH", `/tables/${table}/names/Corner`, { formula: "B2" }],
    ["POST", `/pages/${page}/views`, { kind: "text", position: 1 }],
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

describe("the routes these tests try", () => {
  // The tests below prove a rule for the routes in the three lists. This one
  // proves the lists leave no route out, so a new route fails here until it
  // is added to the list whose rule it should follow.
  it("are every route the app registers", () => {
    const tried = [...accountRoutes, ...readRoutes(), ...writeRoutes()].map(
      ([method, path]) =>
        routeOf(server.routes, method, path) ?? `${method} ${path}: no such route`,
    );
    expect([...new Set(tried)].sort()).toEqual(server.routes);
  });

  // A route in the wrong list would pass the test above and skip the rule it
  // should follow: a write among the reads is never tried as a viewer.
  it("count every route other than a GET as a write, unless it is named as leaving the spreadsheet alone", () => {
    const writes = writeRoutes().map(([method, path]) => routeOf(server.routes, method, path));
    const presumed = server.routes.filter(
      (route) => !route.startsWith("GET ") && !CHANGES_NO_SPREADSHEET.includes(route),
    );
    expect([...new Set(writes)].sort()).toEqual(presumed);
    expect(server.routes).toEqual(expect.arrayContaining(CHANGES_NO_SPREADSHEET));
  });
});

describe("without a session", () => {
  it("answers 401 on every route and changes nothing", async () => {
    const routes = [...accountRoutes, ...readRoutes(), ...writeRoutes()];
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

describe("the stream of changes", () => {
  /** Opens the stream and resolves to the data of its first event after `ready`. */
  async function firstChange(client: TestClient, id: string, change: () => Promise<unknown>) {
    const abort = new AbortController();
    const response = await client.request(
      "GET",
      `/spreadsheets/${id}/events`,
      undefined,
      {},
      abort.signal,
    );
    expect(response.status).toBe(200);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    const read = async (events: number): Promise<void> => {
      while (text.split("\n\n").length <= events) text += (await reader.read()).value ?? "";
    };
    await read(1);
    await change();
    await read(2);
    abort.abort();
    const data = /event: change\ndata: (.*)/.exec(text)?.[1] ?? "";
    return JSON.parse(data) as Change;
  }

  it("sends content to a viewer, and does not open for someone who cannot read", async () => {
    const [viewer, stranger] = [await server.signUp("Viewer"), await server.signUp("Stranger")];
    const shared = await createSpreadsheet(owner, "Shared");
    const table = shared.tables[0]!;
    await owner.json("PUT", `/spreadsheets/${shared.id}/members`, {
      email: viewer.email,
      role: "viewer",
    });
    const heard = await firstChange(viewer, shared.id, () =>
      owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "for viewers" })),
    );
    expect(heard.changed?.cells).toMatchObject([{ tableId: table.id, input: "for viewers" }]);
    await stranger.json("GET", `/spreadsheets/${shared.id}/events`, undefined, 404);
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
      404, 204, 201, 200, 200, 200, 200, 409, 422, 422, 201, 200, 200, 200, 200, 200, 200, 200, 200,
      200, 200, 200, 200, 200, 200, 201, 200, 200, 200, 200, 403, 403, 403,
    ]);
    await owner.json("DELETE", `/spreadsheets/${snapshot.id}`, undefined, 204);
    await editor.json("GET", `/spreadsheets/${snapshot.id}`, undefined, 404);
  });
});
