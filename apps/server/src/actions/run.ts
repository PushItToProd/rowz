import {
  createWorkbook,
  isButton,
  isControl,
  renderTemplate,
  type ActionPlan,
  type CellValue,
  type Effect,
  type ErrorValue,
  type Scalar,
  type SendEmailEffect,
  type TemplateBlock,
  type TemplateInline,
  type Workbook,
} from "@spreadsheet-app/engine";
import type { IdentifiedCell } from "@spreadsheet-app/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { actionRuns, type RunStatus } from "../db/schema";
import { ApiFailure, conflict, unprocessable } from "../errors";
import type { Mailer } from "../mail/mailer";
import { SpreadsheetRepository, type Change, type RepositoryOptions } from "../repo/spreadsheets";

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
  /** Overrides for the repositories the app makes, which tests use to lower limits. */
  repositoryOptions?: RepositoryOptions;
  /** How many emails a user's button clicks may send in any one-hour window. Each recipient of a message is one email. */
  emailsPerHour: number;
}

export interface ClickResult {
  runId: string;
  status: "succeeded" | "failed";
  /** Why the action did nothing, when `status` is `failed`. */
  error: string | null;
  /** What the action wrote to the spreadsheet. `null` when it wrote nothing. */
  change: Change | null;
  emailsSent: number;
}

const HOUR_MS = 60 * 60 * 1000;

function describe(error: ErrorValue): string {
  return error.message === undefined ? error.code : `${error.code} ${error.message}`;
}

function isSendEmail(effect: Effect): effect is SendEmailEffect {
  return effect.type === "sendEmail";
}

/** How many emails the effects send: one for each recipient of each message. */
function emailCount(effects: readonly Effect[]): number {
  return effects
    .filter(isSendEmail)
    .reduce((total, { to, cc }) => total + to.length + cc.length, 0);
}

interface Planned {
  runId: string;
  failure: string | null;
  effects: Effect[];
  change: Change | null;
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
  cell: IdentifiedCell,
  now: () => number,
): Promise<ClickResult> {
  return runCell(dependencies, userId, cell, now, (workbook, value) => {
    if (!isButton(value)) {
      throw unprocessable("not_a_button", "The selected cell does not hold a button");
    }
    return workbook.planAction(value.action);
  });
}

/**
 * Runs the indexed BUTTON occurrence in a stored text view. The request names
 * only the view and its rendered occurrence; the action is read from the view
 * again under the spreadsheet lock.
 */
export function runViewButton(
  dependencies: ActionDependencies,
  userId: string,
  viewId: string,
  buttonIndex: number,
  now: () => number,
): Promise<ClickResult> {
  return runAction(dependencies, userId, now, async (repository) => {
    let view = await repository.findViewForClick(viewId);
    if (view.kind !== "text") throw conflict("This text view no longer exists");
    try {
      await repository.lockSpreadsheet(view.spreadsheetId);
    } catch (cause) {
      if (cause instanceof ApiFailure && cause.status === 404) {
        // Distinguish a deleted target from access that was removed while waiting.
        await repository.findViewForClick(viewId);
      }
      throw cause;
    }

    // A view can be deleted or its source changed while this request waits.
    view = await repository.findViewForClick(viewId);
    if (view.kind !== "text") throw conflict("This text view no longer exists");

    const contents = await repository.read(view.spreadsheetId);
    const workbook = createWorkbook(contents.data, { now });
    const rendered = renderTemplate(view.source, (expression, names) =>
      workbook.evaluateOnPage(view.pageId, expression, names),
    );
    const button = buttonAt(rendered, buttonIndex);
    if (!button) throw conflict("This button no longer exists");

    return {
      spreadsheetId: view.spreadsheetId,
      target: { viewId, buttonIndex },
      plan: workbook.planAction(button.action),
    };
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
  cell: IdentifiedCell,
  input: Scalar,
  now: () => number,
): Promise<ClickResult> {
  return runCell(dependencies, userId, cell, now, (workbook, value) => {
    if (!isControl(value)) {
      throw unprocessable(
        "not_a_control",
        "The selected cell does not hold a checkbox or a dropdown",
      );
    }
    return workbook.planInput(value, input);
  });
}

/**
 * Carries out what a button asks for. What the action writes to the spreadsheet
 * is one change, and it commits together with the audit record. Email is sent
 * after the commit, so a rolled-back run never sends mail.
 */
async function runCell(
  dependencies: ActionDependencies,
  userId: string,
  cell: IdentifiedCell,
  now: () => number,
  decide: Decide,
): Promise<ClickResult> {
  return runAction(dependencies, userId, now, async (repository) => {
    const { spreadsheetId } = await repository.findTable(cell.tableId, "write");
    await repository.lockSpreadsheet(spreadsheetId);

    // The request names the cell by id. The engine works by position, and both come from this read.
    const contents = await repository.read(spreadsheetId);
    const resolved = contents.position(cell);
    const workbook = createWorkbook(contents.data, { now });
    const plan = decide(workbook, workbook.getValue(resolved));
    return { spreadsheetId, target: resolved, plan };
  });
}

type RunTarget =
  | { tableId: string; row: number; col: number; viewId?: never; buttonIndex?: never }
  | { tableId?: never; row?: never; col?: never; viewId: string; buttonIndex: number };

interface LocatedPlan {
  spreadsheetId: string;
  target: RunTarget;
  plan: ActionPlan;
}

type LocatePlan = (repository: SpreadsheetRepository) => Promise<LocatedPlan>;

function buttonAt(
  blocks: readonly TemplateBlock[],
  occurrence: number,
): Extract<TemplateInline, { type: "button" }> | undefined {
  for (const block of blocks) {
    if (block.type !== "markdown") continue;
    const button = block.parts.find(
      (part): part is Extract<TemplateInline, { type: "button" }> =>
        part.type === "button" && part.occurrence === occurrence,
    );
    if (button) return button;
  }
  return undefined;
}

async function runAction(
  { db, mailer, emailsPerHour, repositoryOptions }: ActionDependencies,
  userId: string,
  now: () => number,
  locate: LocatePlan,
): Promise<ClickResult> {
  const planned = await db.transaction(async (tx): Promise<Planned> => {
    const repository = new SpreadsheetRepository(tx, userId, repositoryOptions);
    const { spreadsheetId, target, plan } = await locate(repository);

    const record = async (
      effects: Effect[],
      failure: string | null,
      change: Change | null = null,
    ): Promise<Planned> => {
      const status: RunStatus =
        failure !== null ? "failed" : effects.some(isSendEmail) ? "pending" : "succeeded";
      const [run] = await tx
        .insert(actionRuns)
        .values({
          spreadsheetId,
          ...target,
          userId,
          effects,
          // A refused run sends nothing, so it uses none of the user's limit.
          emails: failure === null ? emailCount(effects) : 0,
          status,
          error: failure,
        })
        .returning({ id: actionRuns.id });
      if (!run) throw new Error("Insert returned no action run");
      return { runId: run.id, failure, effects, change };
    };

    if (!plan.ok) return record([], describe(plan.error));
    const { effects } = plan;

    const emails = emailCount(effects);
    if (emails > 0) {
      // Held until this run is recorded, so that a click made at the same moment counts it.
      await repository.lockUser();
      const sent = await repository.countEmails(new Date(Date.now() - HOUR_MS));
      if (sent + emails > emailsPerHour) {
        return record(effects, `Email limit reached: ${String(emailsPerHour)} per hour`);
      }
    }

    try {
      // The change runs in a transaction of its own, nested in this one, so
      // one that is refused writes nothing while the failed run is still recorded.
      const change = await repository.applyEffects(spreadsheetId, effects);
      return await record(effects, null, change ?? null);
    } catch (cause) {
      if (!(cause instanceof ApiFailure)) throw cause;
      return record(effects, cause.message);
    }
  });

  const { runId, failure, effects, change } = planned;
  if (failure !== null) {
    return { runId, status: "failed", error: failure, change: null, emailsSent: 0 };
  }

  const done = { runId, change };
  const emails = effects.filter(isSendEmail);
  if (emails.length > 0) {
    const { sent, failure: outcome } = await sendAll(mailer, emails);
    await db
      .update(actionRuns)
      // Only what went out counts toward the limit, so a mail server that is down uses none of it.
      .set({
        status: outcome === null ? "succeeded" : "failed",
        error: outcome,
        emails: emailCount(sent),
      })
      .where(eq(actionRuns.id, runId));
    // Cell writes are already committed, so they are reported even when the mail failed.
    if (outcome !== null) return { ...done, status: "failed", error: outcome, emailsSent: 0 };
  }
  return { ...done, status: "succeeded", error: null, emailsSent: emails.length };
}

/** Sends the messages in order and stops at the first that fails. Returns the ones sent, and a description of the failure if there was one. */
async function sendAll(
  mailer: Mailer,
  emails: readonly SendEmailEffect[],
): Promise<{ sent: SendEmailEffect[]; failure: string | null }> {
  const sent: SendEmailEffect[] = [];
  try {
    for (const email of emails) {
      const { to, cc, subject, body } = email;
      await mailer.send({ to, cc, subject, body });
      sent.push(email);
    }
    return { sent, failure: null };
  } catch (cause) {
    console.error("Sending email failed", cause);
    return { sent, failure: "The email could not be sent" };
  }
}
