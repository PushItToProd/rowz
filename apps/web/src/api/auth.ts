import { createAuthClient } from "better-auth/vue";

/** Talks to the auth endpoints under /api/auth on the page's own origin. */
export const authClient = createAuthClient();
