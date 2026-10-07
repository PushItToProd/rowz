<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import type { PageRecord } from "../api/client";
import { undoNotice } from "../notice";
import { useWorkbookStore } from "../stores/workbook";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";
import ContextMenu from "./ContextMenu.vue";
import type { MenuItem } from "./menu";

const props = defineProps<{ spreadsheetId: string; activePageId: string }>();
const store = useWorkbookStore();
const router = useRouter();
const pageMenu = ref<{ x: number; y: number; pageId: string } | null>(null);

function route(pageId: string) {
  return { name: "editor", params: { spreadsheetId: props.spreadsheetId, pageId } };
}

function open(pageId: string): Promise<unknown> {
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

function showPageMenu(page: PageRecord, x: number, y: number): void {
  if (!store.canEdit) return;
  const name = document
    .getElementById(`page-tab-${page.id}`)
    ?.querySelector<HTMLElement>(".editable-name:not(input)");
  name?.focus({ preventScroll: true });
  pageMenu.value = { x, y, pageId: page.id };
}

function onPageContextMenu(event: MouseEvent, page: PageRecord): void {
  if (!store.canEdit) return;
  if (event.target instanceof Element && event.target.closest("button, input")) return;
  event.preventDefault();
  event.stopPropagation();
  showPageMenu(page, event.clientX, event.clientY);
}

function onPageKeydown(event: KeyboardEvent, page: PageRecord): void {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  if (event.target instanceof Element && event.target.closest("button, input")) return;
  if (!store.canEdit) return;
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

const pageMenuItems = computed((): MenuItem[] => {
  const page = pageAt(pageMenu.value?.pageId ?? "");
  if (!page || !store.canEdit) return [];
  const index = store.pages.findIndex((candidate) => candidate.id === page.id);
  return [
    {
      label: "Rename",
      run: () => {
        renamePage(page.id);
      },
    },
    ...(store.pages.length > 1
      ? [{ label: "Delete", danger: true, run: () => void remove(page) }]
      : []),
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
        :aria-label="`Delete ${page.name}`"
        @click.stop="remove(page)"
      >
        ×
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
    @close="pageMenu = null"
  />
</template>
