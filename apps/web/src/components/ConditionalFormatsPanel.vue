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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore, type ConditionalAction } from "../stores/workbook";
import { useDialog } from "../useDialog";

const props = defineProps<{ table: TableRecord }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkbookStore();
const dialog = useDialog();
const criterionInput = ref<HTMLInputElement>();

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});

function focus(): void {
  criterionInput.value?.focus();
}

defineExpose({ focus });

const rules = computed(() => props.table.conditionalFormats);
/** The rules as the panel lists them: the one that wins comes first, which is the last one stored. */
const listed = computed(() => rules.value.map((rule, index) => ({ rule, index })).reverse());

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
    ...(format.wrap === true
      ? ["wrap text"]
      : format.wrap === false
        ? ["no wrap"]
        : format.wrap === null
          ? ["clears wrap"]
          : []),
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
  if (range.entireColumn) {
    const start = formatAddress({ row: 0, col: range.startCol });
    const end = formatAddress({ row: 0, col: range.endCol }).replace(/\d+$/, "");
    return `${start}:${end}`;
  }
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
const wrap = ref(false);
const low = ref<FormatColor | "">("");
const high = ref<FormatColor>("green");

/** The place in the list of the rule being changed, or `null` when the form adds a new one. */
const editing = ref<number | null>(null);
const edited = computed(() => (editing.value === null ? undefined : rules.value[editing.value]));

function edit(index: number): void {
  const rule = rules.value[index];
  if (!rule) return;
  editing.value = index;
  kind.value = rule.kind;
  if (rule.kind === "criterion") {
    criterion.value = rule.criterion;
    fill.value = rule.format.fill ?? "";
    color.value = rule.format.color ?? "";
    bold.value = rule.format.bold === true;
    wrap.value = rule.format.wrap === true;
  } else {
    low.value = rule.low ?? "";
    high.value = rule.high;
    wrap.value = false;
  }
}

/** Moves a rule one place in the stored order, and keeps the form on the rule it was changing. */
async function move(index: number, by: -1 | 1): Promise<void> {
  const moved = await store.moveConditionalFormat(props.table.id, index, by);
  if (!moved) return;
  if (editing.value === index) editing.value = index + by;
  else if (editing.value === index + by) editing.value = index;
}

async function remove(index: number, rule: ConditionalRule): Promise<void> {
  if (
    !(await dialog.confirm({
      title: "Remove conditional format",
      message: `Remove the conditional format for ${areaOf(rule)}?`,
      confirmLabel: "Remove",
      danger: true,
    }))
  )
    return;
  if (editing.value === index) editing.value = null;
  void store.removeConditionalFormat(props.table.id, index);
}

const format = computed<FormatPatch>(() => {
  // The form sets a fill, a text color, and bold. What else a rule being changed sets stays as it was.
  const kept: FormatPatch = edited.value?.kind === "criterion" ? { ...edited.value.format } : {};
  const originalWrap = edited.value?.kind === "criterion" ? edited.value.format.wrap : undefined;
  const wrapPatch = wrap.value === (originalWrap === true) ? originalWrap : wrap.value;
  delete kept.fill;
  delete kept.color;
  delete kept.bold;
  delete kept.wrap;
  return {
    ...kept,
    ...(fill.value ? { fill: fill.value } : {}),
    ...(color.value ? { color: color.value } : {}),
    ...(bold.value ? { bold: true } : {}),
    ...(wrapPatch !== undefined ? { wrap: wrapPatch } : {}),
  };
});
const action = computed<ConditionalAction>(() =>
  kind.value === "criterion"
    ? { kind: "criterion", criterion: criterion.value, format: format.value }
    : { kind: "scale", low: low.value === "" ? null : low.value, high: high.value },
);
const canSave = computed(
  () =>
    (edited.value !== undefined ||
      (selected.value !== null && rules.value.length < MAX_CONDITIONAL_RULES)) &&
    (kind.value === "scale" || Object.keys(format.value).length > 0),
);

async function save(): Promise<void> {
  if (!canSave.value) return;
  const index = editing.value;
  const saved =
    index !== null && edited.value
      ? await store.editConditionalFormat(props.table.id, index, action.value)
      : await store.addConditionalFormat(action.value);
  if (saved) editing.value = null;
}
</script>

<template>
  <section class="conditional-panel" :aria-label="`Conditional formats of ${table.name}`">
    <ul v-if="rules.length > 0" class="conditional-panel__rules">
      <li v-for="{ rule, index } in listed" :key="index">
        <span class="conditional-panel__area">{{ areaOf(rule) }}</span>
        <span>{{ describe(rule) }}</span>
        <template v-if="store.canEdit">
          <button
            type="button"
            :disabled="index === rules.length - 1"
            :aria-label="`Move the rule for ${areaOf(rule)} up`"
            @click="move(index, 1)"
          >
            ↑
          </button>
          <button
            type="button"
            :disabled="index === 0"
            :aria-label="`Move the rule for ${areaOf(rule)} down`"
            @click="move(index, -1)"
          >
            ↓
          </button>
        </template>
        <button
          v-if="store.canEdit"
          type="button"
          :aria-label="`Edit the rule for ${areaOf(rule)}`"
          @click="edit(index)"
        >
          Edit
        </button>
        <button
          v-if="store.canEdit"
          type="button"
          class="danger"
          :aria-label="`Remove the rule for ${areaOf(rule)}`"
          @click="remove(index, rule)"
        >
          ×
        </button>
      </li>
    </ul>
    <p v-if="rules.length > 1" class="conditional-panel__empty">
      A rule higher in the list wins over the ones below it.
    </p>
    <p v-else-if="rules.length === 0" class="conditional-panel__empty">
      This table has no conditional formats. Select cells and add one below.
    </p>

    <form v-if="store.canEdit" class="conditional-panel__add" @submit.prevent="save">
      <p>
        <template v-if="edited">Changing the rule for {{ areaOf(edited) }}.</template>
        <template v-else-if="selected">Applies to {{ selectedText }}.</template>
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
            ref="criterionInput"
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
        <label><input v-model="wrap" type="checkbox" /> Wrap text</label>
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
        <button type="submit" :disabled="!canSave">{{ edited ? "Save rule" : "Add rule" }}</button>
        <button v-if="edited" type="button" @click="editing = null">Cancel</button>
        <button type="button" @click="emit('close')">Close</button>
      </div>
    </form>
    <button v-else type="button" @click="emit('close')">Close</button>
  </section>
</template>
