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
  new ApiFailure(403, "forbidden", "You can view this spreadsheet but not change it");

export const notFound = (what: string): ApiFailure =>
  new ApiFailure(404, "not_found", `${what} not found`);

export const conflict = (message: string): ApiFailure => new ApiFailure(409, "conflict", message);

export const unprocessable = (code: string, message: string): ApiFailure =>
  new ApiFailure(422, code, message);

const UNIQUE_VIOLATION = "23505";

/** Whether a database error, possibly wrapped by the query builder, is a unique constraint violation. */
export function isUniqueViolation(cause: unknown): boolean {
  for (let error = cause; error instanceof Error; error = error.cause) {
    if ("code" in error && error.code === UNIQUE_VIOLATION) return true;
  }
  return false;
}
