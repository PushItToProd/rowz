<script setup lang="ts">
import { useRouter } from "vue-router";
import type { PageRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import EditableName from "./EditableName.vue";

const props = defineProps<{ spreadsheetId: string; activePageId: string }>();
const store = useWorkbookStore();
const router = useRouter();

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
  if (!window.confirm(`Delete ${page.name} and every table on it?`)) return;
  const next = store.pages.find((candidate) => candidate.id !== page.id);
  if ((await store.deletePage(page.id)) && next && page.id === props.activePageId) {
    await open(next.id);
  }
}
</script>

<template>
  <nav class="page-tabs" aria-label="Pages">
    <div
      v-for="page in store.pages"
      :key="page.id"
      class="page-tabs__tab"
      :class="{ 'page-tabs__tab--active': page.id === activePageId }"
      :aria-current="page.id === activePageId ? 'page' : undefined"
      @click="open(page.id)"
    >
      <!-- The name is a link, so the keyboard reaches each page. The tab around it takes the click. -->
      <EditableName
        :value="page.name"
        label="Page name"
        :href="router.resolve(route(page.id)).href"
        :disabled="!store.canEdit"
        @click.prevent
        @rename="store.renamePage(page.id, $event)"
      />
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
</template>
