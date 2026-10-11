<script setup lang="ts">
import { nextTick } from "vue";
import { useWorkbookStore } from "../stores/workbook";
import { focusBlock } from "./focusBlock";

/**
 * `position` is the place a new block takes on the page. With `blockRowId`,
 * the block goes in that row of blocks, and `position` is its place in the row.
 */
const props = defineProps<{ pageId: string; position: number; blockRowId?: string }>();
const store = useWorkbookStore();

async function addBlock(event: MouseEvent, add: () => Promise<boolean>): Promise<void> {
  const trigger = event.currentTarget;
  if (!(trigger instanceof HTMLButtonElement)) return;
  const addRow = trigger.closest<HTMLElement>(".editor__add");
  const focusAtClick = document.activeElement;
  const onPage = () =>
    [...store.tables, ...store.views, ...store.blockRows].filter(
      (block) => block.pageId === props.pageId,
    );
  const existing = new Set(onPage().map((block) => block.id));
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
  const added = onPage().find((block) => !existing.has(block.id));
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
    :aria-label="blockRowId ? 'Add block to this row' : `Insert block at position ${position + 1}`"
    :data-insert-position="position"
  >
    <button
      type="button"
      data-add-block-type="table"
      @click="addBlock($event, () => store.addTable(pageId, position, blockRowId))"
    >
      Add table
    </button>
    <button
      type="button"
      data-add-block-type="chart"
      @click="addBlock($event, () => store.addView(pageId, 'chart', position, blockRowId))"
    >
      Add chart
    </button>
    <button
      type="button"
      data-add-block-type="text"
      @click="addBlock($event, () => store.addView(pageId, 'text', position, blockRowId))"
    >
      Add text
    </button>
    <button
      type="button"
      data-add-block-type="script"
      @click="addBlock($event, () => store.addView(pageId, 'script', position, blockRowId))"
    >
      Add script
    </button>
    <!-- A row holds tables and views, so it is offered on the page only. -->
    <button
      v-if="!blockRowId"
      type="button"
      data-add-block-type="row"
      @click="addBlock($event, () => store.addBlockRow(pageId, position))"
    >
      Add row
    </button>
  </div>
</template>
