<script setup lang="ts">
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, ref } from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";

const props = defineProps<{ table: TableRecord; col: number }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkbookStore();

const column = computed(() => props.table.columns?.[props.col]);
const from = column.value?.choicesFrom;

const source = ref<"list" | "column">(from ? "column" : "list");
const list = ref((column.value?.choices ?? []).join("\n"));
/** The data tables a dropdown can take its choices from. */
const dataTables = computed(() =>
  store.tables.filter((candidate) => candidate.columns && candidate.id !== props.table.id),
);
const sourceTableId = ref(from?.tableId ?? dataTables.value[0]?.id ?? "");
const sourceTable = computed(() =>
  dataTables.value.find((table) => table.id === sourceTableId.value),
);
const sourceColId = ref(from?.colId ?? sourceTable.value?.colIds[0] ?? "");

function onTable(): void {
  sourceColId.value = sourceTable.value?.colIds[0] ?? "";
}

const choices = computed(() =>
  list.value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== ""),
);
const valid = computed(() =>
  source.value === "list"
    ? choices.value.length > 0 &&
      choices.value.length <= LIMITS.choices &&
      choices.value.every((choice) => choice.length <= LIMITS.choiceLength)
    : sourceTable.value !== undefined && sourceColId.value !== "",
);

async function save(): Promise<void> {
  if (!valid.value) return;
  const changes =
    source.value === "list"
      ? { type: "choice" as const, choices: choices.value }
      : {
          type: "choice" as const,
          choicesFrom: { tableId: sourceTableId.value, colId: sourceColId.value },
        };
  if (await store.updateColumn(props.table.id, props.col, changes)) emit("close");
}
</script>

<template>
  <form
    class="choices-panel"
    :aria-label="`Choices for ${column?.name ?? ''}`"
    @submit.prevent="save"
  >
    <fieldset>
      <legend>The dropdown offers</legend>
      <label> <input v-model="source" type="radio" value="list" /> A list of choices </label>
      <label>
        <input v-model="source" type="radio" value="column" :disabled="dataTables.length === 0" />
        The values of a column of a data table
      </label>
    </fieldset>

    <label v-if="source === 'list'" class="choices-panel__list">
      One choice on each line
      <textarea
        v-model="list"
        rows="5"
        aria-label="Choices"
        spellcheck="false"
        :maxlength="LIMITS.choices * LIMITS.choiceLength"
      ></textarea>
    </label>
    <div v-else class="choices-panel__source">
      <label>
        Table
        <select v-model="sourceTableId" aria-label="Table to take choices from" @change="onTable">
          <option v-for="candidate in dataTables" :key="candidate.id" :value="candidate.id">
            {{ candidate.name }}
          </option>
        </select>
      </label>
      <label>
        Column
        <select v-model="sourceColId" aria-label="Column to take choices from">
          <option
            v-for="(definition, index) in sourceTable?.columns ?? []"
            :key="sourceTable?.colIds[index]"
            :value="sourceTable?.colIds[index]"
          >
            {{ definition.name }}
          </option>
        </select>
      </label>
    </div>

    <div class="choices-panel__actions">
      <button type="submit" :disabled="!valid">Save choices</button>
      <button type="button" @click="emit('close')">Cancel</button>
    </div>
  </form>
</template>
