<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { DocumentError, ErrorTraceFrame } from "@spreadsheet-app/engine";
import { useWorkbookStore } from "../stores/workbook";
import ErrorTrace from "./ErrorTrace.vue";

const store = useWorkbookStore();
const emit = defineEmits<{
  close: [];
  go: [target: DocumentError];
  trace: [trace: ErrorTraceFrame[]];
}>();
const panel = ref<HTMLElement>();
const opener = document.activeElement;
function locationAccessibleName(failure: DocumentError): string {
  const pageName = store.pages.find((page) => page.id === failure.pageId)?.name ?? "Unknown page";
  return `Go to ${failure.code} in ${failure.label} on page ${pageName}: ${failure.message}`;
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
      <button type="button" aria-label="Close errors" @click="emit('close')">×</button>
    </header>
    <p v-if="store.errors.length === 0">No errors in this document.</p>
    <ul v-else class="assertions__list">
      <li v-for="(failure, index) in store.errors" :key="index">
        <button
          type="button"
          class="errors__location"
          :aria-label="locationAccessibleName(failure)"
          @click="emit('go', failure)"
        >
          <span>{{ store.pages.find((page) => page.id === failure.pageId)?.name }}</span>
          <strong>{{ failure.label }}</strong>
          <span class="errors__code">{{ failure.code }}</span>
          <span v-if="failure.message !== failure.code">{{ failure.message }}</span>
        </button>
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
