<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SearchScope, ReplaceReport } from "@spreadsheet-app/shared";
import { useWorkbookStore } from "../stores/workbook";
import type { SearchMatch } from "../stores/workbook/search";

const props = defineProps<{ pageId: string; blockId?: string }>();
const emit = defineEmits<{ close: []; go: [match: SearchMatch] }>();
const store = useWorkbookStore();
const query = ref("");
const replacement = ref("");
const mode = ref<"inputs" | "values">("inputs");
const caseSensitive = ref(false);
const whole = ref(false);
const scopeKind = ref<"document" | "page" | "block">("document");
const scope = computed<SearchScope>(() =>
  scopeKind.value === "document"
    ? { kind: "document" }
    : {
        kind: scopeKind.value,
        id: scopeKind.value === "page" ? props.pageId : (props.blockId ?? ""),
      },
);
const found = computed(() =>
  store.find(
    query.value,
    scope.value,
    { caseSensitive: caseSensitive.value, whole: whole.value },
    mode.value,
  ),
);
const matches = computed(() => found.value.matches);
const report = ref<ReplaceReport>();
const index = ref(-1);
const selected = computed(() => matches.value[index.value]);
watch([query, mode, caseSensitive, whole, scope], () => {
  index.value = -1;
});
watch(matches, () => {
  if (index.value >= matches.value.length) index.value = -1;
});
function go(at: number) {
  if (!matches.value.length) return;
  index.value = (at + matches.value.length) % matches.value.length;
  const match = matches.value[index.value];
  if (match) emit("go", match);
}
function next(back = false) {
  go(index.value < 0 ? (back ? matches.value.length - 1 : 0) : index.value + (back ? -1 : 1));
}
function panelKey(event: KeyboardEvent) {
  if (
    event.key !== "Enter" ||
    (event.target instanceof Element &&
      event.target.closest("button, select, input[type=checkbox]"))
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  next(event.shiftKey);
}
defineExpose({ next, focus: () => input.value?.focus() });
const busy = ref(false);
async function replace(all: boolean) {
  const match = selected.value;
  if (!all && !match?.replaceable) return;
  busy.value = true;
  try {
    report.value = await store.replace({
      query: query.value,
      replacement: replacement.value,
      scope: scope.value,
      caseSensitive: caseSensitive.value,
      whole: whole.value,
      ...(!all && match
        ? { one: { target: match.target, offset: match.offset, expected: match.text } }
        : {}),
    });
  } finally {
    busy.value = false;
  }
}
const input = ref<HTMLInputElement>();
const panel = ref<HTMLElement>();
const opener = document.activeElement;
onMounted(() => {
  void nextTick(() => input.value?.focus());
});
onBeforeUnmount(() => {
  if (
    opener instanceof HTMLElement &&
    opener.isConnected &&
    panel.value?.contains(document.activeElement)
  )
    opener.focus();
});
</script>

<template>
  <aside
    ref="panel"
    class="side-panel find-panel"
    role="dialog"
    aria-label="Find and replace"
    @keydown.esc.stop.prevent="emit('close')"
    @keydown="panelKey"
  >
    <header class="side-panel__header">
      <h2>Find and replace</h2>
      <button type="button" aria-label="Close find" @click="emit('close')">×</button>
    </header>
    <label>Find <input ref="input" v-model="query" aria-label="Find text" type="text" /></label>
    <label
      >Search
      <select v-model="mode" aria-label="Search mode">
        <option value="inputs">Stored inputs</option>
        <option value="values">Displayed values</option>
      </select></label
    >
    <label
      >Scope
      <select v-model="scopeKind" aria-label="Search scope">
        <option value="document">Whole document</option>
        <option value="page">Current page</option>
        <option value="block" :disabled="!blockId">Current block</option>
      </select></label
    >
    <label><input v-model="caseSensitive" type="checkbox" /> Case sensitive</label>
    <label><input v-model="whole" type="checkbox" /> Whole cell / entire source</label>
    <p role="status">
      {{ found.total }} {{ found.total === 1 ? "match" : "matches"
      }}<template v-if="found.total > matches.length">, showing first {{ matches.length }}</template
      ><template v-if="selected"> · {{ index + 1 }} of {{ matches.length }}</template>
    </p>
    <div>
      <button type="button" :disabled="!matches.length" @click="next(true)">Previous</button>
      <button type="button" :disabled="!matches.length" @click="next()">Next</button>
    </div>
    <template v-if="store.canEdit">
      <label
        >Replace with <input v-model="replacement" aria-label="Replace with" type="text"
      /></label>
      <p v-if="mode === 'values'">
        Select Stored inputs to replace cell inputs. Replacements include formulas and sources.
      </p>
      <div>
        <button
          type="button"
          :disabled="busy || mode !== 'inputs' || !selected?.replaceable"
          @click="replace(false)"
        >
          Replace one
        </button>
        <button
          type="button"
          :disabled="busy || mode !== 'inputs' || !query || !found.total"
          @click="replace(true)"
        >
          Replace all
        </button>
      </div>
    </template>
    <section v-if="report && report.skippedCount > 0" aria-label="Skipped replacements">
      <p>
        {{ report.skippedCount }} {{ report.skippedCount === 1 ? "item" : "items" }} skipped: would
        not parse
      </p>
      <ul>
        <li v-for="(item, at) in report.skipped" :key="at">{{ item.label }} — {{ item.reason }}</li>
      </ul>
    </section>
    <ul class="assertions__list">
      <li v-for="(match, at) in matches" :key="at">
        <button type="button" :aria-current="index === at ? 'true' : undefined" @click="go(at)">
          <strong>{{ match.label }}</strong
          ><span
            >{{ match.text.slice(Math.max(0, match.offset - 30), match.offset)
            }}<mark>{{ match.text.slice(match.offset, match.offset + query.length) }}</mark
            >{{
              match.text.slice(match.offset + query.length, match.offset + query.length + 60)
            }}</span
          >
        </button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.find-panel {
  overflow-y: auto;
}
.find-panel > label {
  display: block;
  margin: 0.75rem 0;
}
.find-panel input[type="text"],
.find-panel select {
  width: 100%;
}
.find-panel [aria-current="true"] {
  outline: 2px solid var(--accent, #2563eb);
}
</style>
