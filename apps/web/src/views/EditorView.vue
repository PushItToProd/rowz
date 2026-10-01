<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import EditableName from "../components/EditableName.vue";
import FormulaBar from "../components/FormulaBar.vue";
import PageTabs from "../components/PageTabs.vue";
import ChartCard from "../components/ChartCard.vue";
import TableCard from "../components/TableCard.vue";
import TextCard from "../components/TextCard.vue";
import { useWorkbookStore } from "../stores/workbook";

const props = defineProps<{ spreadsheetId: string; pageId?: string }>();
const store = useWorkbookStore();
const router = useRouter();

const loadError = ref<string | null>(null);
const loaded = computed(() => store.spreadsheet?.id === props.spreadsheetId);
const page = computed(() => store.pages.find((candidate) => candidate.id === props.pageId));
/** The tables, charts, and text views of the page, in the order they sit on it. */
const items = computed(() =>
  [
    ...store.tables.map((table) => ({ table, view: null, record: table })),
    ...store.views.map((view) => ({ table: null, view, record: view })),
  ]
    .filter((item) => item.record.pageId === props.pageId)
    .sort((a, b) => a.record.position - b.record.position),
);

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
        <!-- A new tab, so reading about a formula does not take the user away from the sheet. -->
        <RouterLink :to="{ name: 'help' }" target="_blank" class="editor__help">Help</RouterLink>
      </header>
      <template v-if="loaded && page">
        <FormulaBar />
        <PageTabs :spreadsheet-id="spreadsheetId" :active-page-id="page.id" />
      </template>
    </div>

    <p v-if="loadError" class="notice notice--error" role="alert">{{ loadError }}</p>
    <p v-else-if="!loaded" class="editor__loading">Loading…</p>
    <main v-else-if="page" class="editor__page">
      <template v-for="item in items" :key="item.record.id">
        <TableCard v-if="item.table" :table="item.table" />
        <ChartCard v-else-if="item.view.kind === 'chart'" :view="item.view" />
        <TextCard v-else :view="item.view" />
      </template>
      <p v-if="items.length === 0" class="editor__empty">This page is empty.</p>
      <div v-if="store.canEdit" class="editor__add">
        <button type="button" @click="store.addTable(page.id)">Add table</button>
        <button type="button" @click="store.addView(page.id, 'chart')">Add chart</button>
        <button type="button" @click="store.addView(page.id, 'text')">Add text</button>
      </div>
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
