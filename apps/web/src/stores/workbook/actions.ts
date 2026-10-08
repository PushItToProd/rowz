import {
  formatAddress,
  formatDate,
  isDate,
  type CellId,
  type Scalar,
} from "@spreadsheet-app/engine";
import { type ViewInputBody } from "@spreadsheet-app/shared";
import { api, type ClickResult } from "../../api/client";
import { useFormulaSessionStore, type EditingTarget } from "../../formula/session";
import type { Notice } from "../workbook";
import type { WorkbookContext } from "./context";
const MAX_NAMED_CELLS = 3;

export function createActions(context: WorkbookContext) {
  /** Names a written cell, with its table when that is not the table the button is in. */
  function nameOf(cell: CellId, buttonTableId?: string): string {
    const address = formatAddress(cell);
    if (buttonTableId !== undefined && cell.tableId === buttonTableId) return address;
    const table = context.tables.value.find((candidate) => candidate.id === cell.tableId);
    return table ? `${table.name}!${address}` : address;
  }

  function tableLabel(tableId: string): string {
    const table = context.tables.value.find((candidate) => candidate.id === tableId);
    if (!table) return "the deleted table";
    const page = context.pages.value.find((candidate) => candidate.id === table.pageId);
    return page ? `${table.name} on ${page.name}` : table.name;
  }

  function cellLabel(cell: CellId): string {
    const table = context.tables.value.find((candidate) => candidate.id === cell.tableId);
    const page = table && context.pages.value.find((candidate) => candidate.id === table.pageId);
    const prefix = page ? `${page.name} · ` : "";
    return `${prefix}${table?.name ?? "table"}!${formatAddress(cell)}`;
  }

  function pendingCellNames(): string[] {
    return [
      ...new Set(
        [...context.unsavedChanges].flatMap(({ tableId, changes }) =>
          changes.flatMap((change) => {
            const position = context.positionOf({
              tableId,
              rowId: change.rowId,
              colId: change.colId,
            });
            return position ? [cellLabel(position)] : [];
          }),
        ),
      ),
    ];
  }

  function draftDescription(target: EditingTarget): string {
    if (target.kind === "cell") {
      const position = context.positionOf(target);
      return position
        ? `the draft for ${cellLabel(position)}`
        : `the draft for a cell in ${tableLabel(target.tableId)}`;
    }
    if (target.kind === "append") return `the new cell in ${tableLabel(target.tableId)}`;
    if (target.kind === "column") {
      const table = context.tables.value.find((candidate) => candidate.id === target.tableId);
      const column = table?.columns?.[table.colIds.indexOf(target.colId)];
      if (!column) return `the formula column in ${tableLabel(target.tableId)}`;
      const page = context.pages.value.find((candidate) => candidate.id === table.pageId);
      return `the formula for ${table.name}[${column.name}]${page ? ` on ${page.name}` : ""}`;
    }
    if (target.kind === "filter") return `the filter for ${tableLabel(target.tableId)}`;
    if (target.kind === "name")
      return `the formula for ${target.name} in ${tableLabel(target.tableId)}`;

    const view = context.views.value.find((candidate) => candidate.id === target.viewId);
    const page = view && context.pages.value.find((candidate) => candidate.id === view.pageId);
    const place = view && page ? `${view.name} on ${page.name}` : "the view source";
    switch (target.kind) {
      case "chart":
        return `the chart data for ${place}`;
      case "script":
        return `the script for ${place}`;
      case "markdown":
        return `the text view for ${place}`;
    }
  }

  function actionBlockedByDraft(
    subject: string,
    target: EditingTarget,
    detail: string | undefined,
  ): Notice {
    const isInput = subject.startsWith("input ");
    const retry = isInput
      ? "Fix the draft error and try again."
      : "Resolve the draft error and try the action again.";
    return {
      kind: "error",
      text: `The ${subject} could not be ${isInput ? "saved" : "run"} because ${draftDescription(target)} could not be saved. ${retry}`,
      ...(detail ? { detail } : {}),
    };
  }

  function actionBlockedBySave(subject: string, names: readonly string[]): Notice {
    const isInput = subject.startsWith("input ");
    const cause = context.notice.value?.kind === "error" ? context.notice.value.text : undefined;
    const namedCells = names.slice(0, 3);
    const more = names.length - namedCells.length;
    const location = namedCells.length
      ? `${namedCells.join(", ")}${more > 0 ? `, and ${String(more)} more` : ""}`
      : undefined;
    const reason = location
      ? names.length === 1
        ? `the change to ${location} could not be saved`
        : `at least one pending change to ${location} could not be saved`
      : "a pending change could not be saved";
    return {
      kind: "error",
      text: `The ${subject} could not be ${isInput ? "saved" : "run"} because ${reason}. ${isInput ? "Fix the save error and try again." : "Fix the save error and try the action again."}`,
      ...(cause ? { detail: cause } : {}),
    };
  }

  function describe(result: ClickResult, buttonTableId?: string): Notice {
    if (result.status === "failed") {
      return { kind: "error", text: result.error ?? "The action failed" };
    }
    if (result.emailsSent > 0) return { kind: "success", text: "Email sent" };
    const cells = result.change?.changed?.cells ?? [];
    if (cells.length === 0) return { kind: "success", text: "Done" };
    if (cells.length > MAX_NAMED_CELLS) {
      return { kind: "success", text: `Updated ${String(cells.length)} cells` };
    }
    const written = cells
      .flatMap((cell) => {
        const position = context.positionOf(cell);
        return position ? [nameOf(position, buttonTableId)] : [];
      })
      .join(", ");
    return { kind: "success", text: `Updated ${written}` };
  }

  /**
   * Sends a request that makes the server run what a cell asks for, then
   * shows the tables it resized and the cells it wrote.
   */
  async function run(
    id: CellId,
    request: () => Promise<ClickResult>,
    subject = `button at ${cellLabel(id)}`,
  ): Promise<ClickResult | undefined> {
    const identity = context.identityOf(id);
    if (!identity) return undefined;
    return runRequest(context.cellIdentityKey(identity), request, subject);
  }

  async function runRequest(
    key: string,
    request: () => Promise<ClickResult>,
    subject: string,
  ): Promise<ClickResult | undefined> {
    if (context.running.has(key) || !context.canEdit.value) return undefined;
    context.running.add(key);
    const queuedSaves = context.saves;
    const failedBefore = context.failedSaves;
    const pendingNames = pendingCellNames();
    const previousNotice = context.notice.value;
    const draft = useFormulaSessionStore().active;
    try {
      const result = await context.enqueueWrite(
        async () => {
          // The server evaluates stored inputs, so pending edits must be stored first. When one
          // could not be, the action would run on something other than what was typed.
          if (!(await context.stored(queuedSaves, failedBefore))) {
            context.notice.value = actionBlockedBySave(subject, pendingNames);
            return undefined;
          }
          const result = await request();
          if (result.change) await context.receiveChange(result.change);
          return result;
        },
        false,
        false,
      );
      if (
        result?.status === "succeeded" &&
        previousNotice?.kind === "error" &&
        context.notice.value === previousNotice
      )
        context.notice.value = null;
      return result;
    } catch (cause) {
      const failedDraft = useFormulaSessionStore().active;
      if (draft && failedDraft?.error) {
        context.notice.value = actionBlockedByDraft(subject, draft.target, failedDraft.error);
      } else {
        context.fail(cause, "The action could not be run");
      }
      return undefined;
    } finally {
      context.running.delete(key);
    }
  }

  /** Asks the server to run the button in a cell. */
  async function click(id: CellId): Promise<void> {
    const identity = context.identityOf(id);
    if (!identity) return;
    const result = await run(id, () => api.click(identity), `button at ${cellLabel(id)}`);
    if (result) context.notice.value = describe(result, id.tableId);
  }

  /** Runs one BUTTON occurrence from a text view on the server. */
  async function clickViewButton(viewId: string, occurrence: number): Promise<void> {
    const view = context.views.value.find((candidate) => candidate.id === viewId);
    if (view?.kind !== "text") return;
    const page = context.pages.value.find((candidate) => candidate.id === view.pageId);
    const subject = `button in ${view.name}${page ? ` on ${page.name}` : ""}`;
    const result = await runRequest(
      `view:${viewId}:${String(occurrence)}`,
      () => api.clickViewButton(viewId, occurrence),
      subject,
    );
    if (result) context.notice.value = describe(result);
  }

  /** Stores a value chosen through one input occurrence in a text view. */
  async function inputViewControl(
    viewId: string,
    occurrence: number,
    input: ViewInputBody,
  ): Promise<ClickResult | undefined> {
    const view = context.views.value.find((candidate) => candidate.id === viewId);
    const page = view && context.pages.value.find((candidate) => candidate.id === view.pageId);
    const subject = `input in ${view?.name ?? viewId}${page ? ` on ${page.name}` : ""}`;
    const result = await runRequest(
      `view-input:${viewId}:${String(occurrence)}`,
      () => api.inputViewControl(viewId, occurrence, input),
      subject,
    );
    if (result?.status === "failed") context.notice.value = describe(result);
    return result;
  }

  function isViewButtonRunning(viewId: string, occurrence: number): boolean {
    return context.running.has(`view:${viewId}:${String(occurrence)}`);
  }

  function isViewInputRunning(viewId: string, occurrence: number): boolean {
    return context.running.has(`view-input:${viewId}:${String(occurrence)}`);
  }

  /** Stores a value sent through a cell input control. Success is silent. */
  async function input(id: CellId, value: Scalar): Promise<void> {
    // JSON has no date, so a chosen date travels as its text and the server reads it back.
    const sent = isDate(value) ? formatDate(value) : value;
    const identity = context.identityOf(id);
    if (!identity) return;
    const result = await run(id, () => api.input(identity, sent), `input at ${cellLabel(id)}`);
    if (result?.status === "failed") context.notice.value = describe(result, id.tableId);
  }

  function isRunning(id: CellId): boolean {
    const identity = context.identityOf(id);
    return !!identity && context.running.has(context.cellIdentityKey(identity));
  }
  return {
    click,
    clickViewButton,
    inputViewControl,
    isViewButtonRunning,
    isViewInputRunning,
    input,
    isRunning,
  };
}
