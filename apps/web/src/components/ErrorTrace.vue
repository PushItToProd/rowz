<script setup lang="ts">
import {
  formatAddress,
  quoteName,
  type ErrorTraceCallSite,
  type ErrorTraceFrame,
} from "@spreadsheet-app/engine";
import { computed } from "vue";

const props = defineProps<{ trace: ErrorTraceFrame[] }>();
const emit = defineEmits<{ go: [trace: ErrorTraceFrame[]] }>();
const frame = computed(() => props.trace[0]);

function callSiteLabel(site: ErrorTraceCallSite): string {
  switch (site.kind) {
    case "cell":
      return `${site.tableName ? `${quoteName(site.tableName)}!` : ""}${formatAddress(site.cell)}`;
    case "script":
      return `${site.name ? `${site.name} (` : ""}${site.scriptName}, line ${String(site.line)}${site.name ? ")" : ""}`;
    case "page":
      return `${site.pageName ?? "Page"} formula`;
    case "more":
      return `… ${String(site.count)} more calls`;
  }
}

const caller = computed(() => {
  const labels: string[] = [];
  let site = frame.value?.callSite;
  while (site) {
    labels.push(callSiteLabel(site));
    site = site.kind === "more" ? undefined : site.parent;
  }
  return labels.join(" → ");
});
</script>

<template>
  <div v-if="frame" class="error-trace">
    <button type="button" class="error-trace__link" @click.stop="emit('go', trace)">
      Raised in {{ frame.function }} ({{ frame.location.scriptName }}, line
      {{ frame.location.line }})
    </button>
    <p v-if="caller" class="error-trace__callers">Called from {{ caller }}</p>
  </div>
</template>
