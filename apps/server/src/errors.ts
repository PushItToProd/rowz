type FailureStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429;

/** A request the server refuses. The error handler turns it into a JSON response with this status. */
export class ApiFailure extends Error {
  constructor(
    readonly status: FailureStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

export const unauthenticated = (): ApiFailure =>
  new ApiFailure(401, "unauthenticated", "Sign in to continue");

export const forbidden = (): ApiFailure =>
  new ApiFailure(403, "forbidden", "You can view this document but not change it");

export const crossOrigin = (): ApiFailure =>
  new ApiFailure(403, "cross_origin", "This request did not come from the app");

export const ownerOnly = (): ApiFailure =>
  new ApiFailure(403, "forbidden", "Only the owner of this document can do that");

export const notFound = (what: string): ApiFailure =>
  new ApiFailure(404, "not_found", `${what} not found`);

export const conflict = (message: string): ApiFailure => new ApiFailure(409, "conflict", message);

/** A request named a row by an id that no row has: the row was deleted, or never existed. */
export const rowDeleted = (): ApiFailure =>
  new ApiFailure(409, "row_deleted", "This row no longer exists");

/** A request named a column by an id that its table does not have. */
export const columnDeleted = (): ApiFailure =>
  new ApiFailure(409, "column_deleted", "This column no longer exists");

export const unprocessable = (code: string, message: string): ApiFailure =>
  new ApiFailure(422, code, message);

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** Whether a database error, possibly wrapped by the query builder, has a Postgres error code. */
function hasCode(cause: unknown, code: string): boolean {
  for (let error = cause; error instanceof Error; error = error.cause) {
    if ("code" in error && error.code === code) return true;
  }
  return false;
}

/** Whether a database error is a unique constraint violation. */
export function isUniqueViolation(cause: unknown): boolean {
  return hasCode(cause, UNIQUE_VIOLATION);
}

/** Whether a database error is a write that names a row that does not exist. */
export function isForeignKeyViolation(cause: unknown): boolean {
  return hasCode(cause, FOREIGN_KEY_VIOLATION);
}
