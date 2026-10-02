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
export interface CellReference {
  page?: string;
  table?: string;
  start: ReferenceCell;
  /** Present for ranges such as `A1:B2`. */
  end?: ReferenceCell;
}

/**
 * A reference to a named column of a table. `[Price]` is the cell of that
 * column in the formula's own row and table. `Sales[Price]` is every cell of
 * the column in the table named Sales, and `Page!Sales[Price]` names a table
 * on another page.
 */
export interface ColumnReference {
  page?: string;
  table?: string;
  column: string;
}

export type Reference = CellReference | ColumnReference;

export function isColumnReference(reference: Reference): reference is ColumnReference {
  return "column" in reference;
}

/** Whether a reference names exactly one cell: `A1`, or `[Price]` for the formula's own row. */
export function isSingleCell(reference: Reference): boolean {
  return isColumnReference(reference) ? reference.table === undefined : !reference.end;
}

export type Node =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "error"; code: ErrorCode }
  | { type: "reference"; reference: Reference }
  | { type: "unary"; operator: UnaryOperator; operand: Node }
  | { type: "binary"; operator: BinaryOperator; left: Node; right: Node }
  /**
   * A word that is not a cell address: a name bound by `LET`, a parameter of
   * `LAMBDA`, or a name the document defines.
   */
  | { type: "name"; name: string }
  /**
   * A name written with the table or script that holds it: `Summary!Total`,
   * or `Page!Summary!Total` when that is on another page.
   */
  | { type: "qualified"; page?: string; holder: string; name: string }
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

/** Writes a page, table, or other name as it is typed in a formula, in single quotes unless it is a plain word. */
export function quoteName(name: string): string {
  return BARE_NAME.test(name) ? name : `'${name.replaceAll("'", "''")}'`;
}

/** Writes a reference the way it is typed in a formula. */
export function formatReference(reference: Reference): string {
  if (isColumnReference(reference)) {
    const page = reference.page === undefined ? "" : `${quoteName(reference.page)}!`;
    const table = reference.table === undefined ? "" : quoteName(reference.table);
    return `${page}${table}[${reference.column}]`;
  }
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
      return quoteName(node.name);
    case "qualified":
      return [node.page, node.holder, node.name]
        .filter((part) => part !== undefined)
        .map(quoteName)
        .join("!");
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
