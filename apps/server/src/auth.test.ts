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

  it("signs a new account in at once when verification is not required", async () => {
    const response = await server.anonymous.request("POST", "/auth/sign-up/email", {
      name: "Now",
      email: "now@example.com",
      password: "correct horse battery staple",
    });
    expect(await response.json()).toMatchObject({ token: expect.any(String) });
  });

  it("accepts API requests after sign-up", async () => {
    const user = await server.signUp();
    expect(await user.json("GET", "/spreadsheets")).toEqual([]);
  });
});

describe("with email verification required", () => {
  let strict: TestServer;
  beforeAll(async () => {
    strict = await startTestServer({ verifyEmail: true });
  });
  afterAll(() => strict.close());

  const account = {
    name: "Ada",
    email: "ada@example.com",
    password: "correct horse battery staple",
  };
  const signIn = () =>
    strict.anonymous.request("POST", "/auth/sign-in/email", {
      email: account.email,
      password: account.password,
    });

  it("sends a link on sign-up, and lets nobody sign in until it is opened", async () => {
    const signedUp = await strict.anonymous.request("POST", "/auth/sign-up/email", account);
    expect(signedUp.status).toBe(200);
    // Signing up gave no session. The web app tells by the missing token.
    expect(signedUp.headers.getSetCookie().join(";")).not.toContain("session_token");
    expect(await signedUp.clone().json()).toMatchObject({
      token: null,
      user: { email: account.email },
    });
    expect((await signIn()).status).toBe(403);

    expect(strict.sent).toHaveLength(1);
    const [message] = strict.sent;
    expect(message).toMatchObject({
      to: ["ada@example.com"],
      subject: "Confirm your email address",
    });
    const link = /https?:\/\/\S+/.exec(message!.body)?.[0];
    expect(link).toContain("/api/auth/verify-email?token=");

    // Opening the link confirms the address and signs the person in.
    const { pathname, search } = new URL(link!);
    const verified = await strict.anonymous.request(
      "GET",
      `${pathname.replace(/^\/api/, "")}${search}`,
    );
    expect(verified.status).toBeLessThan(400);
    const cookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token");
    const listed = await strict.anonymous.request("GET", "/spreadsheets", undefined, { cookie });
    expect(listed.status).toBe(200);

    expect((await signIn()).status).toBe(200);
  });
});
