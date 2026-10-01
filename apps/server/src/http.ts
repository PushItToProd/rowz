import type { ApiError } from "@spreadsheet-app/shared";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { ActionDependencies } from "./actions/run";
import type { Auth } from "./auth";
import { ApiFailure, crossOrigin, unauthenticated } from "./errors";
import { SpreadsheetRepository } from "./repo/spreadsheets";

export interface AppDependencies extends ActionDependencies {
  auth: Auth;
  /** The URLs the web app is served from. A request that changes something must come from a page of one. */
  trustedOrigins: string[];
  /** Whether a new account must confirm its email address. An account a spreadsheet is shared with must then have. */
  requireEmailVerification: boolean;
  /** Aborted when the server is shutting down, which ends the streams that otherwise never end. */
  shutdown?: AbortSignal;
}

export interface Env {
  Variables: {
    userId: string;
    /** Scoped to the signed-in user. Handlers reach spreadsheet data only through it. */
    repository: SpreadsheetRepository;
  };
}

/** Rejects requests without a session and gives the rest a repository for their user. */
export function requireSession({
  auth,
  db,
  requireEmailVerification,
  repositoryOptions,
}: AppDependencies) {
  const options = {
    ...repositoryOptions,
    sharesNeedVerifiedEmail: requireEmailVerification,
  };
  return createMiddleware<Env>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw unauthenticated();
    c.set("userId", session.user.id);
    c.set("repository", new SpreadsheetRepository(db, session.user.id, options));
    await next();
  });
}

/** Methods that change nothing, which any page may send. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses a request that changes something when a page of another origin
 * sent it. A browser sends the session cookie with a request from any page of
 * the same site, such as a sibling subdomain, and a form on such a page can
 * post without a body, which is all that clicking a button or restoring a
 * version takes. The browser names the sending page in the Origin header of
 * every such request. A request without the header is not from a page.
 */
export function requireTrustedOrigin({ trustedOrigins }: AppDependencies) {
  const trusted = new Set(trustedOrigins.map((url) => new URL(url).origin));
  return createMiddleware(async (c, next) => {
    const origin = c.req.header("origin");
    if (!SAFE_METHODS.has(c.req.method) && origin !== undefined && !trusted.has(origin)) {
      throw crossOrigin();
    }
    await next();
  });
}

/** The hook for request validators: answers a body or parameter that fails its schema with a 400. */
export function onInvalid(
  result: { success: true } | { success: false; error: { issues: { message: string }[] } },
  c: Context,
): Response | undefined {
  if (result.success) return undefined;
  const message = result.error.issues.map((issue) => issue.message).join("; ");
  return c.json<ApiError>({ error: { code: "invalid_request", message } }, 400);
}

export function onError(error: Error, c: Context): Response {
  if (error instanceof ApiFailure) {
    return c.json<ApiError>({ error: { code: error.code, message: error.message } }, error.status);
  }
  console.error(error);
  return c.json<ApiError>({ error: { code: "internal", message: "Something went wrong" } }, 500);
}
