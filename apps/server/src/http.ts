import type { ApiError } from "@spreadsheet-app/shared";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { ActionDependencies } from "./actions/run";
import type { Auth } from "./auth";
import { ApiFailure, unauthenticated } from "./errors";
import { SpreadsheetRepository } from "./repo/spreadsheets";

export interface AppDependencies extends ActionDependencies {
  auth: Auth;
}

export interface Env {
  Variables: {
    userId: string;
    /** Scoped to the signed-in user. Handlers reach spreadsheet data only through it. */
    repository: SpreadsheetRepository;
  };
}

/** Rejects requests without a session and gives the rest a repository for their user. */
export function requireSession({ auth, db }: AppDependencies) {
  return createMiddleware<Env>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw unauthenticated();
    c.set("userId", session.user.id);
    c.set("repository", new SpreadsheetRepository(db, session.user.id));
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
