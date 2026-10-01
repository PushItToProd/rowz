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
    cellsBody({ A1: '=BUTTON("Go", EXECUTE(1, B1))' }),
    204,
  );
  snapshot = await owner.json<Snapshot>("GET", `/spreadsheets/${created.id}`);
});
afterAll(() => server.close());

type Route = [method: string, path: string, body?: unknown];

/** Every route that reads the spreadsheet. */
function readRoutes(): Route[] {
  return [["GET", `/spreadsheets/${snapshot.id}`]];
}

/** Every route that changes the spreadsheet, least destructive first so each still has a target. */
function writeRoutes(): Route[] {
  const page = snapshot.pages[0]!.id;
  const table = snapshot.tables[0]!.id;
  return [
    ["PATCH", `/spreadsheets/${snapshot.id}`, { name: "Taken over" }],
    ["POST", `/spreadsheets/${snapshot.id}/pages`, {}],
    ["PATCH", `/pages/${page}`, { name: "Taken over" }],
    ["POST", `/pages/${page}/tables`, {}],
    ["PATCH", `/tables/${table}`, { name: "Taken over" }],
    ["PUT", `/tables/${table}/cells`, cellsBody({ C3: "written" })],
    ["POST", `/tables/${table}/cells/0/0/click`],
    ["DELETE", `/tables/${table}`],
    ["DELETE", `/pages/${page}`],
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
      ...readRoutes(),
      ...writeRoutes(),
    ];
    const result = await statuses(server.anonymous, routes);
    expect(result).toEqual(routes.map(() => 401));
    await expectUnchanged();
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
  it("can read and make every change", async () => {
    const editor = await server.signUp("Editor");
    await addMember(editor, "editor");

    expect(await editor.json("GET", `/spreadsheets/${snapshot.id}`)).toMatchObject({
      role: "editor",
    });
    // The page delete is refused because it is the last page, not for lack of access.
    expect(await statuses(editor, writeRoutes())).toEqual([
      204, 201, 204, 201, 200, 204, 200, 204, 204, 204,
    ]);
    await owner.json("GET", `/spreadsheets/${snapshot.id}`, undefined, 404);
  });
});
