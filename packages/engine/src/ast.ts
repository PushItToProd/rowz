import { columnLabel } from "./address";
import type { ErrorCode } from "./values";

export type BinaryOperator =
  "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";
export type UnaryOperator = "+" | "-";

/**
 * One corner of a reference. `$` markers are kept so a formula prints back as
 * written. A corner of a range may leave out its row or its column, which
 * leaves that side of the range open: `A:A` is all of column A, `2:3` is all
 * of rows 2 and 3, and `A2:A` runs from A2 to the bottom of the table.
 */
export interface ReferenceCell {
  /** `null` when the corner names only a column. */
  row: number | null;
  /** `null` when the corner names only a row. */
  col: number | null;
  rowAbsolute: boolean;
  colAbsolute: boolean;
}

/**
 * A cell or range reference as written in a formula. With no qualifier it
 * refers to the formula's own table. `Table!A1` names a table on the formula's
 * page. `Page!Table!A1` names a table on another page.
 */
export interface Reference {
  page?: string;
  table?: string;
  start: ReferenceCell;
  /** Present for ranges such as `A1:B2`. */
  end?: ReferenceCell;
}

export type Node =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "error"; code: ErrorCode }
  | { type: "reference"; reference: Reference }
  | { type: "unary"; operator: UnaryOperator; operand: Node }
  | { type: "binary"; operator: BinaryOperator; left: Node; right: Node }
  /** A word that is not a cell address: a name bound by `LET` or a parameter of `LAMBDA`. */
  | { type: "name"; name: string }
  /** A call by name: a built-in function, or a name bound to a function. */
  | { type: "call"; name: string; args: Node[] }
  /** A call of the function an expression evaluates to: `A1(5)`, `LAMBDA(x, x+1)(5)`. */
  | { type: "apply"; target: Node; args: Node[] };

function printReferenceCell(cell: ReferenceCell): string {
  const col = cell.col === null ? "" : `${cell.colAbsolute ? "$" : ""}${columnLabel(cell.col)}`;
  const row = cell.row === null ? "" : `${cell.rowAbsolute ? "$" : ""}${String(cell.row + 1)}`;
  return col + row;
}

const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Writes a page or table name for a reference, in single quotes unless it is a plain word. */
function quoteName(name: string): string {
  return BARE_NAME.test(name) ? name : `'${name.replaceAll("'", "''")}'`;
}

/** Writes a reference the way it is typed in a formula. */
export function formatReference(reference: Reference): string {
  const qualifiers = [reference.page, reference.table]
    .filter((name) => name !== undefined)
    .map((name) => `${quoteName(name)}!`)
    .join("");
  const end = reference.end ? `:${printReferenceCell(reference.end)}` : "";
  return qualifiers + printReferenceCell(reference.start) + end;
}

/**
 * Prints an AST as formula text (without the leading `=`). Every operator is
 * parenthesized, so parsing the output yields the same AST regardless of
 * precedence.
 */
export function printNode(node: Node): string {
  switch (node.type) {
    case "number":
      return String(node.value);
    case "string":
      return `"${node.value.replaceAll('"', '""')}"`;
    case "boolean":
      return node.value ? "TRUE" : "FALSE";
    case "error":
      return node.code;
    case "reference":
      return formatReference(node.reference);
    case "unary":
      return `(${node.operator}${printNode(node.operand)})`;
    case "binary":
      return `(${printNode(node.left)}${node.operator}${printNode(node.right)})`;
    case "name":
      return node.name;
    case "call":
      return `${node.name}(${node.args.map(printNode).join(",")})`;
    case "apply": {
      // A word directly before `(` would be read as a call by name, so it gets parentheses.
      const bare = node.target.type === "name" || node.target.type === "boolean";
      const target = bare ? `(${printNode(node.target)})` : printNode(node.target);
      return `${target}(${node.args.map(printNode).join(",")})`;
    }
  }
}
