<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type SpreadsheetListItem } from "../api/client";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const router = useRouter();

const spreadsheets = ref<SpreadsheetListItem[] | null>(null);
const error = ref<string | null>(null);

async function run(action: () => Promise<void>): Promise<void> {
  error.value = null;
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Something went wrong";
  }
}

const refresh = (): Promise<void> =>
  run(async () => {
    spreadsheets.value = await api.listSpreadsheets();
  });

const create = (): Promise<void> =>
  run(async () => {
    const created = await api.createSpreadsheet("Untitled spreadsheet");
    await router.push({ name: "editor", params: { spreadsheetId: created.id } });
  });

const remove = (spreadsheet: SpreadsheetListItem): Promise<void> =>
  run(async () => {
    if (!window.confirm(`Delete ${spreadsheet.name}? This cannot be undone.`)) return;
    await api.deleteSpreadsheet(spreadsheet.id);
    await refresh();
  });

async function signOut(): Promise<void> {
  await session.signOut();
  await router.push({ name: "login" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

onMounted(refresh);
</script>

<template>
  <div class="list">
    <header class="list__header">
      <h1>Spreadsheets</h1>
      <RouterLink :to="{ name: 'help' }">Help</RouterLink>
      <span class="list__user">{{ session.user?.email }}</span>
      <button type="button" @click="signOut">Sign out</button>
    </header>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <button type="button" class="primary" @click="create">New spreadsheet</button>

    <p v-if="spreadsheets === null && !error">Loading…</p>
    <p v-else-if="spreadsheets?.length === 0" class="list__empty">
      No spreadsheets yet. Create one to get started.
    </p>
    <ul v-else class="list__items">
      <li v-for="spreadsheet in spreadsheets" :key="spreadsheet.id">
        <RouterLink :to="{ name: 'editor', params: { spreadsheetId: spreadsheet.id } }">
          {{ spreadsheet.name }}
        </RouterLink>
        <time :datetime="spreadsheet.updatedAt">{{ formatDate(spreadsheet.updatedAt) }}</time>
        <button
          type="button"
          class="danger"
          :aria-label="`Delete ${spreadsheet.name}`"
          @click="remove(spreadsheet)"
        >
          Delete
        </button>
      </li>
    </ul>
  </div>
</template>
