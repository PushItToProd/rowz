import { analyzeFormula, type EditingSpan, type FormulaAnalysis } from "./editing";
import { parseScript, scanScriptComments } from "./script";
import { scanTemplateTags } from "./template";

export type EditingMode = "cell" | "formula" | "script" | "markdown";

export interface SourceDecoration extends EditingSpan {
  type: "comment" | "definition" | "delimiter" | "keyword";
}

export interface SourceAnalysis {
  text: string;
  regions: FormulaAnalysis[];
  decorations: SourceDecoration[];
  definitions: { name: string; params?: string[] }[];
  /** Complete and unfinished template tags, including non-expression headers. */
  templateTags?: EditingSpan[];
}

/** Tolerant editing analysis uses source offsets and never evaluates a draft. */
export function analyzeSource(source: string, mode: EditingMode): SourceAnalysis {
  if (mode === "script") return analyzeScript(source);
  if (mode === "markdown") return analyzeTemplate(source);
  return {
    text: source,
    regions:
      mode === "cell" && !source.startsWith("=")
        ? []
        : [analyzeFormula(source, { from: mode === "cell" ? 1 : 0, to: source.length })],
    decorations: [],
    definitions: [],
  };
}

/** Comments and definition headers are not formula positions. */
export function formulaAt(analysis: SourceAnalysis, caret: number): FormulaAnalysis | undefined {
  if (
    analysis.decorations.some(
      (span) => span.type === "comment" && span.from <= caret && caret <= span.to,
    )
  )
    return undefined;
  return analysis.regions.find(({ region }) => region.from <= caret && caret <= region.to);
}

function analyzeScript(source: string): SourceAnalysis {
  const { text, comments } = scanScriptComments(source);
  const statements = parseScript(source);
  const byLine = new Map(statements.map((statement) => [statement.line, statement]));
  const definitions = statements.flatMap((statement) =>
    statement.kind === "name" ? [{ name: statement.name, params: statement.params }] : [],
  );
  const decorations: SourceDecoration[] = comments.map((span) => ({ ...span, type: "comment" }));
  const regions: FormulaAnalysis[] = [];
  const starts: { from: number; line: number }[] = [];
  let offset = 0;
  text.split("\n").forEach((line, index) => {
    if (line.trim() && (!/^\s/.test(line) || !starts.length))
      starts.push({ from: offset, line: index + 1 });
    offset += line.length + 1;
  });
  // An empty line at the end is a useful position for a new statement.
  if (!starts.length || (source.endsWith("\n") && !/^\s+\S/.test(source.split("\n").at(-1) ?? "")))
    starts.push({ from: source.length, line: source.split("\n").length });
  starts.forEach((start, index) => {
    const statement = byLine.get(start.line);
    const to = Math.max(
      start.from,
      (starts[index + 1]?.from ?? source.length) - (index + 1 < starts.length ? 1 : 0),
    );
    const from = Math.min(
      statement && statement.kind !== "error" ? statement.from : start.from,
      to,
    );
    if (statement?.kind === "name")
      decorations.push({ from: start.from, to: from, type: "definition" });
    const analysis = analyzeFormula(text, { from, to });
    const params = statement?.kind === "name" ? (statement.params ?? []) : [];
    analysis.bindings.unshift(...params.map((name) => ({ name, from, to })));
    regions.push(analysis);
  });
  return { text, regions, decorations, definitions };
}

function analyzeTemplate(source: string): SourceAnalysis {
  const regions: FormulaAnalysis[] = [];
  const decorations: SourceDecoration[] = [];
  let bound = new Map<string, string>();
  const blocks: { type: "if" | "for"; outer: Map<string, string> }[] = [];
  const bind = (name: string): void => {
    if (!/^[A-Za-z]{1,3}[0-9]+$/.test(name)) bound.set(name.toLowerCase(), name);
  };
  const tags = scanTemplateTags(source, true);
  for (const tag of tags) {
    if (tag.kind === "comment") {
      decorations.push({ from: tag.from, to: tag.to, type: "comment" });
      continue;
    }
    const end = tag.innerFrom + tag.inner.length;
    decorations.push({ from: tag.from, to: tag.innerFrom, type: "delimiter" });
    if (end < tag.to) decorations.push({ from: end, to: tag.to, type: "delimiter" });
    let from: number | undefined;
    let declared: string[] = [];
    let keyword: string | undefined;
    if (tag.kind === "output") from = tag.innerFrom;
    else {
      const head = /^\s*(let|for|if|else|endfor|endif|end)\b/.exec(tag.inner);
      keyword = head?.[1];
      if (head && keyword) {
        const at = tag.innerFrom + head[0].indexOf(keyword);
        decorations.push({ from: at, to: at + keyword.length, type: "keyword" });
      }
      const declaration = /^\s*let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/.exec(tag.inner);
      const loop =
        /^\s*for\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s+in\s*/.exec(
          tag.inner,
        );
      const condition = /^\s*if\s+/.exec(tag.inner);
      const matched = declaration ?? loop ?? condition;
      if (matched) {
        from = tag.innerFrom + matched[0].length;
        declared = (declaration?.[1] ?? loop?.[1])?.split(",").map((name) => name.trim()) ?? [];
        if (declared.length)
          decorations.push({
            from: tag.innerFrom + (head?.[0].length ?? 0),
            to: from,
            type: "definition",
          });
      }
    }
    if (from !== undefined) {
      const analysis = analyzeFormula(source, { from, to: end });
      analysis.bindings.unshift(
        ...[...bound.values()].map((name) => ({ name, from: 0, to: source.length })),
      );
      regions.push(analysis);
    }
    if (keyword === "for" || keyword === "if") {
      blocks.push({ type: keyword, outer: bound });
      bound = new Map(bound);
      if (keyword === "for") declared.forEach(bind);
    } else if (keyword === "let") declared.forEach(bind);
    else if (keyword === "else") {
      const block = blocks.at(-1);
      if (block?.type === "if") bound = new Map(block.outer);
    } else if (keyword === "end" || keyword === "endfor" || keyword === "endif") {
      const block = blocks.pop();
      if (block) bound = new Map(block.outer);
    }
  }
  return {
    text: source,
    regions,
    decorations,
    definitions: [],
    templateTags: tags.map(({ from, to }) => ({ from, to })),
  };
}
