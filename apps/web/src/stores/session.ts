import { defineStore } from "pinia";
import { ref } from "vue";
import { authClient } from "../api/auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

interface AuthResult {
  data: { user: SessionUser } | null;
  error: { message?: string | undefined } | null;
}

export const useSessionStore = defineStore("session", () => {
  /** `undefined` until the first check finishes, then the user or `null` when signed out. */
  const user = ref<SessionUser | null>();

  function accept({ data, error }: AuthResult, fallback: string): void {
    if (error || !data) throw new Error(error?.message ?? fallback);
    user.value = { id: data.user.id, name: data.user.name, email: data.user.email };
  }

  /** Asks the server who is signed in. Later calls reuse the answer. */
  async function load(): Promise<SessionUser | null> {
    if (user.value === undefined) {
      const { data } = await authClient.getSession();
      user.value = data ? { id: data.user.id, name: data.user.name, email: data.user.email } : null;
    }
    return user.value;
  }

  async function signIn(email: string, password: string): Promise<void> {
    accept(await authClient.signIn.email({ email, password }), "Could not sign in");
  }

  async function signUp(name: string, email: string, password: string): Promise<void> {
    accept(await authClient.signUp.email({ name, email, password }), "Could not sign up");
  }

  async function signOut(): Promise<void> {
    await authClient.signOut();
    user.value = null;
  }

  /** Forgets the user after the server rejected the session. */
  function clear(): void {
    user.value = null;
  }

  return { user, load, signIn, signUp, signOut, clear };
});
