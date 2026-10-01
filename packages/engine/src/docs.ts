import type { ErrorCode } from "./values";

/** In the order the help page shows them. */
export const FUNCTION_CATEGORIES = [
  "Math",
  "Logic",
  "Lookup",
  "Text",
  "Information",
  "Actions",
] as const;
export type FunctionCategory = (typeof FUNCTION_CATEGORIES)[number];

/** What the help page shows for one function. */
export interface FunctionDoc {
  name: string;
  category: FunctionCategory;
  /** The call with its parameter names. Optional parameters are in square brackets. */
  syntax: string;
  summary: string;
  /**
   * A formula without the leading `=`. It may read the cells in
   * `EXAMPLE_CELLS`, and it must evaluate without an error.
   */
  example: string;
}

/** The cells every example can read. The help page states them next to the examples. */
export const EXAMPLE_CELLS = {
  A1: "1",
  A2: "2",
  A3: "3",
  B1: "apple",
  B2: "banana",
  B3: "cherry",
} as const;

/**
 * One entry per function in the default registry, in the order the help page
 * lists them. A test fails when a function has no entry or an example breaks.
 */
export const functionDocs: readonly FunctionDoc[] = [
  {
    name: "SUM",
    category: "Math",
    syntax: "SUM(value, ...)",
    summary: "Adds numbers. Text and empty cells inside a range are skipped.",
    example: "SUM(A1:A3, 10)",
  },
  {
    name: "AVERAGE",
    category: "Math",
    syntax: "AVERAGE(value, ...)",
    summary: "The mean of the numbers. Text and empty cells inside a range are skipped.",
    example: "AVERAGE(A1:A3)",
  },
  {
    name: "MIN",
    category: "Math",
    syntax: "MIN(value, ...)",
    summary: "The smallest number.",
    example: "MIN(A1:A3)",
  },
  {
    name: "MAX",
    category: "Math",
    syntax: "MAX(value, ...)",
    summary: "The largest number.",
    example: "MAX(A1:A3, 10)",
  },
  {
    name: "COUNT",
    category: "Math",
    syntax: "COUNT(value, ...)",
    summary: "How many of the values are numbers.",
    example: 'COUNT(A1:A3, "text")',
  },
  {
    name: "COUNTA",
    category: "Math",
    syntax: "COUNTA(value, ...)",
    summary: "How many of the values are not empty.",
    example: "COUNTA(A1:A5)",
  },
  {
    name: "ROUND",
    category: "Math",
    syntax: "ROUND(number, [digits])",
    summary: "Rounds to a number of decimal places, 0 if not given. A half rounds away from zero.",
    example: "ROUND(3.14159, 2)",
  },
  {
    name: "ABS",
    category: "Math",
    syntax: "ABS(number)",
    summary: "The number without its sign.",
    example: "ABS(-4)",
  },
  {
    name: "PRODUCT",
    category: "Math",
    syntax: "PRODUCT(value, ...)",
    summary: "Multiplies numbers. Text and empty cells inside a range are skipped.",
    example: "PRODUCT(A1:A3, 10)",
  },
  {
    name: "MEDIAN",
    category: "Math",
    syntax: "MEDIAN(value, ...)",
    summary: "The middle number, or the mean of the two middle numbers.",
    example: "MEDIAN(A1:A3, 10)",
  },
  {
    name: "COUNTIF",
    category: "Math",
    syntax: "COUNTIF(range, criterion)",
    summary:
      'How many cells of the range meet the criterion. A criterion is a value to equal, or text starting with a comparison such as ">1" or "<>apple". Text criteria ignore letter case and may use * for any characters and ? for one.',
    example: 'COUNTIF(A1:A3, ">1")',
  },
  {
    name: "COUNTIFS",
    category: "Math",
    syntax: "COUNTIFS(range, criterion, ...)",
    summary: "How many positions meet every criterion, each tested in its own range.",
    example: 'COUNTIFS(A1:A3, ">1", B1:B3, "*an*")',
  },
  {
    name: "SUMIF",
    category: "Math",
    syntax: "SUMIF(range, criterion, [sum_range])",
    summary:
      "Adds the numbers of `sum_range` at the positions where `range` meets the criterion. Without `sum_range` it adds `range` itself.",
    example: 'SUMIF(B1:B3, "<>banana", A1:A3)',
  },
  {
    name: "SUMIFS",
    category: "Math",
    syntax: "SUMIFS(sum_range, range, criterion, ...)",
    summary: "Adds the numbers of `sum_range` at the positions that meet every criterion.",
    example: 'SUMIFS(A1:A3, A1:A3, ">1", B1:B3, "c*")',
  },
  {
    name: "AVERAGEIF",
    category: "Math",
    syntax: "AVERAGEIF(range, criterion, [average_range])",
    summary: "The mean of the numbers at the positions where `range` meets the criterion.",
    example: 'AVERAGEIF(A1:A3, ">=2")',
  },
  {
    name: "ROUNDUP",
    category: "Math",
    syntax: "ROUNDUP(number, [digits])",
    summary: "Rounds away from zero to a number of decimal places.",
    example: "ROUNDUP(3.141, 2)",
  },
  {
    name: "ROUNDDOWN",
    category: "Math",
    syntax: "ROUNDDOWN(number, [digits])",
    summary: "Rounds toward zero to a number of decimal places.",
    example: "ROUNDDOWN(3.149, 2)",
  },
  {
    name: "FLOOR",
    category: "Math",
    syntax: "FLOOR(number, [multiple])",
    summary: "Rounds down to a multiple, 1 if not given.",
    example: "FLOOR(17, 5)",
  },
  {
    name: "CEILING",
    category: "Math",
    syntax: "CEILING(number, [multiple])",
    summary: "Rounds up to a multiple, 1 if not given.",
    example: "CEILING(17, 5)",
  },
  {
    name: "INT",
    category: "Math",
    syntax: "INT(number)",
    summary: "Rounds down to a whole number.",
    example: "INT(-2.5)",
  },
  {
    name: "SQRT",
    category: "Math",
    syntax: "SQRT(number)",
    summary: "The square root.",
    example: "SQRT(16)",
  },
  {
    name: "POWER",
    category: "Math",
    syntax: "POWER(base, exponent)",
    summary: "The base raised to the exponent, as the ^ operator does.",
    example: "POWER(2, 10)",
  },
  {
    name: "MOD",
    category: "Math",
    syntax: "MOD(number, divisor)",
    summary: "The remainder of a division. It has the sign of the divisor.",
    example: "MOD(7, 3)",
  },
  {
    name: "IF",
    category: "Logic",
    syntax: "IF(condition, then, [else])",
    summary:
      "Gives `then` when the condition is true and `else` when it is false. Only the chosen one is evaluated, so the other may hold an error.",
    example: 'IF(A1 > 2, "big", "small")',
  },
  {
    name: "IFERROR",
    category: "Logic",
    syntax: "IFERROR(value, fallback)",
    summary: "Gives `value`, or `fallback` when `value` is an error.",
    example: 'IFERROR(1/0, "no result")',
  },
  {
    name: "AND",
    category: "Logic",
    syntax: "AND(value, ...)",
    summary: "TRUE when every value is true.",
    example: "AND(A1 > 0, A2 > 5)",
  },
  {
    name: "OR",
    category: "Logic",
    syntax: "OR(value, ...)",
    summary: "TRUE when at least one value is true.",
    example: "OR(A1 > 0, A2 > 5)",
  },
  {
    name: "NOT",
    category: "Logic",
    syntax: "NOT(value)",
    summary: "TRUE when the value is false, and FALSE when it is true.",
    example: "NOT(A1 = 2)",
  },
  {
    name: "IFS",
    category: "Logic",
    syntax: "IFS(condition, value, ...)",
    summary:
      "Gives the value that follows the first true condition. Later pairs are not evaluated.",
    example: 'IFS(A1 > 2, "big", A1 > 0, "small")',
  },
  {
    name: "SWITCH",
    category: "Logic",
    syntax: "SWITCH(value, case, result, ..., [default])",
    summary:
      "Gives the result that follows the first case equal to the value, or the default when none is.",
    example: 'SWITCH(A2, 1, "one", 2, "two", "many")',
  },
  {
    name: "VLOOKUP",
    category: "Lookup",
    syntax: "VLOOKUP(key, range, column, [sorted])",
    summary:
      "Finds the key in the first column of the range and gives the cell of that row in the numbered column. With `sorted` FALSE the match is exact. Otherwise the range must be sorted by its first column, and the nearest key at or below the given one is used.",
    example: "VLOOKUP(2, A1:B3, 2, FALSE)",
  },
  {
    name: "XLOOKUP",
    category: "Lookup",
    syntax: "XLOOKUP(key, lookup_range, result_range, [if_not_found])",
    summary:
      "Finds the key in one row or column and gives the cell at the same position of another. The match is exact.",
    example: 'XLOOKUP("cherry", B1:B3, A1:A3, 0)',
  },
  {
    name: "MATCH",
    category: "Lookup",
    syntax: "MATCH(key, range, [type])",
    summary:
      "The position of the key in a row or column, counting from 1. Type 0 is an exact match. Type 1, the default, is the nearest value at or below the key in ascending data, and -1 the nearest at or above it in descending data.",
    example: 'MATCH("banana", B1:B3, 0)',
  },
  {
    name: "INDEX",
    category: "Lookup",
    syntax: "INDEX(range, row, [column])",
    summary:
      "The cell at a row and column of the range, counting from 1. A single row or column needs only one position.",
    example: "INDEX(B1:B3, 3)",
  },
  {
    name: "CONCATENATE",
    category: "Text",
    syntax: "CONCATENATE(value, ...)",
    summary: "Joins values into one text. The & operator does the same for two values.",
    example: 'CONCATENATE("Total: ", A3)',
  },
  {
    name: "LEN",
    category: "Text",
    syntax: "LEN(text)",
    summary: "The number of characters.",
    example: 'LEN("hello")',
  },
  {
    name: "UPPER",
    category: "Text",
    syntax: "UPPER(text)",
    summary: "The text in capital letters.",
    example: 'UPPER("hello")',
  },
  {
    name: "LOWER",
    category: "Text",
    syntax: "LOWER(text)",
    summary: "The text in small letters.",
    example: 'LOWER("HELLO")',
  },
  {
    name: "TRIM",
    category: "Text",
    syntax: "TRIM(text)",
    summary: "Removes spaces from both ends and leaves one space between words.",
    example: 'TRIM("  two   words  ")',
  },
  {
    name: "TEXTJOIN",
    category: "Text",
    syntax: "TEXTJOIN(delimiter, skip_empty, value, ...)",
    summary:
      "Joins values with the delimiter between them. With `skip_empty` TRUE, empty values are left out.",
    example: 'TEXTJOIN(", ", TRUE, B1:B3)',
  },
  {
    name: "LEFT",
    category: "Text",
    syntax: "LEFT(text, [count])",
    summary: "The first characters of the text, 1 if no count is given.",
    example: 'LEFT("hello", 2)',
  },
  {
    name: "RIGHT",
    category: "Text",
    syntax: "RIGHT(text, [count])",
    summary: "The last characters of the text, 1 if no count is given.",
    example: 'RIGHT("hello", 2)',
  },
  {
    name: "MID",
    category: "Text",
    syntax: "MID(text, start, count)",
    summary: "Characters from the middle of the text, starting at a position counted from 1.",
    example: 'MID("hello", 2, 3)',
  },
  {
    name: "FIND",
    category: "Text",
    syntax: "FIND(search, text, [start])",
    summary: "The position of one text inside another, counting from 1 and matching letter case.",
    example: 'FIND("l", "hello")',
  },
  {
    name: "SEARCH",
    category: "Text",
    syntax: "SEARCH(search, text, [start])",
    summary: "The position of one text inside another, ignoring letter case.",
    example: 'SEARCH("L", "hello")',
  },
  {
    name: "SUBSTITUTE",
    category: "Text",
    syntax: "SUBSTITUTE(text, old, new)",
    summary: "Replaces every occurrence of `old` with `new`.",
    example: 'SUBSTITUTE("a-b-c", "-", "+")',
  },
  {
    name: "REPT",
    category: "Text",
    syntax: "REPT(text, count)",
    summary: "Repeats the text.",
    example: 'REPT("ab", 3)',
  },
  {
    name: "VALUE",
    category: "Text",
    syntax: "VALUE(text)",
    summary: "Reads text as a number.",
    example: 'VALUE("12.5") + 1',
  },
  {
    name: "ISBLANK",
    category: "Information",
    syntax: "ISBLANK(value)",
    summary: "TRUE when the cell is empty.",
    example: "ISBLANK(C1)",
  },
  {
    name: "ISNUMBER",
    category: "Information",
    syntax: "ISNUMBER(value)",
    summary: "TRUE when the value is a number.",
    example: "ISNUMBER(A1)",
  },
  {
    name: "ISTEXT",
    category: "Information",
    syntax: "ISTEXT(value)",
    summary: "TRUE when the value is text.",
    example: "ISTEXT(A1)",
  },
  {
    name: "ISLOGICAL",
    category: "Information",
    syntax: "ISLOGICAL(value)",
    summary: "TRUE when the value is TRUE or FALSE.",
    example: "ISLOGICAL(A1 > 0)",
  },
  {
    name: "ISERROR",
    category: "Information",
    syntax: "ISERROR(value)",
    summary: "TRUE when the value is an error.",
    example: "ISERROR(1/0)",
  },
  {
    name: "BUTTON",
    category: "Actions",
    syntax: "BUTTON(label, action)",
    summary: "Shows a button in the cell. Clicking it runs the action.",
    example: 'BUTTON("Add one", EXECUTE(A1 + 1, A1))',
  },
  {
    name: "EXECUTE",
    category: "Actions",
    syntax: "EXECUTE(expression, target)",
    summary:
      "Writes the value of the expression into the target cell. The value is stored as if it had been typed, not as a formula.",
    example: 'BUTTON("Sum range", EXECUTE(SUM(A1, A2), A3))',
  },
  {
    name: "SEND_EMAIL",
    category: "Actions",
    syntax: "SEND_EMAIL(to, subject, body, [cc])",
    summary:
      "Sends an email. `to` and `cc` each take one address or several separated by commas or semicolons.",
    example: 'BUTTON("Click me!", SEND_EMAIL("ada@example.com", "Hello", "The total is " & A3))',
  },
];

/** Why a cell shows each error. Typed by `ErrorCode`, so a new code cannot be left out. */
export const errorDocs: Record<ErrorCode, string> = {
  "#DIV/0!": "A number was divided by zero, or AVERAGE was given no numbers.",
  "#VALUE!":
    "A value is the wrong kind: text where a number is needed, or a range where a single value is needed.",
  "#REF!": "The formula names a page or table that does not exist.",
  "#NAME?": "The formula uses a function or a word that is not known.",
  "#N/A": "A lookup found no match, or no case of IFS or SWITCH applied.",
  "#CYCLE!": "The formula depends on its own cell, directly or through other cells.",
  "#ERROR!": "The formula could not be read, or a function was given the wrong number of values.",
};
