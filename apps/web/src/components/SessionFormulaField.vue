<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useWorkbookStore } from "../stores/workbook";
import { namingContext } from "../formula/context";
import {
  sameEditingTarget,
  useFormulaSessionStore,
  type EditingContext,
  type EditingTarget,
  type FormulaMode,
} from "../formula/session";
import FormulaEditor from "./FormulaEditor.vue";

const props = defineProps<{
  target: EditingTarget;
  context: EditingContext;
  value: string;
  label: string;
  targetLabel?: string;
  placeholder?: string;
  maxLength: number;
  readonly?: boolean;
  mode?: FormulaMode;
}>();
const store = useWorkbookStore();
const sessions = useFormulaSessionStore();
const root = ref<HTMLElement>();
const input = ref<HTMLInputElement>();
const editor = ref<{ focus(): void }>();
let mounted = true;
const token = Symbol();
const session = computed(() =>
  sessions.active && sameEditingTarget(sessions.active.target, props.target)
    ? sessions.active
    : undefined,
);
const ownsEditor = computed(() => session.value && sessions.owner === token);
const context = computed(() => namingContext(session.value?.context ?? props.context));

watch(
  () => props.target,
  (target, _old, cleanup) => {
    cleanup(
      sessions.attachField(
        target,
        () => {
          editor.value?.focus();
        },
        token,
      ),
    );
  },
  { immediate: true, deep: true },
);

async function begin(): Promise<void> {
  if (props.readonly) return;
  if (session.value) {
    sessions.activateField(token);
    await nextTick();
    editor.value?.focus();
    return;
  }
  if (
    await sessions.start(
      {
        target: props.target,
        context: props.context,
        text: props.value,
        mode: props.mode ?? "formula",
        label: props.targetLabel ?? props.label,
        maxLength: props.maxLength,
      },
      store.submitFormulaDraft,
    )
  ) {
    sessions.activateField(token);
    await nextTick();
    editor.value?.focus();
  } else {
    await nextTick();
    sessions.focus();
  }
}

async function submit(): Promise<boolean> {
  const saved = await sessions.submit(store.submitFormulaDraft);
  if (!saved) {
    await nextTick();
    sessions.focus();
  }
  return saved;
}

async function commit(key: "Enter" | "Tab", backwards: boolean): Promise<void> {
  if (!(await submit())) return;
  await nextTick();
  if (key === "Tab") {
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]',
      ),
    ];
    const index = input.value ? controls.indexOf(input.value) : -1;
    controls[index + (backwards ? -1 : 1)]?.focus();
  }
}

function cancel(): void {
  sessions.cancel();
}
function blur(): void {
  // Completion clicks and focus transfers within this field keep the session open.
  void nextTick(() => {
    if (mounted && ownsEditor.value && !root.value?.contains(document.activeElement)) void submit();
  });
}
onBeforeUnmount(() => {
  mounted = false;
});
defineExpose({ submit });
</script>

<template>
  <div ref="root" class="session-formula-field" data-formula-field>
    <FormulaEditor
      v-if="ownsEditor && session"
      ref="editor"
      :state="session.state"
      :mode="session.mode"
      :context="context"
      :label="label"
      :readonly="readonly || session.saving"
      :max-length="maxLength"
      @update:state="sessions.updateState"
      @commit="commit"
      @cancel="cancel"
      @blur="blur"
    />
    <input
      v-else
      ref="input"
      :value="session?.state.doc.toString() ?? value"
      :aria-label="label"
      :placeholder="placeholder"
      :disabled="readonly"
      readonly
      :maxlength="maxLength"
      spellcheck="false"
      @focus="begin"
    />
    <p v-if="session?.error && !session.deleted" class="notice notice--error" role="alert">
      {{ session.error }}
    </p>
  </div>
</template>
