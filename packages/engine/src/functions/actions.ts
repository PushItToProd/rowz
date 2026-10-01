import type { Node } from "../ast";
import type { Effect } from "../effects";
import { isAction, isError, literalInput, type Evaluated } from "../values";
import { fail, grid, lazy, scalar, text } from "./arguments";
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
      if (target?.type !== "reference" || target.reference.end) {
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
