<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { APP_NAME } from "../appName";
import { usePageTitle } from "../pageTitle";
import { useSessionStore } from "../stores/session";

const props = defineProps<{ mode: "login" | "signup" }>();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const name = ref("");
const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const submitting = ref(false);
/** The address a confirmation link was sent to, when the account must be confirmed before signing in. */
const confirming = ref<string | null>(null);

const isSignup = computed(() => props.mode === "signup");
const heading = computed(() => (isSignup.value ? "Create an account" : "Sign in"));
usePageTitle(heading);
const MIN_PASSWORD_LENGTH = 8;

async function submit(): Promise<void> {
  error.value = null;
  submitting.value = true;
  try {
    if (!isSignup.value) await session.signIn(email.value, password.value);
    else if (!(await session.signUp(name.value.trim(), email.value, password.value))) {
      confirming.value = email.value;
      return;
    }
    // Only follow a redirect to a path inside this app.
    const { redirect } = route.query;
    await router.push(typeof redirect === "string" && redirect.startsWith("/") ? redirect : "/");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Something went wrong";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="auth">
    <p class="brand">{{ APP_NAME }}</p>
    <h1>{{ heading }}</h1>
    <form @submit.prevent="submit">
      <label v-if="isSignup">
        Name
        <input v-model="name" name="name" autocomplete="name" required />
      </label>
      <label>
        Email
        <input v-model="email" name="email" type="email" autocomplete="email" required />
      </label>
      <label>
        Password
        <input
          v-model="password"
          name="password"
          type="password"
          :autocomplete="isSignup ? 'new-password' : 'current-password'"
          :minlength="isSignup ? MIN_PASSWORD_LENGTH : undefined"
          required
        />
      </label>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <p v-if="confirming" class="notice notice--success" role="status">
        We sent a link to {{ confirming }}. Open it to confirm your address and finish creating your
        account.
      </p>
      <button type="submit" class="primary" :disabled="submitting">
        {{ isSignup ? "Sign up" : "Sign in" }}
      </button>
    </form>
    <p v-if="isSignup">
      Already have an account? <RouterLink :to="{ name: 'login' }">Sign in</RouterLink>
    </p>
    <p v-else>New here? <RouterLink :to="{ name: 'signup' }">Create an account</RouterLink></p>
    <p><RouterLink :to="{ name: 'help' }">How formulas and buttons work</RouterLink></p>
  </main>
</template>
