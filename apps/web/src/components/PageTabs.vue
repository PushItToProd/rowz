<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import type { PageRecord } from "../api/client";
import { undoNotice } from "../notice";
import { copyLinkToClipboard } from "../clipboard";
import { buildPageLink } from "../deepLinks";
import { useWorkbookStore } from "../stores/workbook";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";
import ContextMenu from "./ContextMenu.vue";
import type { MenuItem } from "./menu";
import { isBlockCollapsed, setBlocksCollapsed } from "../blockCollapse";

const props = defineProps<{ spreadsheetId: string; activePageId: string }>();
const store = useWorkbookStore();
const router = useRouter();
const pageMenu = ref<{
  x: number;
  y: number;
  pageId: string;
  restoreFocusTarget: () => HTMLElement | null;
} | null>(null);

function route(pageId: string) {
  return { name: "editor", params: { spreadsheetId: props.spreadsheetId, pageId } };
}

function open(pageId: string): Promise<unknown> {
  if (pageId === props.activePageId) return Promise.resolve();
  return router.push(route(pageId));
}

async function add(): Promise<void> {
  const page = await store.addPage();
  if (page) await open(page.id);
}

async function remove(page: PageRecord): Promise<void> {
  const next = store.pages.find((candidate) => candidate.id !== page.id);
  if (!(await store.deletePage(page.id))) return;
  store.notice = undoNotice(`Deleted page ${page.name}`, () => void store.undo());
  if (next && page.id === props.activePageId) {
    await open(next.id);
  }
}

function pageAt(pageId: string): PageRecord | undefined {
  return store.pages.find((page) => page.id === pageId);
}

function pageFocusTarget(index: number): HTMLElement | null {
  const page = store.pages[Math.max(0, Math.min(index, store.pages.length - 1))];
  return (
    (page &&
      document
        .getElementById(`page-tab-${page.id}`)
        ?.querySelector<HTMLElement>(".editable-name:not(input)")) ??
    document.querySelector<HTMLElement>(".page-tabs__add")
  );
}

function showPageMenu(page: PageRecord, x: number, y: number): void {
  const pageIndex = store.pages.findIndex((candidate) => candidate.id === page.id);
  const name = document
    .getElementById(`page-tab-${page.id}`)
    ?.querySelector<HTMLElement>(".editable-name:not(input)");
  name?.focus({ preventScroll: true });
  pageMenu.value = {
    x,
    y,
    pageId: page.id,
    restoreFocusTarget: () => pageFocusTarget(pageIndex),
  };
}

function onPageContextMenu(event: MouseEvent, page: PageRecord): void {
  event.preventDefault();
  event.stopPropagation();
  showPageMenu(page, event.clientX, event.clientY);
}

function onPageKeydown(event: KeyboardEvent, page: PageRecord): void {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  if (event.target instanceof Element && event.target.closest("button, input")) return;
  event.preventDefault();
  event.stopPropagation();
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  showPageMenu(page, box.left, box.bottom);
}

function renamePage(pageId: string): void {
  // Let the menu unmount and restore focus before using EditableName's F2 flow.
  void nextTick(() => {
    const name = document
      .getElementById(`page-tab-${pageId}`)
      ?.querySelector<HTMLElement>(".editable-name:not(input)");
    if (!name) return;
    name.focus({ preventScroll: true });
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
  });
}

async function copyPageLink(pageId: string): Promise<void> {
  if (await copyLinkToClipboard(buildPageLink(props.spreadsheetId, pageId)))
    store.notice = { kind: "success", text: "Copied" };
}

const pageMenuItems = computed((): MenuItem[] => {
  const page = pageAt(pageMenu.value?.pageId ?? "");
  if (!page) return [];
  const blockIds = [...store.tables, ...store.views]
    .filter((block) => block.pageId === page.id)
    .map((block) => block.id);
  const allCollapsed =
    blockIds.length > 0 && blockIds.every((id) => isBlockCollapsed(props.spreadsheetId, id));
  const collapseItem: MenuItem = {
    label: allCollapsed ? "Expand all" : "Collapse all",
    disabled: blockIds.length === 0,
    run: () => {
      setBlocksCollapsed(props.spreadsheetId, blockIds, !allCollapsed);
    },
  };
  const copyItem: MenuItem = {
    label: "Copy link to this page",
    run: () => void copyPageLink(page.id),
  };
  if (!store.canEdit) return [copyItem, collapseItem];
  const index = store.pages.findIndex((candidate) => candidate.id === page.id);
  return [
    copyItem,
    collapseItem,
    {
      label: "Rename",
      separated: true,
      run: () => {
        renamePage(page.id);
      },
    },
    ...(store.pages.length > 1 ? [{ label: "Delete", danger: true, run: () => remove(page) }] : []),
    {
      label: "Move left",
      disabled: index === 0,
      separated: true,
      run: () => void store.movePage(page.id, -1),
    },
    {
      label: "Move right",
      disabled: index === store.pages.length - 1,
      run: () => void store.movePage(page.id, 1),
    },
  ];
});
</script>

<template>
  <nav class="page-tabs" aria-label="Pages">
    <div
      v-for="(page, index) in store.pages"
      :id="`page-tab-${page.id}`"
      :key="page.id"
      :data-page-id="page.id"
      class="page-tabs__tab"
      :class="{ 'page-tabs__tab--active': page.id === activePageId }"
      :aria-current="page.id === activePageId ? 'page' : undefined"
      @click="open(page.id)"
      @contextmenu="onPageContextMenu($event, page)"
      @keydown="onPageKeydown($event, page)"
    >
      <ErrorWarning v-if="store.errorPages.has(page.id)" :label="`${page.name} contains errors`" />
      <!-- The name is a link, so the keyboard reaches each page. The tab around it takes the click. -->
      <EditableName
        :value="page.name"
        label="Page name"
        :href="router.resolve(route(page.id)).href"
        :click-to-edit="page.id === activePageId"
        :disabled="!store.canEdit"
        @click.prevent
        @rename="store.renamePage(page.id, $event)"
      />
      <!-- The open page can be moved among the tabs. -->
      <template v-if="store.canEdit && store.pages.length > 1 && page.id === activePageId">
        <button
          type="button"
          class="page-tabs__move"
          title="Move left"
          :aria-label="`Move ${page.name} left`"
          :disabled="index === 0"
          @click.stop="store.movePage(page.id, -1)"
        >
          ‹
        </button>
        <button
          type="button"
          class="page-tabs__move"
          title="Move right"
          :aria-label="`Move ${page.name} right`"
          :disabled="index === store.pages.length - 1"
          @click.stop="store.movePage(page.id, 1)"
        >
          ›
        </button>
      </template>
      <button
        v-if="store.canEdit && store.pages.length > 1"
        type="button"
        class="page-tabs__delete"
        :aria-label="`Delete page ${page.name}`"
        title="Delete page"
        @click.stop="remove(page)"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M2.5 4.5h11M6 2.5h4" />
          <path d="m4 4.5.6 9h6.8l.6-9M6.5 6.5v4.5m3-4.5v4.5" />
        </svg>
      </button>
    </div>
    <button v-if="store.canEdit" type="button" class="page-tabs__add" @click="add">Add page</button>
  </nav>
  <ContextMenu
    v-if="pageMenu"
    :key="pageMenu.pageId"
    :x="pageMenu.x"
    :y="pageMenu.y"
    :label="`Actions for ${pageAt(pageMenu.pageId)?.name ?? 'page'}`"
    :items="pageMenuItems"
    :restore-focus-target="pageMenu.restoreFocusTarget"
    @close="pageMenu = null"
  />
</template>
