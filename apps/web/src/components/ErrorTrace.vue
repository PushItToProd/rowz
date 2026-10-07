<script setup lang="ts">
import type { ErrorTraceFrame } from "@spreadsheet-app/engine";
import { computed } from "vue";
import { renderErrorTraceText } from "./errorTraceText";

const props = defineProps<{ trace: ErrorTraceFrame[] }>();
const emit = defineEmits<{ go: [trace: ErrorTraceFrame[]] }>();
const frame = computed(() => props.trace[0]);
const traceLines = computed(() => renderErrorTraceText(props.trace));
const raisedText = computed(() => traceLines.value[0] ?? "");
const callerText = computed(() => traceLines.value[1]);
</script>

<template>
  <div v-if="frame" class="error-trace">
    <div class="error-trace__row">
      <span class="error-trace__text">{{ raisedText }}</span>
      <button
        type="button"
        class="error-trace__link"
        :aria-label="`Go to where it was raised: ${frame.function}, ${frame.location.scriptName}, line ${String(frame.location.line)}`"
        @click.stop="emit('go', trace)"
      >
        Open definition
      </button>
    </div>
    <p v-if="callerText" class="error-trace__callers">{{ callerText }}</p>
  </div>
</template>
