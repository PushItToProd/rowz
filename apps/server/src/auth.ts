import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "./db/client";
import * as schema from "./db/schema";
import type { Mailer } from "./mail/mailer";

export interface AuthOptions {
  secret: string;
  /** The public URL of this server, used for cookies and callback links. */
  baseUrl: string;
  /** Origins allowed to make authenticated requests, such as the web app's dev server. */
  trustedOrigins: string[];
  /**
   * When given, a new account cannot sign in until its email address is
   * confirmed by opening a link sent to it through this mailer.
   */
  verifyEmailWith?: Mailer;
}

export function createAuth(db: Database, options: AuthOptions) {
  const verifier = options.verifyEmailWith;
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
    secret: options.secret,
    baseURL: options.baseUrl,
    basePath: "/api/auth",
    trustedOrigins: options.trustedOrigins,
    emailAndPassword: { enabled: true, requireEmailVerification: verifier !== undefined },
    ...(verifier === undefined
      ? {}
      : {
          emailVerification: {
            sendOnSignUp: true,
            // Opening the link is proof enough of who it is, so it also signs them in.
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url }) => {
              await verifier.send({
                to: [user.email],
                cc: [],
                subject: "Confirm your email address",
                body: `Open this link to confirm your email address and finish creating your account:\n\n${url}\n\nIf you did not ask for an account, ignore this message.`,
              });
            },
          },
        }),
  });
}

export type Auth = ReturnType<typeof createAuth>;
