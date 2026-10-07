<script setup lang="ts">
import { FORMAT_ALIGNMENTS, FORMAT_COLORS, type FormatPatch } from "@spreadsheet-app/engine";
import { computed } from "vue";
import { useWorkbookStore } from "../stores/workbook";
import { useFormulaSessionStore } from "../formula/session";
import { useReferencePickingStore } from "../formula/picking";

const store = useWorkbookStore();
const sessions = useFormulaSessionStore();
const picking = useReferencePickingStore();
const draftActive = computed(() => Boolean(sessions.active) || picking.connected);
function history(direction: "undo" | "redo"): void {
  if (draftActive.value) picking.draftHistory(direction);
  else void store[direction]();
}
function preserveDraftFocus(event: MouseEvent): void {
  if (draftActive.value) event.preventDefault();
}

/** The format of the selected cell, which is what the controls show. */
const current = computed(() => (store.selection ? store.formatOf(store.selection) : {}));

/** Number and date formats offered by name. Each is a format `TEXT` takes. */
const NUMBER_FORMATS = [
  ["0", "1235"],
  ["0.00", "1234.50"],
  ["#,##0", "1,235"],
  ["#,##0.00", "1,234.50"],
  ["$#,##0.00", "$1,234.50"],
  ["0%", "50%"],
  ["0.0%", "50.0%"],
  ["yyyy-mm-dd", "2026-09-30"],
  ["mmm d, yyyy", "Sep 30, 2026"],
  ["d mmm yyyy", "30 Sep 2026"],
  ["hh:mm", "14:05"],
] as const;

const ALIGN_LABELS = { left: "Left", center: "Center", right: "Right" } as const;

function apply(patch: FormatPatch): void {
  void store.formatSelection(patch);
}

/** Applies the choice made in a select, where the empty choice goes back to the default. */
function choose(property: "align" | "numberFormat" | "color" | "fill", event: Event): void {
  const { value } = event.target as HTMLSelectElement;
  apply({ [property]: value === "" ? null : value });
}
</script>

<template>
  <div class="format-bar" role="toolbar" aria-label="Format">
    <button
      type="button"
      title="Undo (Ctrl+Z)"
      aria-label="Undo"
      :disabled="draftActive ? !picking.canUndo : !store.canUndo"
      :data-formula-field="draftActive ? '' : undefined"
      @mousedown="preserveDraftFocus"
      @click="history('undo')"
    >
      ↶
    </button>
    <button
      type="button"
      title="Redo (Ctrl+Y)"
      aria-label="Redo"
      :disabled="draftActive ? !picking.canRedo : !store.canRedo"
      :data-formula-field="draftActive ? '' : undefined"
      @mousedown="preserveDraftFocus"
      @click="history('redo')"
    >
      ↷
    </button>
    <button
      type="button"
      class="format-bar__toggle format-bar__bold"
      title="Bold"
      aria-label="Bold"
      :aria-pressed="current.bold === true"
      :disabled="!store.selection"
      @click="apply({ bold: current.bold !== true })"
    >
      B
    </button>
    <button
      type="button"
      class="format-bar__toggle format-bar__italic"
      title="Italic"
      aria-label="Italic"
      :aria-pressed="current.italic === true"
      :disabled="!store.selection"
      @click="apply({ italic: current.italic !== true })"
    >
      I
    </button>
    <button
      type="button"
      class="format-bar__toggle format-bar__wrap"
      title="Wrap text"
      aria-label="Wrap text"
      :aria-pressed="current.wrap === true"
      :disabled="!store.selection"
      @click="apply({ wrap: current.wrap !== true })"
    >
      Wrap
    </button>
    <select
      aria-label="Align"
      :value="current.align ?? ''"
      :disabled="!store.selection"
      @change="choose('align', $event)"
    >
      <option value="">Align</option>
      <option v-for="align in FORMAT_ALIGNMENTS" :key="align" :value="align">
        {{ ALIGN_LABELS[align] }}
      </option>
    </select>
    <select
      aria-label="Number format"
      :value="current.numberFormat ?? ''"
      :disabled="!store.selection"
      @change="choose('numberFormat', $event)"
    >
      <option value="">Number format</option>
      <option v-for="[format, example] in NUMBER_FORMATS" :key="format" :value="format">
        {{ example }}
      </option>
      <!-- A format set some other way, such as by an imported file, is shown as it is. -->
      <option
        v-if="
          current.numberFormat &&
          !NUMBER_FORMATS.some(([format]) => format === current.numberFormat)
        "
        :value="current.numberFormat"
      >
        {{ current.numberFormat }}
      </option>
    </select>
    <select
      aria-label="Text color"
      :value="current.color ?? ''"
      :disabled="!store.selection"
      @change="choose('color', $event)"
    >
      <option value="">Text color</option>
      <option v-for="color in FORMAT_COLORS" :key="color" :value="color">{{ color }}</option>
    </select>
    <select
      aria-label="Fill color"
      :value="current.fill ?? ''"
      :disabled="!store.selection"
      @change="choose('fill', $event)"
    >
      <option value="">Fill color</option>
      <option v-for="color in FORMAT_COLORS" :key="color" :value="color">{{ color }}</option>
    </select>
    <button type="button" :disabled="!store.selection" @click="store.formatSelection({}, true)">
      Clear format
    </button>
  </div>
</template>
