<script setup lang="ts">
import type { TableName } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { EditorState } from "@codemirror/state";
import { namingContext } from "../formula/context";
import { useFormulaSessionStore } from "../formula/session";
import FormulaEditor from "./FormulaEditor.vue";
import SessionFormulaField from "./SessionFormulaField.vue";
import EditableName from "./EditableName.vue";
import { shown } from "./shownValue";

const props = defineProps<{
  table: TableRecord;
  /** A formula to start a new name with, such as the address of the selected range. */
  suggestion?: string;
}>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkbookStore();
const sessions = useFormulaSessionStore();
const newContext = shallowRef({ pageId: props.table.pageId, tableId: props.table.id });
const context = computed(() => namingContext(newContext.value));
const targetLabel = (name: string) =>
  `${store.pages.find((page) => page.id === props.table.pageId)?.name ?? "Page"} · ${props.table.name} · ${name}`;

const newName = ref("");
const newState = shallowRef(EditorState.create({ doc: props.suggestion ?? "" }));
const newFormula = computed(() => newState.value.doc.toString());
const adding = ref(false);
const newEditor = ref<{ focus(): void }>();
const nameInput = ref<HTMLInputElement>();

// A range chosen from the menu starts a new name, whatever was being typed.
watch(
  () => props.suggestion,
  async (suggestion) => {
    if (suggestion === undefined) return;
    newContext.value = { pageId: props.table.pageId, tableId: props.table.id };
    newState.value = EditorState.create({ doc: suggestion });
    await nextTick();
    nameInput.value?.focus();
  },
);

/** The table's names with their values. */
const held = computed(() =>
  props.table.names.map((name) => ({
    ...name,
    value: shown(store.nameValue(props.table.id, name.name)),
  })),
);

async function submitDraft(): Promise<boolean> {
  if (await sessions.submit(store.submitFormulaDraft)) return true;
  await nextTick();
  sessions.focus();
  return false;
}
function discardNew(): void {
  newContext.value = { pageId: props.table.pageId, tableId: props.table.id };
  newName.value = "";
  newState.value = EditorState.create({ doc: "" });
}
async function add(): Promise<void> {
  if (adding.value) return;
  adding.value = true;
  try {
    if (!(await submitDraft())) return;
    const name = newName.value.trim();
    const formula = newFormula.value.trim();
    const table = store.tables.find((table) => table.id === props.table.id);
    if (!table || name === "" || formula === "") return;
    if (await store.setTableNames(table.id, [...table.names, { name, formula }])) discardNew();
    else {
      await nextTick();
      newEditor.value?.focus();
    }
  } finally {
    adding.value = false;
  }
}
async function change(name: string, changes: Partial<TableName>): Promise<void> {
  if (!(await submitDraft())) return;
  const table = store.tables.find((table) => table.id === props.table.id);
  if (!table) return;
  await store.setTableNames(
    table.id,
    table.names.map((entry) =>
      entry.name.toLowerCase() === name.toLowerCase() ? { ...entry, ...changes } : entry,
    ),
  );
}
async function remove(name: string): Promise<void> {
  if (!(await submitDraft())) return;
  const table = store.tables.find((table) => table.id === props.table.id);
  if (table)
    await store.setTableNames(
      table.id,
      table.names.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase()),
    );
}
async function close(): Promise<void> {
  if (!(await submitDraft())) return;
  discardNew();
  emit("close");
}
function commitNew(key: "Enter" | "Tab", backwards: boolean): void {
  if (key === "Enter") {
    void add();
    return;
  }
  const controls = [
    ...document.querySelectorAll<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]',
    ),
  ];
  const index = controls.indexOf(document.activeElement as HTMLElement);
  controls[index + (backwards ? -1 : 1)]?.focus();
}
</script>

<template>
  <section class="names-panel" :aria-label="`Names in ${table.name}`">
    <table v-if="table.names.length > 0">
      <tbody>
        <tr v-for="entry in held" :key="entry.name" :data-name="entry.name">
          <th scope="row">
            <EditableName
              :value="entry.name"
              label="Name"
              :disabled="!store.canEdit"
              @rename="change(entry.name, { name: $event })"
            />
          </th>
          <td>
            <SessionFormulaField
              class="names-panel__formula"
              :target="{ kind: 'name', tableId: table.id, name: entry.name }"
              :context="{ pageId: table.pageId, tableId: table.id }"
              :value="entry.formula"
              label="Formula of the name"
              :target-label="targetLabel(entry.name)"
              :readonly="!store.canEdit"
              :max-length="LIMITS.inputLength"
            />
          </td>
          <td :class="{ script__error: entry.value.error }" class="names-panel__value">
            {{ entry.value.text }}
            <span v-if="entry.value.error" class="script__reason">{{ entry.value.error }}</span>
          </td>
          <td v-if="store.canEdit">
            <button
              type="button"
              class="danger"
              :aria-label="`Remove ${entry.name}`"
              @click="remove(entry.name)"
            >
              ×
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="names-panel__empty">
      This table holds no names. Select a range and choose "Name this range", or add one below.
    </p>

    <form v-if="store.canEdit" class="names-panel__add" @submit.prevent="add">
      <input
        ref="nameInput"
        v-model="newName"
        aria-label="New name"
        placeholder="Name"
        spellcheck="false"
        :maxlength="LIMITS.nameLength"
        :disabled="adding"
      />
      <FormulaEditor
        ref="newEditor"
        class="names-panel__formula"
        :state="newState"
        mode="formula"
        :context="context"
        label="Formula of the new name"
        :max-length="LIMITS.inputLength"
        :readonly="adding"
        @update:state="newState = $event"
        @commit="commitNew"
        @cancel="discardNew"
      />
      <button type="submit" :disabled="adding || newName.trim() === '' || newFormula.trim() === ''">
        Add name
      </button>
      <button type="button" :disabled="adding" @click="discardNew">Cancel</button>
      <button type="button" :disabled="adding" @click="close">Close</button>
    </form>
    <button v-else type="button" @click="close">Close</button>
  </section>
</template>
