<script setup lang="ts">
import {
  formatValue,
  isError,
  isLambda,
  isRange,
  parseScript,
  type Evaluated,
} from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, ref, watch } from "vue";
import type { ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import EditableName from "./EditableName.vue";

const props = defineProps<{ view: ViewRecord }>();
const store = useWorkbookStore();

const editing = ref(false);
let editRevision = store.revision;
const draft = ref(props.view.source);
// Follow changes made elsewhere, such as a table rename rewriting a reference.
watch(
  () => props.view.source,
  (source) => {
    if (!editing.value) draft.value = source;
  },
);

const editor = ref<HTMLTextAreaElement>();

async function save(): Promise<boolean> {
  if (draft.value === props.view.source) return true;
  const saved = await store.updateView(props.view.id, { source: draft.value }, editRevision);
  if (!saved) {
    editing.value = true;
    editRevision = store.revision;
    await nextTick();
    editor.value?.focus();
  }
  return saved;
}

async function edit(): Promise<void> {
  if (!store.canEdit || editing.value) return;
  editRevision = store.revision;
  editing.value = true;
  await nextTick();
  editor.value?.focus();
}

async function finish(): Promise<void> {
  if (await save()) editing.value = false;
}

/** Leaving the source saves it and ends the edit. */
function onBlur(): void {
  void save();
  // The source still has the keyboard when it is the window that lost focus, and the edit goes on.
  if (document.activeElement !== editor.value) editing.value = false;
}

function remove(): void {
  if (window.confirm(`Delete ${props.view.name}?`)) void store.deleteView(props.view.id);
}

/** How a name's value is shown in one line: a range by its size, a function by its parameters. */
function shown(value: Evaluated | undefined): { text: string; error?: string } {
  if (value === undefined) return { text: "" };
  if (isError(value)) return { text: value.code, error: value.message ?? value.code };
  if (isRange(value)) {
    const cols = value.rows[0]?.length ?? 0;
    return { text: `${String(value.rows.length)} × ${String(cols)} values` };
  }
  if (isLambda(value)) return { text: `function (${value.params.join(", ")})` };
  return { text: formatValue(value) };
}

/** Each statement of the saved source, with the value of each name. */
const statements = computed(() =>
  parseScript(props.view.source).map((statement) => {
    if (statement.kind === "error") {
      return { line: statement.line, label: "", value: { text: "", error: statement.message } };
    }
    if (statement.kind === "expression") {
      return { line: statement.line, label: statement.formula.trim(), value: { text: "" } };
    }
    const params = statement.params ? `(${statement.params.join(", ")})` : "";
    return {
      line: statement.line,
      label: `${statement.name}${params}`,
      value: shown(store.nameValue(props.view.id, statement.name)),
    };
  }),
);
</script>

<template>
  <section class="view-card" :data-view="view.name">
    <header class="view-card__header">
      <h2>
        <EditableName
          :value="view.name"
          label="Script name"
          :disabled="!store.canEdit"
          @rename="store.updateView(view.id, { name: $event })"
        />
      </h2>
      <div v-if="store.canEdit" class="view-card__actions">
        <!-- A press on Done leaves the keyboard in the source, so the edit ends once, on the click. -->
        <button v-if="editing" type="button" @mousedown.prevent @click="finish">Done</button>
        <button v-else type="button" @click="edit">Edit</button>
        <button type="button" class="danger" @click="remove">Delete script</button>
      </div>
    </header>

    <textarea
      v-if="editing"
      ref="editor"
      v-model="draft"
      class="text-view__source"
      aria-label="Script source"
      rows="10"
      spellcheck="false"
      :maxlength="LIMITS.viewSourceLength"
      @blur="onBlur"
    ></textarea>

    <table
      class="script"
      :title="store.canEdit && !editing ? 'Double-click to edit' : undefined"
      @dblclick="edit"
    >
      <tbody>
        <tr v-for="statement in statements" :key="statement.line">
          <th scope="row" class="script__name">{{ statement.label }}</th>
          <td :class="{ script__error: statement.value.error }">
            {{ statement.value.text }}
            <span v-if="statement.value.error" class="script__reason">{{
              statement.value.error
            }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="statements.length === 0" class="view-card__problem">This script defines no names.</p>
  </section>
</template>
