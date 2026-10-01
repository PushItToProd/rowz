import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema";

/** A connection or an open transaction. Both run the same queries. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const POSTGRES_URL = /^postgres(ql)?:\/\//;

/** PGlite's address for a database that lives in memory and is gone when closed. */
export const IN_MEMORY = "memory://";

/**
 * Opens the database and applies pending migrations.
 *
 * A `postgres://` URL connects to a Postgres server. Anything else is handed
 * to PGlite, which runs Postgres inside this process: a directory path keeps
 * the data on disk, and `IN_MEMORY` keeps it in memory. PGlite lets tests and
 * local development run with no database server.
 */
export async function openDatabase(url: string): Promise<DatabaseHandle> {
  if (POSTGRES_URL.test(url)) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePostgres(pool, { schema });
    await migratePostgres(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }

  const client = new PGlite(url);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
