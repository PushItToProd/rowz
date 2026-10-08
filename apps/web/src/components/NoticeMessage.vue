<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import { RouterLink } from "vue-router";
import type { Notice } from "../notice";

const props = defineProps<{ notice: Notice }>();
const emit = defineEmits<{ dismiss: [] }>();

const SUCCESS_MS = 4000;
const ERROR_MS = 8000;

watch(
  () => props.notice,
  (notice, _previous, onCleanup) => {
    if (notice.action && !("run" in notice.action)) return;

    const timer = window.setTimeout(
      () => {
        if (props.notice === notice) emit("dismiss");
      },
      notice.kind === "error" ? ERROR_MS : SUCCESS_MS,
    );
    onCleanup(() => {
      window.clearTimeout(timer);
    });
  },
  { immediate: true },
);

function dismissOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("dismiss");
}

function runAction(): void {
  const action = props.notice.action;
  if (!action || !("run" in action)) return;
  action.run();
  emit("dismiss");
}

onMounted(() => {
  document.addEventListener("keydown", dismissOnEscape, true);
});
onUnmounted(() => {
  document.removeEventListener("keydown", dismissOnEscape, true);
});
</script>

<template>
  <div
    class="notice notice--floating"
    :class="`notice--${notice.kind}`"
    :role="notice.kind === 'error' ? 'alert' : 'status'"
  >
    <div v-if="notice.detail" class="notice__message">
      <p>{{ notice.text }}</p>
      <pre class="notice__detail"><code>{{ notice.detail }}</code></pre>
    </div>
    <span v-else>{{ notice.text }}</span>
    <RouterLink
      v-if="notice.action && 'to' in notice.action"
      class="notice__action"
      :to="notice.action.to"
    >
      {{ notice.action.label }}
    </RouterLink>
    <button
      v-else-if="notice.action && 'run' in notice.action"
      type="button"
      class="notice__action"
      @click="runAction"
    >
      {{ notice.action.label }}
    </button>
    <button type="button" aria-label="Dismiss" @click="emit('dismiss')">×</button>
  </div>
</template>
