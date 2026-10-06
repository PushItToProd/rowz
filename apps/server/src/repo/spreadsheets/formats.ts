import {
  addFormatRule,
  criterionTest,
  type ConditionalRule,
  type FormatRule,
} from "@spreadsheet-app/engine";
import {
  MAX_CONDITIONAL_RULES,
  MAX_FORMAT_RULES,
  TableLayout,
  type IdentityConditionalRule,
  type IdentityFormatRange,
  type ResizeLinesBody,
} from "@spreadsheet-app/shared";
import { orderedRows, type Change } from "../journal";
import { ApiFailure, columnDeleted, rowDeleted, unprocessable } from "../../errors";
import { fail } from "./helpers";
import type { RepositoryContext } from "./context";

/** Sets or resets pixel sizes for existing row or column identities under the spreadsheet lock. */
export async function resizeLines(
  ctx: RepositoryContext,
  tableId: string,
  request: ResizeLinesBody,
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    const rows = request.axis === "row";
    const existing = new Set(
      rows ? (await orderedRows(tx, tableId)).map(({ id }) => id) : table.colIds,
    );
    for (const id of request.ids) {
      if (!existing.has(id)) {
        throw rows ? rowDeleted() : columnDeleted();
      }
    }
    const key = rows ? "rows" : "columns";
    const sizes = { ...table.gridSizes[key] };
    for (const id of request.ids) {
      if (request.size === null) Reflect.deleteProperty(sizes, id);
      else sizes[id] = request.size;
    }
    writer.setLabel(`Resize ${rows ? "rows" : "columns"} in ${table.name}`);
    await writer.updateTable(tableId, { gridSizes: { ...table.gridSizes, [key]: sizes } });
  });
  return change;
}

/**
 * Changes how a range of cells is shown. The format is added to whatever
 * the cells already have. The range names the rows and columns at its
 * corners by id, and a format rule holds their positions as they are now.
 */
export async function formatCells(
  ctx: RepositoryContext,
  tableId: string,
  range: IdentityFormatRange,
  format: FormatRule["format"],
  reset?: boolean,
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    const layout = new TableLayout(await orderedRows(tx, tableId), table.colIds);
    const row = (id: string): number => layout.rowIndex(id) ?? fail(rowDeleted());
    const col = (id: string): number => layout.colIndex(id) ?? fail(columnDeleted());
    const rule: FormatRule = {
      startRow: row(range.startRowId),
      endRow: range.endRowId === null ? null : row(range.endRowId),
      startCol: col(range.startColId),
      endCol: range.endColId === null ? null : col(range.endColId),
      format,
      ...(reset ? { reset } : {}),
    };
    if (
      (rule.endRow !== null && rule.endRow < rule.startRow) ||
      (rule.endCol !== null && rule.endCol < rule.startCol)
    ) {
      throw new ApiFailure(400, "invalid_request", "A range ends at or after where it starts");
    }
    writer.setLabel(`Format cells in ${table.name}`);
    const formats = addFormatRule(table.formats, rule);
    if (formats.length > MAX_FORMAT_RULES) {
      throw unprocessable(
        "too_many_formats",
        `${table.name} has too many separate formats. Clear the formatting of some cells first`,
      );
    }
    await writer.updateTable(tableId, { formats });
  });
  return change;
}

/**
 * Replaces the conditional formats of a table. Each rule names the rows and
 * columns at its corners by id, and a stored rule holds their positions as
 * they are now. A criterion is built once here, so that one that cannot be
 * built is refused on save and not shown as a rule that never applies.
 */
export async function setConditionalFormats(
  ctx: RepositoryContext,
  tableId: string,
  rules: IdentityConditionalRule[],
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    if (rules.length > MAX_CONDITIONAL_RULES) {
      throw unprocessable(
        "too_many_formats",
        `A table can have at most ${String(MAX_CONDITIONAL_RULES)} conditional formats`,
      );
    }
    const layout = new TableLayout(await orderedRows(tx, tableId), table.colIds);
    const row = (id: string): number => layout.rowIndex(id) ?? fail(rowDeleted());
    const col = (id: string): number => layout.colIndex(id) ?? fail(columnDeleted());
    const stored = rules.map(({ range, ...rest }): ConditionalRule => {
      const area = {
        startRow: row(range.startRowId),
        endRow: range.endRowId === null ? null : row(range.endRowId),
        startCol: col(range.startColId),
        endCol: range.endColId === null ? null : col(range.endColId),
      };
      if (
        (area.endRow !== null && area.endRow < area.startRow) ||
        (area.endCol !== null && area.endCol < area.startCol)
      ) {
        throw new ApiFailure(400, "invalid_request", "A range ends at or after where it starts");
      }
      if (rest.kind === "criterion" && criterionTest(rest.criterion) === undefined) {
        throw unprocessable("invalid_criterion", `${rest.criterion} is not a criterion`);
      }
      return { ...area, ...rest };
    });
    writer.setLabel(`Change the conditional formats of ${table.name}`);
    await writer.updateTable(tableId, { conditionalFormats: stored });
  });
  return change;
}
