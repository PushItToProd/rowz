<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useWorkbookStore } from "../stores/workbook";

const store = useWorkbookStore();
const emit = defineEmits<{
  close: [];
  /** The user picked a failing assertion: open its page, and select its cell if it is in one. */
  go: [target: (typeof store.assertions)[number]];
}>();

const panel = ref<HTMLElement>();

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
      <button type="button" aria-label="Close assertions" @click="emit('close')">×</button>
    </header>
    <p v-if="store.assertions.length === 0">Every assertion holds.</p>
    <ul v-else class="assertions__list">
      <li v-for="(failure, index) in store.assertions" :key="index">
        <button type="button" @click="emit('go', failure)">
          <strong>{{ failure.label }}</strong>
          <span>{{ failure.message }}</span>
        </button>
      </li>
    </ul>
  </aside>
</template>
