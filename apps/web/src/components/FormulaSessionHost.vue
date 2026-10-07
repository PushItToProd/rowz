<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { LIMITS } from "@spreadsheet-app/shared";
import { editingLabel } from "../formula/cells";
import { namingContext } from "../formula/context";
import { useFormulaSessionStore } from "../formula/session";
import { useWorkbookStore } from "../stores/workbook";
import FormulaEditor from "./FormulaEditor.vue";
import { closeContextMenu } from "./contextMenuState";

const sessions = useFormulaSessionStore();
const emit = defineEmits<{ return: [pageId: string] }>();
const store = useWorkbookStore();
const fallback = computed(() =>
  sessions.active && !sessions.hasField() ? sessions.active : undefined,
);
const fallbackLabel = computed(() =>
  fallback.value
    ? (editingLabel(fallback.value.target) ?? fallback.value.label ?? "Editing formula")
    : "Editing formula",
);
const context = computed(() => namingContext(sessions.active?.context ?? { pageId: "" }));
const editor = ref<{ focus(): void }>();
const modal = ref<HTMLElement>();
const close = ref<HTMLButtonElement>();

watch(
  () => sessions.active?.deleted,
  async (deleted) => {
    if (deleted) {
      closeContextMenu();
      await nextTick();
      close.value?.focus();
    }
  },
);
watch(
  () => fallback.value?.error,
  async () => {
    await nextTick();
    editor.value?.focus();
  },
);

async function submit(): Promise<void> {
  const pageId = sessions.active?.context.pageId;
  if (await sessions.submit(store.submitFormulaDraft)) {
    if (pageId) emit("return", pageId);
  }
}
function cancel(): void {
  const pageId = sessions.active?.context.pageId;
  if (sessions.cancel() && pageId) emit("return", pageId);
}
function trap(event: KeyboardEvent): void {
  const controls = [
    ...(modal.value?.querySelectorAll<HTMLElement>('button, [tabindex="0"]') ?? []),
  ];
  const index = controls.indexOf(document.activeElement as HTMLElement);
  const next = controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length];
  event.preventDefault();
  next?.focus();
}
</script>

<template>
  <section
    v-if="fallback && !fallback.deleted"
    class="formula-session-fallback"
    aria-label="Formula draft"
  >
    <strong>{{ fallbackLabel }}</strong>
    <FormulaEditor
      ref="editor"
      :state="fallback.state"
      :picking-key="fallback.id"
      :same-row-picking="fallback.target.kind === 'column' || fallback.target.kind === 'filter'"
      :mode="fallback.mode"
      :context="context"
      :label="fallbackLabel"
      :max-length="fallback.maxLength ?? LIMITS.inputLength"
      :readonly="fallback.saving || !store.canEdit"
      @update:state="sessions.updateState"
      @commit="submit"
      @cancel="cancel"
    />
    <p v-if="fallback.error" class="notice notice--error" role="alert">{{ fallback.error }}</p>
    <button type="button" :disabled="fallback.saving" @click="submit">
      {{ fallback.mode === "script" || fallback.mode === "markdown" ? "Done" : "Apply" }}
    </button>
    <button type="button" :disabled="fallback.saving" @click="cancel">Cancel</button>
    <button type="button" @click="emit('return', fallback.context.pageId)">Return to editor</button>
  </section>
  <Teleport to="body">
    <div v-if="sessions.active?.deleted" class="formula-recovery-backdrop">
      <section
        ref="modal"
        class="formula-recovery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="formula-recovery-title"
        @keydown.tab.capture="trap"
        @keydown.esc.capture.stop="sessions.cancel"
      >
        <h2 id="formula-recovery-title">The editing target was deleted</h2>
        <p>Your input was not saved. Select and copy it below before closing this dialog.</p>
        <FormulaEditor
          :state="sessions.active.state"
          :mode="sessions.active.mode"
          :context="context"
          label="Unsaved formula for copying"
          :max-length="sessions.active.maxLength ?? LIMITS.inputLength"
          readonly
        />
        <button ref="close" type="button" @click="sessions.cancel">Close</button>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.formula-session-fallback {
  padding: 12px;
  border: 1px solid #ccc;
  background: white;
}
.formula-recovery-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: #0006;
}
.formula-recovery {
  width: min(640px, 90vw);
  max-height: 90vh;
  overflow: auto;
  padding: 24px;
  border-radius: 8px;
  background: white;
}
</style>
