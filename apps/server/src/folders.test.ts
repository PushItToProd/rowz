import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentList, Snapshot } from "./app";
import { createSpreadsheet, startTestServer, type TestServer, type TestUser } from "./testing";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

const list = (user: TestUser): Promise<DocumentList> =>
  user.json<DocumentList>("GET", "/spreadsheets");

describe("private document folders", () => {
  it("creates, renames, moves documents, and deletes a folder back to the root", async () => {
    const user = await server.signUp("Owner");
    const document = await createSpreadsheet(user, "Plan");
    const initialList = await list(user);
    expect(initialList.folders).toEqual([]);
    expect(initialList.documents).toMatchObject([{ id: document.id, folderId: null }]);

    const folder = await user.json<{ id: string; name: string }>(
      "POST",
      "/folders",
      { name: "Projects" },
      201,
    );
    expect(folder).toMatchObject({ id: expect.any(String), name: "Projects" });
    await user.json("POST", "/folders", { name: "projects" }, 409);
    await user.json("PATCH", `/folders/${folder.id}`, { name: "PROJECTS" }, 200);

    const beforeMove = await user.json<Snapshot>("GET", `/spreadsheets/${document.id}`);
    const beforeUpdatedAt = (await list(user)).documents[0]?.updatedAt;
    const moved = await user.request("PUT", `/spreadsheets/${document.id}/folder`, {
      folderId: folder.id,
    });
    expect(moved.status).toBe(204);
    expect(moved.headers.get("x-undoable")).toBeNull();
    expect(await user.json<Snapshot>("GET", `/spreadsheets/${document.id}`)).toEqual(beforeMove);
    expect((await list(user)).documents[0]).toMatchObject({ folderId: folder.id });
    expect((await list(user)).documents[0]?.updatedAt).toBe(beforeUpdatedAt);

    await user.json("PUT", `/spreadsheets/${document.id}/folder`, { folderId: null }, 204);
    expect((await list(user)).documents[0]).toMatchObject({ folderId: null });
    await user.json("PUT", `/spreadsheets/${document.id}/folder`, { folderId: folder.id }, 204);
    await user.json("DELETE", `/folders/${folder.id}`, undefined, 204);
    expect(await list(user)).toMatchObject({ folders: [], documents: [{ folderId: null }] });
  });

  it("keeps folders private and refuses a document the caller cannot open", async () => {
    const alice = await server.signUp("Alice");
    const bob = await server.signUp("Bob");
    const aliceDocument = await createSpreadsheet(alice, "Alice's plan");
    const aliceFolder = await alice.json<{ id: string; name: string }>(
      "POST",
      "/folders",
      { name: "Private plans" },
      201,
    );
    await alice.json(
      "PUT",
      `/spreadsheets/${aliceDocument.id}/folder`,
      { folderId: aliceFolder.id },
      204,
    );

    const bobDocument = await createSpreadsheet(bob, "Bob's plan");
    const bobFolder = await bob.json<{ id: string; name: string }>(
      "POST",
      "/folders",
      { name: "private plans" },
      201,
    );
    expect((await list(bob)).folders).toEqual([bobFolder]);
    expect((await list(bob)).documents.map(({ name }) => name)).toEqual(["Bob's plan"]);
    await bob.json("PATCH", `/folders/${aliceFolder.id}`, { name: "Taken" }, 404);
    await bob.json("DELETE", `/folders/${aliceFolder.id}`, undefined, 404);
    await bob.json(
      "PUT",
      `/spreadsheets/${bobDocument.id}/folder`,
      {
        folderId: aliceFolder.id,
      },
      404,
    );
    await bob.json(
      "PUT",
      `/spreadsheets/${aliceDocument.id}/folder`,
      {
        folderId: bobFolder.id,
      },
      404,
    );
    expect((await list(alice)).documents[0]).toMatchObject({ folderId: aliceFolder.id });
    expect((await list(bob)).documents[0]).toMatchObject({ folderId: null });
  });

  it("lets a viewer organize a shared document in their own folders", async () => {
    const owner = await server.signUp("Owner");
    const viewer = await server.signUp("Viewer");
    const document = await createSpreadsheet(owner, "Shared plan");
    const ownerFolder = await owner.json<{ id: string }>(
      "POST",
      "/folders",
      {
        name: "Owner's folder",
      },
      201,
    );
    await owner.json(
      "PUT",
      `/spreadsheets/${document.id}/folder`,
      { folderId: ownerFolder.id },
      204,
    );
    await owner.json("PUT", `/spreadsheets/${document.id}/members`, {
      email: viewer.email,
      role: "viewer",
    });

    const viewerFolder = await viewer.json<{ id: string; name: string }>(
      "POST",
      "/folders",
      { name: "My shared documents" },
      201,
    );
    await viewer.json(
      "PUT",
      `/spreadsheets/${document.id}/folder`,
      {
        folderId: viewerFolder.id,
      },
      204,
    );
    expect((await list(viewer)).documents).toMatchObject([
      { id: document.id, role: "viewer", folderId: viewerFolder.id },
    ]);
    expect((await list(viewer)).folders).toEqual([viewerFolder]);
    expect((await list(owner)).documents).toMatchObject([
      { id: document.id, folderId: ownerFolder.id },
    ]);
  });

  it("requires requests that change folder membership to come from the app", async () => {
    const user = await server.signUp("Owner");
    const stranger = await server.signUp("Stranger");
    const document = await createSpreadsheet(user, "Plan");
    const folder = await user.json<{ id: string }>("POST", "/folders", { name: "Plans" }, 201);
    const elsewhere = { origin: "https://evil.localhost:5173" };
    const requests: [string, string, unknown?][] = [
      ["POST", "/folders", { name: "Other" }],
      ["PATCH", `/folders/${folder.id}`, { name: "Renamed" }],
      ["DELETE", `/folders/${folder.id}`],
      ["PUT", `/spreadsheets/${document.id}/folder`, { folderId: null }],
    ];
    for (const [method, path, body] of requests) {
      const response = await user.request(method, path, body, elsewhere);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "cross_origin" } });
    }
    await stranger.json("PUT", `/spreadsheets/${document.id}/folder`, { folderId: folder.id }, 404);
    expect((await list(user)).documents[0]).toMatchObject({ folderId: null });
  });
});
