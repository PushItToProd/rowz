import { randomUUID } from "node:crypto";
import { STEP_ID_HEADER } from "@spreadsheet-app/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Change, UndoResult } from "./app";
import { ChangeFeed, type Announcement } from "./changes";
import {
  addTable,
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  rowIds,
  startTestServer,
  withClientId,
  type TestClient,
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

/** An event with no data: something changed, and a session reads the spreadsheet again. */
const READ_AGAIN = { event: "change", data: undefined };

/**
 * Opens the stream of changes of a spreadsheet and reads its events one at a
 * time. The data of an event is given parsed, and `undefined` when it has none.
 */
async function listen(client: TestClient, spreadsheetId: string, as = "") {
  const abort = new AbortController();
  const response = await client.request(
    "GET",
    `/spreadsheets/${spreadsheetId}/events${as === "" ? "" : `?client=${as}`}`,
    undefined,
    {},
    abort.signal,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  const next = async (): Promise<{ event: string; data: unknown }> => {
    for (;;) {
      const end = buffered.indexOf("\n\n");
      if (end !== -1) {
        const block = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const field = (name: string): string =>
          block
            .split("\n")
            .find((line) => line.startsWith(`${name}:`))
            ?.slice(name.length + 1)
            .trim() ?? "";
        const data = field("data");
        return { event: field("event"), data: data === "" ? undefined : JSON.parse(data) };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("The stream ended");
      buffered += value;
    }
  };
  const ready = await next();
  expect(ready).toEqual({ event: "ready", data: { revision: expect.any(Number) } });
  return {
    /** The revision of the spreadsheet when the stream opened. */
    revision: (ready.data as { revision: number }).revision,
    next,
    /** The next event, which must be a change to the content. */
    change: async (): Promise<Change> => {
      const { event, data } = await next();
      expect(event).toBe("change");
      expect(data).toMatchObject({ revision: expect.any(Number) });
      return data as Change;
    },
    close: (): void => {
      abort.abort();
    },
  };
}

describe("ChangeFeed", () => {
  it("tells the listeners of a spreadsheet, and only them, until they stop listening", () => {
    const feed = new ChangeFeed();
    const heard: string[] = [];
    const from = (origin: string): Announcement => ({ origin });
    const stop = feed.subscribe("a", ({ origin }) => heard.push(`a:${origin}`));
    feed.subscribe("b", ({ origin }) => heard.push(`b:${origin}`));
    feed.publish("a", from("one"));
    feed.publish("b", from("two"));
    feed.publish("c", from("three"));
    stop();
    feed.publish("a", from("four"));
    expect(heard).toEqual(["a:one", "b:two"]);
  });
});

describe("the stream of changes", () => {
  it("sends each change to the content with its revision, without naming the client that made it", async () => {
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    const stream = await listen(user, snapshot.id);
    expect(stream.revision).toBe(snapshot.revision);

    const response = await user.request(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A1: "x" }),
      { "x-client-id": "tab-1" },
    );
    const answered = (await response.json()) as Change;
    expect(answered.revision).toBe(snapshot.revision + 1);
    // The event holds what the response to the change held.
    const heard = await stream.next();
    expect(heard).toEqual({ event: "change", data: answered });
    expect(JSON.stringify(heard)).not.toContain("tab-1");
    expect(answered.changed?.cells).toEqual([
      {
        tableId: table.id,
        rowId: rowIds(snapshot, table.id)[0],
        colId: table.colIds[0],
        input: "x",
      },
    ]);

    // A change to something other than the content has no revision, and no data.
    await user.json("PATCH", `/spreadsheets/${snapshot.id}`, { name: "Renamed" }, 204);
    expect(await stream.next()).toEqual(READ_AGAIN);
    stream.close();
  });

  it("holds the rows and cells of a save, a row insert, and an undo", async () => {
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    const tab = withClientId(user);
    const stream = await listen(user, snapshot.id);

    await tab.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A2: "1", B1: "=A2" }));
    expect((await stream.change()).changed?.cells.map((cell) => cell.input)).toEqual(["1", "=A2"]);

    await tab.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "insert", index: 0 });
    const inserted = await stream.change();
    const after = await readSnapshot(user, snapshot.id);
    const [added] = rowIds(after, table.id);
    expect(inserted.changed).toEqual({
      pages: [],
      tables: [],
      views: [],
      rows: [{ id: added, tableId: table.id, orderKey: expect.any(String) }],
      // The formula's cell keeps its ids. Only its text changed.
      cells: [
        { tableId: table.id, rowId: rowIds(snapshot, table.id)[0], colId: table.colIds[1], input: "=A3" },
      ],
    });

    const undone = await tab.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/undo`);
    const heard = await stream.change();
    expect(heard).toEqual(undone.change);
    expect(heard.revision).toBe(inserted.revision + 1);
    expect(heard.changed).toMatchObject({
      rows: [{ id: added, tableId: table.id, orderKey: null }],
      cells: [{ input: "=A2" }],
    });
    stream.close();
  });

  it("sends a change too large to describe without its content", async () => {
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: 11, colCount: 100 });
    const tab = withClientId(user);
    const step = { [STEP_ID_HEADER]: randomUUID() };
    const cells = Array.from({ length: 1001 }, (_, index) => ({
      row: Math.floor(index / 100),
      col: index % 100,
      input: String(index),
    }));
    for (const batch of [cells.slice(0, 1000), cells.slice(1000)]) {
      const response = await tab.request("PUT", `/tables/${table.id}/cells`, { cells: batch }, step);
      expect(response.status).toBe(200);
    }

    const stream = await listen(user, snapshot.id);
    const undone = await tab.json<UndoResult>("POST", `/spreadsheets/${snapshot.id}/undo`);
    expect(undone).toMatchObject({ outcome: "done", change: { changed: null } });
    expect(await stream.change()).toEqual({ revision: undone.change?.revision, changed: null });
    expect((await readSnapshot(user, snapshot.id)).cells).toEqual([]);
    stream.close();
  });

  it("sends a client its own changes to the content, and not its other changes", async () => {
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    const save = (input: string, client: string) =>
      user.request("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: input }), {
        "x-client-id": client,
      });
    const [mine, theirs] = [
      await listen(user, snapshot.id, "tab-1"),
      await listen(user, snapshot.id, "tab-2"),
    ];

    // Each hears every revision, its own included, so neither takes one for a gap.
    await save("from tab 1", "tab-1");
    await save("from tab 2", "tab-2");
    for (const stream of [mine, theirs]) {
      const revisions = [(await stream.change()).revision, (await stream.change()).revision];
      expect(revisions).toEqual([snapshot.revision + 1, snapshot.revision + 2]);
    }

    // A rename of the spreadsheet is on the screen of the tab that made it.
    await user.request("PATCH", `/spreadsheets/${snapshot.id}`, { name: "Renamed" }, {
      "x-client-id": "tab-1",
    });
    await save("marker", "");
    expect(await theirs.next()).toEqual(READ_AGAIN);
    expect((await theirs.change()).revision).toBe(snapshot.revision + 3);
    // The first thing tab 1 hears is the marker: its rename was not announced to it.
    expect((await mine.change()).revision).toBe(snapshot.revision + 3);
    mine.close();
    theirs.close();
  });

  it("ends when the server shuts down", async () => {
    const stopping = new AbortController();
    const stopped = await startTestServer({ shutdown: stopping.signal });
    const reader = await stopped.signUp();
    const snapshot = await createSpreadsheet(reader);
    const stream = await listen(reader, snapshot.id);

    stopping.abort();
    await expect(stream.next()).rejects.toThrow("The stream ended");
    // A stream opened during the shutdown ends at once, so reading all of it does not wait.
    const late = await reader.request("GET", `/spreadsheets/${snapshot.id}/events`);
    expect(await late.text()).toBe(
      `event: ready\ndata: {"revision":${String(snapshot.revision)}}\n\n`,
    );
    await stopped.close();
  });

  it("announces a button click, a share, and a deletion", async () => {
    const guest = await server.signUp("Guest");
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    await user.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A1: '=BUTTON("Go", DO(APPEND_ROW(A:A, "added"), EXECUTE(1, B1)))' }),
    );
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: 1 });
    const stream = await listen(user, snapshot.id);
    await user.json("POST", `/tables/${table.id}/cells/0/0/click`);
    // The row the action added and the cells it wrote are one change, and one revision.
    const clicked = await stream.change();
    expect(clicked.revision).toBe(stream.revision + 1);
    expect(clicked.changed?.rows).toHaveLength(1);
    expect(clicked.changed?.cells.map((cell) => cell.input).sort()).toEqual(["1", "added"]);

    await user.json("PUT", `/spreadsheets/${snapshot.id}/members`, {
      email: guest.email,
      role: "viewer",
    });
    expect(await stream.next()).toEqual(READ_AGAIN);
    await user.json("DELETE", `/spreadsheets/${snapshot.id}`, undefined, 204);
    expect(await stream.next()).toEqual(READ_AGAIN);
    stream.close();
  });

  it("says nothing of a request that was refused, or of another spreadsheet", async () => {
    const snapshot = await createSpreadsheet(user);
    const other = await createSpreadsheet(user);
    const stream = await listen(user, snapshot.id);
    const table = snapshot.tables[0]!;

    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ Z99: "outside" }), 409);
    await addTable(user, other.pages[0]!.id);
    await user.json("GET", `/spreadsheets/${snapshot.id}`);
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "marker" }), 200);
    // The first thing heard is the change made last: nothing before it was announced,
    // and the refused request used no revision.
    expect(await stream.change()).toMatchObject({
      revision: snapshot.revision + 1,
      changed: { cells: [{ input: "marker" }] },
    });
    stream.close();
  });

  it("is closed to people who cannot open the spreadsheet", async () => {
    const snapshot = await createSpreadsheet(user);
    const stranger = await server.signUp("Stranger");
    await stranger.json("GET", `/spreadsheets/${snapshot.id}/events`, undefined, 404);
    expect(
      (await server.anonymous.request("GET", `/spreadsheets/${snapshot.id}/events`)).status,
    ).toBe(401);
  });

  it("sends no content to someone whose share ended while the stream was open", async () => {
    const guest = await server.signUp("Guest");
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    const members = `/spreadsheets/${snapshot.id}/members`;
    await user.json("PUT", members, { email: guest.email, role: "viewer" });
    const stream = await listen(guest, snapshot.id);

    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "for the guest" }));
    expect((await stream.change()).changed?.cells[0]?.input).toBe("for the guest");

    await user.json("DELETE", `${members}/${guest.userId}`, undefined, 204);
    expect(await stream.next()).toEqual(READ_AGAIN);
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "secret" }));
    // The guest is told only that something changed, and then the stream ends.
    expect(await stream.next()).toEqual(READ_AGAIN);
    await expect(stream.next()).rejects.toThrow("The stream ended");
  });
});
