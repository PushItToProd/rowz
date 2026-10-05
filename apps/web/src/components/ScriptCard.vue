<script setup lang="ts">
import { parseScript } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed } from "vue";
import type { ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import ViewSourceEditor from "./ViewSourceEditor.vue";
import { sameEditingTarget, useFormulaSessionStore } from "../formula/session";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";
import { shown } from "./shownValue";

const props = defineProps<{ view: ViewRecord }>();
const store = useWorkbookStore();

const sessions = useFormulaSessionStore();
const target = { kind: "script" as const, viewId: props.view.id };
const active = computed(() =>
  sessions.active && sameEditingTarget(sessions.active.target, target)
    ? sessions.active
    : undefined,
);
const editing = computed(() => !!active.value);
async function edit(): Promise<void> {
  if (!store.canEdit) return;
  await sessions.start(
    {
      target,
      context: { pageId: props.view.pageId, holderId: props.view.id },
      mode: "script",
      text: props.view.source,
      label: `${store.pages.find((page) => page.id === props.view.pageId)?.name ?? ""} · ${props.view.name} · Script source`,
      maxLength: LIMITS.viewSourceLength,
    },
    store.submitFormulaDraft,
  );
  sessions.focus();
}

function remove(): void {
  if (window.confirm(`Delete ${props.view.name}?`)) void store.deleteView(props.view.id);
}

/** Each statement of the saved source, with the value of each name. */
const statements = computed(() =>
  parseScript(props.view.source).map((statement) => {
    if (statement.kind === "error") {
      return { line: statement.line, label: "", value: { text: "", error: statement.message } };
    }
    if (statement.kind === "expression") {
      return {
        line: statement.line,
        label: statement.formula.trim(),
        value: shown(store.statementValue(props.view.id, statement.line)),
      };
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
  <section :id="`script-${view.id}`" class="view-card" :data-view="view.name">
    <header class="view-card__header">
      <h2>
        <ErrorWarning
          v-if="store.errorBlocks.has(view.id)"
          :label="`${view.name} contains errors`"
        />
        <EditableName
          :value="view.name"
          label="Script name"
          :disabled="!store.canEdit"
          @rename="store.updateView(view.id, { name: $event })"
        />
      </h2>
      <div v-if="store.canEdit" class="view-card__actions">
        <button v-if="!editing" type="button" @click="edit">Edit</button>
        <button type="button" class="danger" @click="remove">Delete script</button>
      </div>
    </header>

    <ViewSourceEditor v-if="editing" :view="view" mode="script" label="Script source" />

    <table
      class="script"
      :title="store.canEdit && !editing ? 'Double-click to edit' : undefined"
      @dblclick="edit"
    >
      <tbody>
        <tr
          v-for="statement in statements"
          :key="statement.line"
          :data-script-line="statement.line"
        >
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
