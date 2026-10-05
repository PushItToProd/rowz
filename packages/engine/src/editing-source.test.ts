import { describe, expect, it } from "vitest";
import { analyzeSource, formulaAt } from "./editing-source";
import { bindingsAt } from "./editing";
import { parseScript } from "./script";
import { parseTemplate } from "./template";

function bound(source: string, mode: "script" | "markdown", at = source.length): string[] {
  const region = formulaAt(analyzeSource(source, mode), at);
  return region ? bindingsAt(region, at) : [];
}

describe("tolerant source analysis", () => {
  it("uses script statement offsets, definitions, parameters, and indented continuations", () => {
    const source =
      "// heading\nRate = 2\nScale(amount) = amount *\n  Rate + SUM(Sales!A1,\nScale(Rate)";
    const analysis = analyzeSource(source, "script");
    expect(analysis.definitions).toEqual([
      { name: "Rate", params: undefined },
      { name: "Scale", params: ["amount"] },
    ]);
    expect(analysis.regions.map(({ region }) => source.slice(region.from, region.to))).toEqual([
      "2",
      "amount *\n  Rate + SUM(Sales!A1,",
      "Scale(Rate)",
    ]);
    expect(bound(source, "script", source.indexOf("SUM"))).toEqual(["amount"]);
    expect(bound(source, "script")).toEqual([]);
    expect(formulaAt(analysis, source.indexOf("Scale(amount)"))).toBeUndefined();
    expect(formulaAt(analysis, 3)).toBeUndefined();
  });

  it("blanks script comments without moving references or hiding following statements", () => {
    const source = 'Broken = "unfinished // text\nGood = B2 // comment A1\n  + C3';
    const analysis = analyzeSource(source, "script");
    expect(
      analysis.regions
        .flatMap((region) => region.references)
        .map(({ from, to }) => source.slice(from, to)),
    ).toEqual(["B2", "C3"]);
    expect(formulaAt(analysis, source.indexOf("comment") + 2)).toBeUndefined();
    expect(parseScript(source)).toHaveLength(2);
  });

  it("retains an empty script or an unfinished definition body as a formula position", () => {
    expect(formulaAt(analyzeSource("", "script"), 0)?.region).toEqual({ from: 0, to: 0 });
    expect(bound("Scale(amount) = ", "script")).toEqual(["amount"]);
    expect(formulaAt(analyzeSource("Rate = 1\n", "script"), 9)?.region.from).toBe(9);
  });

  it("recognizes template expressions inside Markdown code and preserves original offsets", () => {
    const source = "`{{ Sales!A1 }}`\n```\n{{ SUM(Sales!B2, }}\n```\n{# Sales!C3 #}";
    const analysis = analyzeSource(source, "markdown");
    expect(
      analysis.regions
        .flatMap((region) => region.references)
        .map(({ from, to }) => source.slice(from, to)),
    ).toEqual(["Sales!A1", "Sales!B2"]);
    expect(formulaAt(analysis, 0)).toBeUndefined();
    expect(formulaAt(analysis, source.indexOf("Sales!C3"))).toBeUndefined();
  });

  it("keeps template let and loop scope aligned with evaluation, including if branches", () => {
    const source =
      "{% let Rate = 2 %}\n{% for Item, Price in Sales[A] %}\n{% if Price %}\n{% let Inside = 1 %}\n{{ Rate + Price + Inside }}\n{% else %}\n{{ Price }}\n{% end %}\n{{ Item }}\n{% end %}\n{{ Rate }}";
    expect(bound(source, "markdown", source.indexOf("Rate +"))).toEqual([
      "Rate",
      "Item",
      "Price",
      "Inside",
    ]);
    expect(bound(source, "markdown", source.indexOf("{{ Price") + 3)).toEqual([
      "Rate",
      "Item",
      "Price",
    ]);
    expect(bound(source, "markdown", source.indexOf("{{ Item") + 3)).toEqual([
      "Rate",
      "Item",
      "Price",
    ]);
    expect(bound(source, "markdown", source.lastIndexOf("Rate"))).toEqual(["Rate"]);
    expect(bound("{% let Name = Na", "markdown")).toEqual([]);
    expect(bound("{% for Item in Sales[A] %}{{ It", "markdown")).toEqual(["Item"]);
    expect(() => parseTemplate(source)).not.toThrow();
  });

  it.each([
    "{{ SUM(\n{{ Sales!B2 }}",
    '{{ "unfinished\n{{ Sales!B2 }}',
    "{# unfinished\n{{ Sales!B2 }}",
  ])("recovers valid tags after %s without changing strict parsing", (source) => {
    const analysis = analyzeSource(source, "markdown");
    expect(
      analysis.regions
        .flatMap((region) => region.references)
        .map(({ from, to }) => source.slice(from, to)),
    ).toContain("Sales!B2");
    expect(formulaAt(analysis, source.indexOf("Sales!B2"))).toBeDefined();
  });

  it("leaves delimiters inside complete strings alone", () => {
    const source = '{{ "{{ not a tag }}" & Sales!A1 }}';
    expect(analyzeSource(source, "markdown").regions).toHaveLength(1);
    expect(() => parseTemplate(source)).not.toThrow();
  });

  it("handles 50,000 characters without evaluating or copying every definition into each region", () => {
    const source = "Rate = 1\n".repeat(5_555) + "     ";
    expect(source).toHaveLength(50_000);
    const analysis = analyzeSource(source, "script");
    expect(analysis.definitions).toHaveLength(5_555);
    expect(analysis.regions.every((region) => region.bindings.length === 0)).toBe(true);
  });
});
