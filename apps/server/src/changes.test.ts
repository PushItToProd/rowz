import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TableRecord } from "./app";
import { ChangeFeed } from "./changes";
import {
  cellsBody,
  createSpreadsheet,
  startTestServer,
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

/** Opens the stream of changes of a spreadsheet and reads its events one at a time. */
async function listen(client: TestUser, spreadsheetId: string) {
  const abort = new AbortController();
  const response = await client.request(
    "GET",
    `/spreadsheets/${spreadsheetId}/events`,
    undefined,
    {},
    abort.signal,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  const next = async (): Promise<{ event: string; data: string }> => {
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
        return { event: field("event"), data: field("data") };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("The stream ended");
      buffered += value;
    }
  };
  expect(await next()).toEqual({ event: "ready", data: "" });
  return {
    next,
    close: (): void => {
      abort.abort();
    },
  };
}

describe("ChangeFeed", () => {
  it("tells the listeners of a spreadsheet, and only them, until they stop listening", () => {
    const feed = new ChangeFeed();
    const heard: string[] = [];
    const stop = feed.subscribe("a", (origin) => heard.push(`a:${origin}`));
    feed.subscribe("b", (origin) => heard.push(`b:${origin}`));
    feed.publish("a", "one");
    feed.publish("b", "two");
    feed.publish("c", "three");
    stop();
    feed.publish("a", "four");
    expect(heard).toEqual(["a:one", "b:two"]);
  });
});

describe("the stream of changes", () => {
  it("announces each change with the client that made it", async () => {
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    const stream = await listen(user, snapshot.id);

    await user.request("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "x" }), {
      "x-client-id": "tab-1",
    });
    expect(await stream.next()).toEqual({ event: "change", data: "tab-1" });

    await user.json("PATCH", `/spreadsheets/${snapshot.id}`, { name: "Renamed" }, 204);
    expect(await stream.next()).toEqual({ event: "change", data: "" });

    await user.request(
      "POST",
      `/tables/${table.id}/edits`,
      { axis: "row", kind: "insert", index: 0 },
      {
        "x-client-id": "tab-2",
      },
    );
    expect(await stream.next()).toEqual({ event: "change", data: "tab-2" });
    stream.close();
  });

  it("announces a button click, a share, and a deletion", async () => {
    const guest = await server.signUp("Guest");
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    await user.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A1: '=BUTTON("Go", EXECUTE(1, B1))' }),
      204,
    );
    const stream = await listen(user, snapshot.id);
    await user.json("POST", `/tables/${table.id}/cells/0/0/click`);
    expect((await stream.next()).event).toBe("change");
    await user.json("PUT", `/spreadsheets/${snapshot.id}/members`, {
      email: guest.email,
      role: "viewer",
    });
    expect((await stream.next()).event).toBe("change");
    await user.json("DELETE", `/spreadsheets/${snapshot.id}`, undefined, 204);
    expect((await stream.next()).event).toBe("change");
    stream.close();
  });

  it("says nothing of a request that was refused, or of another spreadsheet", async () => {
    const snapshot = await createSpreadsheet(user);
    const other = await createSpreadsheet(user);
    const stream = await listen(user, snapshot.id);
    const table = snapshot.tables[0]!;

    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ Z99: "outside" }), 422);
    await user.json<TableRecord>("POST", `/pages/${other.pages[0]!.id}/tables`, {}, 201);
    await user.json("GET", `/spreadsheets/${snapshot.id}`);
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "marker" }), 204);
    // The first thing heard is the change made last: nothing before it was announced.
    expect(await stream.next()).toEqual({ event: "change", data: "" });
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
});
