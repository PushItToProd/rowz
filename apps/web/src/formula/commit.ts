import { tokenizeForEditing, type EditingToken } from "@spreadsheet-app/engine";

function hasUnterminatedFinalToken(source: string, tokens: readonly EditingToken[]): boolean {
  const token = tokens.filter(({ type }) => type !== "end").at(-1);
  if (token?.end !== source.length) return false;
  if (token.type === "column") return source[token.end - 1] !== "]";
  if (token.type !== "string" && token.type !== "quotedName") return false;

  const quote = token.type === "string" ? '"' : "'";
  for (let index = token.position + 1; index < token.end; index += 1) {
    if (source[index] !== quote) continue;
    if (source[index + 1] === quote) {
      index += 1;
      continue;
    }
    return index + 1 !== token.end;
  }
  return true;
}

/** Adds closing parentheses left open at the end of a formula input. */
export function closeOpenFormulaParentheses(input: string): string {
  if (!input.startsWith("=")) return input;

  const formula = input.slice(1);
  const tokens = tokenizeForEditing(formula);
  if (hasUnterminatedFinalToken(formula, tokens)) return input;

  const ignored = tokens.filter(
    (token) => token.type === "string" || token.type === "quotedName" || token.type === "column",
  );
  let ignoredIndex = 0;
  let braces = 0;
  let parentheses = 0;

  for (let index = 0; index < formula.length; index += 1) {
    const token = ignored[ignoredIndex];
    if (token?.position === index) {
      index = token.end - 1;
      ignoredIndex += 1;
      continue;
    }

    const character = formula[index];
    if (character === "{") braces += 1;
    else if (character === "}" && braces > 0) braces -= 1;
    else if (braces === 0 && character === "(") parentheses += 1;
    else if (braces === 0 && character === ")" && parentheses > 0) parentheses -= 1;
  }

  if (braces > 0 || parentheses === 0) return input;
  return `${input}${")".repeat(parentheses)}`;
}
