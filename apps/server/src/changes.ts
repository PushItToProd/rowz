import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { CLIENT_ID_HEADER, STEP_ID_HEADER, UNDOABLE_HEADER } from "@spreadsheet-app/shared";
import { z } from "zod";
import { createMiddleware } from "hono/factory";
import { ApiFailure } from "./errors";
import type { Change } from "./repo/journal";

/**
 * The header a client sends to name itself. It gives the same name when it
 * opens the stream of changes, which lets the stream leave out what the
 * client need not hear of again. The name is never sent to another client:
 * whoever knew it could make changes under it that its owner would not hear
 * of.
 */
export { CLIENT_ID_HEADER } from "@spreadsheet-app/shared";

/**
 * Something that happened to a spreadsheet, for its open sessions. `change`
 * is a change to what it holds, with its revision. Without one, something
 * else about the spreadsheet changed, such as its name or who may open it,
 * and a session reads it again.
 */
export interface Announcement {
  /** The id of the client that caused it, or an empty string. */
  origin: string;
  change?: Change;
}

type Listener = (announcement: Announcement) => void;

/**
 * Tells the open sessions of a spreadsheet that it changed. It lives in this
 * process, so it reaches only the sessions connected to this server.
 */
export class ChangeFeed {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Calls `listener` with each announcement about a spreadsheet. Returns what stops it. */
  subscribe(spreadsheetId: string, listener: Listener): () => void {
    const listening = this.listeners.get(spreadsheetId) ?? new Set<Listener>();
    listening.add(listener);
    this.listeners.set(spreadsheetId, listening);
    return () => {
      listening.delete(listener);
      if (listening.size === 0) this.listeners.delete(spreadsheetId);
    };
  }

  publish(spreadsheetId: string, announcement: Announcement): void {
    for (const listener of this.listeners.get(spreadsheetId) ?? []) listener(announcement);
  }
}

export interface RequestContext {
  clientId: string | null;
  stepId: string;
  journaled: boolean;
  /** What the request did to each spreadsheet, in order. `undefined` is a change to something other than its content. */
  changed: { spreadsheetId: string; change: Change | undefined }[];
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
 * Records that the request being handled changed a spreadsheet. `change` is
 * given for a change to what the spreadsheet holds. Outside a request it does
 * nothing.
 */
export function noteChange(spreadsheetId: string, change?: Change): void {
  current.getStore()?.changed.push({ spreadsheetId, change });
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
      changed: [],
    };
    await current.run(context, next);
    // A request that failed rolled back whatever it had begun.
    if (c.res.status >= 400) return;
    for (const { spreadsheetId, change } of context.changed) {
      feed.publish(spreadsheetId, { origin: clientId ?? "", ...(change ? { change } : {}) });
    }
    if (clientId !== null && context.journaled) c.header(UNDOABLE_HEADER, "1");
  });
}
