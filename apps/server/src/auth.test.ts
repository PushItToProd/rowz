import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

describe("authentication", () => {
  it("rejects API requests without a session", async () => {
    const body = await server.anonymous.json("GET", "/spreadsheets", undefined, 401);
    expect(body).toEqual({ error: { code: "unauthenticated", message: "Sign in to continue" } });
  });

  it("accepts API requests after sign-up", async () => {
    const user = await server.signUp();
    expect(await user.json("GET", "/spreadsheets")).toEqual([]);
  });
});
