import { cellKey } from "./address";
import { formatReference, isColumnReference, type Reference, type ReferenceCell } from "./ast";
import { parseFormulaWithReferences, type LocatedReference } from "./parser";
import { FormulaSyntaxError } from "./tokenizer";
import { isFormulaInput } from "./values";
import {
  sameColumnName,
  TableResolver,
  type StoredInput,
  type TableDefinition,
  type WorkbookData,
} from "./structure";

/** What to write in place of a reference: a new reference, or `#REF!` when its target is gone. */
export type Replacement = Reference | "#REF!";

/**
 * Rewrites the references in a cell input and leaves every other character
 * as the user typed it. `replace` returns the new reference, or `undefined`
 * to keep the one written. An input that is not a formula, or that does not
 * parse, is returned unchanged.
 */
export function rewriteReferences(
  input: string,
  replace: (reference: Reference) => Replacement | undefined,
): string {
  if (!isFormulaInput(input)) return input;
  let text = input.slice(1);
  let references: LocatedReference[];
  try {
    ({ references } = parseFormulaWithReferences(text));
  } catch (cause) {
    if (cause instanceof FormulaSyntaxError) return input;
    throw cause;
  }

  // Last to first, so earlier offsets stay valid while later text changes length.
  for (const { reference, from, to } of references.toReversed()) {
    const replacement = replace(reference);
    if (replacement === undefined) continue;
    const written = replacement === "#REF!" ? replacement : formatReference(replacement);
    text = text.slice(0, from) + written + text.slice(to);
  }
  return `=${text}`;
}

/**
 * Rewrites a cell input for a cell some rows and columns away from where it
 * was written, the way copying or filling a formula does. Each part of a
 * reference moves by the same distance unless a `$` pins it. A reference
 * pushed past the first row or column becomes `#REF!`.
 */
export function translateInput(input: string, rows: number, cols: number): string {
  if (rows === 0 && cols === 0) return input;
  const move = (cell: ReferenceCell): ReferenceCell | undefined => {
    const row = cell.row === null || cell.rowAbsolute ? cell.row : cell.row + rows;
    const col = cell.col === null || cell.colAbsolute ? cell.col : cell.col + cols;
    return (row ?? 0) < 0 || (col ?? 0) < 0 ? undefined : { ...cell, row, col };
  };
  return rewriteReferences(input, (reference) => {
    // A column reference names its column, wherever the formula is.
    if (isColumnReference(reference)) return undefined;
    const start = move(reference.start);
    const end = reference.end ? move(reference.end) : undefined;
    if (!start || (reference.end && !end)) return "#REF!";
    return end ? { ...reference, start, end } : { ...reference, start };
  });
}

export type Rename =
  | { kind: "page"; pageId: string; name: string }
  | { kind: "table"; tableId: string; name: string }
  /** A column of a data table, named `from` before the rename. */
  | { kind: "column"; tableId: string; from: string; name: string };

/**
 * Decides how a reference must be rewritten, given the table it means where
 * it is written. `undefined` leaves the reference as it is.
 */
export type Decide = (
  reference: Reference,
  target: TableDefinition | undefined,
) => Replacement | undefined;

/** The rewrite a rename asks for: the new name in place of the old, wherever the old one is written. */
export function renameDecider(resolver: TableResolver, rename: Rename): Decide {
  return (reference, target) => {
    if (rename.kind === "page") {
      // The page qualifier is rewritten even when the table it names does not exist.
      return reference.page !== undefined && resolver.isPage(reference.page, rename.pageId)
        ? { ...reference, page: rename.name }
        : undefined;
    }
    if (rename.kind === "column") {
      return isColumnReference(reference) &&
        target?.id === rename.tableId &&
        sameColumnName(reference.column, rename.from)
        ? { ...reference, column: rename.name }
        : undefined;
    }
    // A reference with no table name follows its formula's table and needs no rewrite.
    return reference.table !== undefined && target?.id === rename.tableId
      ? { ...reference, table: rename.name }
      : undefined;
  };
}

/**
 * The cells whose formulas name a page or table that is being renamed, with
 * the new name written in. `data` is the workbook before the rename.
 */
export function inputsAfterRename(data: WorkbookData, rename: Rename): StoredInput[] {
  const resolver = new TableResolver(data);
  const decide = renameDecider(resolver, rename);
  return data.cells.flatMap(({ input, ...cell }) => {
    const rewritten = rewriteReferences(input, (reference) =>
      decide(reference, resolver.find(reference, cell.tableId)),
    );
    return rewritten === input ? [] : [{ ...cell, input: rewritten }];
  });
}

/** Inserting or deleting one row or column of a table. */
export interface StructuralEdit {
  tableId: string;
  axis: "row" | "col";
  kind: "insert" | "delete";
  /** For an insert, the new row or column takes this index and those from here on move by one. */
  index: number;
}

/** Where a row or column index ends up after the edit, or `undefined` if it is deleted. */
function moveIndex(index: number, edit: StructuralEdit): number | undefined {
  if (edit.kind === "insert") return index >= edit.index ? index + 1 : index;
  if (index === edit.index) return undefined;
  return index > edit.index ? index - 1 : index;
}

/**
 * Where the two ends of a range end up along the edited axis. `null` is an
 * open side. A range keeps covering the rows or columns it covered: it shrinks
 * when one inside it is deleted, grows when one is inserted inside it, and
 * becomes `undefined` when the only one it covered is deleted.
 */
function moveSpan(
  start: number | null,
  end: number | null,
  edit: StructuralEdit,
): [start: number | null, end: number | null] | undefined {
  if (start === null && end === null) return [start, end];
  const first = start === null ? 0 : end === null ? start : Math.min(start, end);
  const last = end === null ? Infinity : start === null ? end : Math.max(start, end);

  let [newFirst, newLast] = [first, last];
  if (edit.kind === "insert") {
    if (first >= edit.index) newFirst += 1;
    if (last >= edit.index) newLast += 1;
  } else {
    if (first === last && first === edit.index) return undefined;
    if (first > edit.index) newFirst -= 1;
    if (last >= edit.index) newLast -= 1;
  }

  // Write the new ends back to whichever corner held them, keeping open sides open.
  if (start === null) return [null, newLast];
  if (end === null) return [newFirst, null];
  return start <= end ? [newFirst, newLast] : [newLast, newFirst];
}

/** How a reference into the edited table must be written after the edit. */
function moveReference(reference: Reference, edit: StructuralEdit): Replacement | undefined {
  // A column reference follows its column by name, and a deleted column's name is simply gone.
  if (isColumnReference(reference)) return undefined;
  const { axis } = edit;
  const withAxis = (cell: ReferenceCell, value: number | null): ReferenceCell => ({
    ...cell,
    [axis]: value,
  });

  const { start, end } = reference;
  if (!end) {
    const index = start[axis];
    if (index === null) return undefined;
    const moved = moveIndex(index, edit);
    if (moved === undefined) return "#REF!";
    return moved === index ? undefined : { ...reference, start: withAxis(start, moved) };
  }

  const moved = moveSpan(start[axis], end[axis], edit);
  if (!moved) return "#REF!";
  if (moved[0] === start[axis] && moved[1] === end[axis]) return undefined;
  return { ...reference, start: withAxis(start, moved[0]), end: withAxis(end, moved[1]) };
}

/** The rewrite a row or column edit asks for: references into the edited table follow their cells. */
export function editDecider(edit: StructuralEdit): Decide {
  return (reference, target) =>
    target?.id === edit.tableId ? moveReference(reference, edit) : undefined;
}

/**
 * The cell writes that carry out inserting or deleting a row or column: cells
 * past the edit move by one, and formulas anywhere in the workbook that read
 * the table are rewritten to keep reading the same cells. A reference to a
 * deleted cell becomes `#REF!`. An empty input in the result clears that cell.
 * `data` is the workbook before the edit.
 */
export function inputsAfterEdit(data: WorkbookData, edit: StructuralEdit): StoredInput[] {
  const resolver = new TableResolver(data);
  const decide = editDecider(edit);
  const before = new Map(data.cells.map((cell) => [cellKey(cell), cell.input]));
  const after = new Map<string, StoredInput>();

  for (const cell of data.cells) {
    const input = rewriteReferences(cell.input, (reference) =>
      decide(reference, resolver.find(reference, cell.tableId)),
    );
    if (cell.tableId !== edit.tableId) {
      after.set(cellKey(cell), { ...cell, input });
      continue;
    }
    const moved = moveIndex(cell[edit.axis], edit);
    if (moved === undefined) continue;
    const target = { ...cell, [edit.axis]: moved, input };
    after.set(cellKey(target), target);
  }

  const written = [...after.values()].filter((cell) => before.get(cellKey(cell)) !== cell.input);
  const cleared = data.cells
    .filter((cell) => !after.has(cellKey(cell)))
    .map(({ tableId, row, col }) => ({ tableId, row, col, input: "" }));
  return [...written, ...cleared];
}
