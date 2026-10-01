<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api, type VersionListItem } from "../api/client";

const props = defineProps<{ spreadsheetId: string; canRestore: boolean }>();
const emit = defineEmits<{
  close: [];
  /** The spreadsheet was put back as a version had it, and must be read again. */
  restored: [];
  /** A version was opened as a new spreadsheet with this id. */
  copied: [spreadsheetId: string];
}>();

const versions = ref<VersionListItem[] | null>(null);
const error = ref<string | null>(null);
/** The version a restore or copy is running for, which turns its buttons off. */
const busy = ref<string | null>(null);
const panel = ref<HTMLElement>();

async function run(versionId: string | null, action: () => Promise<void>): Promise<void> {
  error.value = null;
  busy.value = versionId;
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Something went wrong";
  } finally {
    busy.value = null;
  }
}

const refresh = (): Promise<void> =>
  run(null, async () => {
    versions.value = await api.listVersions(props.spreadsheetId);
  });

function restore(version: VersionListItem): Promise<void> {
  const asked = `Put the spreadsheet back as it was on ${when(version)}? What it holds now is kept as a version, so this can be undone.`;
  if (!window.confirm(asked)) return Promise.resolve();
  return run(version.id, async () => {
    await api.restoreVersion(props.spreadsheetId, version.id);
    emit("restored");
    await refresh();
  });
}

function copy(version: VersionListItem): Promise<void> {
  return run(version.id, async () => {
    const created = await api.copyVersion(props.spreadsheetId, version.id);
    emit("copied", created.id);
  });
}

function when(version: VersionListItem): string {
  return new Date(version.createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  panel.value?.focus();
  void refresh();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <aside ref="panel" class="history" role="dialog" aria-label="History" tabindex="-1">
    <header class="history__header">
      <h2>History</h2>
      <button type="button" aria-label="Close history" @click="emit('close')">×</button>
    </header>
    <p class="history__about">
      A version is kept before anything is deleted, and every ten minutes while the spreadsheet is
      being changed.
    </p>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-if="versions === null && !error">Loading…</p>
    <p v-else-if="versions?.length === 0">No versions have been kept yet.</p>
    <ol v-else class="history__list">
      <li v-for="version in versions" :key="version.id">
        <div>
          <time :datetime="version.createdAt">{{ when(version) }}</time>
          <span class="history__reason">{{ version.reason ?? "Kept while editing" }}</span>
          <span v-if="version.createdBy" class="history__who">{{ version.createdBy }}</span>
        </div>
        <div class="history__actions">
          <button
            v-if="canRestore"
            type="button"
            :disabled="busy !== null"
            :aria-label="`Restore the version of ${when(version)}`"
            @click="restore(version)"
          >
            Restore
          </button>
          <button
            type="button"
            :disabled="busy !== null"
            :aria-label="`Open a copy of the version of ${when(version)}`"
            @click="copy(version)"
          >
            Open a copy
          </button>
        </div>
      </li>
    </ol>
  </aside>
</template>
