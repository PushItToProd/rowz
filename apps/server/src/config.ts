export interface Config {
  port: number;
  /** A `postgres://` URL, or a directory for the embedded PGlite database. */
  databaseUrl: string;
  authSecret: string;
  /** The URL browsers use to reach the app. */
  baseUrl: string;
  emailRunsPerHour: number;
}

const DEV_SECRET = "development-only-secret-do-not-deploy";

function integer(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number`);
  return parsed;
}

/**
 * Reads configuration from environment variables. Development works with
 * none set. Production refuses to start without a session secret, because a
 * known secret lets anyone forge a session.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const production = env.NODE_ENV === "production";
  const authSecret = env.AUTH_SECRET ?? (production ? undefined : DEV_SECRET);
  if (authSecret === undefined || authSecret === "") {
    throw new Error("AUTH_SECRET must be set in production");
  }
  return {
    port: integer("PORT", env.PORT, 3000),
    databaseUrl: env.DATABASE_URL ?? ".data/pglite",
    authSecret,
    // In development the browser talks to the Vite dev server, which proxies /api here.
    baseUrl: env.BASE_URL ?? "http://localhost:5173",
    emailRunsPerHour: integer("EMAIL_RUNS_PER_HOUR", env.EMAIL_RUNS_PER_HOUR, 20),
  };
}
