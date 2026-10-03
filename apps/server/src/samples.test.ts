import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWorkbook } from "@spreadsheet-app/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SnapshotWithHistory, SpreadsheetSummary } from "./app";
import { Contents } from "./repo/contents";
import {
  readSnapshot,
  startTestServer,
  type TestServer,
  type TestSnapshot,
  type TestUser,
} from "./testing";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp();
});
afterAll(() => server.close());

/** Imports a sample document from `samples/`, as the Import button does. */
async function importSample(
  name: string,
): Promise<{ snapshot: TestSnapshot; wire: SnapshotWithHistory }> {
  const file: unknown = JSON.parse(readFileSync(resolve(process.cwd(), "samples", name), "utf8"));
  const summary = await user.json<SpreadsheetSummary>("POST", "/spreadsheets/import", file, 201);
  return {
    snapshot: await readSnapshot(user, summary.id),
    wire: await user.json<SnapshotWithHistory>("GET", `/spreadsheets/${summary.id}`),
  };
}

describe("the Gran Turismo 7 grind comparison", () => {
  it("imports with a dropdown on its races, a sort, and color scales", async () => {
    const { snapshot } = await importSample("gt7-grind-comparison.json");
    const table = (name: string) => snapshot.tables.find((candidate) => candidate.name === name)!;
    const [races, runs, pivot] = [table("Races"), table("Runs"), table("Payout over 40 hours")];

    expect(runs.columns?.[0]).toEqual({
      name: "Race",
      type: "choice",
      choicesFrom: { tableId: races.id, colId: races.colIds[0] },
    });
    // Sorted by payout per minute, highest first.
    expect(runs.display).toEqual({ sort: [{ colId: runs.colIds[2], descending: true }] });
    expect(runs.conditionalFormats).toMatchObject([{ kind: "scale", startCol: 2, endCol: 2 }]);
    expect(pivot.conditionalFormats).toMatchObject([{ kind: "scale", startRow: 1, startCol: 1 }]);
  });

  it("computes what a run pays, and pivots the payout by race and duration", async () => {
    const { snapshot, wire } = await importSample("gt7-grind-comparison.json");
    const workbook = createWorkbook(new Contents(wire).data);
    const id = (name: string) => snapshot.tables.find((candidate) => candidate.name === name)!.id;
    const runs = id("Runs");
    const value = (tableId: string, row: number, col: number) =>
      workbook.getValue({ tableId, row, col });

    // The first run is the Tokyo Expressway at its shortest, 6 minutes for 92,000 credits.
    expect(value(runs, 0, 2)).toBeCloseTo(92_000 / 6);
    expect(value(runs, 0, 3)).toBeCloseTo(10);
    expect(value(runs, 0, 4)).toBeCloseTo(80);
    expect(value(runs, 0, 5)).toBeCloseTo(400);
    expect(value(runs, 0, 6)).toBeCloseTo((92_000 / 6) * 2400);

    // The summary's sentences read the best run, which is the one the table is sorted to show first.
    const page = snapshot.pages.find((candidate) => candidate.name === "Report")!.id;
    const best = "MAX(Data!Runs[Payout per minute])";
    expect(
      workbook.evaluateOnPage(
        page,
        `INDEX(Data!Runs[Race], MATCH(${best}, Data!Runs[Payout per minute], 0))`,
      ),
    ).toBe("Deep Forest Raceway, 5 laps");
    expect(workbook.evaluateOnPage(page, `TEXT(${best} * 40 * 60, "#,##0")`)).toBe("39,428,571");

    const pivot = id("Payout over 40 hours");
    const rows = [0, 1, 2, 3, 4, 5].map((row) =>
      [0, 1, 2, 3, 4].map((col) => value(pivot, row, col)),
    );
    expect(rows[0]).toEqual(["Race", "6", "7", "8", "9"]);
    expect(rows.slice(1).every((row) => typeof row[0] === "string")).toBe(true);
    // The races come in alphabetical order, so the first is Autodromo Lago Maggiore at 6 minutes.
    expect(rows[1]?.[0]).toBe("Autodromo Lago Maggiore GP");
    expect(rows[1]?.[1]).toBeCloseTo((78_000 / 6) * 2400);
    expect(rows.flat()).not.toContainEqual(expect.objectContaining({ kind: "error" }));
  });
});
