import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ListedSpreadsheet, MemberRecord, Snapshot } from "./app";
import {
  cellsBody,
  createSpreadsheet,
  startTestServer,
  type TestServer,
  type TestUser,
} from "./testing";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

/** An owner with a spreadsheet, and a second account it can be shared with. */
async function start() {
  const owner = await server.signUp("Owner");
  const guest = await server.signUp("Guest");
  const snapshot = await createSpreadsheet(owner, "Plan");
  const base = `/spreadsheets/${snapshot.id}`;
  const share = (email: string, role: string, status?: number, as: TestUser = owner) =>
    as.json<MemberRecord[]>("PUT", `${base}/members`, { email, role }, status);
  return { owner, guest, snapshot, base, table: snapshot.tables[0]!, share };
}

describe("sharing a spreadsheet", () => {
  it("lists only the owner until it is shared", async () => {
    const { owner, base } = await start();
    expect(await owner.json("GET", `${base}/members`)).toEqual([
      { userId: owner.userId, name: "Owner", email: owner.email, role: "owner", shared: false },
    ]);
  });

  it("gives another account the spreadsheet, in its list and with its role", async () => {
    const { guest, snapshot, base, share } = await start();
    await guest.json("GET", base, undefined, 404);

    const members = await share(guest.email.toUpperCase(), "editor");
    expect(members).toMatchObject([
      { name: "Owner", role: "owner", shared: false },
      { userId: guest.userId, name: "Guest", role: "editor", shared: true },
    ]);
    expect(await guest.json<Snapshot>("GET", base)).toMatchObject({
      id: snapshot.id,
      role: "editor",
    });
    expect(
      (await guest.json<{ documents: ListedSpreadsheet[] }>("GET", "/spreadsheets")).documents,
    ).toMatchObject([{ id: snapshot.id, name: "Plan", role: "editor" }]);
  });

  it("lets an editor change the contents and run buttons, and not share or delete", async () => {
    const { guest, base, table, share } = await start();
    await share(guest.email, "editor");
    await guest.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A1: '=BUTTON("Go", EXECUTE(7, B1))' }),
    );
    expect(await guest.json("POST", `/tables/${table.id}/cells/0/0/click`)).toMatchObject({
      status: "succeeded",
    });
    await guest.json("POST", `/tables/${table.id}/edits`, {
      axis: "row",
      kind: "insert",
      index: 0,
    });
    expect(await share("x@example.com", "viewer", 403, guest)).toEqual({
      error: { code: "forbidden", message: "Only the owner of this spreadsheet can do that" },
    });
    await guest.json("DELETE", base, undefined, 403);
  });

  it("lets a viewer read and nothing else", async () => {
    const { guest, base, table, share } = await start();
    await share(guest.email, "viewer");
    expect(await guest.json<Snapshot>("GET", base)).toMatchObject({ role: "viewer" });
    await guest.json("GET", `${base}/members`);
    await guest.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "x" }), 403);
    await guest.json("PATCH", base, { name: "Mine now" }, 403);
    await guest.json("DELETE", base, undefined, 403);
  });

  it("changes the role of someone it is already shared with", async () => {
    const { guest, base, table, share } = await start();
    await share(guest.email, "viewer");
    const members = await share(guest.email, "editor");
    expect(members.filter((member) => member.shared)).toMatchObject([{ role: "editor" }]);
    await guest.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "x" }), 200);
    expect(await guest.json<Snapshot>("GET", base)).toMatchObject({ role: "editor" });
  });

  it("puts a guest's new spreadsheets in the guest's own workspace", async () => {
    const { owner, guest, share } = await start();
    await share(guest.email, "editor");
    const mine = await createSpreadsheet(guest, "Guest's own");
    await owner.json("GET", `/spreadsheets/${mine.id}`, undefined, 404);
    const listed = await owner.json<{ documents: ListedSpreadsheet[] }>("GET", "/spreadsheets");
    expect(listed.documents.map((item) => item.name)).toEqual(["Plan"]);
  });

  it.each<[string, (fixture: Awaited<ReturnType<typeof start>>) => Promise<unknown>, object]>([
    [
      "an address no account uses",
      ({ share }) => share("nobody@example.com", "viewer", 422),
      {
        error: {
          code: "no_such_account",
          message: "No account uses nobody@example.com. Ask them to sign up, then share again",
        },
      },
    ],
    [
      "the owner's own address",
      ({ owner, share }) => share(owner.email, "viewer", 409),
      { error: { code: "conflict" } },
    ],
    ["the role of owner", ({ guest, share }) => share(guest.email, "owner", 400), {}],
    ["something that is not an address", ({ share }) => share("not an email", "viewer", 400), {}],
  ])("refuses %s", async (_, attempt, expected) => {
    const fixture = await start();
    expect(await attempt(fixture)).toMatchObject(expected);
    expect(await fixture.owner.json<MemberRecord[]>("GET", `${fixture.base}/members`)).toHaveLength(
      1,
    );
  });
});

describe("ending a share", () => {
  it("takes the spreadsheet away from the guest", async () => {
    const { owner, guest, base, share } = await start();
    await share(guest.email, "editor");
    await owner.json("DELETE", `${base}/members/${guest.userId}`, undefined, 204);
    await guest.json("GET", base, undefined, 404);
    expect(await guest.json("GET", "/spreadsheets")).toEqual({ folders: [], documents: [] });
    expect(await owner.json<MemberRecord[]>("GET", `${base}/members`)).toHaveLength(1);
  });

  it("lets a guest leave, and not remove anyone else", async () => {
    const { owner, guest, base, share } = await start();
    const other = await server.signUp("Other");
    await share(guest.email, "editor");
    await share(other.email, "viewer");
    await guest.json("DELETE", `${base}/members/${other.userId}`, undefined, 403);
    await other.json("DELETE", `${base}/members/${guest.userId}`, undefined, 403);
    await guest.json("DELETE", `${base}/members/${guest.userId}`, undefined, 204);
    await guest.json("GET", base, undefined, 404);
    const left = await owner.json<MemberRecord[]>("GET", `${base}/members`);
    expect(left.map((member) => member.name)).toEqual(["Owner", "Other"]);
  });

  it("cannot remove the owner, or a share that is not there", async () => {
    const { owner, guest, base } = await start();
    await owner.json("DELETE", `${base}/members/${owner.userId}`, undefined, 404);
    await owner.json("DELETE", `${base}/members/${guest.userId}`, undefined, 404);
    await owner.json("GET", base);
  });

  it("ends with the spreadsheet: deleting it removes it from the guest's list", async () => {
    const { owner, guest, base, share } = await start();
    await share(guest.email, "editor");
    await owner.json("DELETE", base, undefined, 204);
    expect(await guest.json("GET", "/spreadsheets")).toEqual({ folders: [], documents: [] });
  });
});
