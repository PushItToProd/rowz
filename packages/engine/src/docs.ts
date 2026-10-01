import type { ErrorCode } from "./values";

/** In the order the help page shows them. */
export const FUNCTION_CATEGORIES = [
  "Math",
  "Statistics",
  "Logic",
  "Lookup",
  "Text",
  "Dates",
  "Information",
  "Names",
  "Arrays",
  "Charts",
  "Controls",
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

/** One entry per function. Within a category, entries are shown in the order written here. */
const ENTRIES: readonly FunctionDoc[] = [
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
    summary: "The smallest number, or the earliest date when the values are dates.",
    example: "MIN(A1:A3)",
  },
  {
    name: "MAX",
    category: "Math",
    syntax: "MAX(value, ...)",
    summary: "The largest number, or the latest date when the values are dates.",
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
    name: "TEXT",
    category: "Text",
    syntax: "TEXT(value, format)",
    summary:
      'Writes a number or a date as text in a format. In a number format `0` always shows a digit, `#` shows one when needed, a comma groups thousands, and `%` shows a percentage: `"#,##0.00"`, `"0.0%"`, `"$0.00"`. A date format is built from `yyyy`, `mm`, `mmm`, `mmmm`, `dd`, `ddd`, `dddd`, `hh`, `mm`, `ss`, and `AM/PM`: `"mmm d, yyyy"`.',
    example: 'TEXT(1234.5, "$#,##0.00")',
  },
  {
    name: "VALUE",
    category: "Text",
    syntax: "VALUE(text)",
    summary: "Reads text as a number.",
    example: 'VALUE("12.5") + 1',
  },
  {
    name: "TODAY",
    category: "Dates",
    syntax: "TODAY()",
    summary: "Today's date.",
    example: "TODAY()",
  },
  {
    name: "NOW",
    category: "Dates",
    syntax: "NOW()",
    summary: "The date and time now, to the second.",
    example: "NOW()",
  },
  {
    name: "DATE",
    category: "Dates",
    syntax: "DATE(year, month, day)",
    summary:
      "A date from its year, month, and day. A month or day outside its range carries over, so day 0 is the last day of the month before.",
    example: "DATE(2026, 3, 0)",
  },
  {
    name: "DATEVALUE",
    category: "Dates",
    syntax: "DATEVALUE(text)",
    summary: 'Reads text written like "2026-09-30" as a date.',
    example: 'DATEVALUE("2026-09-30") + 1',
  },
  {
    name: "YEAR",
    category: "Dates",
    syntax: "YEAR(date)",
    summary: "The year of a date.",
    example: 'YEAR("2026-09-30")',
  },
  {
    name: "MONTH",
    category: "Dates",
    syntax: "MONTH(date)",
    summary: "The month of a date, from 1 to 12.",
    example: 'MONTH("2026-09-30")',
  },
  {
    name: "DAY",
    category: "Dates",
    syntax: "DAY(date)",
    summary: "The day of the month of a date.",
    example: 'DAY("2026-09-30")',
  },
  {
    name: "HOUR",
    category: "Dates",
    syntax: "HOUR(date)",
    summary: "The hour of a date's time, from 0 to 23.",
    example: 'HOUR("2026-09-30 14:05")',
  },
  {
    name: "MINUTE",
    category: "Dates",
    syntax: "MINUTE(date)",
    summary: "The minute of a date's time.",
    example: 'MINUTE("2026-09-30 14:05")',
  },
  {
    name: "SECOND",
    category: "Dates",
    syntax: "SECOND(date)",
    summary: "The second of a date's time.",
    example: 'SECOND("2026-09-30 14:05:09")',
  },
  {
    name: "WEEKDAY",
    category: "Dates",
    syntax: "WEEKDAY(date)",
    summary: "The day of the week as a number, from 1 for Sunday to 7 for Saturday.",
    example: 'WEEKDAY("2026-09-30")',
  },
  {
    name: "DAYS",
    category: "Dates",
    syntax: "DAYS(end, start)",
    summary: "How many days the first date is after the second.",
    example: 'DAYS("2026-12-25", "2026-09-30")',
  },
  {
    name: "EDATE",
    category: "Dates",
    syntax: "EDATE(date, months)",
    summary:
      "The date a number of months later, or earlier for a negative number. A day the month does not have becomes its last day.",
    example: 'EDATE("2026-01-31", 1)',
  },
  {
    name: "EOMONTH",
    category: "Dates",
    syntax: "EOMONTH(date, months)",
    summary: "The last day of the month a number of months after a date.",
    example: 'EOMONTH("2026-09-30", 1)',
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
    name: "ISDATE",
    category: "Information",
    syntax: "ISDATE(value)",
    summary: "TRUE when the value is a date.",
    example: "ISDATE(DATE(2026, 1, 1))",
  },
  {
    name: "ISERROR",
    category: "Information",
    syntax: "ISERROR(value)",
    summary: "TRUE when the value is an error.",
    example: "ISERROR(1/0)",
  },
  {
    name: "LET",
    category: "Names",
    syntax: "LET(name, value, ..., result)",
    summary:
      "Gives names to values and computes the result with them. Each value can use the names before it. A name is a word that is not a cell address.",
    example: "LET(total, SUM(A1:A3), total * 2)",
  },
  {
    name: "LAMBDA",
    category: "Names",
    syntax: "LAMBDA(parameter, ..., body)",
    summary:
      "Makes a function of your own. Call it by putting values in parentheses after it. Name it with `LET`, or leave it in a cell and call the cell.",
    example: "LAMBDA(price, count, price * count)(A2, A3)",
  },
  {
    name: "FILTER",
    category: "Arrays",
    syntax: "FILTER(range, condition, ...)",
    summary:
      "Keeps the rows of the range where every condition is true. A condition is a column as tall as the range, usually a comparison.",
    example: "FILTER(B1:B3, A1:A3 > 1)",
  },
  {
    name: "SORT",
    category: "Arrays",
    syntax: "SORT(range, [column], [ascending], ...)",
    summary:
      "Sorts the rows of the range by a column, counting from 1. Without a column it sorts by the first, ascending. FALSE or -1 sorts descending. More column and direction pairs break ties.",
    example: "SORT(A1:B3, 1, FALSE)",
  },
  {
    name: "UNIQUE",
    category: "Arrays",
    syntax: "UNIQUE(range)",
    summary: "The rows of the range with repeats removed.",
    example: "UNIQUE(MAP(B1:B3, LAMBDA(name, LEN(name))))",
  },
  {
    name: "SEQUENCE",
    category: "Arrays",
    syntax: "SEQUENCE(rows, [columns], [start], [step])",
    summary:
      "A block of counting numbers, filled row by row. It starts at 1 and counts by 1 unless told otherwise.",
    example: "SEQUENCE(2, 3)",
  },
  {
    name: "TRANSPOSE",
    category: "Arrays",
    syntax: "TRANSPOSE(range)",
    summary: "Turns rows into columns and columns into rows.",
    example: "TRANSPOSE(A1:A3)",
  },
  {
    name: "TAKE",
    category: "Arrays",
    syntax: "TAKE(range, rows, [columns])",
    summary:
      "The first rows of the range, or the last rows when the count is negative. A third value does the same for columns.",
    example: "TAKE(SORT(A1:B3, 1, FALSE), 2)",
  },
  {
    name: "DROP",
    category: "Arrays",
    syntax: "DROP(range, rows, [columns])",
    summary:
      "The range without its first rows, or without its last rows when the count is negative.",
    example: "DROP(B1:B3, 1)",
  },
  {
    name: "ROWS",
    category: "Arrays",
    syntax: "ROWS(range)",
    summary: "How many rows the range has.",
    example: "ROWS(A1:B3)",
  },
  {
    name: "HSTACK",
    category: "Arrays",
    syntax: "HSTACK(range, ...)",
    summary: "Puts ranges side by side as one array.",
    example: "HSTACK(B1:B3, A1:A3)",
  },
  {
    name: "VSTACK",
    category: "Arrays",
    syntax: "VSTACK(range, ...)",
    summary: "Puts ranges one under another as one array.",
    example: "VSTACK(A1:A2, B1:B2)",
  },
  {
    name: "COLUMNS",
    category: "Arrays",
    syntax: "COLUMNS(range)",
    summary: "How many columns the range has.",
    example: "COLUMNS(A1:B3)",
  },
  {
    name: "MAP",
    category: "Arrays",
    syntax: "MAP(range, ..., function)",
    summary:
      "Calls a function on each cell and gives the results in the same arrangement. With several ranges of one size, the function receives one cell of each.",
    example: 'MAP(A1:A3, B1:B3, LAMBDA(n, name, n & " " & name))',
  },
  {
    name: "REDUCE",
    category: "Arrays",
    syntax: "REDUCE(start, range, function)",
    summary:
      "Folds a range into one value. The function receives the value so far and the next cell, and gives the new value so far.",
    example: "REDUCE(0, A1:A3, LAMBDA(total, n, total + n * n))",
  },
  {
    name: "BYROW",
    category: "Arrays",
    syntax: "BYROW(range, function)",
    summary: "Calls a function on each row and gives a column of the results.",
    example: 'BYROW(A1:B3, LAMBDA(row, TEXTJOIN("-", TRUE, row)))',
  },
  {
    name: "BYCOL",
    category: "Arrays",
    syntax: "BYCOL(range, function)",
    summary: "Calls a function on each column and gives a row of the results.",
    example: "BYCOL(A1:B3, LAMBDA(col, COUNTA(col)))",
  },
  {
    name: "BAR_CHART",
    category: "Charts",
    syntax: "BAR_CHART(data, [title])",
    summary:
      "A bar chart. The first column of the data labels the bars, and each other column is a series of bars. A first row of text names the series.",
    example: 'BAR_CHART(HSTACK(B1:B3, A1:A3), "Fruit")',
  },
  {
    name: "LINE_CHART",
    category: "Charts",
    syntax: "LINE_CHART(data, [title])",
    summary: "A line chart, with one line for each column after the first.",
    example: "LINE_CHART(HSTACK(B1:B3, A1:A3))",
  },
  {
    name: "PIE_CHART",
    category: "Charts",
    syntax: "PIE_CHART(data, [title])",
    summary: "A pie chart of the second column, with a slice for each row.",
    example: "PIE_CHART(HSTACK(B1:B3, A1:A3))",
  },
  {
    name: "SCATTER_CHART",
    category: "Charts",
    syntax: "SCATTER_CHART(data, [title])",
    summary:
      "A scatter chart. The first column gives each point's position across, and each other column its height.",
    example: "SCATTER_CHART(HSTACK(A1:A3, A1:A3))",
  },
  {
    name: "CHECKBOX",
    category: "Controls",
    syntax: "CHECKBOX(cell, [label])",
    summary:
      "Shows a checkbox that is ticked when the cell holds TRUE. Ticking or clearing it writes TRUE or FALSE to the cell.",
    example: 'CHECKBOX(C1, "Done")',
  },
  {
    name: "DROPDOWN",
    category: "Controls",
    syntax: "DROPDOWN(choices, cell)",
    summary:
      'Shows a list to choose from and writes the choice to the cell. The choices are the values of a range, or text with commas between them such as "low, medium, high".',
    example: "DROPDOWN(B1:B3, C1)",
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
  {
    name: "APPEND_ROW",
    category: "Actions",
    syntax: "APPEND_ROW(range, value, ...)",
    summary:
      "Writes the values into the first row of the range after its last row with content. The table grows when it has no row left.",
    example: 'BUTTON("Add", APPEND_ROW(A:B, 4, "date"))',
  },
  {
    name: "CLEAR",
    category: "Actions",
    syntax: "CLEAR(range)",
    summary: "Empties the cells of the range.",
    example: 'BUTTON("Reset", CLEAR(A1:A3))',
  },
  {
    name: "DO",
    category: "Actions",
    syntax: "DO(action, ...)",
    summary:
      "Runs several actions from one click. Each action reads the cells as they were before the click.",
    example: 'BUTTON("Move", DO(EXECUTE(A1, C1), CLEAR(A1)))',
  },
  {
    name: "SUMPRODUCT",
    category: "Math",
    syntax: "SUMPRODUCT(range, ...)",
    summary: "Multiplies ranges of one size cell by cell and adds the products.",
    example: "SUMPRODUCT(A1:A3, A1:A3)",
  },
  {
    name: "TRUNC",
    category: "Math",
    syntax: "TRUNC(number, [places])",
    summary: "Cuts a number off at a number of decimal places without rounding.",
    example: "TRUNC(2.78, 1)",
  },
  {
    name: "MROUND",
    category: "Math",
    syntax: "MROUND(number, multiple)",
    summary: "Rounds to the nearest multiple.",
    example: "MROUND(17, 5)",
  },
  {
    name: "QUOTIENT",
    category: "Math",
    syntax: "QUOTIENT(dividend, divisor)",
    summary: "The whole-number part of a division.",
    example: "QUOTIENT(7, 2)",
  },
  {
    name: "SIGN",
    category: "Math",
    syntax: "SIGN(number)",
    summary: "1 for a positive number, -1 for a negative one, and 0 for zero.",
    example: "SIGN(-4)",
  },
  {
    name: "EXP",
    category: "Math",
    syntax: "EXP(number)",
    summary: "The constant e raised to a power.",
    example: "ROUND(EXP(1), 3)",
  },
  {
    name: "LN",
    category: "Math",
    syntax: "LN(number)",
    summary: "The natural logarithm.",
    example: "ROUND(LN(10), 3)",
  },
  {
    name: "LOG",
    category: "Math",
    syntax: "LOG(number, [base])",
    summary: "The logarithm to a base, which is 10 unless given.",
    example: "LOG(8, 2)",
  },
  {
    name: "PI",
    category: "Math",
    syntax: "PI()",
    summary: "The ratio of a circle's circumference to its diameter.",
    example: "ROUND(PI(), 4)",
  },
  {
    name: "EVEN",
    category: "Math",
    syntax: "EVEN(number)",
    summary: "Rounds away from zero to the next even number.",
    example: "EVEN(3)",
  },
  {
    name: "ODD",
    category: "Math",
    syntax: "ODD(number)",
    summary: "Rounds away from zero to the next odd number.",
    example: "ODD(4)",
  },
  {
    name: "ISEVEN",
    category: "Math",
    syntax: "ISEVEN(number)",
    summary: "Whether a number is even.",
    example: "ISEVEN(A2)",
  },
  {
    name: "ISODD",
    category: "Math",
    syntax: "ISODD(number)",
    summary: "Whether a number is odd.",
    example: "ISODD(A2)",
  },
  {
    name: "GCD",
    category: "Math",
    syntax: "GCD(number, ...)",
    summary: "The largest whole number that divides every value.",
    example: "GCD(12, 18)",
  },
  {
    name: "LCM",
    category: "Math",
    syntax: "LCM(number, ...)",
    summary: "The smallest whole number that every value divides.",
    example: "LCM(4, 6)",
  },
  {
    name: "FACT",
    category: "Math",
    syntax: "FACT(number)",
    summary: "The product of the whole numbers from 1 to the number.",
    example: "FACT(5)",
  },
  {
    name: "MAXIFS",
    category: "Math",
    syntax: "MAXIFS(range, criteria_range, criterion, ...)",
    summary: "The largest number of the range in the rows that meet every criterion.",
    example: 'MAXIFS(A1:A3, B1:B3, "<>cherry")',
  },
  {
    name: "MINIFS",
    category: "Math",
    syntax: "MINIFS(range, criteria_range, criterion, ...)",
    summary: "The smallest number of the range in the rows that meet every criterion.",
    example: 'MINIFS(A1:A3, A1:A3, ">1")',
  },
  {
    name: "MODE",
    category: "Statistics",
    syntax: "MODE(value, ...)",
    summary: "The number that occurs most often.",
    example: "MODE(1, 2, 2, 3)",
  },
  {
    name: "STDEV",
    category: "Statistics",
    syntax: "STDEV(value, ...)",
    summary:
      "The standard deviation of a sample: how far the numbers typically are from their average.",
    example: "STDEV(A1:A3)",
  },
  {
    name: "STDEVP",
    category: "Statistics",
    syntax: "STDEVP(value, ...)",
    summary:
      "The standard deviation when the numbers are the whole population and not a sample of it.",
    example: "ROUND(STDEVP(A1:A3), 3)",
  },
  {
    name: "VAR_S",
    category: "Statistics",
    syntax: "VAR_S(value, ...)",
    summary: "The variance of a sample, which is the standard deviation squared.",
    example: "VAR_S(A1:A3)",
  },
  {
    name: "VAR_P",
    category: "Statistics",
    syntax: "VAR_P(value, ...)",
    summary: "The variance of a whole population.",
    example: "ROUND(VAR_P(A1:A3), 3)",
  },
  {
    name: "PERCENTILE",
    category: "Statistics",
    syntax: "PERCENTILE(range, fraction)",
    summary: "The value a fraction of the way through the numbers in order. 0.5 is the median.",
    example: "PERCENTILE(A1:A3, 0.75)",
  },
  {
    name: "QUARTILE",
    category: "Statistics",
    syntax: "QUARTILE(range, quarter)",
    summary:
      "The value at a quarter of the way through the numbers in order: 0 is the smallest, 2 the median, and 4 the largest.",
    example: "QUARTILE(A1:A3, 1)",
  },
  {
    name: "RANK",
    category: "Statistics",
    syntax: "RANK(number, range, [ascending])",
    summary:
      "The position of a number among the numbers of a range, counting from the largest. With `ascending` TRUE it counts from the smallest.",
    example: "RANK(3, A1:A3)",
  },
  {
    name: "CORREL",
    category: "Statistics",
    syntax: "CORREL(range, range)",
    summary: "How closely two ranges move together, from -1 to 1.",
    example: "CORREL(A1:A3, A1:A3 * 2)",
  },
  {
    name: "COUNTUNIQUE",
    category: "Statistics",
    syntax: "COUNTUNIQUE(value, ...)",
    summary: "How many different values there are, not counting empty cells.",
    example: 'COUNTUNIQUE(A1:A3, 1, "x")',
  },
  {
    name: "COUNTBLANK",
    category: "Statistics",
    syntax: "COUNTBLANK(range, ...)",
    summary: "How many cells are empty.",
    example: "COUNTBLANK(A1:C3)",
  },
  {
    name: "IFNA",
    category: "Logic",
    syntax: "IFNA(value, fallback)",
    summary:
      "The value, or the fallback when the value is `#N/A`. Other errors are kept, so a lookup that finds nothing does not hide a mistake.",
    example: 'IFNA(MATCH("kiwi", B1:B3, 0), "none")',
  },
  {
    name: "HLOOKUP",
    category: "Lookup",
    syntax: "HLOOKUP(key, range, row, [sorted])",
    summary:
      "`VLOOKUP` on its side: finds the key in the first row of the range and gives the cell of that column in another row. Pass FALSE as `sorted` for an exact match.",
    example: "HLOOKUP(2, TRANSPOSE(A1:B3), 2, FALSE)",
  },
  {
    name: "ROW",
    category: "Lookup",
    syntax: "ROW([cell])",
    summary: "The row number of a cell. Without a cell, the row of the formula itself.",
    example: "ROW(B3)",
  },
  {
    name: "COLUMN",
    category: "Lookup",
    syntax: "COLUMN([cell])",
    summary:
      "The column number of a cell, where A is 1. Without a cell, the column of the formula itself.",
    example: "COLUMN(B3)",
  },
  {
    name: "CONCAT",
    category: "Text",
    syntax: "CONCAT(value, ...)",
    summary: "The same as `CONCATENATE`.",
    example: 'CONCAT(B1, "-", A1)',
  },
  {
    name: "JOIN",
    category: "Text",
    syntax: "JOIN(delimiter, value, ...)",
    summary: "Joins values with a delimiter between them.",
    example: 'JOIN(", ", B1:B3)',
  },
  {
    name: "SPLIT",
    category: "Text",
    syntax: "SPLIT(text, delimiter)",
    summary: "Cuts text at a delimiter into cells across a row.",
    example: 'SPLIT("a,b,c", ",")',
  },
  {
    name: "PROPER",
    category: "Text",
    syntax: "PROPER(text)",
    summary: "Capitalizes the first letter of each word.",
    example: 'PROPER("ada LOVELACE")',
  },
  {
    name: "CHAR",
    category: "Text",
    syntax: "CHAR(number)",
    summary: "The character with a Unicode number.",
    example: "CHAR(65)",
  },
  {
    name: "CODE",
    category: "Text",
    syntax: "CODE(text)",
    summary: "The Unicode number of the first character.",
    example: 'CODE("A")',
  },
  {
    name: "ENCODEURL",
    category: "Text",
    syntax: "ENCODEURL(text)",
    summary: "Writes text so it can be part of a web address.",
    example: 'ENCODEURL("a b&c")',
  },
  {
    name: "FIXED",
    category: "Text",
    syntax: "FIXED(number, [decimals], [no_commas])",
    summary:
      "Writes a number as text with a fixed number of decimals, 2 unless given. Thousands are grouped unless `no_commas` is TRUE.",
    example: "FIXED(1234.567, 1)",
  },
  {
    name: "TIME",
    category: "Dates",
    syntax: "TIME(hour, minute, second)",
    summary: "A time of day as a fraction of a day. Add it to a date to set the time.",
    example: "DATE(2026, 9, 30) + TIME(14, 30, 0)",
  },
  {
    name: "DATEDIF",
    category: "Dates",
    syntax: "DATEDIF(start, end, unit)",
    summary:
      'The whole years (`"Y"`), months (`"M"`), or days (`"D"`) from one date to a later one. `"YM"` gives the months left after the whole years, and `"MD"` the days left after the whole months.',
    example: 'DATEDIF(DATE(2024, 1, 15), DATE(2026, 9, 30), "Y")',
  },
  {
    name: "WEEKNUM",
    category: "Dates",
    syntax: "WEEKNUM(date)",
    summary: "The week of the year, where weeks start on Sunday and January 1 is in week 1.",
    example: "WEEKNUM(DATE(2026, 9, 30))",
  },
  {
    name: "ISOWEEKNUM",
    category: "Dates",
    syntax: "ISOWEEKNUM(date)",
    summary:
      "The ISO week of the year, where weeks start on Monday and week 1 holds the year's first Thursday.",
    example: "ISOWEEKNUM(DATE(2026, 9, 30))",
  },
  {
    name: "WORKDAY",
    category: "Dates",
    syntax: "WORKDAY(start, days, [holidays])",
    summary:
      "The date a number of working days after a date. Saturdays, Sundays, and the dates in `holidays` are skipped.",
    example: "WORKDAY(DATE(2026, 9, 30), 5)",
  },
  {
    name: "NETWORKDAYS",
    category: "Dates",
    syntax: "NETWORKDAYS(start, end, [holidays])",
    summary: "How many working days there are from one date to another, counting both.",
    example: "NETWORKDAYS(DATE(2026, 9, 1), DATE(2026, 9, 30))",
  },
  {
    name: "ISNA",
    category: "Information",
    syntax: "ISNA(value)",
    summary: "Whether a value is the error `#N/A`.",
    example: 'ISNA(MATCH("kiwi", B1:B3, 0))',
  },
  {
    name: "ISERR",
    category: "Information",
    syntax: "ISERR(value)",
    summary: "Whether a value is an error other than `#N/A`.",
    example: "ISERR(1/0)",
  },
  {
    name: "ISNONTEXT",
    category: "Information",
    syntax: "ISNONTEXT(value)",
    summary: "Whether a value is anything but text. An empty cell is not text.",
    example: "ISNONTEXT(A1)",
  },
  {
    name: "FLATTEN",
    category: "Arrays",
    syntax: "FLATTEN(range, ...)",
    summary: "Every cell of the ranges in one column, reading each range row by row.",
    example: "FLATTEN(A1:B2)",
  },
  {
    name: "QUERY",
    category: "Arrays",
    syntax: "QUERY(range, query, [headers])",
    summary:
      "Selects, filters, groups, and sorts the rows of a range with a query written like SQL. Columns are named by letter, counting from the first column of the range, or by their header. `headers` is how many rows at the top are headings.",
    example: 'QUERY(A1:B3, "select B where A > 1 order by A desc")',
  },
];

/**
 * One entry per function in the default registry, in the order the help page
 * lists them. A test fails when a function has no entry or an example breaks.
 */
export const functionDocs: readonly FunctionDoc[] = FUNCTION_CATEGORIES.flatMap((category) =>
  ENTRIES.filter((doc) => doc.category === category),
);

/** Why a cell shows each error. Typed by `ErrorCode`, so a new code cannot be left out. */
export const errorDocs: Record<ErrorCode, string> = {
  "#DIV/0!": "A number was divided by zero, or AVERAGE was given no numbers.",
  "#VALUE!":
    "A value is the wrong kind: text where a number is needed, or a range where a single value is needed.",
  "#REF!": "The formula names a page or table that does not exist.",
  "#NAME?": "The formula uses a function or a word that is not known.",
  "#N/A": "A lookup found no match, or no case of IFS or SWITCH applied.",
  "#SPILL!":
    "The result is several values, and a cell they would fill is not empty or is outside the table.",
  "#CYCLE!": "The formula depends on its own cell, directly or through other cells.",
  "#ERROR!": "The formula could not be read, or a function was given the wrong number of values.",
};
