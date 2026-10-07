import {
  FormulaSyntaxError,
  TemplateSyntaxError,
  parseFormula,
  parseScript,
  parseTemplate,
  type TemplateNode,
} from "@spreadsheet-app/engine";

export type ReplacementSyntax = "cell" | "formula" | "chart" | "text" | "script";

/** Check syntax only. Parsing does not resolve names or evaluate references. */
export function replacementParses(source: string, kind: ReplacementSyntax): boolean {
  const formula = (text: string) => parseFormula(text.startsWith("=") ? text.slice(1) : text);
  const template = (nodes: TemplateNode[]): void => {
    for (const node of nodes) {
      if (node.type === "text") continue;
      formula(node.expression);
      if (node.type === "for") template(node.body);
      if (node.type === "if") {
        template(node.then);
        template(node.otherwise);
      }
    }
  };
  try {
    switch (kind) {
      case "cell":
        if (source.startsWith("=")) formula(source);
        break;
      case "formula":
        formula(source);
        break;
      case "chart":
        // An empty chart source clears the chart, as in the source editor.
        if (source.trim()) formula(source);
        break;
      case "text":
        template(parseTemplate(source));
        break;
      case "script":
        for (const statement of parseScript(source)) {
          if (statement.kind === "error") return false;
          formula(statement.formula);
        }
        break;
    }
    return true;
  } catch (cause) {
    if (cause instanceof FormulaSyntaxError || cause instanceof TemplateSyntaxError) return false;
    throw cause;
  }
}
