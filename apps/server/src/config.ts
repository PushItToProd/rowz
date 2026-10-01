export interface Config {
  port: number;
  /** A `postgres://` URL, or a directory for the embedded PGlite database. */
  databaseUrl: string;
  authSecret: string;
  /** The URL browsers use to reach the app. */
  baseUrl: string;
  /** Emails one user's button clicks may send in an hour, counting each recipient of a message. */
  emailsPerHour: number;
  /** The directory of the built web app to serve next to the API. Unset when something else serves it. */
  webRoot?: string;
  /** An `smtp://` or `smtps://` URL of the mail server that delivers `SEND_EMAIL`. Unset to log messages instead. */
  smtpUrl?: string;
  /** The address email is sent from. */
  mailFrom: string;
  /** Whether a new account must confirm its email address, by a link sent to it, before it can sign in. */
  requireEmailVerification: boolean;
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
  // A production server serves the built web app itself unless told there is none to serve.
  const webRoot = env.WEB_ROOT ?? (production ? "../web/dist" : "");
  return {
    ...(webRoot === "" ? {} : { webRoot }),
    ...(env.SMTP_URL === undefined || env.SMTP_URL === "" ? {} : { smtpUrl: env.SMTP_URL }),
    mailFrom: env.MAIL_FROM ?? "Spreadsheet <no-reply@localhost>",
    requireEmailVerification: ["1", "true"].includes(
      (env.REQUIRE_EMAIL_VERIFICATION ?? "").toLowerCase(),
    ),
    port: integer("PORT", env.PORT, 3000),
    databaseUrl: env.DATABASE_URL ?? ".data/pglite",
    authSecret,
    // In development the browser talks to the Vite dev server, which proxies /api here.
    baseUrl: env.BASE_URL ?? "http://localhost:5173",
    emailsPerHour: integer("EMAILS_PER_HOUR", env.EMAILS_PER_HOUR, 50),
  };
}
