import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { logMailer } from "./mail/mailer";

const config = loadConfig(process.env);

if (!config.databaseUrl.includes("://")) {
  await mkdir(dirname(config.databaseUrl), { recursive: true });
}
const database = await openDatabase(config.databaseUrl);

const app = createApp({
  db: database.db,
  auth: createAuth(database.db, {
    secret: config.authSecret,
    baseUrl: config.baseUrl,
    trustedOrigins: [config.baseUrl],
  }),
  mailer: logMailer(),
  emailRunsPerHour: config.emailRunsPerHour,
});

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
