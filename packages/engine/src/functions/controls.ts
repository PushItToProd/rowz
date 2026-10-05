import { isSingleCell, type Node } from "../ast";
import { evaluate, type EvaluationContext } from "../evaluate";
import type { CellId } from "../address";
import {
  compare,
  isScalar,
  kindOf,
  type ControlValue,
  type Evaluated,
  type Scalar,
} from "../values";
import { fail, grid, scalar, text } from "./arguments";
import type { FunctionDefinition } from "./registry";

const CHOICE_SEPARATOR = ",";

/** Finds the single cell a control reads and writes, and that cell's value. */
function target(
  node: Node | undefined,
  context: EvaluationContext,
  form: string,
): { cell: CellId; value: Scalar } {
  if (node?.type !== "reference" || !isSingleCell(node.reference)) {
    return fail("#VALUE!", `${form} needs a single cell to read and write`);
  }
  const range = context.resolve(node.reference);
  if (!range) return fail("#REF!", "The cell to read and write does not exist");
  const cell = { tableId: range.tableId, row: range.startRow, col: range.startCol };
  const targetError = context.controlTargetError(cell);
  if (targetError) fail("#VALUE!", targetError);
  const value = context.read(cell);
  // A non-formula target with an invalid typed value is shown as empty.
  return { cell, value: isScalar(value) ? value : null };
}

/** The distinct, non-empty choices in a range, or in text with commas between the choices. */
function choices(given: Evaluated): Scalar[] {
  const cells = grid(given).flat().map(scalar);
  const [only] = cells;
  const listed =
    cells.length === 1 && typeof only === "string"
      ? only.split(CHOICE_SEPARATOR).map((choice) => choice.trim())
      : cells;
  const distinct: Scalar[] = [];
  for (const choice of listed) {
    if (choice === null || choice === "") continue;
    const seen = distinct.some(
      (other) => kindOf(other) === kindOf(choice) && compare(other, choice) === 0,
    );
    if (!seen) distinct.push(choice);
  }
  return distinct;
}

export const controlFunctions: Record<string, FunctionDefinition> = {
  /**
   * `CHECKBOX(cell, [label])` shows a checkbox that is ticked when the cell
   * holds TRUE. Ticking or clearing it writes TRUE or FALSE to the cell.
   */
  CHECKBOX: {
    kind: "special",
    minArgs: 1,
    maxArgs: 2,
    evaluate([cellNode, labelNode], context): ControlValue {
      const { cell, value } = target(cellNode, context, "CHECKBOX");
      const label = labelNode ? text(evaluate(labelNode, context)) : "";
      return { kind: "control", control: "checkbox", target: cell, value, options: [], label };
    },
  },

  /**
   * `DROPDOWN(choices, cell)` shows a list to choose from. The choices come
   * from a range or from text such as `"low, medium, high"`. Choosing one
   * writes it to the cell.
   */
  DROPDOWN: {
    kind: "special",
    minArgs: 2,
    maxArgs: 2,
    evaluate([choicesNode, cellNode], context): ControlValue {
      const { cell, value } = target(cellNode, context, "DROPDOWN");
      const options = choicesNode ? choices(evaluate(choicesNode, context)) : [];
      if (options.length === 0) fail("#VALUE!", "DROPDOWN needs at least one choice");
      return { kind: "control", control: "dropdown", target: cell, value, options, label: "" };
    },
  },

  /**
   * `TEXTBOX(cell, [label])` shows the cell's value in a text input. Committing
   * text writes it as text to the cell.
   */
  TEXTBOX: {
    kind: "special",
    minArgs: 1,
    maxArgs: 2,
    evaluate([cellNode, labelNode], context): ControlValue {
      const { cell, value } = target(cellNode, context, "TEXTBOX");
      const label = labelNode ? text(evaluate(labelNode, context)) : "";
      return { kind: "control", control: "textbox", target: cell, value, options: [], label };
    },
  },

  /**
   * `NUMBERBOX(cell, [label])` shows the cell's value in a number input.
   * Committing a number writes it to the cell.
   */
  NUMBERBOX: {
    kind: "special",
    minArgs: 1,
    maxArgs: 2,
    evaluate([cellNode, labelNode], context): ControlValue {
      const { cell, value } = target(cellNode, context, "NUMBERBOX");
      const label = labelNode ? text(evaluate(labelNode, context)) : "";
      return { kind: "control", control: "numberbox", target: cell, value, options: [], label };
    },
  },
};
