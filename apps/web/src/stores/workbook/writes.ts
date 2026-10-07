import { isFormulaInput, type CellAddress, type CellId } from "@spreadsheet-app/engine";
import {
  LIMITS,
  type CellInput,
  type IdentifiedCell,
  type IdentityCellInput,
} from "@spreadsheet-app/shared";
import { api, type Change } from "../../api/client";
import { closeOpenFormulaParentheses } from "../../formula/commit";
import { type EditingTarget } from "../../formula/session";
import type { WorkbookContext } from "./context";
type CellChange = IdentityCellInput;

export function createWrites(context: WorkbookContext) {
  async function setIdentifiedCell(
    id: IdentifiedCell,
    input: string,
    writtenAt = context.revision.value,
  ): Promise<void> {
    const position = context.positionOf(id);
    if (!position) {
      context.notice.value = {
        kind: "error",
        text: "The row or column being edited was deleted. Your text was not saved.",
      };
      return;
    }
    await setCell(position, input, writtenAt);
  }

  /** Saves a draft to its current target, without a starting-revision restriction. */
  function submitFormulaDraft(target: EditingTarget, text: string): Promise<"saved" | "deleted"> {
    const committedText =
      target.kind === "script" || target.kind === "markdown"
        ? text
        : closeOpenFormulaParentheses(text);
    return context.enqueueWrite(async () => {
      if (!context.canEdit.value) throw new Error("You cannot edit this document");
      const table =
        "tableId" in target
          ? context.tables.value.find((item) => item.id === target.tableId)
          : undefined;
      if ("tableId" in target && !table) return "deleted";
      try {
        let change: Change;
        switch (target.kind) {
          case "cell": {
            const position = context.positionOf(target);
            if (!position) return "deleted";
            if (committedText === context.inputOf(position)) return "saved";
            change = await api.setCells(
              target.tableId,
              [{ rowId: target.rowId, colId: target.colId, input: committedText }],
              crypto.randomUUID(),
              context.revision.value,
              [],
            );
            break;
          }
          case "append": {
            if (!table?.colIds.includes(target.colId)) return "deleted";
            if (committedText === "") return "saved";
            const rowId = target.rowId ?? crypto.randomUUID();
            const existing = table.rows.some((row) => row.id === rowId);
            change = await api.setCells(
              table.id,
              [{ rowId, colId: target.colId, input: committedText }],
              crypto.randomUUID(),
              context.revision.value,
              existing ? [] : [rowId],
            );
            break;
          }
          case "column":
            if (!table?.columns?.[table.colIds.indexOf(target.colId)]) return "deleted";
            change = await api.updateColumn(target.tableId, target.colId, {
              formula: committedText,
              type: "formula",
            });
            break;
          case "name": {
            change = await api.updateNamedFormula(target.tableId, target.name, committedText);
            break;
          }
          case "filter":
            if (!table) return "deleted";
            change = await api.setTableDisplay(target.tableId, {
              ...table.display,
              filter: committedText,
            });
            break;
          case "script":
          case "markdown":
          case "chart":
            {
              const view = context.views.value.find((item) => item.id === target.viewId);
              if (!view) return "deleted";
              if (committedText === view.source) return "saved";
            }
            change = await api.updateView(target.viewId, { source: committedText });
            break;
        }
        await context.receiveChange(change);
        return "saved";
      } catch (cause) {
        if (
          cause instanceof Error &&
          "code" in cause &&
          ["not_found", "row_deleted", "column_deleted"].includes(String(cause.code))
        )
          return "deleted";
        throw cause;
      }
    }, true);
  }

  /**
   * Shows the new input at once and saves it. A failed save puts the old
   * input back. What is typed into a cell of a formula column becomes the
   * formula of the whole column.
   */
  async function setCell(
    id: CellId,
    input: string,
    writtenAt = context.revision.value,
  ): Promise<void> {
    if (context.columnOf(id)?.type !== "formula") {
      return writeCells(id, [{ row: id.row, col: id.col, input }], writtenAt);
    }
    if (input.trim() === "" || input === context.engine.value.getInput(id)) return;
    if (!isFormulaInput(input)) {
      // A stray keystroke must not replace the formula of a whole column.
      const name = context.columnOf(id)?.name ?? "This";
      context.notice.value = {
        kind: "error",
        text: `${name} is a formula column. Type a formula starting with = to change it for every row`,
      };
      return;
    }
    const identity = context.identityOf(id);
    if (
      !(await context.updateColumn(id.tableId, id.col, { formula: input }, writtenAt)) &&
      identity
    ) {
      context.rejectedDraft.value = { id: identity, input, revision: writtenAt };
    }
  }

  function showInputs(tableId: string, writes: readonly CellInput[]): CellChange[] {
    return writes
      .filter((write) => context.columnOf({ tableId, ...write })?.type !== "formula")
      .flatMap((write) => {
        const identity = context.identityOf({ tableId, ...write });
        if (!identity) throw new Error("The row or column being edited no longer exists");
        return context.engine.value.getInput({ tableId, ...write }) === write.input
          ? []
          : [{ rowId: identity.rowId, colId: identity.colId, input: write.input }];
      });
  }

  function setCells(tableId: string, writes: readonly CellInput[]): Promise<void> {
    return writeCells({ tableId, row: 0, col: 0 }, writes);
  }

  async function saveCellChanges(
    pending: { tableId: string; changes: CellChange[] },
    stepId: string,
    writtenAt: number,
    appendRows: string[],
  ): Promise<void> {
    const written = pending.changes.map((cell) => ({ tableId: pending.tableId, ...cell }));
    try {
      do {
        const batch = pending.changes.slice(0, LIMITS.cellsPerRequest);
        const change = await api.setCells(pending.tableId, batch, stepId, writtenAt, appendRows);
        pending.changes.splice(0, batch.length);
        await context.receiveChange(change);
        appendRows = [];
      } while (pending.changes.length > 0);
    } catch (cause) {
      context.failedSaves += 1;
      context.fail(cause, "The change could not be saved");
    } finally {
      context.unsavedChanges.delete(pending);
      context.pendingRows.delete(stepId);
      context.withStableSelection(() => {
        if (appendRows.length) context.syncStructure();
        else context.syncCells(written);
      });
    }
  }

  /**
   * Writes cells into a table that grows to fit them, up to its size limit,
   * and selects what was written, up to the stored cell `selectTo` when it is
   * given and otherwise the last row and column written.
   */
  async function writeCells(
    at: CellId,
    writes: readonly CellInput[],
    writtenAt = context.revision.value,
    selectWritten = false,
    selectTo?: CellAddress,
  ): Promise<void> {
    const table = context.tables.value.find((candidate) => candidate.id === at.tableId);
    if (!table || writes.length === 0) return;
    const rowCount = Math.min(LIMITS.tableRows, Math.max(...writes.map((write) => write.row + 1)));
    const colCount = Math.min(LIMITS.tableCols, Math.max(...writes.map((write) => write.col + 1)));
    const fitting = writes.filter((write) => write.row < rowCount && write.col < colCount);
    const selectionAnchor =
      selectWritten && context.selection.value
        ? context.identityOf(context.selection.value)
        : undefined;
    const stepId = crypto.randomUUID();
    const appendRows = Array.from({ length: Math.max(0, rowCount - table.rowCount) }, () =>
      crypto.randomUUID(),
    );
    context.pendingRows.set(stepId, { tableId: table.id, ids: appendRows });
    if (appendRows.length) context.syncStructure();
    // Capture every existing row before a queued structural edit can move it.
    const rowIds = [...table.rows.map((row) => row.id), ...appendRows];
    const pending = {
      tableId: table.id,
      changes: showInputs(
        table.id,
        fitting.filter((write) => write.col < table.colCount),
      ),
    };
    if (!pending.changes.length && !appendRows.length && colCount <= table.colCount) {
      context.pendingRows.delete(stepId);
      return;
    }
    context.unsavedChanges.add(pending);
    context.syncCells(pending.changes.map((cell) => ({ tableId: table.id, ...cell })));
    const selectEnd = selectTo ?? { row: rowCount - 1, col: colCount - 1 };
    if (selectWritten) context.extendSelection(selectEnd);
    context.saves = context.enqueueWrite(async () => {
      try {
        const current = context.tables.value.find((candidate) => candidate.id === table.id);
        if (!current) throw new Error("The table was deleted");
        if (colCount > current.colCount) {
          const change = await api.updateTable(table.id, { colCount }, stepId);
          const grown = change.changed?.tables.find((record) => record.id === table.id)?.table;
          await context.receiveChange(change);
          if (!grown) throw new Error("The resized table was not returned");
          // Extending immediately can point into a column that does not have an
          // identity yet. Restore that endpoint after growth only if the user
          // still has the selection that this paste started from.
          const currentAnchor =
            context.selection.value && context.identityOf(context.selection.value);
          if (
            selectionAnchor &&
            currentAnchor &&
            context.cellIdentityKey(selectionAnchor) === context.cellIdentityKey(currentAnchor)
          ) {
            context.extendSelection(selectEnd);
          }
        }
        // A queued paste may have grown the table before this one ran. Use
        // the current identities for columns that had no id when this paste
        // was queued, including columns the earlier paste just created.
        const currentColumns = context.tables.value.find(
          (candidate) => candidate.id === table.id,
        )?.colIds;
        if (!currentColumns) throw new Error("The table was deleted");
        for (const write of fitting.filter((write) => write.col >= table.colCount)) {
          const rowId = rowIds[write.row];
          const colId = currentColumns[write.col];
          if (!rowId || !colId) throw new Error("The row or column being edited no longer exists");
          pending.changes.push({ rowId, colId, input: write.input });
        }
        await saveCellChanges(pending, stepId, writtenAt, appendRows);
        if (fitting.length < writes.length)
          context.notice.value = { kind: "error", text: "Some cells did not fit in the table" };
      } catch (cause) {
        context.unsavedChanges.delete(pending);
        context.pendingRows.delete(stepId);
        if (appendRows.length) context.syncStructure();
        else context.syncCells(pending.changes.map((cell) => ({ tableId: table.id, ...cell })));
        context.failedSaves += 1;
        context.fail(cause, "The change could not be saved");
      }
    });
    await context.saves;
  }

  function appendCell(
    tableId: string,
    colId: string,
    input: string,
    writtenAt = context.revision.value,
  ): Promise<void> {
    const table = context.tables.value.find((table) => table.id === tableId);
    const col = table?.colIds.indexOf(colId) ?? -1;
    if (!table || col < 0) {
      context.fail(
        new Error("The column being edited was deleted. Your text was not saved."),
        "The cell could not be saved",
      );
      return Promise.resolve();
    }
    if (input === "") return Promise.resolve();
    return setCell({ tableId, row: table.rowCount, col }, input, writtenAt);
  }
  return { setIdentifiedCell, submitFormulaDraft, setCell, setCells, writeCells, appendCell };
}
