<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useWorkbookStore } from "../stores/workbook";
import { useCopyFeedback } from "./useCopyFeedback";

const store = useWorkbookStore();
const emit = defineEmits<{
  close: [];
  /** The user picked a failing assertion: open its page, and select its cell if it is in one. */
  go: [target: (typeof store.assertions)[number]];
}>();

const panel = ref<HTMLElement>();
const { status: copyStatus, copy } = useCopyFeedback();

function pageName(failure: (typeof store.assertions)[number]): string {
  return store.pages.find((page) => page.id === failure.pageId)?.name ?? "Unknown page";
}

function assertionText(failure: (typeof store.assertions)[number]): string {
  return `${failure.label} (page ${pageName(failure)}): ${failure.message}`;
}

function assertionKey(failure: (typeof store.assertions)[number]): string {
  const cellIdentity = failure.cell && store.identityOf(failure.cell);
  const location = failure.cell
    ? [
        "cell",
        cellIdentity?.tableId ?? failure.cell.tableId,
        cellIdentity?.rowId ?? failure.cell.row,
        cellIdentity?.colId ?? failure.cell.col,
      ]
    : failure.line !== undefined
      ? ["line", failure.blockId, failure.line]
      : failure.name !== undefined
        ? ["name", failure.blockId, failure.name]
        : ["view", failure.blockId, failure.label];
  return JSON.stringify([failure.pageId, ...location, failure.message]);
}

function copyAll(): void {
  void copy(store.assertions.map(assertionText).join("\n\n"));
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  panel.value?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <aside
    ref="panel"
    class="side-panel assertions"
    role="dialog"
    aria-label="Failing assertions"
    tabindex="-1"
  >
    <header class="side-panel__header">
      <h2>Failing assertions</h2>
      <div class="side-panel__header-actions">
        <span class="copy-status" role="status" aria-live="polite">{{ copyStatus }}</span>
        <button
          type="button"
          class="assertions__copy-all"
          :disabled="store.assertions.length === 0"
          @click="copyAll"
        >
          Copy all
        </button>
        <button type="button" aria-label="Close assertions" @click="emit('close')">×</button>
      </div>
    </header>
    <p v-if="store.assertions.length === 0">Every assertion holds.</p>
    <ul v-else class="assertions__list">
      <li v-for="failure in store.assertions" :key="assertionKey(failure)">
        <div class="assertions__content">
          <strong>{{ failure.label }}</strong>
          <span>{{ failure.message }}</span>
        </div>
        <div class="assertions__actions">
          <button
            type="button"
            class="assertions__go"
            :aria-label="`Go to assertion ${failure.label} on page ${pageName(failure)}`"
            @click="emit('go', failure)"
          >
            Go to assertion
          </button>
          <button
            type="button"
            class="assertions__copy"
            :aria-label="`Copy assertion ${failure.label} on page ${pageName(failure)}`"
            @click="copy(assertionText(failure))"
          >
            Copy
          </button>
        </div>
      </li>
    </ul>
  </aside>
</template>
