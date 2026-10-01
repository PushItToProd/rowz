import type { Node } from "../ast";
import type { Effect } from "../effects";
import {
  error,
  isAction,
  isError,
  literalInput,
  toText,
  type ErrorValue,
  type Evaluated,
  type Scalar,
} from "../values";
import { asScalar } from "./arguments";
import type { FunctionDefinition, PlanContext } from "./registry";

const ADDRESS_SEPARATOR = /[,;]/;
// A loose check that catches blanks and obvious typos. The mail server is the real validator.
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function scalarArgument(node: Node | undefined, context: PlanContext): Scalar | ErrorValue {
  return node ? asScalar(context.evaluate(node)) : null;
}

function textArgument(node: Node | undefined, context: PlanContext): string | ErrorValue {
  const value = scalarArgument(node, context);
  return isError(value) ? value : toText(value);
}

/** Reads a comma- or semicolon-separated list of email addresses. */
function addressList(node: Node | undefined, context: PlanContext): string[] | ErrorValue {
  const text = textArgument(node, context);
  if (isError(text)) return text;
  const addresses = text
    .split(ADDRESS_SEPARATOR)
    .map((address) => address.trim())
    .filter((address) => address !== "");
  const invalid = addresses.find((address) => !EMAIL_ADDRESS.test(address));
  if (invalid !== undefined) return error("#VALUE!", `"${invalid}" is not an email address`);
  return addresses;
}

export const actionFunctions: Record<string, FunctionDefinition> = {
  /** `BUTTON(label, action)` shows a button that runs the action when clicked. */
  BUTTON: {
    kind: "pure",
    minArgs: 2,
    maxArgs: 2,
    call([label, action]): Evaluated {
      const labelValue = asScalar(label?.() ?? null);
      if (isError(labelValue)) return labelValue;
      const actionValue = action?.() ?? null;
      if (isError(actionValue)) return actionValue;
      if (!isAction(actionValue)) {
        return error("#VALUE!", "BUTTON needs an action such as EXECUTE or SEND_EMAIL");
      }
      return { kind: "button", label: toText(labelValue), action: actionValue };
    },
  },

  /** `EXECUTE(expression, target)` writes the value of the expression into the target cell. */
  EXECUTE: {
    kind: "action",
    minArgs: 2,
    maxArgs: 2,
    plan([expression, target], context): Effect[] | ErrorValue {
      if (target?.type !== "reference" || target.reference.end) {
        return error("#VALUE!", "EXECUTE needs a single cell to write to");
      }
      const cell = context.resolve(target.reference);
      if (!cell) return error("#REF!", "The cell to write to does not exist");
      const value = scalarArgument(expression, context);
      if (isError(value)) return value;
      return [
        {
          type: "setCell",
          tableId: cell.tableId,
          row: cell.startRow,
          col: cell.startCol,
          input: literalInput(value),
        },
      ];
    },
  },

  /** `SEND_EMAIL(to, subject, body, [cc])`. `to` and `cc` take addresses separated by commas or semicolons. */
  SEND_EMAIL: {
    kind: "action",
    minArgs: 3,
    maxArgs: 4,
    plan([toNode, subjectNode, bodyNode, ccNode], context): Effect[] | ErrorValue {
      const to = addressList(toNode, context);
      if (isError(to)) return to;
      if (to.length === 0) return error("#VALUE!", "SEND_EMAIL needs a recipient");
      const subject = textArgument(subjectNode, context);
      if (isError(subject)) return subject;
      const body = textArgument(bodyNode, context);
      if (isError(body)) return body;
      const cc = addressList(ccNode, context);
      if (isError(cc)) return cc;
      return [{ type: "sendEmail", to, cc, subject, body }];
    },
  },
};
