import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWorkbook, formatValue, renderTemplate } from "@spreadsheet-app/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickResult, SnapshotWithHistory, SpreadsheetSummary } from "./app";
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
async function importSample(name: string): Promise<Sample> {
  const file: unknown = JSON.parse(readFileSync(resolve(process.cwd(), "samples", name), "utf8"));
  const summary = await user.json<SpreadsheetSummary>("POST", "/spreadsheets/import", file, 201);
  return readSample(summary.id);
}

/** A document as the tests read it: its tables by name, and the values the engine computes. */
interface Sample {
  id: string;
  snapshot: TestSnapshot;
  table: (name: string) => TestSnapshot["tables"][number];
  /** The values of a table's first `rows` rows and `cols` columns. */
  values: (name: string, rows: number, cols: number) => unknown[][];
  /** The Markdown a text view shows. */
  text: (name: string) => string;
}

async function readSample(id: string): Promise<Sample> {
  const snapshot = await readSnapshot(user, id);
  const wire = await user.json<SnapshotWithHistory>("GET", `/spreadsheets/${id}`);
  const workbook = createWorkbook(new Contents(wire).data);
  const table = (name: string) => snapshot.tables.find((candidate) => candidate.name === name)!;
  return {
    id,
    snapshot,
    table,
    values: (name, rows, cols) =>
      Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) =>
          workbook.getValue({ tableId: table(name).id, row, col }),
        ),
      ),
    text: (name) => {
      const view = wire.views.find((candidate) => candidate.name === name)!;
      const page = wire.pages.find((candidate) => candidate.id === view.pageId)!;
      return renderTemplate(view.source, (expression, names) =>
        workbook.evaluateOnPage(page.id, expression, names),
      )
        .map((block) =>
          block.type === "markdown"
            ? block.parts
                .map((part) =>
                  part.type === "text"
                    ? part.text
                    : part.type === "error"
                      ? `${part.error.code} ${part.error.message ?? part.error.code}`
                      : part.type === "input"
                        ? formatValue(part.control)
                        : part.label,
                )
                .join("")
            : `[${block.type}]`,
        )
        .join("");
    },
  };
}

describe("the Gran Turismo 7 grind comparison", () => {
  const SARDEGNA_21 = 12;

  it("computes what each run of a race pays over 40 hours", async () => {
    const sample = await importSample("gt7-grind-comparison.json");
    const runs = sample.values("Runs", 93, 8);

    // Spa at 61 minutes fits 7 times into 8 hours, with 53 minutes left over.
    expect(runs[1]).toEqual([1, "Spa", 61, 1_500_000 / 61, 60 / 61, 7, 35, 52_500_000]);
    expect(runs[SARDEGNA_21]).toEqual([
      3,
      "Sardegna",
      21,
      727_500 / 21,
      60 / 21,
      22,
      110,
      80_025_000,
    ]);
    expect(runs[92]?.slice(0, 3)).toEqual([11, "Tokyo - 030%", 29]);

    const sorted = sample.values("Runs by payout", 3, 8);
    expect(sorted[0]?.slice(0, 3)).toEqual(["#", "Race", "Duration"]);
    expect(sorted[1]?.slice(1)).toEqual([
      "Tokyo - 100%",
      21,
      825_000 / 21,
      60 / 21,
      22,
      110,
      90_750_000,
    ]);
    expect(sorted[2]?.slice(1, 3)).toEqual(["Tokyo - 090%", 21]);
  });

  it("pivots the payout by race and duration on both pages", async () => {
    const sample = await importSample("gt7-grind-comparison.json");
    const pivot = sample.values("Payout (8*5 hours)", 11, 15);

    expect(pivot[0]).toEqual(["Race", ...Array.from({ length: 14 }, (_, n) => String(21 + n))]);
    expect(pivot.map((row) => row[0])).toEqual([
      "Race",
      "Le Mans",
      "Sardegna",
      ...["030", "040", "050", "060", "070", "080", "090", "100"].map(
        (share) => `Tokyo - ${share}%`,
      ),
    ]);
    // Le Mans takes 30 to 34 minutes, so it has no payout at 21.
    expect(pivot[1]?.slice(9)).toEqual([
      null,
      66_000_000,
      61_875_000,
      61_875_000,
      57_750_000,
      57_750_000,
    ]);
    expect(pivot[2]?.slice(1, 5)).toEqual([80_025_000, 76_387_500, 72_750_000, 72_750_000]);
    expect(sample.values("Payout by duration", 11, 15)).toEqual(pivot);

    const perMinute = sample.values("Payout per minute by duration", 10, 10);
    expect(perMinute[0]?.slice(0, 3)).toEqual(["Duration", "Sardegna", "Tokyo - 030%"]);
    expect(perMinute[1]?.[0]).toBe(21);
    expect(perMinute[1]?.[1]).toBeCloseTo(34_642.86, 2);
    expect(perMinute[9]?.[9]).toBeCloseTo(28_448.28, 2);
  });

  it("rebuilds the runs from the races when the button is clicked", async () => {
    const sample = await importSample("gt7-grind-comparison.json");
    const stored = (name: string) =>
      sample.snapshot.cells.filter((cell) => cell.tableId === sample.table(name).id);
    const click = () =>
      user.json<ClickResult>("POST", `/tables/${sample.table("Rebuild").id}/cells/0/0/click`);

    // The file's runs are what the button makes of the file's races.
    expect(await click()).toMatchObject({
      status: "succeeded",
      change: { changed: { cells: [], rows: [] } },
    });

    // Sardegna now takes 21 to 23 minutes, which leaves it 3 runs of its 9.
    const maxDuration = stored("Races").find((cell) => cell.row === 2 && cell.col === 3)!;
    expect(maxDuration.input).toBe("29");
    await user.json(
      "PUT",
      `/tables/${sample.table("Races").id}/cells`,
      { cells: [{ row: 2, col: 3, input: "23" }] },
      200,
    );
    expect(await click()).toMatchObject({ status: "succeeded" });

    const rebuilt = await readSample(sample.id);
    expect(rebuilt.table("Runs").rowCount).toBe(87);
    const runs = rebuilt.values("Runs", 87, 3);
    expect(runs.filter(([, race]) => race === "Sardegna")).toEqual([
      [3, "Sardegna", 21],
      [3, "Sardegna", 22],
      [3, "Sardegna", 23],
    ]);
    expect(runs[86]).toEqual([11, "Tokyo - 030%", 29]);
    expect(rebuilt.values("Payout (8*5 hours)", 3, 5)[2]).toEqual([
      "Sardegna",
      80_025_000,
      76_387_500,
      72_750_000,
      null,
    ]);
  });

  it("shows Spa in the comparison when its checkbox is ticked", async () => {
    const sample = await importSample("gt7-grind-comparison.json");
    // The checkbox writes to the one cell of a table on the Config page.
    const setting = sample.table("Show Spa?");
    expect(sample.values("Options", 1, 1)).toMatchObject([
      [{ control: "checkbox", label: "Show Spa", value: false, target: { tableId: setting.id } }],
    ]);
    expect(sample.values("Payout (8*5 hours)", 12, 22)[11]?.[0]).toBeNull();

    await user.json(
      "PUT",
      `/tables/${setting.id}/cells`,
      { cells: [{ row: 0, col: 0, input: "TRUE" }] },
      200,
    );
    const pivot = (await readSample(sample.id)).values("Payout (8*5 hours)", 12, 22);
    expect(pivot[0]?.slice(15)).toEqual(["60", "61", "62", "63", "64", "65", "66"]);
    expect(pivot[3]?.[0]).toBe("Spa");
    expect(pivot[3]?.slice(15, 17)).toEqual([60_000_000, 52_500_000]);
  });

  it("works out from the runs when Tokyo beats Sardegna", async () => {
    const sample = await importSample("gt7-grind-comparison.json");
    const lines = sample
      .text("Conclusions")
      .split("\n")
      .filter((line) => line.startsWith("- "));
    // Sardegna at 24 minutes pays 72,750,000, which Tokyo at 30% and 40% never reaches.
    expect(lines).toEqual(
      [
        [21, 50],
        [22, 60],
        [24, 70],
        [25, 80],
        [25, 90],
        [26, 100],
      ].map(
        ([minutes, share]) =>
          `- You can finish in ${String(minutes)} minutes or less with the clean race bonus at least ${String(share)}% of the time.`,
      ),
    );
  });
});
