import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { keyBetween, keysAfter } from "@spreadsheet-app/shared";
import { startTestServer, type TestServer } from "./testing";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => server.close());

it("orders generated and backfilled keys the same way in JavaScript and the database's C collation", async () => {
  const keys = keysAfter(null, 1000);
  let first = keys[0]!;
  for (let i = 0; i < 1000; i++) {
    first = keyBetween(null, first);
    keys.push(first);
  }
  let upper = "a1";
  for (let i = 0; i < 311; i++) {
    upper = keyBetween("a0", upper);
    keys.push(upper);
  }
  keys.push(...Array.from({ length: 1000 }, (_, row) => `f${String(row).padStart(5, "0")}V`));
  const ordered = await server.db
    .select({ key: sql<string>`key` })
    .from(
      sql`(values ${sql.join(
        keys.map((key) => sql`(${key})`),
        sql`, `,
      )}) as generated(key)`,
    )
    .orderBy(sql`key collate "C"`);
  expect(ordered.map(({ key }) => key)).toEqual(keys.toSorted());
});

it("stores row order keys with C collation", async () => {
  const result = await server.db
    .select({ collname: sql<string>`c.collname` })
    .from(
      sql`pg_attribute a JOIN pg_class t ON t.oid = a.attrelid JOIN pg_collation c ON c.oid = a.attcollation`,
    )
    .where(sql`t.relname = 'table_rows' AND a.attname = 'order_key'`);
  expect(result).toEqual([{ collname: "C" }]);
});
