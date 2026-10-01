import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { CLIENT_ID_HEADER, STEP_ID_HEADER, UNDOABLE_HEADER } from "@spreadsheet-app/shared";
import { z } from "zod";
import { createMiddleware } from "hono/factory";
import { ApiFailure } from "./errors";

/**
 * The header a client sends to name itself. It gives the same name when it
 * opens the stream of changes, and the stream leaves out the changes made
 * under that name. The name is never sent to another client: whoever knew it
 * could make changes under it that its owner would not hear of.
 */
export { CLIENT_ID_HEADER } from "@spreadsheet-app/shared";

type Listener = (origin: string) => void;

/**
 * Tells the open sessions of a spreadsheet that it changed. It lives in this
 * process, so it reaches only the sessions connected to this server.
 */
export class ChangeFeed {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Calls `listener` with the id of the client that made each change. Returns what stops it. */
  subscribe(spreadsheetId: string, listener: Listener): () => void {
    const listening = this.listeners.get(spreadsheetId) ?? new Set<Listener>();
    listening.add(listener);
    this.listeners.set(spreadsheetId, listening);
    return () => {
      listening.delete(listener);
      if (listening.size === 0) this.listeners.delete(spreadsheetId);
    };
  }

  publish(spreadsheetId: string, origin: string): void {
    for (const listener of this.listeners.get(spreadsheetId) ?? []) listener(origin);
  }
}

export interface RequestContext {
  clientId: string | null;
  stepId: string;
  journaled: boolean;
  changed: Set<string>;
}

/** The spreadsheet changes and undo identity for the current request. */
const current = new AsyncLocalStorage<RequestContext>();

export function requestContext(): RequestContext | undefined {
  return current.getStore();
}

/** Marks that a transaction committed an entry for the current request. */
export function noteJournaled(): void {
  const context = current.getStore();
  if (context) context.journaled = true;
}

/**
 * Takes back `noteJournaled` for the current request. A caller that ran
 * changes inside a transaction of its own calls this when it rolls that
 * transaction back, which removes the entries with it.
 */
export function forgetJournaled(): void {
  const context = current.getStore();
  if (context) context.journaled = false;
}

/** Records that the request being handled changed a spreadsheet. Outside a request it does nothing. */
export function noteChange(spreadsheetId: string): void {
  current.getStore()?.changed.add(spreadsheetId);
}

/**
 * Publishes the changes a request made, once it has been answered. By then
 * its transactions are committed, so a session that reads the spreadsheet on
 * hearing of the change sees it.
 */
export function announceChanges(feed: ChangeFeed) {
  return createMiddleware(async (c, next) => {
    const clientId = c.req.header(CLIENT_ID_HEADER) ?? null;
    const requestedStep = c.req.header(STEP_ID_HEADER);
    if (requestedStep !== undefined && !z.uuid().safeParse(requestedStep).success) {
      throw new ApiFailure(400, "invalid_request", `${STEP_ID_HEADER} must be a UUID`);
    }
    const context: RequestContext = {
      clientId,
      stepId: requestedStep ?? randomUUID(),
      journaled: false,
      changed: new Set(),
    };
    await current.run(context, next);
    // A request that failed rolled back whatever it had begun.
    if (c.res.status >= 400) return;
    for (const spreadsheetId of context.changed) feed.publish(spreadsheetId, clientId ?? "");
    if (clientId !== null && context.journaled) c.header(UNDOABLE_HEADER, "1");
  });
}
