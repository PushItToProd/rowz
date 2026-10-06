import {
  formatAddress,
  formatDate,
  isDate,
  type CellId,
  type Scalar,
} from "@spreadsheet-app/engine";
import { type ViewInputBody } from "@spreadsheet-app/shared";
import { api, type ClickResult } from "../../api/client";
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
  ): Promise<ClickResult | undefined> {
    const identity = context.identityOf(id);
    if (!identity) return undefined;
    return runRequest(context.cellIdentityKey(identity), request);
  }

  async function runRequest(
    key: string,
    request: () => Promise<ClickResult>,
  ): Promise<ClickResult | undefined> {
    if (context.running.has(key) || !context.canEdit.value) return undefined;
    context.running.add(key);
    const queuedSaves = context.saves;
    const failedBefore = context.failedSaves;
    try {
      return await context.enqueueWrite(async () => {
        // The server evaluates stored inputs, so pending edits must be stored first. When one
        // could not be, the action would run on something other than what was typed.
        if (!(await context.stored(queuedSaves, failedBefore))) return undefined;
        const result = await request();
        if (result.change) await context.receiveChange(result.change);
        return result;
      });
    } catch (cause) {
      context.fail(cause, "The action could not be run");
      return undefined;
    } finally {
      context.running.delete(key);
    }
  }

  /** Asks the server to run the button in a cell. */
  async function click(id: CellId): Promise<void> {
    const identity = context.identityOf(id);
    if (!identity) return;
    const result = await run(id, () => api.click(identity));
    if (result) context.notice.value = describe(result, id.tableId);
  }

  /** Runs one BUTTON occurrence from a text view on the server. */
  async function clickViewButton(viewId: string, occurrence: number): Promise<void> {
    const view = context.views.value.find((candidate) => candidate.id === viewId);
    if (view?.kind !== "text") return;
    const result = await runRequest(`view:${viewId}:${String(occurrence)}`, () =>
      api.clickViewButton(viewId, occurrence),
    );
    if (result) context.notice.value = describe(result);
  }

  /** Stores a value chosen through one input occurrence in a text view. */
  async function inputViewControl(
    viewId: string,
    occurrence: number,
    input: ViewInputBody,
  ): Promise<ClickResult | undefined> {
    const result = await runRequest(`view-input:${viewId}:${String(occurrence)}`, () =>
      api.inputViewControl(viewId, occurrence, input),
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
    const result = await run(id, () => api.input(identity, sent));
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
