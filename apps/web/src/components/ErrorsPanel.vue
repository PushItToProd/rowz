<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { DocumentError, ErrorTraceFrame } from "@spreadsheet-app/engine";
import { useWorkbookStore } from "../stores/workbook";
import ErrorTrace from "./ErrorTrace.vue";
import { renderErrorTraceText } from "./errorTraceText";
import { useCopyFeedback } from "./useCopyFeedback";

const store = useWorkbookStore();
const emit = defineEmits<{
  close: [];
  go: [target: DocumentError];
  trace: [trace: ErrorTraceFrame[]];
}>();
const panel = ref<HTMLElement>();
const opener = document.activeElement;
const { status: copyStatus, copy } = useCopyFeedback();

function pageName(failure: DocumentError): string {
  return store.pages.find((page) => page.id === failure.pageId)?.name ?? "Unknown page";
}

function locationAccessibleName(failure: DocumentError): string {
  return `Go to ${failure.code} in ${failure.label} on page ${pageName(failure)}: ${failure.message}`;
}

function errorKey(failure: DocumentError): string {
  const cellIdentity = failure.cell && store.identityOf(failure.cell);
  const table = store.tables.find((candidate) => candidate.id === failure.blockId);
  const location = failure.cell
    ? [
        "cell",
        cellIdentity?.tableId ?? failure.cell.tableId,
        cellIdentity?.rowId ?? failure.cell.row,
        cellIdentity?.colId ?? failure.cell.col,
      ]
    : failure.filter
      ? ["filter", failure.blockId]
      : failure.column !== undefined
        ? ["column", failure.blockId, table?.colIds[failure.column] ?? failure.column]
        : failure.line !== undefined
          ? ["line", failure.blockId, failure.line]
          : failure.name !== undefined
            ? ["name", failure.blockId, failure.name]
            : ["view", failure.blockId, failure.label];
  return JSON.stringify([failure.pageId, ...location, failure.code, failure.message]);
}

function errorText(failure: DocumentError): string {
  const message = failure.message === failure.code ? "" : `: ${failure.message}`;
  return [
    `${failure.code} in ${failure.label} (page ${pageName(failure)})${message}`,
    ...renderErrorTraceText(failure.trace ?? []),
  ].join("\n");
}

function copyAll(): void {
  void copy(store.errors.map(errorText).join("\n\n"));
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}
onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  panel.value?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  if (
    opener instanceof HTMLElement &&
    (panel.value?.contains(document.activeElement) || document.activeElement === document.body)
  )
    opener.focus({ preventScroll: true });
});
</script>

<template>
  <aside
    ref="panel"
    class="side-panel errors"
    role="dialog"
    aria-label="Document errors"
    tabindex="-1"
  >
    <header class="side-panel__header">
      <h2>Document errors</h2>
      <div class="side-panel__header-actions">
        <span class="copy-status" role="status" aria-live="polite">{{ copyStatus }}</span>
        <button
          type="button"
          class="errors__copy-all"
          :disabled="store.errors.length === 0"
          @click="copyAll"
        >
          Copy all
        </button>
        <button type="button" aria-label="Close errors" @click="emit('close')">×</button>
      </div>
    </header>
    <p v-if="store.errors.length === 0">No errors in this document.</p>
    <ul v-else class="assertions__list">
      <li v-for="failure in store.errors" :key="errorKey(failure)">
        <div class="errors__content">
          <span class="errors__page">{{ pageName(failure) }}</span>
          <strong>{{ failure.label }}</strong>
          <span class="errors__code">{{ failure.code }}</span>
          <span v-if="failure.message !== failure.code">{{ failure.message }}</span>
        </div>
        <div class="errors__actions">
          <button
            type="button"
            class="errors__location"
            :aria-label="locationAccessibleName(failure)"
            @click="emit('go', failure)"
          >
            <span aria-hidden="true">↗</span> Go to error
          </button>
          <button
            type="button"
            class="errors__copy"
            :aria-label="`Copy ${failure.code} in ${failure.label} on page ${pageName(failure)}`"
            @click="copy(errorText(failure))"
          >
            Copy
          </button>
        </div>
        <ErrorTrace
          v-if="failure.trace?.length"
          class="errors__trace"
          :trace="failure.trace"
          @go="emit('trace', $event)"
        />
      </li>
    </ul>
  </aside>
</template>
