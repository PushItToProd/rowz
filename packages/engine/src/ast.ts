import { columnLabel } from "./address";

export type BinaryOperator =
  "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";
export type UnaryOperator = "+" | "-";

/** One corner of a reference. `$` markers are kept so a formula prints back as written. */
export interface ReferenceCell {
  row: number;
  col: number;
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
  | { type: "reference"; reference: Reference }
  | { type: "unary"; operator: UnaryOperator; operand: Node }
  | { type: "binary"; operator: BinaryOperator; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] };

function printReferenceCell(cell: ReferenceCell): string {
  const col = `${cell.colAbsolute ? "$" : ""}${columnLabel(cell.col)}`;
  const row = `${cell.rowAbsolute ? "$" : ""}${String(cell.row + 1)}`;
  return col + row;
}

function quoteName(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

function printReference(reference: Reference): string {
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
    case "reference":
      return printReference(node.reference);
    case "unary":
      return `(${node.operator}${printNode(node.operand)})`;
    case "binary":
      return `(${printNode(node.left)}${node.operator}${printNode(node.right)})`;
    case "call":
      return `${node.name}(${node.args.map(printNode).join(",")})`;
  }
}
