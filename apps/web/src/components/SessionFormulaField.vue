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
  cellNavigation?: boolean;
  showLabel?: boolean;
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

watch(
  ownsEditor,
  async (owns) => {
    if (!owns) return;
    await nextTick();
    if (mounted && ownsEditor.value && !sessions.active?.deleted) editor.value?.focus();
  },
  { immediate: true },
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
  const controlsBefore = [
    ...document.querySelectorAll<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]',
    ),
  ];
  const indexBefore = controlsBefore.indexOf(document.activeElement as HTMLElement);
  const target = sessions.active?.target;
  const move = props.cellNavigation ? store.prepareCellMove(key, backwards) : undefined;
  if (!(await submit())) return;
  if (move) {
    if (target?.kind === "append") {
      const table = store.tables.find((table) => table.id === target.tableId);
      const row = table?.rows.findIndex((row) => row.id === target.rowId) ?? -1;
      const col = table?.colIds.indexOf(target.colId) ?? -1;
      if (table && row >= 0 && col >= 0) store.selection = { tableId: table.id, row, col };
      store.prepareCellMove(key, backwards)();
    } else move();
    store.focusGrid();
    return;
  }
  await nextTick();
  if (key === "Tab") {
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]',
      ),
    ];
    const index = input.value ? controls.indexOf(input.value) : -1;
    if (index >= 0) controls[index + (backwards ? -1 : 1)]?.focus();
    else {
      const following = backwards
        ? controlsBefore.slice(0, indexBefore).reverse()
        : controlsBefore.slice(indexBefore + 1);
      following.find((control) => control.isConnected && !control.matches(":disabled"))?.focus();
    }
  }
}

function cancel(): void {
  if (sessions.cancel() && props.cellNavigation) store.focusGrid();
}
function transfer(event: MouseEvent): void {
  if (!session.value || props.readonly) return;
  event.preventDefault();
  void begin();
}
function blur(): void {
  // Completion clicks and focus transfers within this field keep the session open.
  void nextTick(() => {
    if (
      mounted &&
      ownsEditor.value &&
      !root.value?.contains(document.activeElement) &&
      !document.activeElement?.closest(".context-menu")
    )
      void submit();
  });
}
onBeforeUnmount(() => {
  mounted = false;
});
defineExpose({ submit, begin });
</script>

<template>
  <div ref="root" class="session-formula-field" data-formula-field>
    <strong v-if="showLabel" class="formula-column-label">{{ targetLabel }}</strong>
    <FormulaEditor
      v-if="ownsEditor && session"
      ref="editor"
      :state="session.state"
      :mode="session.mode"
      :context="context"
      :label="showLabel ? `${label} · ${targetLabel}` : label"
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
      @mousedown="transfer"
      @focus="begin"
    />
    <p v-if="session?.error && !session.deleted" class="notice notice--error" role="alert">
      {{ session.error }}
    </p>
  </div>
</template>
