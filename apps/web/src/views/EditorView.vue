<script setup lang="ts">
import { FILE_LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import EditableName from "../components/EditableName.vue";
import AddBlockRow from "../components/AddBlockRow.vue";
import FormulaBar from "../components/FormulaBar.vue";
import FormulaSessionHost from "../components/FormulaSessionHost.vue";
import { useFormulaSessionStore } from "../formula/session";
import { useReferencePickingStore } from "../formula/picking";
import PageTabs from "../components/PageTabs.vue";
import ChartCard from "../components/ChartCard.vue";
import ContextMenu from "../components/ContextMenu.vue";
import type { MenuItem } from "../components/menu";
import FormatBar from "../components/FormatBar.vue";
import ErrorsPanel from "../components/ErrorsPanel.vue";
import FindPanel from "../components/FindPanel.vue";
import type { SearchMatch } from "../stores/workbook/search";
import ErrorWarning from "../components/ErrorWarning.vue";
import { formatAddress, type DocumentError, type ErrorTraceFrame } from "@spreadsheet-app/engine";
import AssertionsPanel from "../components/AssertionsPanel.vue";
import HistoryPanel from "../components/HistoryPanel.vue";
import RunsPanel from "../components/RunsPanel.vue";
import NoticeMessage from "../components/NoticeMessage.vue";
import SharePanel from "../components/SharePanel.vue";
import { useSessionStore } from "../stores/session";
import { watchSpreadsheet } from "../api/live";
import { api } from "../api/client";
import { download, fileName } from "../files/download";
import { fitsImport } from "../files/spreadsheetFile";
import { usePageTitle } from "../pageTitle";
import TableCard from "../components/TableCard.vue";
import ScriptCard from "../components/ScriptCard.vue";
import TextCard from "../components/TextCard.vue";
import { useWorkbookStore } from "../stores/workbook";
import { SIDE_PANES, provideActiveSidePane, tableIdOfSidePane } from "../sidePane";

const props = defineProps<{ spreadsheetId: string; pageId?: string }>();
const store = useWorkbookStore();
const router = useRouter();
const formulas = useFormulaSessionStore();
const picking = useReferencePickingStore();
const activeSidePane = provideActiveSidePane();
const replayed = new WeakSet<Event>();

function pageNavigation(target: Element): boolean {
  return target.closest(".page-tabs") !== null && target.closest("button") === null;
}
function preserveNavigationFocus(event: MouseEvent): void {
  if (
    formulas.active &&
    event.target instanceof Element &&
    (pageNavigation(event.target) || event.target.closest(".editor__back"))
  )
    event.preventDefault();
}
/** Page-control clicks run only after the draft save succeeds. */
function guardControl(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element && picking.suppressClick && target.closest(".grid")) return;
  if (
    target instanceof Element &&
    !target.closest(".formula-editor") &&
    target.closest("[data-pick-kind]") &&
    (picking.available || picking.suppressClick)
  )
    return;
  if (!formulas.active || replayed.has(event) || !(target instanceof HTMLElement)) return;
  if (
    target.closest("[data-formula-field], .formula-session-fallback, .editor__back") ||
    pageNavigation(target)
  )
    return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void formulas.submit(store.submitFormulaDraft).then((saved) => {
    if (!saved) {
      formulas.focus();
      return;
    }
    if (!target.isConnected) return;
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: event.button,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
    replayed.add(click);
    target.dispatchEvent(click);
  });
}
async function returnToEditor(pageId: string): Promise<void> {
  if (store.pages.some((item) => item.id === pageId)) {
    await router.push({ name: "editor", params: { spreadsheetId: props.spreadsheetId, pageId } });
    await nextTick();
    if (formulas.active) formulas.focus();
    else store.focusGrid();
  }
}

const loadError = ref<string | null>(null);
const copying = ref(false);
const pendingCopyNotice = ref<{
  spreadsheetId: string;
  originalId: string;
  originalPageId: string | undefined;
  name: string;
} | null>(null);
async function saveCopy(): Promise<void> {
  copying.value = true;
  const originalId = props.spreadsheetId;
  const originalPageId = props.pageId;
  try {
    const copy = await api.copySpreadsheet(originalId);
    pendingCopyNotice.value = {
      spreadsheetId: copy.id,
      originalId,
      originalPageId,
      name: copy.name,
    };
    await openCopy(copy.id);
    if (router.currentRoute.value.params.spreadsheetId !== copy.id) pendingCopyNotice.value = null;
  } catch (error) {
    pendingCopyNotice.value = null;
    store.notice = {
      kind: "error",
      text: error instanceof Error ? error.message : "Could not save a copy",
    };
  } finally {
    copying.value = false;
  }
}

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

const historyOpen = activeSidePane.isOpen(SIDE_PANES.history);
const runsOpen = activeSidePane.isOpen(SIDE_PANES.runs);
const shareOpen = activeSidePane.isOpen(SIDE_PANES.share);
const assertionsOpen = activeSidePane.isOpen(SIDE_PANES.assertions);
const errorsOpen = activeSidePane.isOpen(SIDE_PANES.errors);
const findOpen = activeSidePane.isOpen(SIDE_PANES.find);
const findPanel = ref<InstanceType<typeof FindPanel>>();
const selectedBlock = ref<string>();
watch(
  () => store.selection?.tableId,
  (id) => {
    if (id) selectedBlock.value = id;
  },
);
const findBlockId = computed(() => {
  const id = selectedBlock.value ?? store.selection?.tableId;
  return [...store.tables, ...store.views].find(
    (block) => block.id === id && block.pageId === props.pageId,
  )?.id;
});
function rememberBlock(event: FocusEvent) {
  const block = event.target instanceof Element ? event.target.closest(".editor__block") : null;
  if (block) selectedBlock.value = block.id.slice("block-".length);
}
function findKey(event: KeyboardEvent) {
  if (!loaded.value) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    event.stopPropagation();
    activeSidePane.open(SIDE_PANES.find);
    void nextTick(() => {
      findPanel.value?.focus();
    });
  } else if (event.key === "F3" && findOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    findPanel.value?.next(event.shiftKey);
  } else if (event.key === "Escape" && findOpen.value && !formulas.active) {
    event.preventDefault();
    event.stopPropagation();
    activeSidePane.close(SIDE_PANES.find);
  }
}
async function goToMatch(match: SearchMatch) {
  const keepFindFocus = !!document.activeElement?.matches(
    '.find-panel input[aria-label="Find text"]',
  );
  if (formulas.active && !(await formulas.submit(store.submitFormulaDraft))) {
    formulas.focus();
    return;
  }
  await goToError({
    pageId: match.pageId,
    blockId: match.blockId,
    label: match.label,
    ...(match.cell ? { cell: match.cell } : {}),
    ...(match.target.kind === "name" ? { name: match.target.name } : {}),
  });
  if (keepFindFocus) findPanel.value?.focus();
}
watch(
  () => props.spreadsheetId,
  () => {
    activeSidePane.closeActive();
    selectedBlock.value = undefined;
  },
);
watch(
  [() => props.pageId, () => store.tables.map((table) => `${table.id}:${table.pageId}`)],
  () => {
    const paneId = activeSidePane.active.value;
    if (!paneId) return;
    const tableId = tableIdOfSidePane(paneId);
    if (
      tableId !== undefined &&
      !store.tables.some((table) => table.id === tableId && table.pageId === props.pageId)
    )
      activeSidePane.close(paneId);
  },
);
async function goToError(
  target: Pick<
    DocumentError,
    "pageId" | "blockId" | "label" | "cell" | "name" | "line" | "column" | "trace"
  >,
): Promise<void> {
  const [origin] = target.trace ?? [];
  if (origin) {
    await goToTrace(target.trace ?? []);
    return;
  }
  await router.push({
    name: "editor",
    params: { spreadsheetId: props.spreadsheetId, pageId: target.pageId },
  });
  await nextTick();
  const block = document.getElementById(`block-${target.blockId}`);
  if (target.cell && store.rowView(target.cell.tableId).place(target.cell.row) !== undefined) {
    store.selection = target.cell;
    await nextTick();
    store.focusGrid();
    await nextTick();
    block
      ?.querySelector(`[data-cell="${formatAddress(target.cell)}"]`)
      ?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  } else {
    if (target.name && target.line === undefined) {
      const toggle = block?.querySelector<HTMLButtonElement>("[data-open-names]");
      if (toggle?.getAttribute("aria-expanded") === "false") toggle.click();
      await nextTick();
    }
    const location =
      target.line !== undefined
        ? block?.querySelector(`[data-script-line="${String(target.line)}"]`)
        : target.name
          ? block?.querySelector(`[data-name="${CSS.escape(target.name)}"]`)
          : target.column !== undefined
            ? block?.querySelector(`thead th:nth-child(${String(target.column + 2)})`)
            : undefined;
    block?.focus({ preventScroll: true });
    (location ?? block)?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (target.cell)
      store.notice = {
        kind: "error",
        text: `${target.label} is hidden by the table filter. Edit or clear the filter to show it.`,
      };
  }
}

/** Opens the script where a function error arose and puts the caret on its definition. */
async function goToTrace(trace: ErrorTraceFrame[]): Promise<void> {
  const [frame] = trace;
  if (!frame) return;
  const script = store.views.find(
    (view) => view.id === frame.location.scriptId && view.kind === "script",
  );
  if (!script) return;
  await router.push({
    name: "editor",
    params: { spreadsheetId: props.spreadsheetId, pageId: script.pageId },
  });
  await nextTick();
  const block = document.getElementById(`block-${script.id}`);
  block?.focus({ preventScroll: true });
  block
    ?.querySelector(`[data-script-line="${String(frame.location.line)}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (!store.canEdit) return;

  const offset = script.source
    .split("\n")
    .slice(0, frame.location.line - 1)
    .reduce((length, line) => length + line.length + 1, 0);
  if (
    !(await formulas.start(
      {
        target: { kind: "script", viewId: script.id },
        context: { pageId: script.pageId, holderId: script.id },
        mode: "script",
        text: script.source,
        label: `${store.pages.find((page) => page.id === script.pageId)?.name ?? ""} · ${script.name} · Script source`,
      },
      store.submitFormulaDraft,
    ))
  )
    return;
  const session = formulas.active;
  if (session?.target.kind === "script" && session.target.viewId === script.id)
    formulas.updateState(session.state.update({ selection: { anchor: offset } }).state);
  await nextTick();
  formulas.focus();
}

/** Opens the page of a failing assertion and selects its cell. */
async function goToAssertion(target: (typeof store.assertions)[number]): Promise<void> {
  await router.push({
    name: "editor",
    params: { spreadsheetId: props.spreadsheetId, pageId: target.pageId },
  });
  if (target.cell) store.selection = target.cell;
  if (target.scriptId) {
    await nextTick();
    document
      .getElementById(`script-${target.scriptId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}
const session = useSessionStore();

/** Reads the spreadsheet again after a version was restored. Its pages are new, so the first one opens. */
async function reload(): Promise<void> {
  await store.load(props.spreadsheetId);
  store.notice = { kind: "success", text: "The version was restored" };
}

async function openCopy(spreadsheetId: string): Promise<void> {
  activeSidePane.closeActive();
  await router.push({ name: "editor", params: { spreadsheetId } });
}

const opened = ref<string | null>(null);
const loaded = computed(
  () => opened.value === props.spreadsheetId && store.spreadsheet?.id === props.spreadsheetId,
);
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

/** The actions for a block, opened from its card or its action button. */
const blockMenu = ref<{ x: number; y: number; blockId: string } | null>(null);

function actionControls(blockId: string): HTMLElement[] {
  return [
    ...(document
      .getElementById(`block-${blockId}`)
      ?.querySelectorAll<HTMLElement>("[data-block-action]") ?? []),
  ];
}

function runBlockAction(blockId: string, action: string): void {
  void nextTick(() => {
    actionControls(blockId)
      .find((control) => control.dataset.blockAction === action)
      ?.click();
  });
}

function renameBlock(blockId: string): void {
  void nextTick(() => {
    const name = document
      .getElementById(`block-${blockId}`)
      ?.querySelector<HTMLElement>(".editable-name:not(input)");
    if (!name) return;
    name.focus({ preventScroll: true });
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

function addBlockBelow(blockId: string, kind: string): void {
  void nextTick(() => {
    const trigger = document
      .getElementById(`block-${blockId}`)
      ?.nextElementSibling?.querySelector<HTMLButtonElement>(`[data-add-block-type="${kind}"]`);
    trigger?.focus({ preventScroll: true });
    trigger?.click();
  });
}

const blockMenuItems = computed((): MenuItem[] => {
  const menu = blockMenu.value;
  const block = menu && blocks.value.find((candidate) => candidate.record.id === menu.blockId);
  if (!menu || !block) return [];
  const availableActions = actionControls(block.record.id).map((control) => {
    const action = control.dataset.blockAction ?? "";
    return {
      label: action,
      run: () => {
        runBlockAction(block.record.id, action);
      },
    };
  });
  const groups: MenuItem[][] = [];
  if (store.canEdit) {
    groups.push([
      {
        label: "Rename",
        run: () => {
          renameBlock(block.record.id);
        },
      },
      ...availableActions,
    ]);
    if (blocks.value.length > 1) {
      const index = blocks.value.findIndex((candidate) => candidate.record.id === block.record.id);
      groups.push([
        {
          label: "Move up",
          disabled: index === 0,
          run: () => void store.moveBlock(props.pageId ?? "", block.record.id, -1),
        },
        {
          label: "Move down",
          disabled: index === blocks.value.length - 1,
          run: () => void store.moveBlock(props.pageId ?? "", block.record.id, 1),
        },
        ...store.pages
          .filter((candidate) => candidate.id !== props.pageId)
          .map((target) => ({
            label: `Move to ${target.name}`,
            run: () => void store.moveBlockToPage(block.record.id, target.id),
          })),
      ]);
    } else if (store.pages.some((candidate) => candidate.id !== props.pageId)) {
      groups.push(
        store.pages
          .filter((candidate) => candidate.id !== props.pageId)
          .map((target) => ({
            label: `Move to ${target.name}`,
            run: () => void store.moveBlockToPage(block.record.id, target.id),
          })),
      );
    }
    groups.push(
      (["table", "chart", "text", "script"] as const).map((kind) => ({
        label: `Add ${kind} below`,
        run: () => {
          addBlockBelow(block.record.id, kind);
        },
      })),
    );
  } else if (availableActions.length > 0) {
    groups.push(availableActions);
  }
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      group.map((item, position) => ({ ...item, separated: index > 0 && position === 0 })),
    );
});
const blockMenuLabel = computed(() => {
  const id = blockMenu.value?.blockId;
  const block = blocks.value.find((candidate) => candidate.record.id === id);
  return `Actions for ${block?.record.name ?? "block"}`;
});

function openBlockMenu(event: MouseEvent, block: { id: string; name: string }): void {
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      'button, a[href], input, select, textarea, [contenteditable="true"], [role="button"]:not(.editable-name), [role="link"], .grid, .text-view, .cm-editor, .formula-editor',
    )
  )
    return;
  if (!store.canEdit && !store.tables.some((table) => table.id === block.id)) return;
  event.preventDefault();
  event.stopPropagation();
  const container = event.currentTarget as HTMLElement;
  container.focus({ preventScroll: true });
  blockMenu.value = { x: event.clientX, y: event.clientY, blockId: block.id };
}

function openBlockActionMenu(event: MouseEvent, block: { id: string; name: string }): void {
  const trigger = event.currentTarget as HTMLElement;
  const box = trigger.getBoundingClientRect();
  blockMenu.value = { x: box.right, y: box.bottom, blockId: block.id };
}

function onBlockKeydown(event: KeyboardEvent, block: { id: string; name: string }): void {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  if (
    event.target !== event.currentTarget ||
    (!store.canEdit && !store.tables.some((table) => table.id === block.id))
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  blockMenu.value = { x: box.left, y: box.bottom, blockId: block.id };
}

// Changes made elsewhere arrive here. Several at once are read as one.
const REFRESH_DELAY_MS = 250;
let refreshTimer: number | undefined;
watch(
  () => props.spreadsheetId,
  async (spreadsheetId, _previous, onCleanup) => {
    let active = true;
    const isActive = (): boolean => active;
    let stop: (() => void) | undefined;
    onCleanup(() => {
      active = false;
      window.clearTimeout(refreshTimer);
      stop?.();
    });
    if (pendingCopyNotice.value?.spreadsheetId !== spreadsheetId) pendingCopyNotice.value = null;
    loadError.value = null;
    opened.value = null;
    try {
      await store.load(spreadsheetId);
    } catch (cause) {
      if (isActive())
        loadError.value =
          cause instanceof Error ? cause.message : "The document could not be opened";
      return;
    }
    if (!isActive()) return;
    opened.value = spreadsheetId;
    const savedCopy = pendingCopyNotice.value;
    if (savedCopy?.spreadsheetId === spreadsheetId) {
      pendingCopyNotice.value = null;
      store.notice = {
        kind: "success",
        text: `Copy saved. You are now editing “${savedCopy.name}”.`,
        action: {
          label: "Back to original",
          to: {
            name: "editor",
            params: {
              spreadsheetId: savedCopy.originalId,
              ...(savedCopy.originalPageId ? { pageId: savedCopy.originalPageId } : {}),
            },
          },
        },
      };
    }
    stop = watchSpreadsheet(spreadsheetId, (change) => {
      if (change) {
        void store.receiveChange(change).catch((cause: unknown) => {
          loadError.value =
            cause instanceof Error ? cause.message : "The document could not be read again";
        });
        return;
      }
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        store.refresh().catch((cause: unknown) => {
          // The spreadsheet was deleted, or is no longer shared with this person.
          loadError.value =
            cause instanceof Error ? cause.message : "The document could not be read again";
        });
      }, REFRESH_DELAY_MS);
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
</script>

<template>
  <!-- `data-saving` is what the end-to-end tests wait on before a reload, which the page would otherwise ask about. -->
  <div
    class="editor"
    :data-saving="store.saving ? '' : undefined"
    @click.capture="guardControl"
    @mousedown.capture="preserveNavigationFocus"
    @keydown.capture="findKey"
    @focusin="rememberBlock"
  >
    <div class="editor__chrome">
      <header class="editor__header">
        <RouterLink :to="{ name: 'spreadsheets' }" class="editor__back" aria-label="← Documents">
          ← <span class="editor__back-label">Documents</span>
        </RouterLink>
        <h1 v-if="store.spreadsheet && loaded">
          <EditableName
            :value="store.spreadsheet.name"
            label="Document name"
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
        <button
          v-if="loaded && store.errors.length > 0"
          type="button"
          class="editor__errors"
          :aria-label="`${store.errors.length} ${store.errors.length === 1 ? 'error' : 'errors'}`"
          aria-haspopup="dialog"
          @click="activeSidePane.open(SIDE_PANES.errors)"
        >
          <ErrorWarning label="Document contains errors" />
          {{ store.errors.length }} {{ store.errors.length === 1 ? "error" : "errors" }}
        </button>
        <button
          v-if="loaded && store.assertions.length > 0"
          type="button"
          class="editor__assertions"
          @click="activeSidePane.open(SIDE_PANES.assertions)"
        >
          {{ store.assertions.length }} failing
          {{ store.assertions.length === 1 ? "assertion" : "assertions" }}
        </button>
        <button
          v-if="loaded"
          type="button"
          class="editor__export"
          @click="activeSidePane.open(SIDE_PANES.share)"
        >
          Share
        </button>
        <button v-if="loaded" type="button" @click="activeSidePane.open(SIDE_PANES.history)">
          History
        </button>
        <button v-if="loaded" type="button" @click="activeSidePane.open(SIDE_PANES.find)">
          Find
        </button>
        <button v-if="loaded" type="button" @click="activeSidePane.open(SIDE_PANES.runs)">
          Runs
        </button>
        <button v-if="loaded" type="button" @click="exportFile">Export</button>
        <button v-if="loaded" type="button" :disabled="copying || store.saving" @click="saveCopy">
          Save a copy
        </button>
        <!-- A new tab, so reading about a formula does not take the user away from the sheet. -->
        <RouterLink :to="{ name: 'help' }" target="_blank" class="editor__help">Help</RouterLink>
      </header>
      <template v-if="loaded && page">
        <FormulaBar :page-id="page?.id" />
        <FormatBar v-if="store.canEdit" />
        <PageTabs :spreadsheet-id="spreadsheetId" :active-page-id="page.id" />
      </template>
    </div>

    <FormulaSessionHost @return="returnToEditor" />

    <p v-if="loadError" class="notice notice--error" role="alert">{{ loadError }}</p>
    <p v-else-if="!loaded" class="editor__loading">Loading…</p>
    <main v-else-if="page" class="editor__page">
      <template v-for="(block, index) in blocks" :key="block.record.id">
        <AddBlockRow :page-id="page.id" :position="index" />
        <div
          :id="`block-${block.record.id}`"
          tabindex="0"
          role="region"
          :aria-label="block.record.name"
          class="editor__block"
          @contextmenu="openBlockMenu($event, block.record)"
          @keydown="onBlockKeydown($event, block.record)"
        >
          <TableCard
            v-if="block.table"
            :table="block.table"
            @trace="goToTrace"
            @actions="openBlockActionMenu($event, block.record)"
          />
          <ChartCard
            v-else-if="block.view.kind === 'chart'"
            :view="block.view"
            @actions="openBlockActionMenu($event, block.record)"
          />
          <ScriptCard
            v-else-if="block.view.kind === 'script'"
            :view="block.view"
            @actions="openBlockActionMenu($event, block.record)"
          />
          <TextCard
            v-else
            :view="block.view"
            @actions="openBlockActionMenu($event, block.record)"
          />
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
      </template>
      <p v-if="blocks.length === 0" class="editor__empty">This page is empty.</p>
      <AddBlockRow :page-id="page.id" :position="blocks.length" />
    </main>

    <ContextMenu
      v-if="pageMenu"
      :x="pageMenu.x"
      :y="pageMenu.y"
      :label="`Move ${pageMenu.block.name} to another page`"
      :items="pageMenuItems"
      @close="pageMenu = null"
    />
    <ContextMenu
      v-if="blockMenu"
      :key="blockMenu.blockId"
      :x="blockMenu.x"
      :y="blockMenu.y"
      :label="blockMenuLabel"
      :items="blockMenuItems"
      @close="blockMenu = null"
    />
    <SharePanel
      v-if="shareOpen && loaded"
      :spreadsheet-id="spreadsheetId"
      :owner="store.spreadsheet?.role === 'owner'"
      :user-id="session.user?.id"
      @close="activeSidePane.close(SIDE_PANES.share)"
      @left="router.push({ name: 'spreadsheets' })"
    />
    <ErrorsPanel
      v-if="errorsOpen && loaded"
      @close="activeSidePane.close(SIDE_PANES.errors)"
      @go="goToError"
    />
    <FindPanel
      v-if="findOpen && loaded && page"
      ref="findPanel"
      :page-id="page.id"
      :block-id="findBlockId"
      @close="activeSidePane.close(SIDE_PANES.find)"
      @go="goToMatch"
    />
    <AssertionsPanel
      v-if="assertionsOpen && loaded"
      @close="activeSidePane.close(SIDE_PANES.assertions)"
      @go="goToAssertion"
    />
    <HistoryPanel
      v-if="historyOpen && loaded"
      :spreadsheet-id="spreadsheetId"
      :can-restore="store.canEdit"
      @close="activeSidePane.close(SIDE_PANES.history)"
      @restored="reload"
      @copied="openCopy"
    />
    <RunsPanel
      v-if="runsOpen && loaded"
      :spreadsheet-id="spreadsheetId"
      @close="activeSidePane.close(SIDE_PANES.runs)"
    />

    <NoticeMessage v-if="store.notice" :notice="store.notice" @dismiss="store.notice = null" />
  </div>
</template>
