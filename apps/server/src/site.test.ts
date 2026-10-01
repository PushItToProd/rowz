import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withWebApp } from "./site";

let root: string;
let site: Hono;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "site-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>App</title>");
  await writeFile(join(root, "assets", "app.js"), "console.log('app')");
  const api = new Hono().get("/api/ping", (c) => c.json({ ok: true }));
  site = withWebApp(api, root);
});
afterAll(() => rm(root, { recursive: true }));

describe("withWebApp", () => {
  it("still answers the API", async () => {
    const response = await site.request("/api/ping");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("serves the app's page at the root", async () => {
    const response = await site.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("<title>App</title>");
  });

  it("serves the files of the build", async () => {
    const response = await site.request("/assets/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toBe("console.log('app')");
  });

  it("serves the app's page for an address only the web app's router knows", async () => {
    const response = await site.request("/s/123/p/456");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>App</title>");
  });

  it("keeps an unknown API path a 404, and does not answer it with the page", async () => {
    const response = await site.request("/api/nothing");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("<title>");
  });

  it("does not serve files outside the build", async () => {
    const response = await site.request("/../package.json");
    expect(await response.text()).not.toContain('"name"');
  });
});
