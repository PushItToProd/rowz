import {
  createWorkbook,
  formatAddress,
  isButton,
  type CellId,
  type Effect,
  type ErrorValue,
  type SendEmailEffect,
  type SetCellEffect,
} from "@spreadsheet-app/engine";
import type { StoredCell } from "@spreadsheet-app/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { actionRuns, type RunStatus } from "../db/schema";
import { ApiFailure, unprocessable } from "../errors";
import type { Mailer } from "../mail/mailer";
import { SpreadsheetRepository } from "../repo/spreadsheets";

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
  emailsSent: number;
}

const HOUR_MS = 60 * 60 * 1000;

function describe(error: ErrorValue): string {
  return error.message === undefined ? error.code : `${error.code} ${error.message}`;
}

function isSetCell(effect: Effect): effect is SetCellEffect {
  return effect.type === "setCell";
}

function isSendEmail(effect: Effect): effect is SendEmailEffect {
  return effect.type === "sendEmail";
}

interface Planned {
  runId: string;
  failure: string | null;
  effects: Effect[];
}

/**
 * Runs the button in a cell.
 *
 * The client names only the cell. The action comes from the stored formula,
 * so a client cannot ask the server to perform an effect the spreadsheet does
 * not describe.
 *
 * Cell writes and the audit record commit together. Email is sent after the
 * commit, so a rolled-back click never sends mail.
 */
export async function runButton(
  { db, mailer, emailRunsPerHour }: ActionDependencies,
  userId: string,
  cell: CellId,
): Promise<ClickResult> {
  const planned = await db.transaction(async (tx): Promise<Planned> => {
    const repository = new SpreadsheetRepository(tx, userId);
    const { spreadsheetId } = await repository.findTable(cell.tableId, "write");
    await repository.lockSpreadsheet(spreadsheetId);

    const workbook = createWorkbook(await repository.getSnapshot(spreadsheetId));
    const value = workbook.getValue(cell);
    if (!isButton(value)) {
      throw unprocessable("not_a_button", `${formatAddress(cell)} does not hold a button`);
    }

    const record = async (effects: Effect[], failure: string | null): Promise<Planned> => {
      const status: RunStatus =
        failure !== null ? "failed" : effects.some(isSendEmail) ? "pending" : "succeeded";
      const [run] = await tx
        .insert(actionRuns)
        .values({ spreadsheetId, ...cell, userId, effects, status, error: failure })
        .returning({ id: actionRuns.id });
      if (!run) throw new Error("Insert returned no action run");
      return { runId: run.id, failure, effects };
    };

    const plan = workbook.planAction(value.action);
    if (!plan.ok) return record([], describe(plan.error));
    const { effects } = plan;

    if (effects.some(isSendEmail)) {
      const recent = await repository.countEmailRuns(new Date(Date.now() - HOUR_MS));
      if (recent >= emailRunsPerHour) {
        return record(effects, `Email limit reached: ${String(emailRunsPerHour)} per hour`);
      }
    }

    try {
      // A nested transaction, so a write that is refused undoes the writes
      // before it while the failed run is still recorded.
      await tx.transaction(async (writes) => {
        const writer = new SpreadsheetRepository(writes, userId);
        for (const [tableId, tableEffects] of Map.groupBy(
          effects.filter(isSetCell),
          (effect) => effect.tableId,
        )) {
          await writer.setCells(tableId, tableEffects);
        }
      });
    } catch (cause) {
      if (!(cause instanceof ApiFailure)) throw cause;
      return record(effects, cause.message);
    }
    return record(effects, null);
  });

  const { runId, failure, effects } = planned;
  if (failure !== null) {
    return { runId, status: "failed", error: failure, cells: [], emailsSent: 0 };
  }

  const emails = effects.filter(isSendEmail);
  if (emails.length > 0) {
    const outcome = await sendAll(mailer, emails);
    await db
      .update(actionRuns)
      .set({ status: outcome === null ? "succeeded" : "failed", error: outcome })
      .where(eq(actionRuns.id, runId));
    if (outcome !== null) {
      // Cell writes are already committed, so they are still reported.
      return {
        runId,
        status: "failed",
        error: outcome,
        cells: writtenCells(effects),
        emailsSent: 0,
      };
    }
  }
  return {
    runId,
    status: "succeeded",
    error: null,
    cells: writtenCells(effects),
    emailsSent: emails.length,
  };
}

function writtenCells(effects: readonly Effect[]): StoredCell[] {
  return effects
    .filter(isSetCell)
    .map(({ tableId, row, col, input }) => ({ tableId, row, col, input }));
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
