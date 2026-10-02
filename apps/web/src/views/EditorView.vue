<script setup lang="ts">
import { FILE_LIMITS } from "@spreadsheet-app/shared";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import EditableName from "../components/EditableName.vue";
import FormulaBar from "../components/FormulaBar.vue";
import PageTabs from "../components/PageTabs.vue";
import ChartCard from "../components/ChartCard.vue";
import ContextMenu from "../components/ContextMenu.vue";
import type { MenuItem } from "../components/menu";
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
/** The blocks of the page, in the order they sit on it. */
const blocks = computed(() =>
  [
    ...store.tables.map((table) => ({ table, view: null, record: table })),
    ...store.views.map((view) => ({ table: null, view, record: view })),
  ]
    .filter((block) => block.record.pageId === props.pageId)
    .sort((a, b) => a.record.position - b.record.position),
);

/** The block whose menu of pages to move it to is open, and where the menu is. */
const pageMenu = ref<{ x: number; y: number; block: { id: string; name: string } } | null>(null);

function openPageMenu(event: MouseEvent, block: { id: string; name: string }): void {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  pageMenu.value = { x: box.left, y: box.bottom + 4, block };
}

/** The other pages, each as a place to move the block to. */
const pageMenuItems = computed((): MenuItem[] => {
  const block = pageMenu.value?.block;
  if (!block) return [];
  return store.pages
    .filter((candidate) => candidate.id !== props.pageId)
    .map((target) => ({
      label: `Move to ${target.name}`,
      run: () => {
        void store.moveBlockToPage(block.id, target.id);
      },
    }));
});

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
  <!-- `data-saving` is what the end-to-end tests wait on before a reload, which the page would otherwise ask about. -->
  <div class="editor" :data-saving="store.saving ? '' : undefined">
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
        <span
          v-else-if="loaded"
          class="editor__saved"
          :class="{ 'editor__saved--busy': store.saving }"
        >
          {{ store.saving ? "Saving…" : "Saved" }}
        </span>
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
      <div v-for="(block, index) in blocks" :key="block.record.id" class="editor__block">
        <TableCard v-if="block.table" :table="block.table" />
        <ChartCard v-else-if="block.view.kind === 'chart'" :view="block.view" />
        <TextCard v-else :view="block.view" />
        <div
          v-if="store.canEdit && (blocks.length > 1 || store.pages.length > 1)"
          class="editor__move"
        >
          <template v-if="blocks.length > 1">
            <button
              type="button"
              title="Move up"
              :aria-label="`Move ${block.record.name} up`"
              :disabled="index === 0"
              @click="store.moveBlock(page.id, block.record.id, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              title="Move down"
              :aria-label="`Move ${block.record.name} down`"
              :disabled="index === blocks.length - 1"
              @click="store.moveBlock(page.id, block.record.id, 1)"
            >
              ↓
            </button>
          </template>
          <button
            v-if="store.pages.length > 1"
            type="button"
            title="Move to another page"
            aria-haspopup="menu"
            :aria-label="`Move ${block.record.name} to another page`"
            @click="openPageMenu($event, block.record)"
          >
            ⇄
          </button>
        </div>
      </div>
      <p v-if="blocks.length === 0" class="editor__empty">This page is empty.</p>
      <div v-if="store.canEdit" class="editor__add">
        <button type="button" @click="store.addTable(page.id)">Add table</button>
        <button type="button" @click="store.addView(page.id, 'chart')">Add chart</button>
        <button type="button" @click="store.addView(page.id, 'text')">Add text</button>
      </div>
    </main>

    <ContextMenu
      v-if="pageMenu"
      :x="pageMenu.x"
      :y="pageMenu.y"
      :label="`Move ${pageMenu.block.name} to another page`"
      :items="pageMenuItems"
      @close="pageMenu = null"
    />
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
