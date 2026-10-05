import { compileRegex, RegexError, RegexRunner, type RegexMatch } from "../regex";
import { eager, fail, text } from "./arguments";
import type { FunctionDefinition } from "./registry";

const MAX_RESULT_LENGTH = 2_000_000;

function withRegex<T>(compute: () => T): T {
  try {
    return compute();
  } catch (cause) {
    if (cause instanceof RegexError) fail("#VALUE!", cause.message);
    throw cause;
  }
}

function replacementText(
  replacement: string,
  match: RegexMatch,
  source: string,
  maximumLength: number,
): string {
  const parts: string[] = [];
  let length = 0;
  const add = (part: string): void => {
    length += part.length;
    if (length > maximumLength) {
      fail(
        "#VALUE!",
        `The regular expression result cannot exceed ${MAX_RESULT_LENGTH.toLocaleString("en-US")} characters`,
      );
    }
    parts.push(part);
  };
  for (let index = 0; index < replacement.length; index += 1) {
    const character = replacement.charAt(index);
    const next = replacement.charAt(index + 1);
    if (character !== "$" || next === "") {
      add(character);
      continue;
    }
    if (next === "$") {
      add("$");
      index += 1;
    } else if (next === "&") {
      add(source.slice(match.start, match.end));
      index += 1;
    } else if (next >= "0" && next <= "9") {
      const twoDigit = replacement.charAt(index + 2);
      const group =
        twoDigit !== "" && twoDigit >= "0" && twoDigit <= "9"
          ? Number(next + twoDigit)
          : Number(next);
      if (group > 0 && group <= match.captures.length) {
        add(match.captures[group - 1] ?? "");
        index += group >= 10 && twoDigit !== "" ? 2 : 1;
      } else {
        add("$");
        add(next);
        index += 1;
      }
    } else {
      add("$");
    }
  }
  return parts.join("");
}

function replaceAll(source: string, pattern: string, replacement: string): string {
  const runner = new RegexRunner(compileRegex(pattern));
  const parts: string[] = [];
  let resultLength = 0;
  let cursor = 0;
  let searchFrom = 0;

  const append = (part: string): void => {
    resultLength += part.length;
    if (resultLength > MAX_RESULT_LENGTH) {
      fail(
        "#VALUE!",
        `The regular expression result cannot exceed ${MAX_RESULT_LENGTH.toLocaleString("en-US")} characters`,
      );
    }
    parts.push(part);
  };

  while (searchFrom <= source.length) {
    const match = runner.find(source, searchFrom);
    if (!match) break;
    append(source.slice(cursor, match.start));
    append(replacementText(replacement, match, source, MAX_RESULT_LENGTH - resultLength));
    cursor = match.end;
    searchFrom = match.end > match.start ? match.end : match.end + 1;
  }
  append(source.slice(cursor));
  return parts.join("");
}

export const regexFunctions: Record<string, FunctionDefinition> = {
  REGEXMATCH: eager(2, 2, (value, pattern) =>
    withRegex(() => new RegexRunner(compileRegex(text(pattern))).find(text(value)) !== undefined),
  ),
  REGEXEXTRACT: eager(2, 2, (value, pattern) =>
    withRegex(() => {
      const source = text(value);
      const runner = new RegexRunner(compileRegex(text(pattern)));
      const match = runner.find(source);
      if (!match) return fail("#N/A", "The regular expression did not match the text");
      return match.captures.length > 0
        ? (match.captures[0] ?? "")
        : source.slice(match.start, match.end);
    }),
  ),
  REGEXREPLACE: eager(3, 3, (value, pattern, replacement) =>
    withRegex(() => replaceAll(text(value), text(pattern), text(replacement))),
  ),
};
