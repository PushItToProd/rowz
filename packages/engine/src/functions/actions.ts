import { isSingleCell, type Node } from "../ast";
import type { Effect } from "../effects";
import type { CellRange } from "../address";
import {
  compare,
  isAction,
  isError,
  isScalar,
  kindOf,
  literalInput,
  type CellValue,
  type Evaluated,
  type Scalar,
} from "../values";
import { fail, Failure, grid, integer, lazy, scalar, text } from "./arguments";
import type { FunctionDefinition, PlanContext } from "./registry";

const ADDRESS_SEPARATOR = /[,;]/;
// A loose check that catches blanks and obvious typos. The mail server is the real validator.
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Evaluates an action's argument at the time the action runs. A missing argument is empty. */
function argument(node: Node | undefined, context: PlanContext): Evaluated {
  return node ? context.evaluate(node) : null;
}

/** Reads a comma- or semicolon-separated list of email addresses. */
function addressList(node: Node | undefined, context: PlanContext): string[] {
  const addresses = text(argument(node, context))
    .split(ADDRESS_SEPARATOR)
    .map((address) => address.trim())
    .filter((address) => address !== "");
  const invalid = addresses.find((address) => !EMAIL_ADDRESS.test(address));
  if (invalid !== undefined) fail("#VALUE!", `"${invalid}" is not an email address`);
  return addresses;
}

function filled(cells: readonly CellValue[]): boolean {
  return cells.some((cell) => cell !== null && cell !== "");
}

/** The range an action writes rows into, with what it holds now. */
interface Destination {
  range: CellRange;
  /** The rows of the range through the last one that holds anything. */
  rows: CellValue[][];
  width: number;
}

function destination(target: Node | undefined, context: PlanContext, name: string): Destination {
  if (target?.type !== "reference") fail("#VALUE!", `${name} needs a range to write to`);
  const range = context.resolve(target.reference);
  if (!range) fail("#REF!", "The range to write to does not exist");
  const rows = grid(context.evaluate(target));
  // Cells an array formula fills count as content.
  return {
    range,
    rows: rows.slice(0, rows.findLastIndex(filled) + 1),
    width: range.endCol - range.startCol + 1,
  };
}

/** The rows of an action's data that hold something, checked against the width they must fit. */
function dataRows(
  node: Node | undefined,
  context: PlanContext,
  width: number,
  name: string,
): Scalar[][] {
  const rows = grid(argument(node, context))
    .filter(filled)
    .map((cells) => cells.map(scalar));
  const widest = Math.max(0, ...rows.map((cells) => cells.length));
  if (widest > width) {
    fail("#VALUE!", `${name} was given ${String(widest)} columns for a range of ${String(width)}`);
  }
  return rows;
}

/** The effects that write one row of values into a row of the range. */
function writeRow(
  { tableId, startCol }: CellRange,
  row: number,
  values: readonly Scalar[],
): Effect[] {
  return values.map((value, offset) => ({
    type: "setCell" as const,
    tableId,
    row,
    col: startCol + offset,
    input: literalInput(value),
  }));
}

/** The effects that add rows after `used` rows of the range, growing the table to hold them. */
function appendRows({ range }: Destination, used: number, rows: readonly Scalar[][]): Effect[] {
  if (rows.length === 0) return [];
  const first = range.startRow + used;
  if (first + rows.length - 1 > range.endRow)
    fail("#VALUE!", "The range has too few empty rows left");
  return [
    { type: "ensureRows", tableId: range.tableId, rowCount: first + rows.length },
    ...rows.flatMap((values, index) => writeRow(range, first + index, values)),
  ];
}

/** Whether two cells hold the same value, as a lookup would judge it. An empty cell matches nothing. */
function sameKey(a: CellValue, b: CellValue): boolean {
  if (a === null || b === null || !isScalar(a) || !isScalar(b)) return false;
  return kindOf(a) === kindOf(b) && compare(a, b) === 0;
}

export const actionFunctions: Record<string, FunctionDefinition> = {
  /** `BUTTON(label, action)` shows a button that runs the action when clicked. */
  BUTTON: lazy(2, 2, ([label, action]): Evaluated => {
    const shown = text(label?.() ?? null);
    const run = action?.() ?? null;
    if (isError(run)) return run;
    if (!isAction(run)) fail("#VALUE!", "BUTTON needs an action such as EXECUTE or SEND_EMAIL");
    return { kind: "button", label: shown, action: run };
  }),

  /**
   * `EXECUTE(expression, target)` writes the value of the expression into the
   * target cell. An array is written as a block whose first cell is the target.
   */
  EXECUTE: {
    kind: "action",
    minArgs: 2,
    maxArgs: 2,
    plan([expression, target], context): Effect[] {
      if (target?.type !== "reference" || !isSingleCell(target.reference)) {
        fail("#VALUE!", "EXECUTE needs a single cell to write to");
      }
      const cell = context.resolve(target.reference);
      if (!cell) fail("#REF!", "The cell to write to does not exist");
      return grid(argument(expression, context)).flatMap((cells, rowOffset) =>
        cells.map((value, colOffset) => ({
          type: "setCell" as const,
          tableId: cell.tableId,
          row: cell.startRow + rowOffset,
          col: cell.startCol + colOffset,
          input: literalInput(scalar(value)),
        })),
      );
    },
  },

  /**
   * `APPEND_ROW(range, value, ...)` writes the values into the first row of
   * the range after its last row that holds anything, growing the table when
   * the range has no free row left. An array value takes one cell per element.
   */
  APPEND_ROW: {
    kind: "action",
    minArgs: 2,
    maxArgs: Infinity,
    plan([target, ...valueNodes], context): Effect[] {
      const range = target?.type === "reference" ? context.resolve(target.reference) : undefined;
      if (target?.type !== "reference")
        fail("#VALUE!", "APPEND_ROW needs a range to add the row to");
      if (!range) fail("#REF!", "The range to add the row to does not exist");

      const values = valueNodes.flatMap((node) => grid(context.evaluate(node)).flat().map(scalar));
      const width = range.endCol - range.startCol + 1;
      if (values.length > width) {
        fail(
          "#VALUE!",
          `APPEND_ROW was given ${String(values.length)} values for ${String(width)} columns`,
        );
      }
      // The row after the last one with content. Cells an array formula fills count as content.
      const rows = grid(context.evaluate(target));
      const used = rows.findLastIndex((cells) =>
        cells.some((cell) => cell !== null && cell !== ""),
      );
      const row = range.startRow + used + 1;
      if (row > range.endRow) fail("#VALUE!", "The range has no empty row left");
      return [
        { type: "ensureRows", tableId: range.tableId, rowCount: row + 1 },
        ...values.map((value, offset) => ({
          type: "setCell" as const,
          tableId: range.tableId,
          row,
          col: range.startCol + offset,
          input: literalInput(value),
        })),
      ];
    },
  },

  /**
   * `INSERT(data, range)` adds every row of the data after the last row of
   * the range that holds anything. It is `APPEND_ROW` for many rows at once.
   */
  INSERT: {
    kind: "action",
    minArgs: 2,
    maxArgs: 2,
    plan([data, target], context): Effect[] {
      const into = destination(target, context, "INSERT");
      return appendRows(into, into.rows.length, dataRows(data, context, into.width, "INSERT"));
    },
  },

  /**
   * `UPDATE(data, key_columns, range)` writes each row of the data over the
   * row of the range that has the same values in the key columns, and adds
   * the rows that match none. Key columns are counted from 1.
   */
  UPDATE: {
    kind: "action",
    minArgs: 3,
    maxArgs: 3,
    plan([data, keyNode, target], context): Effect[] {
      const into = destination(target, context, "UPDATE");
      const keys = grid(argument(keyNode, context))
        .flat()
        .map((key) => integer(key) - 1);
      if (keys.length === 0 || keys.some((key) => key < 0 || key >= into.width)) {
        fail("#VALUE!", `The key columns must be between 1 and ${String(into.width)}`);
      }
      // Rows added by this update can be matched by later rows of the same data.
      const existing: CellValue[][] = into.rows.map((cells) => [...cells]);
      const effects: Effect[] = [];
      const added: Scalar[][] = [];
      for (const values of dataRows(data, context, into.width, "UPDATE")) {
        const found = existing.findIndex((cells) =>
          keys.every((key) => sameKey(cells[key] ?? null, values[key] ?? null)),
        );
        if (found === -1) {
          existing.push(values);
          added.push(values);
        } else if (found >= into.rows.length) {
          // The row it matches is one this update is adding: the later values win.
          added[found - into.rows.length] = values;
          existing[found] = values;
        } else {
          effects.push(...writeRow(into.range, into.range.startRow + found, values));
        }
      }
      return [...effects, ...appendRows(into, into.rows.length, added)];
    },
  },

  /** `OVERWRITE(data, range)` empties the range and writes the data from its first row. */
  OVERWRITE: {
    kind: "action",
    minArgs: 2,
    maxArgs: 2,
    plan([data, target], context): Effect[] {
      const into = destination(target, context, "OVERWRITE");
      const written = appendRows(into, 0, dataRows(data, context, into.width, "OVERWRITE"));
      const kept = new Set(
        written.flatMap((effect) =>
          effect.type === "setCell" ? [`${String(effect.row)}:${String(effect.col)}`] : [],
        ),
      );
      const cleared = context
        .inputsIn(into.range)
        .filter(({ row, col }) => !kept.has(`${String(row)}:${String(col)}`))
        .map(({ tableId, row, col }) => ({
          type: "setCell" as const,
          tableId,
          row,
          col,
          input: "",
        }));
      return [...cleared, ...written];
    },
  },

  /** `CLEAR(range)` empties every cell of the range that holds something typed. */
  CLEAR: {
    kind: "action",
    minArgs: 1,
    maxArgs: 1,
    plan([target], context): Effect[] {
      if (target?.type !== "reference") fail("#VALUE!", "CLEAR needs a cell or range to empty");
      const range = context.resolve(target.reference);
      if (!range) fail("#REF!", "The range to empty does not exist");
      return context.inputsIn(range).map(({ tableId, row, col }) => ({
        type: "setCell" as const,
        tableId,
        row,
        col,
        input: "",
      }));
    },
  },

  /**
   * `DO(action, ...)` runs several actions from one click. Every action reads
   * the cells as they were before the click, not as an earlier action in the
   * list left them.
   */
  DO: {
    kind: "action",
    minArgs: 1,
    maxArgs: Infinity,
    plan(args, context): Effect[] {
      return args.flatMap((node) => {
        const action = context.evaluate(node);
        if (isError(action)) throw new Failure(action);
        if (!isAction(action)) fail("#VALUE!", "DO takes actions such as EXECUTE or SEND_EMAIL");
        return context.plan(action);
      });
    },
  },

  /** `SEND_EMAIL(to, subject, body, [cc])`. `to` and `cc` take addresses separated by commas or semicolons. */
  SEND_EMAIL: {
    kind: "action",
    minArgs: 3,
    maxArgs: 4,
    plan([toNode, subjectNode, bodyNode, ccNode], context): Effect[] {
      const to = addressList(toNode, context);
      if (to.length === 0) fail("#VALUE!", "SEND_EMAIL needs a recipient");
      const subject = text(argument(subjectNode, context));
      const body = text(argument(bodyNode, context));
      return [{ type: "sendEmail", to, cc: addressList(ccNode, context), subject, body }];
    },
  },
};
