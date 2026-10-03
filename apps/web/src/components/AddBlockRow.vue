<script setup lang="ts">
import { useWorkbookStore } from "../stores/workbook";

defineProps<{ pageId: string; position: number }>();
const store = useWorkbookStore();
</script>

<template>
  <div
    v-if="store.canEdit"
    class="editor__add"
    role="group"
    :aria-label="`Insert block at position ${position + 1}`"
    :data-insert-position="position"
  >
    <button type="button" @click="store.addTable(pageId, position)">Add table</button>
    <button type="button" @click="store.addView(pageId, 'chart', position)">Add chart</button>
    <button type="button" @click="store.addView(pageId, 'text', position)">Add text</button>
    <button type="button" @click="store.addView(pageId, 'script', position)">Add script</button>
  </div>
</template>
