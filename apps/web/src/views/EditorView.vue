<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import EditableName from "../components/EditableName.vue";
import FormulaBar from "../components/FormulaBar.vue";
import PageTabs from "../components/PageTabs.vue";
import TableCard from "../components/TableCard.vue";
import { useWorkbookStore } from "../stores/workbook";

const props = defineProps<{ spreadsheetId: string; pageId?: string }>();
const store = useWorkbookStore();
const router = useRouter();

const loadError = ref<string | null>(null);
const loaded = computed(() => store.spreadsheet?.id === props.spreadsheetId);
const page = computed(() => store.pages.find((candidate) => candidate.id === props.pageId));
const pageTables = computed(() => store.tables.filter((table) => table.pageId === props.pageId));

watch(
  () => props.spreadsheetId,
  async (spreadsheetId) => {
    loadError.value = null;
    try {
      await store.load(spreadsheetId);
    } catch (cause) {
      loadError.value =
        cause instanceof Error ? cause.message : "The spreadsheet could not be opened";
    }
  },
  { immediate: true },
);

// An address without a page, or with a page that no longer exists, opens the first page.
watch(
  [loaded, page],
  async () => {
    const first = store.pages[0];
    if (loaded.value && !page.value && first) {
      await router.replace({
        name: "editor",
        params: { spreadsheetId: props.spreadsheetId, pageId: first.id },
      });
    }
  },
  { immediate: true },
);

// A success notice clears itself. An error stays until dismissed.
const NOTICE_MS = 4000;
watch(
  () => store.notice,
  (notice, _previous, onCleanup) => {
    if (notice?.kind !== "success") return;
    const timer = window.setTimeout(() => {
      if (store.notice === notice) store.notice = null;
    }, NOTICE_MS);
    onCleanup(() => {
      window.clearTimeout(timer);
    });
  },
);
</script>

<template>
  <div class="editor">
    <div class="editor__chrome">
      <header class="editor__header">
        <RouterLink :to="{ name: 'spreadsheets' }" class="editor__back">← Spreadsheets</RouterLink>
        <h1 v-if="store.spreadsheet && loaded">
          <EditableName
            :value="store.spreadsheet.name"
            label="Spreadsheet name"
            :disabled="!store.canEdit"
            @rename="store.renameSpreadsheet($event)"
          />
        </h1>
        <span v-if="loaded && !store.canEdit" class="badge">View only</span>
      </header>
      <template v-if="loaded && page">
        <FormulaBar />
        <PageTabs :spreadsheet-id="spreadsheetId" :active-page-id="page.id" />
      </template>
    </div>

    <p v-if="loadError" class="notice notice--error" role="alert">{{ loadError }}</p>
    <p v-else-if="!loaded" class="editor__loading">Loading…</p>
    <main v-else-if="page" class="editor__page">
      <TableCard v-for="table in pageTables" :key="table.id" :table="table" />
      <p v-if="pageTables.length === 0" class="editor__empty">This page has no tables.</p>
      <button v-if="store.canEdit" type="button" @click="store.addTable(page.id)">Add table</button>
    </main>

    <div
      v-if="store.notice"
      class="notice notice--floating"
      :class="`notice--${store.notice.kind}`"
      :role="store.notice.kind === 'error' ? 'alert' : 'status'"
    >
      {{ store.notice.text }}
      <button type="button" aria-label="Dismiss" @click="store.notice = null">×</button>
    </div>
  </div>
</template>
