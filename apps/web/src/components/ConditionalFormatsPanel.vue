<script setup lang="ts">
import {
  columnLabel,
  FORMAT_COLORS,
  formatAddress,
  type ConditionalRule,
  type FormatColor,
  type FormatPatch,
} from "@spreadsheet-app/engine";
import { LIMITS, MAX_CONDITIONAL_RULES } from "@spreadsheet-app/shared";
import { computed, ref } from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";

const props = defineProps<{ table: TableRecord }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkbookStore();

const rules = computed(() => props.table.conditionalFormats);

/** The cells a rule covers, written as a range. A side with no end runs to the table's edge. */
function areaOf(rule: ConditionalRule): string {
  const end = {
    row: rule.endRow ?? Math.max(0, props.table.rowCount - 1),
    col: rule.endCol ?? props.table.colCount - 1,
  };
  const first = formatAddress({ row: rule.startRow, col: rule.startCol });
  return `${first}:${rule.endRow === null ? columnLabel(end.col) : formatAddress(end)}`;
}

const STYLE_NAMES = ["fill", "color"] as const;

/** What a criterion rule does to the cells it covers, in words. */
function describeFormat(format: FormatPatch): string {
  const parts = [
    ...STYLE_NAMES.flatMap((name) =>
      format[name] ? [`${name === "fill" ? "fill" : "text"} ${format[name]}`] : [],
    ),
    ...(format.bold ? ["bold"] : []),
    ...(format.italic ? ["italic"] : []),
    ...(format.align ? [`align ${format.align}`] : []),
    ...(format.numberFormat ? [`number format ${format.numberFormat}`] : []),
  ];
  return parts.length > 0 ? parts.join(", ") : "no change";
}

function describe(rule: ConditionalRule): string {
  return rule.kind === "criterion"
    ? `cells matching ${rule.criterion === "" ? "empty" : rule.criterion}: ${describeFormat(rule.format)}`
    : `color scale, ${rule.low ?? "no color"} to ${rule.high}`;
}

/** The selected cells, which a new rule covers. */
const selected = computed(() =>
  store.selection?.tableId === props.table.id ? store.selectedRange : null,
);
const selectedText = computed(() => {
  const range = selected.value;
  if (!range) return "";
  const row = store.rowView(props.table.id).storedRow;
  const start = formatAddress({ row: row(range.startRow), col: range.startCol });
  const end = formatAddress({ row: row(range.endRow), col: range.endCol });
  return start === end ? start : `${start}:${end}`;
});

const kind = ref<"criterion" | "scale">("criterion");
const criterion = ref(">0");
const fill = ref<FormatColor | "">("green");
const color = ref<FormatColor | "">("");
const bold = ref(false);
const low = ref<FormatColor | "">("");
const high = ref<FormatColor>("green");

const format = computed<FormatPatch>(() => ({
  ...(fill.value ? { fill: fill.value } : {}),
  ...(color.value ? { color: color.value } : {}),
  ...(bold.value ? { bold: true } : {}),
}));
const canAdd = computed(
  () =>
    selected.value !== null &&
    rules.value.length < MAX_CONDITIONAL_RULES &&
    (kind.value === "scale" || Object.keys(format.value).length > 0),
);

async function add(): Promise<void> {
  if (!canAdd.value) return;
  await store.addConditionalFormat(
    kind.value === "criterion"
      ? { kind: "criterion", criterion: criterion.value, format: format.value }
      : { kind: "scale", low: low.value === "" ? null : low.value, high: high.value },
  );
}
</script>

<template>
  <section class="conditional-panel" :aria-label="`Conditional formats of ${table.name}`">
    <ul v-if="rules.length > 0" class="conditional-panel__rules">
      <li v-for="(rule, index) in rules" :key="index">
        <span class="conditional-panel__area">{{ areaOf(rule) }}</span>
        <span>{{ describe(rule) }}</span>
        <button
          v-if="store.canEdit"
          type="button"
          class="danger"
          :aria-label="`Remove the rule for ${areaOf(rule)}`"
          @click="store.removeConditionalFormat(table.id, index)"
        >
          ×
        </button>
      </li>
    </ul>
    <p v-else class="conditional-panel__empty">
      This table has no conditional formats. Select cells and add one below.
    </p>

    <form v-if="store.canEdit" class="conditional-panel__add" @submit.prevent="add">
      <p>
        <template v-if="selected">Applies to {{ selectedText }}.</template>
        <template v-else>Select the cells the rule is for.</template>
      </p>
      <fieldset>
        <legend>Rule</legend>
        <label
          ><input v-model="kind" type="radio" value="criterion" /> Format cells that match</label
        >
        <label><input v-model="kind" type="radio" value="scale" /> Color scale</label>
      </fieldset>
      <template v-if="kind === 'criterion'">
        <label>
          Criterion
          <input
            v-model="criterion"
            aria-label="Criterion"
            placeholder=">100, Done, <>"
            spellcheck="false"
            :maxlength="LIMITS.criterionLength"
          />
        </label>
        <label>
          Fill
          <select v-model="fill" aria-label="Rule fill">
            <option value="">None</option>
            <option v-for="name in FORMAT_COLORS" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label>
          Text color
          <select v-model="color" aria-label="Rule text color">
            <option value="">None</option>
            <option v-for="name in FORMAT_COLORS" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label><input v-model="bold" type="checkbox" /> Bold</label>
      </template>
      <template v-else>
        <label>
          Smallest number
          <select v-model="low" aria-label="Scale low color">
            <option value="">No color</option>
            <option v-for="name in FORMAT_COLORS" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label>
          Largest number
          <select v-model="high" aria-label="Scale high color">
            <option v-for="name in FORMAT_COLORS" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
      </template>
      <div class="conditional-panel__actions">
        <button type="submit" :disabled="!canAdd">Add rule</button>
        <button type="button" @click="emit('close')">Close</button>
      </div>
    </form>
    <button v-else type="button" @click="emit('close')">Close</button>
  </section>
</template>
