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

const api = createApp({
  db: database.db,
  auth: createAuth(database.db, {
    secret: config.authSecret,
    baseUrl: config.baseUrl,
    trustedOrigins: [config.baseUrl],
    ...(config.requireEmailVerification ? { verifyEmailWith: mailer } : {}),
  }),
  mailer,
  emailRunsPerHour: config.emailRunsPerHour,
});

const app = config.webRoot === undefined ? api : withWebApp(api, resolve(config.webRoot));

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Listening on http://localhost:${String(port)}`);
});

function shutdown(): void {
  server.close(() => {
    void database.close().then(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
