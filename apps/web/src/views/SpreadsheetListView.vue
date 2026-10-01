<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type ListedSpreadsheetItem } from "../api/client";
import { readSpreadsheetFile } from "../files/spreadsheetFile";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const router = useRouter();

const spreadsheets = ref<ListedSpreadsheetItem[] | null>(null);
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

/** Creates a spreadsheet from a chosen file that an export wrote, and opens it. */
const importFile = (event: Event): Promise<void> =>
  run(async () => {
    const input = event.target as HTMLInputElement;
    const [file] = input.files ?? [];
    // Cleared so that choosing the same file again is a change the input reports.
    input.value = "";
    if (!file) return;
    const created = await api.importSpreadsheet(readSpreadsheetFile(await file.text()));
    await router.push({ name: "editor", params: { spreadsheetId: created.id } });
  });

const remove = (spreadsheet: ListedSpreadsheetItem): Promise<void> =>
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

    <div class="list__actions">
      <button type="button" class="primary" @click="create">New spreadsheet</button>
      <label class="file-button">
        Import
        <input type="file" accept=".json,application/json" @change="importFile" />
      </label>
    </div>

    <p v-if="spreadsheets === null && !error">Loading…</p>
    <p v-else-if="spreadsheets?.length === 0" class="list__empty">
      No spreadsheets yet. Create one to get started.
    </p>
    <ul v-else class="list__items">
      <li v-for="spreadsheet in spreadsheets" :key="spreadsheet.id">
        <RouterLink :to="{ name: 'editor', params: { spreadsheetId: spreadsheet.id } }">
          {{ spreadsheet.name }}
        </RouterLink>
        <span v-if="spreadsheet.role !== 'owner'" class="badge">
          Shared with you · {{ spreadsheet.role === "editor" ? "can edit" : "can view" }}
        </span>
        <time :datetime="spreadsheet.updatedAt">{{ formatDate(spreadsheet.updatedAt) }}</time>
        <button
          v-if="spreadsheet.role === 'owner'"
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
