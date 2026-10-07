import { randomUUID } from "node:crypto";
import { formatAddress } from "@spreadsheet-app/engine";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { ReplaceBody, ReplaceReport } from "@spreadsheet-app/shared";
import {
  addView,
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  startTestServer,
  withClientId,
  type TestClient,
  type TestServer,
  type TestUser,
} from "./testing";

let server: TestServer;
let owner: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  owner = await server.signUp();
});
afterAll(async () => server.close());
const request = (changes: Partial<ReplaceBody> = {}): ReplaceBody => ({
  query: "old",
  replacement: "new",
  scope: { kind: "document" },
  caseSensitive: false,
  whole: false,
  ...changes,
});
async function storedInputs(client: TestClient, id: string, tableId: string) {
  const snapshot = await readSnapshot(client, id);
  return Object.fromEntries(
    snapshot.cells
      .filter((cell) => cell.tableId === tableId)
      .map((cell) => [formatAddress(cell), cell.input]),
  );
}

it("replaces literal occurrences in cell formulas and all block sources in one undo step", async () => {
  const client = withClientId(owner);
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  await owner.json(
    "PUT",
    `/tables/${table.id}/cells`,
    cellsBody({ A1: "OLD old", A2: '=UPPER("old")', A3: "a.b" }),
  );
  for (const kind of ["chart", "text", "script"] as const) {
    const view = await addView(owner, snapshot.pages[0]!.id, kind);
    await owner.json("PATCH", `/views/${view.id}`, {
      source: kind === "script" ? 'Value = "old"' : "old",
    });
  }
  const before = await readSnapshot(owner, snapshot.id);
  const result = await client.json("POST", `/spreadsheets/${snapshot.id}/replace`, request());
  expect(result).toHaveProperty("changed");
  const after = await readSnapshot(owner, snapshot.id);
  expect(await storedInputs(owner, snapshot.id, table.id)).toMatchObject({
    A1: "new new",
    A2: '=UPPER("new")',
    A3: "a.b",
  });
  expect(after.views.every((view) => view.source.includes("new"))).toBe(true);
  await client.json("POST", `/spreadsheets/${snapshot.id}/undo`);
  const undone = await readSnapshot(owner, snapshot.id);
  expect(undone.cells).toEqual(expect.arrayContaining(before.cells));
  expect(undone.cells).toHaveLength(before.cells.length);
  expect(undone.views).toEqual(before.views);
});

it("limits replacements by page and block, respects case and entire matches, and treats punctuation literally", async () => {
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  const other = await owner.json<{ page: { id: string }; table: { id: string } }>(
    "POST",
    `/spreadsheets/${snapshot.id}/pages`,
    {},
    201,
  );
  await owner.json(
    "PUT",
    `/tables/${table.id}/cells`,
    cellsBody({ A1: "old", A2: "OLD", A3: "older", A4: "a.b aXb" }),
  );
  await owner.json("PUT", `/tables/${other.table.id}/cells`, cellsBody({ A1: "old" }));
  const view = await addView(owner, snapshot.pages[0]!.id, "text");
  await owner.json("PATCH", `/views/${view.id}`, { source: "old" });
  await owner.json(
    "POST",
    `/spreadsheets/${snapshot.id}/replace`,
    request({ scope: { kind: "block", id: table.id }, caseSensitive: true, whole: true }),
  );
  let after = await readSnapshot(owner, snapshot.id);
  expect(await storedInputs(owner, snapshot.id, table.id)).toMatchObject({
    A1: "new",
    A2: "OLD",
    A3: "older",
  });
  expect(after.views[0]!.source).toBe("old");
  await owner.json(
    "POST",
    `/spreadsheets/${snapshot.id}/replace`,
    request({ scope: { kind: "page", id: snapshot.pages[0]!.id } }),
  );
  after = await readSnapshot(owner, snapshot.id);
  expect((await storedInputs(owner, snapshot.id, other.table.id)).A1).toBe("old");
  expect(after.views[0]!.source).toBe("new");
  await owner.json(
    "POST",
    `/spreadsheets/${snapshot.id}/replace`,
    request({ query: "a.b", replacement: "$&" }),
  );
  expect((await storedInputs(owner, snapshot.id, table.id)).A4).toBe("$& aXb");
});

it("replaces one occurrence using stable cell identities and refuses a stale match", async () => {
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  await owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "old old" }));
  const cell = (await readSnapshot(owner, snapshot.id)).cells[0]!;
  const one = {
    target: {
      kind: "cell" as const,
      blockId: table.id,
      rowId: table.rows[cell.row]!.id,
      colId: table.colIds[cell.col]!,
    },
    offset: 4,
    expected: "old old",
  };
  await owner.json("POST", `/spreadsheets/${snapshot.id}/replace`, request({ one }));
  expect((await storedInputs(owner, snapshot.id, table.id)).A1).toBe("old new");
  expect(
    (await owner.request("POST", `/spreadsheets/${snapshot.id}/replace`, request({ one }))).status,
  ).toBe(409);
});

it("replaces formula column definitions, filters and named formulas without storing computed cells", async () => {
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  await owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "old" }));
  await owner.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
  await owner.json("PATCH", `/tables/${table.id}/columns/1`, {
    type: "formula",
    formula: '="old"',
  });
  await owner.json("PUT", `/tables/${table.id}/display`, {
    sort: [],
    filter: '=[Column 1] = "old"',
  });
  const plain = await owner.json<{ table: { id: string } }>(
    "POST",
    `/pages/${snapshot.pages[0]!.id}/tables`,
    {},
    201,
  );
  await owner.json("PUT", `/tables/${plain.table.id}/names`, {
    names: [{ name: "Greeting", formula: '"old"' }],
  });
  await owner.json("POST", `/spreadsheets/${snapshot.id}/replace`, request());
  const after = await readSnapshot(owner, snapshot.id);
  const updated = after.tables.find((item) => item.id === table.id)!;
  expect(updated.columns?.[1]?.formula).toBe('="new"');
  expect(updated.display.filter).toBe('=[Column 1] = "new"');
  expect(after.cells.filter((cell) => cell.tableId === table.id)).toHaveLength(1);
  expect(after.tables.find((item) => item.id === plain.table.id)?.names[0]?.formula).toBe('"new"');
});

it("preserves script-name reference rewriting when a replacement renames a definition", async () => {
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  const script = await addView(owner, snapshot.pages[0]!.id, "script");
  await owner.json("PATCH", `/views/${script.id}`, { source: "OldName = 2" });
  await owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "=OldName+1" }));
  await owner.json(
    "POST",
    `/spreadsheets/${snapshot.id}/replace`,
    request({ query: "OldName", replacement: "NewName", scope: { kind: "block", id: script.id } }),
  );
  const after = await readSnapshot(owner, snapshot.id);
  expect((await storedInputs(owner, snapshot.id, table.id)).A1).toBe("=NewName+1");
  expect(after.views[0]!.source).toBe("NewName = 2");
});

it("refuses empty queries and foreign scopes without writing", async () => {
  const snapshot = await createSpreadsheet(owner);
  const other = await createSpreadsheet(owner);
  expect(
    (await owner.request("POST", `/spreadsheets/${snapshot.id}/replace`, request({ query: "" })))
      .status,
  ).toBe(400);
  for (const scope of [
    { kind: "page" as const, id: other.pages[0]!.id },
    { kind: "block" as const, id: other.tables[0]!.id },
    { kind: "block" as const, id: randomUUID() },
  ]) {
    expect(
      (await owner.request("POST", `/spreadsheets/${snapshot.id}/replace`, request({ scope })))
        .status,
    ).toBe(404);
  }
});

it("rolls back every replacement if any input would exceed its length limit", async () => {
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  await owner.json(
    "PUT",
    `/tables/${table.id}/cells`,
    cellsBody({ A1: "old", A2: "old".repeat(2700) }),
  );
  const before = await storedInputs(owner, snapshot.id, table.id);
  expect(
    (
      await owner.request(
        "POST",
        `/spreadsheets/${snapshot.id}/replace`,
        request({ replacement: "longer" }),
      )
    ).status,
  ).toBe(400);
  expect(await storedInputs(owner, snapshot.id, table.id)).toEqual(before);
});

it("refuses replacements too large to journal and leaves the document unchanged", async () => {
  const limited = await startTestServer({
    repositoryOptions: { journalLimits: { journalEntryBytes: 200 } },
  });
  try {
    const user = await limited.signUp();
    const client = withClientId(user);
    const snapshot = await createSpreadsheet(user);
    const table = snapshot.tables[0]!;
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "old".repeat(100) }));
    const before = await storedInputs(user, snapshot.id, table.id);
    const response = await client.request(
      "POST",
      `/spreadsheets/${snapshot.id}/replace`,
      request(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "replacement_too_large" } });
    expect(await storedInputs(user, snapshot.id, table.id)).toEqual(before);
  } finally {
    await limited.close();
  }
});

it("skips syntax errors in every formula-bearing input while replacing valid text in one undo step", async () => {
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  const pageId = snapshot.pages[0]!.id;
  await owner.json(
    "PUT",
    `/tables/${table.id}/cells`,
    cellsBody({ A1: '=UPPER("old")', A2: "=old!A1", C1: "old" }),
  );
  await owner.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
  await owner.json("PATCH", `/tables/${table.id}/columns/1`, {
    type: "formula",
    formula: '="old"',
  });
  await owner.json("PUT", `/tables/${table.id}/display`, {
    sort: [],
    filter: '=[Column 3] = "old"',
  });
  const plain = await owner.json<{ table: { id: string } }>(
    "POST",
    `/pages/${pageId}/tables`,
    {},
    201,
  );
  await owner.json("PUT", `/tables/${plain.table.id}/names`, {
    names: [{ name: "Greeting", formula: '"old"' }],
  });
  for (const kind of ["chart", "text", "script"] as const) {
    const view = await addView(owner, pageId, kind);
    const source =
      kind === "text"
        ? '{{ UPPER("old") }}'
        : kind === "script"
          ? 'Greeting = "old"'
          : 'UPPER("old")';
    await owner.json("PATCH", `/views/${view.id}`, { source });
  }
  const before = await readSnapshot(owner, snapshot.id);
  const client = withClientId(owner);
  const result = await client.json<ReplaceReport>(
    "POST",
    `/spreadsheets/${snapshot.id}/replace`,
    request({ replacement: '"' }),
  );
  expect(result.skippedCount).toBe(8);
  expect(result.skipped).toHaveLength(8);
  expect(result.skipped.every((item) => item.pageId === pageId)).toBe(true);
  expect(result.skipped.map((item) => item.reason)).toEqual(
    Array.from({ length: 8 }, () => "skipped: would not parse"),
  );
  expect(result.skipped.map((item) => item.target.kind).sort()).toEqual(
    ["cell", "cell", "column", "filter", "name", "source", "source", "source"].sort(),
  );
  expect(result.skipped.map((item) => item.label)).toEqual(
    expect.arrayContaining([
      "Page 1 > Table 1 > A1",
      "Page 1 > Table 1 > A2",
      "Page 1 > Table 1 > Column 2 formula",
      "Page 1 > Table 1 > filter",
    ]),
  );
  const after = await readSnapshot(owner, snapshot.id);
  expect(await storedInputs(owner, snapshot.id, table.id)).toMatchObject({
    A1: '=UPPER("old")',
    A2: "=old!A1",
    C1: '"',
  });
  expect(after.tables).toEqual(before.tables);
  expect(after.views).toEqual(before.views);
  await client.json("POST", `/spreadsheets/${snapshot.id}/undo`);
  expect(await storedInputs(owner, snapshot.id, table.id)).toMatchObject({ C1: "old" });
});

it("checks nested template expressions and template/script structural syntax", async () => {
  const snapshot = await createSpreadsheet(owner);
  const text = await addView(owner, snapshot.pages[0]!.id, "text");
  for (const source of [
    '{% if TRUE %}{% for item in {"old"} %}{{ item }}{% end %}{% else %}{{ "old" }}{% end %}',
    '{% let value = "old" %}{{ value }}',
  ]) {
    await owner.json("PATCH", `/views/${text.id}`, { source });
    const result = await owner.json<ReplaceReport>(
      "POST",
      `/spreadsheets/${snapshot.id}/replace`,
      request({ replacement: '"' }),
    );
    expect(result.skippedCount).toBe(1);
    expect(
      (await readSnapshot(owner, snapshot.id)).views.find((view) => view.id === text.id)?.source,
    ).toBe(source);
  }
  await owner.json("PATCH", `/views/${text.id}`, { source: "{% if TRUE %}old{% end %}" });
  const result = await owner.json<ReplaceReport>(
    "POST",
    `/spreadsheets/${snapshot.id}/replace`,
    request({ query: "end", replacement: "broken" }),
  );
  expect(result.skippedCount).toBe(1);
  const script = await addView(owner, snapshot.pages[0]!.id, "script");
  await owner.json("PATCH", `/views/${script.id}`, { source: "OldName = 1" });
  const scriptResult = await owner.json<ReplaceReport>(
    "POST",
    `/spreadsheets/${snapshot.id}/replace`,
    request({ query: "OldName", replacement: "  Indented" }),
  );
  expect(scriptResult.skippedCount).toBe(1);
});

it("accepts syntactically valid unresolved names and replaces matches beyond the client display cap", async () => {
  const snapshot = await createSpreadsheet(owner);
  const table = snapshot.tables[0]!;
  await owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "=OldName+1" }));
  const result = await owner.json<ReplaceReport>(
    "POST",
    `/spreadsheets/${snapshot.id}/replace`,
    request({ query: "OldName", replacement: "MissingName" }),
  );
  expect(result).toMatchObject({ skippedCount: 0, skipped: [] });
  expect(await storedInputs(owner, snapshot.id, table.id)).toMatchObject({ A1: "=MissingName+1" });
  const text = await addView(owner, snapshot.pages[0]!.id, "text");
  await owner.json("PATCH", `/views/${text.id}`, { source: "old ".repeat(1200) });
  await owner.json("POST", `/spreadsheets/${snapshot.id}/replace`, request());
  expect(
    (await readSnapshot(owner, snapshot.id)).views.find((view) => view.id === text.id)?.source,
  ).toBe("new ".repeat(1200));
});
