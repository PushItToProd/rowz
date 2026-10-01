import {
  createWorkbook,
  formatAddress,
  isButton,
  isControl,
  type ActionPlan,
  type CellId,
  type CellValue,
  type Effect,
  type EnsureRowsEffect,
  type ErrorValue,
  type Scalar,
  type SendEmailEffect,
  type SetCellEffect,
  type Workbook,
} from "@spreadsheet-app/engine";
import type { StoredCell } from "@spreadsheet-app/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { actionRuns, type RunStatus } from "../db/schema";
import { ApiFailure, unprocessable } from "../errors";
import type { Mailer } from "../mail/mailer";
import { SpreadsheetRepository, type TableRecord } from "../repo/spreadsheets";

/** The header in which the browser says how many minutes its clock is behind UTC. */
export const UTC_OFFSET_HEADER = "x-utc-offset-minutes";

const MINUTE_MS = 60_000;
// No place on Earth is further from UTC than this.
const MAX_OFFSET_MINUTES = 14 * 60;

/**
 * The clock of the person who made a request, for `TODAY` and `NOW` in the
 * action being run. Without a usable offset it is UTC.
 */
export function clientClock(offsetHeader: string | undefined): () => number {
  const minutes = Number(offsetHeader ?? 0);
  const usable = Number.isInteger(minutes) && Math.abs(minutes) <= MAX_OFFSET_MINUTES;
  return () => Date.now() - (usable ? minutes : 0) * MINUTE_MS;
}

export interface ActionDependencies {
  db: Database;
  mailer: Mailer;
  /** How many button clicks per user may send email in any one-hour window. */
  emailRunsPerHour: number;
}

export interface ClickResult {
  runId: string;
  status: "succeeded" | "failed";
  /** Why the action did nothing, when `status` is `failed`. */
  error: string | null;
  /** Cells the action wrote, for the client to apply. */
  cells: StoredCell[];
  /** Tables the action resized. */
  tables: TableRecord[];
  emailsSent: number;
}

const HOUR_MS = 60 * 60 * 1000;

function describe(error: ErrorValue): string {
  return error.message === undefined ? error.code : `${error.code} ${error.message}`;
}

function isSetCell(effect: Effect): effect is SetCellEffect {
  return effect.type === "setCell";
}

function isEnsureRows(effect: Effect): effect is EnsureRowsEffect {
  return effect.type === "ensureRows";
}

function isSendEmail(effect: Effect): effect is SendEmailEffect {
  return effect.type === "sendEmail";
}

interface Planned {
  runId: string;
  failure: string | null;
  effects: Effect[];
  tables: TableRecord[];
}

/**
 * Decides what a cell asks for, given its computed value. Throws an
 * `ApiFailure` when the cell is not the kind of thing the request is for.
 */
type Decide = (workbook: Workbook, value: CellValue) => ActionPlan;

/**
 * Runs the button in a cell.
 *
 * The client names only the cell. The action comes from the stored formula,
 * so a client cannot ask the server to perform an effect the spreadsheet does
 * not describe.
 */
export function runButton(
  dependencies: ActionDependencies,
  userId: string,
  cell: CellId,
  now: () => number,
): Promise<ClickResult> {
  return runCell(dependencies, userId, cell, now, (workbook, value) => {
    if (!isButton(value)) {
      throw unprocessable("not_a_button", `${formatAddress(cell)} does not hold a button`);
    }
    return workbook.planAction(value.action);
  });
}

/**
 * Stores a value chosen through the control in a cell, such as a checkbox.
 * The control's formula says which cell the value goes to and which values
 * are allowed, so the client supplies only the choice.
 */
export function runControl(
  dependencies: ActionDependencies,
  userId: string,
  cell: CellId,
  input: Scalar,
  now: () => number,
): Promise<ClickResult> {
  return runCell(dependencies, userId, cell, now, (workbook, value) => {
    if (!isControl(value)) {
      throw unprocessable(
        "not_a_control",
        `${formatAddress(cell)} does not hold a checkbox or a dropdown`,
      );
    }
    return workbook.planInput(value, input);
  });
}

/**
 * Carries out what a cell asks for. Cell writes, table growth, and the audit
 * record commit together. Email is sent after the commit, so a rolled-back
 * run never sends mail.
 */
async function runCell(
  { db, mailer, emailRunsPerHour }: ActionDependencies,
  userId: string,
  cell: CellId,
  now: () => number,
  decide: Decide,
): Promise<ClickResult> {
  const planned = await db.transaction(async (tx): Promise<Planned> => {
    const repository = new SpreadsheetRepository(tx, userId);
    const { spreadsheetId } = await repository.findTable(cell.tableId, "write");
    await repository.lockSpreadsheet(spreadsheetId);

    const workbook = createWorkbook(await repository.getSnapshot(spreadsheetId), { now });
    const plan = decide(workbook, workbook.getValue(cell));

    const record = async (
      effects: Effect[],
      failure: string | null,
      tables: TableRecord[] = [],
    ): Promise<Planned> => {
      const status: RunStatus =
        failure !== null ? "failed" : effects.some(isSendEmail) ? "pending" : "succeeded";
      const [run] = await tx
        .insert(actionRuns)
        .values({ spreadsheetId, ...cell, userId, effects, status, error: failure })
        .returning({ id: actionRuns.id });
      if (!run) throw new Error("Insert returned no action run");
      return { runId: run.id, failure, effects, tables };
    };

    if (!plan.ok) return record([], describe(plan.error));
    const { effects } = plan;

    if (effects.some(isSendEmail)) {
      const recent = await repository.countEmailRuns(new Date(Date.now() - HOUR_MS));
      if (recent >= emailRunsPerHour) {
        return record(effects, `Email limit reached: ${String(emailRunsPerHour)} per hour`);
      }
    }

    try {
      // A nested transaction, so a change that is refused undoes the changes
      // before it while the failed run is still recorded.
      const tables = await tx.transaction(async (writes) => {
        const writer = new SpreadsheetRepository(writes, userId);
        const grown: TableRecord[] = [];
        // Tables grow first, so the cells written into new rows are inside the table.
        for (const { tableId, rowCount } of effects.filter(isEnsureRows)) {
          const table = await writer.ensureRows(tableId, rowCount);
          if (table) grown.push(table);
        }
        for (const [tableId, tableEffects] of Map.groupBy(
          effects.filter(isSetCell),
          (effect) => effect.tableId,
        )) {
          await writer.setCells(tableId, tableEffects);
        }
        return grown;
      });
      return await record(effects, null, tables);
    } catch (cause) {
      if (!(cause instanceof ApiFailure)) throw cause;
      return record(effects, cause.message);
    }
  });

  const { runId, failure, effects, tables } = planned;
  if (failure !== null) {
    return { runId, status: "failed", error: failure, cells: [], tables: [], emailsSent: 0 };
  }

  const done = { runId, cells: writtenCells(effects), tables };
  const emails = effects.filter(isSendEmail);
  if (emails.length > 0) {
    const outcome = await sendAll(mailer, emails);
    await db
      .update(actionRuns)
      .set({ status: outcome === null ? "succeeded" : "failed", error: outcome })
      .where(eq(actionRuns.id, runId));
    // Cell writes are already committed, so they are reported even when the mail failed.
    if (outcome !== null) return { ...done, status: "failed", error: outcome, emailsSent: 0 };
  }
  return { ...done, status: "succeeded", error: null, emailsSent: emails.length };
}

/** The cells the effects wrote. When one cell was written twice, the last write is the one stored. */
function writtenCells(effects: readonly Effect[]): StoredCell[] {
  const cells = new Map<string, StoredCell>();
  for (const { tableId, row, col, input } of effects.filter(isSetCell)) {
    cells.set(`${tableId}:${formatAddress({ row, col })}`, { tableId, row, col, input });
  }
  return [...cells.values()];
}

/** Sends every message. Returns `null` on success or a description of the first failure. */
async function sendAll(mailer: Mailer, emails: readonly SendEmailEffect[]): Promise<string | null> {
  try {
    for (const { to, cc, subject, body } of emails) {
      await mailer.send({ to, cc, subject, body });
    }
    return null;
  } catch (cause) {
    console.error("Sending email failed", cause);
    return "The email could not be sent";
  }
}
