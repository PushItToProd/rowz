import { AsyncLocalStorage } from "node:async_hooks";
import { createMiddleware } from "hono/factory";

/** The header a client sends to name itself, so it can tell its own changes from other people's. */
export const CLIENT_ID_HEADER = "x-client-id";

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

/** The spreadsheets changed while handling the current request. */
const changed = new AsyncLocalStorage<Set<string>>();

/** Records that the request being handled changed a spreadsheet. Outside a request it does nothing. */
export function noteChange(spreadsheetId: string): void {
  changed.getStore()?.add(spreadsheetId);
}

/**
 * Publishes the changes a request made, once it has been answered. By then
 * its transactions are committed, so a session that reads the spreadsheet on
 * hearing of the change sees it.
 */
export function announceChanges(feed: ChangeFeed) {
  return createMiddleware(async (c, next) => {
    const touched = new Set<string>();
    await changed.run(touched, next);
    // A request that failed rolled back whatever it had begun.
    if (c.res.status >= 400) return;
    const origin = c.req.header(CLIENT_ID_HEADER) ?? "";
    for (const spreadsheetId of touched) feed.publish(spreadsheetId, origin);
  });
}
