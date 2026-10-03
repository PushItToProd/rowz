<script setup lang="ts">
import type { TableName } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, ref, watch } from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import EditableName from "./EditableName.vue";
import { shown } from "./shownValue";

const props = defineProps<{
  table: TableRecord;
  /** A formula to start a new name with, such as the address of the selected range. */
  suggestion?: string;
}>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkbookStore();

const newName = ref("");
const newFormula = ref(props.suggestion ?? "");
const nameInput = ref<HTMLInputElement>();

// A range chosen from the menu starts a new name, whatever was being typed.
watch(
  () => props.suggestion,
  async (suggestion) => {
    if (suggestion === undefined) return;
    newFormula.value = suggestion;
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

const replace = (names: TableName[]): Promise<boolean> =>
  store.setTableNames(props.table.id, names);

async function add(): Promise<void> {
  const name = newName.value.trim();
  const formula = newFormula.value.trim();
  if (name === "" || formula === "") return;
  if (await replace([...props.table.names, { name, formula }])) {
    newName.value = "";
    newFormula.value = "";
  }
}

function change(index: number, changes: Partial<TableName>): void {
  void replace(
    props.table.names.map((current, position) =>
      position === index ? { ...current, ...changes } : current,
    ),
  );
}

function onFormula(index: number, event: Event): void {
  const formula = (event.target as HTMLInputElement).value.trim();
  if (formula !== "" && formula !== props.table.names[index]?.formula) change(index, { formula });
}

function remove(index: number): void {
  void replace(props.table.names.filter((_, position) => position !== index));
}
</script>

<template>
  <section class="names-panel" :aria-label="`Names in ${table.name}`">
    <table v-if="table.names.length > 0">
      <tbody>
        <tr v-for="(entry, index) in held" :key="entry.name" :data-name="entry.name">
          <th scope="row">
            <EditableName
              :value="entry.name"
              label="Name"
              :disabled="!store.canEdit"
              @rename="change(index, { name: $event })"
            />
          </th>
          <td>
            <input
              :value="entry.formula"
              class="names-panel__formula"
              aria-label="Formula of the name"
              spellcheck="false"
              :disabled="!store.canEdit"
              :maxlength="LIMITS.inputLength"
              @change="onFormula(index, $event)"
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
              @click="remove(index)"
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
      />
      <input
        v-model="newFormula"
        aria-label="Formula of the new name"
        placeholder="Formula, such as B2:B9"
        spellcheck="false"
        :maxlength="LIMITS.inputLength"
      />
      <button type="submit" :disabled="newName.trim() === '' || newFormula.trim() === ''">
        Add name
      </button>
      <button type="button" @click="emit('close')">Close</button>
    </form>
    <button v-else type="button" @click="emit('close')">Close</button>
  </section>
</template>
