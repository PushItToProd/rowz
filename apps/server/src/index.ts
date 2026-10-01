import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { resolve } from "node:path";
import { createTransport } from "nodemailer";
import { logMailer, smtpMailer } from "./mail/mailer";
import { withWebApp } from "./site";

const config = loadConfig(process.env);

if (!config.databaseUrl.includes("://")) {
  await mkdir(dirname(config.databaseUrl), { recursive: true });
}
const database = await openDatabase(config.databaseUrl);

const mailer =
  config.smtpUrl === undefined
    ? logMailer()
    : smtpMailer(createTransport(config.smtpUrl), config.mailFrom);

const stopping = new AbortController();

const api = createApp({
  db: database.db,
  auth: createAuth(database.db, {
    secret: config.authSecret,
    baseUrl: config.baseUrl,
    trustedOrigins: [config.baseUrl],
    ...(config.requireEmailVerification ? { verifyEmailWith: mailer } : {}),
  }),
  mailer,
  emailsPerHour: config.emailsPerHour,
  trustedOrigins: [config.baseUrl],
  requireEmailVerification: config.requireEmailVerification,
  shutdown: stopping.signal,
});

const app = config.webRoot === undefined ? api : withWebApp(api, resolve(config.webRoot));

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Listening on http://localhost:${String(port)}`);
});

/** How long requests in progress get to finish before their connections are closed. */
const SHUTDOWN_GRACE_MS = 10_000;

function shutdown(): void {
  // The server closes once every response has ended, and a stream of changes
  // ends only when its reader leaves or it is told to.
  stopping.abort();
  server.close(() => {
    void database.close().then(() => process.exit(0));
  });
  setTimeout(() => {
    if ("closeAllConnections" in server) server.closeAllConnections();
  }, SHUTDOWN_GRACE_MS).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
