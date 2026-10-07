<script setup lang="ts">
import { nextTick } from "vue";
import { useWorkbookStore } from "../stores/workbook";
import { focusBlock } from "./focusBlock";

const props = defineProps<{ pageId: string; position: number }>();
const store = useWorkbookStore();

async function addBlock(event: MouseEvent, add: () => Promise<boolean>): Promise<void> {
  const trigger = event.currentTarget;
  if (!(trigger instanceof HTMLButtonElement)) return;
  const addRow = trigger.closest<HTMLElement>(".editor__add");
  const focusAtClick = document.activeElement;
  const existing = new Set(
    [...store.tables, ...store.views]
      .filter((block) => block.pageId === props.pageId)
      .map((block) => block.id),
  );
  if (!(await add())) return;

  await nextTick();
  const active = document.activeElement;
  if (
    active !== document.body &&
    active !== trigger &&
    !addRow?.contains(active) &&
    active !== focusAtClick
  )
    return;
  const added = [...store.tables, ...store.views].find(
    (block) => block.pageId === props.pageId && !existing.has(block.id),
  );
  const card = added && document.getElementById(`block-${added.id}`);
  if (added && card instanceof HTMLElement) {
    if (store.tables.some((table) => table.id === added.id))
      store.selection = { tableId: added.id, row: 0, col: 0 };
    focusBlock(card);
  }
}
</script>

<template>
  <div
    v-if="store.canEdit"
    class="editor__add"
    role="group"
    :aria-label="`Insert block at position ${position + 1}`"
    :data-insert-position="position"
  >
    <button
      type="button"
      data-add-block-type="table"
      @click="addBlock($event, () => store.addTable(pageId, position))"
    >
      Add table
    </button>
    <button
      type="button"
      data-add-block-type="chart"
      @click="addBlock($event, () => store.addView(pageId, 'chart', position))"
    >
      Add chart
    </button>
    <button
      type="button"
      data-add-block-type="text"
      @click="addBlock($event, () => store.addView(pageId, 'text', position))"
    >
      Add text
    </button>
    <button
      type="button"
      data-add-block-type="script"
      @click="addBlock($event, () => store.addView(pageId, 'script', position))"
    >
      Add script
    </button>
  </div>
</template>
