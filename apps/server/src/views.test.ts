import { LIMITS } from "@spreadsheet-app/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PageRecord, Snapshot, TableRecord, ViewRecord } from "./app";
import {
  cellsBody,
  createSpreadsheet,
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
  return user.json<ViewRecord>("POST", `/pages/${pageId}/views`, { kind }, 201);
}

async function viewsOf(spreadsheetId: string): Promise<ViewRecord[]> {
  return (await user.json<Snapshot>("GET", `/spreadsheets/${spreadsheetId}`)).views;
}

describe("creating views", () => {
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
    const second = await user.json<TableRecord>("POST", `/pages/${page.id}/tables`, {}, 201);
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
    expect(await user.json("PATCH", `/views/${chart.id}`, changes)).toEqual({
      ...chart,
      ...changes,
    });
    expect(await viewsOf(id)).toEqual([{ ...chart, ...changes }]);
  });

  it("changes a text view's source, and refuses to give it a chart type", async () => {
    const { id, page } = await start();
    const text = await add(page.id, "text");
    const source = "# Report\n\nTotal: {{ SUM('Table 1'!A:A) }}";
    expect(await user.json("PATCH", `/views/${text.id}`, { source })).toMatchObject({ source });
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
    await user.json("DELETE", `/views/${chart.id}`, undefined, 204);
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
    await user.json("DELETE", `/pages/${page.id}`, undefined, 204);
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
    const renamed = await user.json("PATCH", `/tables/${table.id}`, { name: "Sales" });
    expect(renamed).toMatchObject({
      views: [
        { id: chart.id, source: "Sales!A1:B3" },
        { id: text.id, source: "Total: {{ SUM(Sales!A:A) }}" },
      ],
    });
    expect(await sources()).toEqual(["Sales!A1:B3", "Total: {{ SUM(Sales!A:A) }}"]);
  });

  it("writes a page's new name into the views that name it", async () => {
    const { page, chart, sources } = await withViews(
      "='Page 1'!'Table 1'!A1:B3",
      "{{ 'Table 1'!A1 }}",
    );
    expect(await user.json("PATCH", `/pages/${page.id}`, { name: "Data" })).toEqual({
      cells: [],
      views: [{ id: chart.id, source: "=Data!'Table 1'!A1:B3" }],
      tables: [],
    });
    expect(await sources()).toEqual(["=Data!'Table 1'!A1:B3", "{{ 'Table 1'!A1 }}"]);
  });

  it("moves the references in a view when a row is inserted or deleted", async () => {
    const { table, chart, text, sources } = await withViews(
      "'Table 1'!A2:B4",
      "{% for row in 'Table 1'!A2:B4 %}{{ row }}{% endfor %} and {{ 'Table 1'!C1 }}",
    );
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A2: "1", B2: "2" }), 204);
    const inserted = await user.json("POST", `/tables/${table.id}/edits`, {
      axis: "row",
      kind: "insert",
      index: 0,
    });
    const moved = "{% for row in 'Table 1'!A3:B5 %}{{ row }}{% endfor %} and {{ 'Table 1'!C2 }}";
    expect(inserted).toMatchObject({
      views: [
        { id: chart.id, source: "'Table 1'!A3:B5" },
        { id: text.id, source: moved },
      ],
    });
    expect(await sources()).toEqual(["'Table 1'!A3:B5", moved]);

    await user.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "delete", index: 2 });
    expect(await sources()).toEqual([
      "'Table 1'!A3:B5",
      "{% for row in 'Table 1'!A3:B5 %}{{ row }}{% endfor %} and {{ #REF! }}",
    ]);
  });

  it("leaves views alone when a rename is refused", async () => {
    const { page, table, sources } = await withViews("'Table 1'!A1", "{{ 'Table 1'!A1 }}");
    const other = await user.json<TableRecord>("POST", `/pages/${page.id}/tables`, {}, 201);
    await user.json("PATCH", `/tables/${table.id}`, { name: other.name }, 409);
    expect(await sources()).toEqual(["'Table 1'!A1", "{{ 'Table 1'!A1 }}"]);
  });
});
