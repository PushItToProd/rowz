<script setup lang="ts">
import { FILE_LIMITS } from "@spreadsheet-app/shared";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import EditableName from "../components/EditableName.vue";
import FormulaBar from "../components/FormulaBar.vue";
import PageTabs from "../components/PageTabs.vue";
import ChartCard from "../components/ChartCard.vue";
import FormatBar from "../components/FormatBar.vue";
import HistoryPanel from "../components/HistoryPanel.vue";
import SharePanel from "../components/SharePanel.vue";
import { useSessionStore } from "../stores/session";
import { watchSpreadsheet } from "../api/live";
import { download, fileName } from "../files/download";
import { fitsImport } from "../files/spreadsheetFile";
import { usePageTitle } from "../pageTitle";
import TableCard from "../components/TableCard.vue";
import TextCard from "../components/TextCard.vue";
import { useWorkbookStore } from "../stores/workbook";

const props = defineProps<{ spreadsheetId: string; pageId?: string }>();
const store = useWorkbookStore();
const router = useRouter();

const loadError = ref<string | null>(null);

/** Saves the spreadsheet, formulas included, as a file that can be imported again. */
function exportFile(): void {
  const file = store.toFile();
  if (!file) return;
  download(fileName(file.name, "json"), JSON.stringify(file, null, 1), "application/json");
  if (!fitsImport(file)) {
    const megabytes = String(FILE_LIMITS.bytes / 1024 / 1024);
    store.notice = {
      kind: "error",
      text: `The file was saved, but it is larger than ${megabytes} MB, the most that can be imported`,
    };
  }
}

const historyOpen = ref(false);
const shareOpen = ref(false);
const session = useSessionStore();

/** Reads the spreadsheet again after a version was restored. Its pages are new, so the first one opens. */
async function reload(): Promise<void> {
  await store.load(props.spreadsheetId);
  store.notice = { kind: "success", text: "The version was restored" };
}

async function openCopy(spreadsheetId: string): Promise<void> {
  historyOpen.value = false;
  await router.push({ name: "editor", params: { spreadsheetId } });
}

const loaded = computed(() => store.spreadsheet?.id === props.spreadsheetId);
// The store may still hold the spreadsheet that was open before this one.
usePageTitle(() => (loaded.value ? store.spreadsheet?.name : undefined));
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

// Changes made elsewhere arrive here. Several at once are read as one.
const REFRESH_DELAY_MS = 250;
let refreshTimer: number | undefined;
watch(
  () => props.spreadsheetId,
  (spreadsheetId, _previous, onCleanup) => {
    const stop = watchSpreadsheet(spreadsheetId, () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        store.refresh().catch((cause: unknown) => {
          // The spreadsheet was deleted, or is no longer shared with this person.
          loadError.value =
            cause instanceof Error ? cause.message : "The spreadsheet could not be read again";
        });
      }, REFRESH_DELAY_MS);
    });
    onCleanup(() => {
      window.clearTimeout(refreshTimer);
      stop();
    });
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
        <RouterLink :to="{ name: 'spreadsheets' }" class="editor__back" aria-label="← Spreadsheets">
          ← <span class="editor__back-label">Spreadsheets</span>
        </RouterLink>
        <h1 v-if="store.spreadsheet && loaded">
          <EditableName
            :value="store.spreadsheet.name"
            label="Spreadsheet name"
            :disabled="!store.canEdit"
            @rename="store.renameSpreadsheet($event)"
          />
        </h1>
        <span v-if="loaded && !store.canEdit" class="badge">View only</span>
        <button v-if="loaded" type="button" class="editor__export" @click="shareOpen = true">
          Share
        </button>
        <button v-if="loaded" type="button" @click="historyOpen = true">History</button>
        <button v-if="loaded" type="button" @click="exportFile">Export</button>
        <!-- A new tab, so reading about a formula does not take the user away from the sheet. -->
        <RouterLink :to="{ name: 'help' }" target="_blank" class="editor__help">Help</RouterLink>
      </header>
      <template v-if="loaded && page">
        <FormulaBar />
        <FormatBar v-if="store.canEdit" />
        <PageTabs :spreadsheet-id="spreadsheetId" :active-page-id="page.id" />
      </template>
    </div>

    <p v-if="loadError" class="notice notice--error" role="alert">{{ loadError }}</p>
    <p v-else-if="!loaded" class="editor__loading">Loading…</p>
    <main v-else-if="page" class="editor__page">
      <div v-for="(item, index) in items" :key="item.record.id" class="editor__item">
        <TableCard v-if="item.table" :table="item.table" />
        <ChartCard v-else-if="item.view.kind === 'chart'" :view="item.view" />
        <TextCard v-else :view="item.view" />
        <div v-if="store.canEdit && items.length > 1" class="editor__move">
          <button
            type="button"
            title="Move up"
            :aria-label="`Move ${item.record.name} up`"
            :disabled="index === 0"
            @click="store.moveItem(page.id, item.record.id, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            title="Move down"
            :aria-label="`Move ${item.record.name} down`"
            :disabled="index === items.length - 1"
            @click="store.moveItem(page.id, item.record.id, 1)"
          >
            ↓
          </button>
        </div>
      </div>
      <p v-if="items.length === 0" class="editor__empty">This page is empty.</p>
      <div v-if="store.canEdit" class="editor__add">
        <button type="button" @click="store.addTable(page.id)">Add table</button>
        <button type="button" @click="store.addView(page.id, 'chart')">Add chart</button>
        <button type="button" @click="store.addView(page.id, 'text')">Add text</button>
      </div>
    </main>

    <SharePanel
      v-if="shareOpen && loaded"
      :spreadsheet-id="spreadsheetId"
      :owner="store.spreadsheet?.role === 'owner'"
      :user-id="session.user?.id"
      @close="shareOpen = false"
      @left="router.push({ name: 'spreadsheets' })"
    />
    <HistoryPanel
      v-if="historyOpen && loaded"
      :spreadsheet-id="spreadsheetId"
      :can-restore="store.canEdit"
      @close="historyOpen = false"
      @restored="reload"
      @copied="openCopy"
    />

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
