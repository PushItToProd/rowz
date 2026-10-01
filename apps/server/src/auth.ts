import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "./db/client";
import * as schema from "./db/schema";

export interface AuthOptions {
  secret: string;
  /** The public URL of this server, used for cookies and callback links. */
  baseUrl: string;
  /** Origins allowed to make authenticated requests, such as the web app's dev server. */
  trustedOrigins: string[];
}

export function createAuth(db: Database, options: AuthOptions) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
    secret: options.secret,
    baseURL: options.baseUrl,
    basePath: "/api/auth",
    trustedOrigins: options.trustedOrigins,
    emailAndPassword: { enabled: true },
  });
}

export type Auth = ReturnType<typeof createAuth>;
