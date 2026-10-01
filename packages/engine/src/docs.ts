import type { ErrorCode } from "./values";

export type FunctionCategory = "Math" | "Logic" | "Text" | "Actions";

/** What the help page shows for one function. */
export interface FunctionDoc {
  name: string;
  category: FunctionCategory;
  /** The call with its parameter names. Optional parameters are in square brackets. */
  syntax: string;
  summary: string;
  /**
   * A formula without the leading `=`. It may read A1, A2, and A3, which the
   * help page fills with `EXAMPLE_CELLS`, and it must evaluate without an error.
   */
  example: string;
}

/** The cells every example can read. The help page states them next to the examples. */
export const EXAMPLE_CELLS = { A1: "1", A2: "2", A3: "3" } as const;

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
  "#CYCLE!": "The formula depends on its own cell, directly or through other cells.",
  "#ERROR!": "The formula could not be read, or a function was given the wrong number of values.",
};
