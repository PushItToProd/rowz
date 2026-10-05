<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { LIMITS } from "@spreadsheet-app/shared";
import type { ViewRecord } from "../api/client";
import { namingContext } from "../formula/context";
import { sameEditingTarget, useFormulaSessionStore } from "../formula/session";
import { useWorkbookStore } from "../stores/workbook";
import FormulaEditor from "./FormulaEditor.vue";

const props = defineProps<{ view: ViewRecord; mode: "script" | "markdown"; label: string }>();
const store = useWorkbookStore();
const sessions = useFormulaSessionStore();
const token = Symbol();
const target = { kind: props.mode, viewId: props.view.id };
const session = computed(() =>
  sessions.active && sameEditingTarget(sessions.active.target, target)
    ? sessions.active
    : undefined,
);
const editor = ref<{ focus(): void }>();
const root = ref<HTMLElement>();
const context = computed(() =>
  namingContext(session.value?.context ?? { pageId: props.view.pageId, holderId: props.view.id }),
);
const detach = sessions.attachField(target, () => editor.value?.focus(), token);
onBeforeUnmount(detach);
onMounted(async () => {
  sessions.activateField(token);
  await nextTick();
  editor.value?.focus();
});
async function done(): Promise<void> {
  if (!(await sessions.submit(store.submitFormulaDraft))) {
    await nextTick();
    sessions.focus();
  }
}
function cancel(): void {
  sessions.cancel();
}
function blur(): void {
  void nextTick(() => {
    // Page navigation and the editor's controls preserve focus until their own handler runs.
    if (session.value && sessions.owner === token && !root.value?.contains(document.activeElement))
      void done();
  });
}
async function commit(key: "Enter" | "Tab", backwards: boolean): Promise<void> {
  const controls = [
    ...document.querySelectorAll<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]',
    ),
  ];
  const index = controls.indexOf(document.activeElement as HTMLElement);
  const following = backwards ? controls.slice(0, index).reverse() : controls.slice(index + 1);
  if (!(await sessions.submit(store.submitFormulaDraft))) {
    await nextTick();
    sessions.focus();
    return;
  }
  if (key === "Tab") {
    await nextTick();
    following.find((control) => control.isConnected && !control.matches(":disabled"))?.focus();
  }
}
</script>

<template>
  <section v-if="session" ref="root" class="view-source-editor" data-formula-field>
    <FormulaEditor
      ref="editor"
      :state="session.state"
      :mode="mode"
      :context="context"
      :label="label"
      :readonly="!store.canEdit || session.saving"
      :max-length="LIMITS.viewSourceLength"
      @update:state="sessions.updateState"
      @commit="commit"
      @blur="blur"
    />
    <p v-if="session.error && !session.deleted" class="notice notice--error" role="alert">
      {{ session.error }}
    </p>
    <button type="button" :disabled="session.saving" @mousedown.prevent @click="done">Done</button>
    <button type="button" :disabled="session.saving" @mousedown.prevent @click="cancel">
      Cancel
    </button>
  </section>
</template>
