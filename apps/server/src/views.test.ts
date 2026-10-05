import { LIMITS } from "@spreadsheet-app/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Change, PageRecord, TableRecord, ViewRecord } from "./app";
import {
  addTable,
  addView,
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  startTestServer,
  type TestServer,
  type TestUser,
} from "./testing";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp();
});
afterAll(() => server.close());

/** A new spreadsheet with its first page and table. */
async function start(): Promise<{ id: string; page: PageRecord; table: TableRecord }> {
  const snapshot = await createSpreadsheet(user);
  return { id: snapshot.id, page: snapshot.pages[0]!, table: snapshot.tables[0]! };
}

function add(pageId: string, kind: ViewRecord["kind"]): Promise<ViewRecord> {
  return addView(user, pageId, kind);
}

/** The sources a change wrote, by view. */
function sourcesIn(change: Change): { id: string; source: string | undefined }[] {
  return (change.changed?.views ?? []).map(({ id, view }) => ({ id, source: view?.source }));
}

async function viewsOf(spreadsheetId: string): Promise<ViewRecord[]> {
  return (await readSnapshot(user, spreadsheetId)).views;
}

describe("creating views", () => {
  it("inserts mixed blocks at the top, middle, and end, including after a deletion", async () => {
    const { id, page, table } = await start();
    const chart = await add(page.id, "chart");
    const text = await user.json<{ view: ViewRecord }>(
      "POST",
      `/pages/${page.id}/views`,
      { kind: "text", position: 0 },
      201,
    );
    const middle = await user.json<{ table: TableRecord; change: Change }>(
      "POST",
      `/pages/${page.id}/tables`,
      { position: 2 },
      201,
    );
    expect(middle.change.changed?.views).toMatchObject([{ id: chart.id, view: { position: 3 } }]);
    const order = async () => {
      const snapshot = await readSnapshot(user, id);
      return [...snapshot.tables, ...snapshot.views]
        .sort((a, b) => a.position - b.position)
        .map(({ id }) => id);
    };
    expect(await order()).toEqual([text.view.id, table.id, middle.table.id, chart.id]);
    await user.json("DELETE", `/tables/${middle.table.id}`);
    const last = await user.json<{ view: ViewRecord }>(
      "POST",
      `/pages/${page.id}/views`,
      { kind: "chart", position: 3 },
      201,
    );
    expect(await order()).toEqual([text.view.id, table.id, chart.id, last.view.id]);
  });

  it.each(["tables", "views"])(
    "rejects invalid insertion positions for %s without changing content",
    async (endpoint) => {
      const { id, page } = await start();
      const before = await readSnapshot(user, id);
      for (const position of [-1, 0.5, "0", 2]) {
        await user.json(
          "POST",
          `/pages/${page.id}/${endpoint}`,
          { position, ...(endpoint === "views" ? { kind: "text" } : {}) },
          position === 2 ? 422 : 400,
        );
      }
      const after = await readSnapshot(user, id);
      expect(after.tables).toEqual(before.tables);
      expect(after.views).toEqual(before.views);
    },
  );

  it("starts a spreadsheet with none", async () => {
    const { id } = await start();
    expect(await viewsOf(id)).toEqual([]);
  });

  it("adds a bar chart with no data, named after the charts already on the page", async () => {
    const { id, page } = await start();
    const chart = await add(page.id, "chart");
    expect(chart).toMatchObject({
      pageId: page.id,
      kind: "chart",
      name: "Chart 1",
      source: "",
      chartType: "bar",
    });
    expect(await add(page.id, "chart")).toMatchObject({ name: "Chart 2" });
    expect((await viewsOf(id)).map((view) => view.name)).toEqual(["Chart 1", "Chart 2"]);
  });

  it("adds a text view with a starter template and no chart type", async () => {
    const { page } = await start();
    const text = await add(page.id, "text");
    expect(text).toMatchObject({ kind: "text", name: "Text 1", chartType: null });
    expect(text.source).toContain("{{ 1 + 1 }}");
  });

  it("puts tables and views on a page in the order they were added", async () => {
    const { id, page, table } = await start();
    const chart = await add(page.id, "chart");
    const second = await addTable(user, page.id);
    const text = await add(page.id, "text");
    expect([table, chart, second, text].map((item) => item.position)).toEqual([0, 1, 2, 3]);
    expect((await viewsOf(id)).map((view) => view.id)).toEqual([chart.id, text.id]);
  });

  it("refuses an unknown kind and an unknown page", async () => {
    const { page } = await start();
    await user.json("POST", `/pages/${page.id}/views`, { kind: "map" }, 400);
    await user.json("POST", `/pages/${page.id}/views`, {}, 400);
    await user.json("POST", `/pages/${UNKNOWN_ID}/views`, { kind: "chart" }, 404);
  });
});

describe("changing views", () => {
  it("changes a chart's name, data, and type", async () => {
    const { id, page } = await start();
    const chart = await add(page.id, "chart");
    const changes = { name: "Sales by month", source: "'Table 1'!A1:B6", chartType: "line" };
    expect(await user.json("PATCH", `/views/${chart.id}`, changes)).toMatchObject({
      changed: { views: [{ id: chart.id, view: { ...chart, ...changes } }] },
    });
    expect(await viewsOf(id)).toEqual([{ ...chart, ...changes }]);
  });

  it("changes a text view's source, and refuses to give it a chart type", async () => {
    const { id, page } = await start();
    const text = await add(page.id, "text");
    const source = "# Report\n\nTotal: {{ SUM('Table 1'!A:A) }}";
    expect(await user.json("PATCH", `/views/${text.id}`, { source })).toMatchObject({
      changed: { views: [{ view: { source } }] },
    });
    expect(await user.json("PATCH", `/views/${text.id}`, { chartType: "pie" }, 422)).toEqual({
      error: { code: "not_a_chart", message: "Text 1 is not a chart" },
    });
    expect(await viewsOf(id)).toMatchObject([{ source, chartType: null }]);
  });

  it("lets two views share a name: formulas never refer to a view", async () => {
    const { page } = await start();
    const chart = await add(page.id, "chart");
    await add(page.id, "chart");
    await user.json("PATCH", `/views/${chart.id}`, { name: "Chart 2" });
  });

  it.each([
    {},
    { name: "" },
    { name: "x".repeat(LIMITS.nameLength + 1) },
    { source: "x".repeat(LIMITS.viewSourceLength + 1) },
    { chartType: "donut" },
  ])("refuses the change %j", async (body) => {
    const { page } = await start();
    const chart = await add(page.id, "chart");
    await user.json("PATCH", `/views/${chart.id}`, body, 400);
  });

  it("answers 404 for a view that does not exist", async () => {
    await user.json("PATCH", `/views/${UNKNOWN_ID}`, { name: "x" }, 404);
    await user.json("DELETE", `/views/${UNKNOWN_ID}`, undefined, 404);
  });
});

describe("deleting", () => {
  it("deletes a view", async () => {
    const { id, page } = await start();
    const chart = await add(page.id, "chart");
    const text = await add(page.id, "text");
    await user.json("DELETE", `/views/${chart.id}`, undefined, 200);
    expect((await viewsOf(id)).map((view) => view.id)).toEqual([text.id]);
  });

  it("deletes a page's views with the page", async () => {
    const { id } = await start();
    const { page } = await user.json<{ page: PageRecord }>(
      "POST",
      `/spreadsheets/${id}/pages`,
      {},
      201,
    );
    await add(page.id, "chart");
    await user.json("DELETE", `/pages/${page.id}`, undefined, 200);
    expect(await viewsOf(id)).toEqual([]);
  });
});

describe("keeping views pointed at the same cells", () => {
  /** A page with a chart and a text view that both read Table 1. */
  async function withViews(chartSource: string, textSource: string) {
    const started = await start();
    const chart = await add(started.page.id, "chart");
    const text = await add(started.page.id, "text");
    await user.json("PATCH", `/views/${chart.id}`, { source: chartSource });
    await user.json("PATCH", `/views/${text.id}`, { source: textSource });
    const sources = async (): Promise<string[]> =>
      (await viewsOf(started.id)).map((view) => view.source);
    return { ...started, chart, text, sources };
  }

  it("writes a table's new name into the views that name it", async () => {
    const { table, chart, text, sources } = await withViews(
      "'Table 1'!A1:B3",
      "Total: {{ SUM('Table 1'!A:A) }}",
    );
    const renamed = await user.json<Change>("PATCH", `/tables/${table.id}`, { name: "Sales" });
    expect(sourcesIn(renamed)).toEqual([
      { id: chart.id, source: "Sales!A1:B3" },
      { id: text.id, source: "Total: {{ SUM(Sales!A:A) }}" },
    ]);
    expect(await sources()).toEqual(["Sales!A1:B3", "Total: {{ SUM(Sales!A:A) }}"]);
  });

  it("writes a page's new name into the views that name it", async () => {
    const { page, chart, sources } = await withViews(
      "='Page 1'!'Table 1'!A1:B3",
      "{{ 'Table 1'!A1 }}",
    );
    const renamed = await user.json<Change>("PATCH", `/pages/${page.id}`, { name: "Data" });
    expect(sourcesIn(renamed)).toEqual([{ id: chart.id, source: "=Data!'Table 1'!A1:B3" }]);
    expect(renamed.changed).toMatchObject({ cells: [], tables: [] });
    expect(await sources()).toEqual(["=Data!'Table 1'!A1:B3", "{{ 'Table 1'!A1 }}"]);
  });

  it("moves the references in a view when a row is inserted or deleted", async () => {
    const { table, chart, text, sources } = await withViews(
      "'Table 1'!A2:B4",
      "{% for row in 'Table 1'!A2:B4 %}{{ row }}{% endfor %} and {{ 'Table 1'!C1 }}",
    );
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A2: "1", B2: "2" }), 200);
    const inserted = await user.json<Change>("POST", `/tables/${table.id}/edits`, {
      axis: "row",
      kind: "insert",
      index: 0,
    });
    const moved = "{% for row in 'Table 1'!A3:B5 %}{{ row }}{% endfor %} and {{ 'Table 1'!C2 }}";
    expect(sourcesIn(inserted)).toEqual([
      { id: chart.id, source: "'Table 1'!A3:B5" },
      { id: text.id, source: moved },
    ]);
    expect(await sources()).toEqual(["'Table 1'!A3:B5", moved]);

    await user.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "delete", index: 2 });
    expect(await sources()).toEqual([
      "'Table 1'!A3:B5",
      "{% for row in 'Table 1'!A3:B5 %}{{ row }}{% endfor %} and {{ #REF! }}",
    ]);
  });

  it("leaves views alone when a rename is refused", async () => {
    const { page, table, sources } = await withViews("'Table 1'!A1", "{{ 'Table 1'!A1 }}");
    const other = await addTable(user, page.id);
    await user.json("PATCH", `/tables/${table.id}`, { name: other.name }, 409);
    expect(await sources()).toEqual(["'Table 1'!A1", "{{ 'Table 1'!A1 }}"]);
  });
});

describe("reordering a page", () => {
  async function page() {
    const started = await start();
    const chart = await add(started.page.id, "chart");
    const text = await add(started.page.id, "text");
    const order = async (): Promise<string[]> => {
      const snapshot = await readSnapshot(user, started.id);
      return [...snapshot.tables, ...snapshot.views]
        .sort((a, b) => a.position - b.position)
        .map((item) => item.id);
    };
    const put = (blocks: string[], status = 200) =>
      user.json("PUT", `/pages/${started.page.id}/order`, { blocks }, status);
    return { ...started, chart, text, order, put };
  }

  it("puts tables and views in the order given", async () => {
    const { table, chart, text, order, put } = await page();
    expect(await order()).toEqual([table.id, chart.id, text.id]);
    await put([text.id, table.id, chart.id]);
    expect(await order()).toEqual([text.id, table.id, chart.id]);
  });

  it("puts a table added afterward at the end", async () => {
    const {
      page: { id: pageId },
      table,
      chart,
      text,
      order,
      put,
    } = await page();
    await put([chart.id, text.id, table.id]);
    const added = await addTable(user, pageId);
    expect(await order()).toEqual([chart.id, text.id, table.id, added.id]);
  });

  it.each<[string, (ids: string[]) => string[]]>([
    ["leaves one out", (ids) => ids.slice(1)],
    ["names one twice", (ids) => [ids[0]!, ids[0]!, ids[2]!]],
    ["names something that is not on the page", (ids) => [...ids.slice(1), UNKNOWN_ID]],
  ])("refuses a list that %s, and leaves the order alone", async (_, spoil) => {
    const { table, chart, text, order, put } = await page();
    expect(await put(spoil([table.id, chart.id, text.id]), 409)).toEqual({
      error: { code: "conflict", message: "The page has changed. Reload it and try again" },
    });
    expect(await order()).toEqual([table.id, chart.id, text.id]);
  });

  it("refuses a list that is empty or not ids", async () => {
    const { put } = await page();
    await put([], 400);
    await put(["first"], 400);
  });
});

describe("reordering pages", () => {
  async function spreadsheet() {
    const started = await start();
    const second = await user.json<{ page: PageRecord }>(
      "POST",
      `/spreadsheets/${started.id}/pages`,
      {},
      201,
    );
    const third = await user.json<{ page: PageRecord }>(
      "POST",
      `/spreadsheets/${started.id}/pages`,
      {},
      201,
    );
    const ids = [started.page.id, second.page.id, third.page.id];
    const order = async (): Promise<string[]> =>
      (await readSnapshot(user, started.id)).pages.map(({ id }) => id);
    const put = (pages: string[], status = 200) =>
      user.json("PUT", `/spreadsheets/${started.id}/pages/order`, { pages }, status);
    return { ...started, ids, order, put };
  }

  it("puts the pages in the order given, and a page added afterward at the end", async () => {
    const { id, ids, order, put } = await spreadsheet();
    expect(await order()).toEqual(ids);
    const [first, second, third] = ids as [string, string, string];
    await put([third, first, second]);
    expect(await order()).toEqual([third, first, second]);
    const added = await user.json<{ page: PageRecord }>(
      "POST",
      `/spreadsheets/${id}/pages`,
      {},
      201,
    );
    expect(await order()).toEqual([third, first, second, added.page.id]);
  });

  it.each<[string, (ids: string[]) => string[]]>([
    ["leaves one out", (ids) => ids.slice(1)],
    ["names one twice", (ids) => [ids[0]!, ids[0]!, ids[2]!]],
    ["names a page the spreadsheet does not have", (ids) => [...ids.slice(1), UNKNOWN_ID]],
  ])("refuses a list that %s, and leaves the order alone", async (_, spoil) => {
    const { ids, order, put } = await spreadsheet();
    expect(await put(spoil(ids), 409)).toEqual({
      error: {
        code: "conflict",
        message: "The pages have changed. Reload the document and try again",
      },
    });
    expect(await order()).toEqual(ids);
  });

  it("refuses a list that is empty or not ids", async () => {
    const { put } = await spreadsheet();
    await put([], 400);
    await put(["first"], 400);
  });
});

describe("moving a block to another page", () => {
  /** A spreadsheet with a second page, and a chart and a text view beside the first page's table. */
  async function twoPages() {
    const started = await start();
    const other = await user.json<{ page: PageRecord; table: TableRecord }>(
      "POST",
      `/spreadsheets/${started.id}/pages`,
      {},
      201,
    );
    const snapshot = () => readSnapshot(user, started.id);
    const inputs = async (tableId: string): Promise<Record<string, string>> =>
      Object.fromEntries(
        (await snapshot()).cells
          .filter((cell) => cell.tableId === tableId)
          .map((cell) => [`${String(cell.row)}:${String(cell.col)}`, cell.input]),
      );
    return { ...started, other, snapshot, inputs };
  }

  it("moves a table to the end of the page, and keeps every formula reading what it read", async () => {
    const { page, table, other, snapshot, inputs } = await twoPages();
    const sibling = await addTable(user, page.id);
    const chart = await add(page.id, "chart");
    await user.json("PATCH", `/views/${chart.id}`, { source: "'Table 2'!A1:B2" });
    await user.json("PATCH", `/tables/${sibling.id}`, { name: "Moved" });
    await user.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A1: "=Moved!A1 + 1", A2: "5" }),
      200,
    );
    await user.json(
      "PUT",
      `/tables/${sibling.id}/cells`,
      cellsBody({ A1: "='Table 1'!A2 * 2", A2: "=Moved!A1" }),
      200,
    );
    await user.json(
      "PUT",
      `/tables/${other.table.id}/cells`,
      cellsBody({ A1: "='Page 1'!Moved!A1" }),
      200,
    );

    const result = await user.json<Change>("PUT", `/tables/${sibling.id}/page`, {
      pageId: other.page.id,
    });
    expect(result.changed?.tables).toMatchObject([
      { id: sibling.id, table: { pageId: other.page.id, position: 1 } },
    ]);
    expect(result.changed?.cells).toHaveLength(3);
    expect(sourcesIn(result)).toEqual([{ id: chart.id, source: "'Page 2'!Moved!A1:B2" }]);
    expect(await inputs(table.id)).toEqual({ "0:0": "='Page 2'!Moved!A1 + 1", "1:0": "5" });
    expect(await inputs(sibling.id)).toEqual({
      "0:0": "='Page 1'!'Table 1'!A2 * 2",
      "1:0": "=Moved!A1",
    });
    expect(await inputs(other.table.id)).toEqual({ "0:0": "=Moved!A1" });
    expect((await snapshot()).tables.find(({ id }) => id === sibling.id)?.pageId).toBe(
      other.page.id,
    );
  });

  it("rewrites the formula columns of a moved table", async () => {
    const { page, table, other } = await twoPages();
    const sibling = await addTable(user, page.id);
    await user.json("POST", `/tables/${sibling.id}/columns`, { headerRow: false });
    await user.json("PATCH", `/tables/${sibling.id}/columns/1`, {
      type: "formula",
      formula: "='Table 1'!A1 + [Column 1]",
    });
    const result = await user.json<Change>("PUT", `/tables/${sibling.id}/page`, {
      pageId: other.page.id,
    });
    expect(result.changed?.tables[0]?.table?.columns?.[1]).toMatchObject({
      formula: "='Page 1'!'Table 1'!A1 + [Column 1]",
    });
    expect(table.name).toBe("Table 1");
  });

  it("moves a view, which then names the page of the tables it reads", async () => {
    const { page, other, snapshot } = await twoPages();
    const text = await add(page.id, "text");
    await user.json("PATCH", `/views/${text.id}`, { source: "{{ SUM('Table 1'!A1:A3) }}" });
    const result = await user.json<Change>("PUT", `/views/${text.id}/page`, {
      pageId: other.page.id,
    });
    const [moved] = result.changed?.views ?? [];
    expect(moved?.view).toMatchObject({
      id: text.id,
      pageId: other.page.id,
      position: 1,
      source: "{{ SUM('Page 1'!'Table 1'!A1:A3) }}",
    });
    expect(result.changed?.views).toHaveLength(1);
    expect((await snapshot()).views).toEqual([moved?.view]);
  });

  it("refuses a page that already has a table of the same name", async () => {
    const { table, other, snapshot } = await twoPages();
    const before = await snapshot();
    expect(
      await user.json("PUT", `/tables/${table.id}/page`, { pageId: other.page.id }, 409),
    ).toEqual({
      error: { code: "conflict", message: "Page 2 already has a table named Table 1" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses the page a block is already on, a page of another spreadsheet, and no page", async () => {
    const { page, table } = await twoPages();
    const text = await add(page.id, "text");
    const elsewhere = await start();
    expect(await user.json("PUT", `/tables/${table.id}/page`, { pageId: page.id }, 422)).toEqual({
      error: { code: "same_page", message: "Table 1 is already on Page 1" },
    });
    await user.json("PUT", `/views/${text.id}/page`, { pageId: page.id }, 422);
    await user.json("PUT", `/tables/${table.id}/page`, { pageId: elsewhere.page.id }, 404);
    await user.json("PUT", `/views/${text.id}/page`, { pageId: elsewhere.page.id }, 404);
    await user.json("PUT", `/tables/${table.id}/page`, { pageId: UNKNOWN_ID }, 404);
    await user.json("PUT", `/tables/${table.id}/page`, {}, 400);
  });
});
