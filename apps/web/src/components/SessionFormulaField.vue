<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useWorkbookStore } from "../stores/workbook";
import { namingContext } from "../formula/context";
import { cellEditingRequest } from "../formula/cells";
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
let opening = false;
let commitPending = false;
let discardDeferredKeys = false;
interface DeferredKey {
  key: string;
  backwards: boolean;
}
const deferredKeys: DeferredKey[] = [];
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
  opening = true;
  let opened = false;
  try {
    if (session.value) {
      sessions.activateField(token);
      await nextTick();
      editor.value?.focus();
      opened = true;
    } else if (
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
      opened = true;
    } else {
      await nextTick();
      sessions.focus();
    }
  } finally {
    opening = false;
    if (opened) replayOpeningKeys();
    else deferredKeys.length = 0;
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
      'input:not(:disabled), select:not(:disabled), button:not(:disabled):not(.formula-editor__pick), a[href], [tabindex="0"]',
    ),
  ];
  const indexBefore = controlsBefore.indexOf(document.activeElement as HTMLElement);
  const target = sessions.active?.target;
  const move = props.cellNavigation ? store.prepareCellMove(key, backwards) : undefined;
  commitPending = true;
  discardDeferredKeys = false;
  try {
    if (!(await submit())) {
      const buffered = deferredKeys.splice(0);
      for (const queued of buffered) {
        if (isCharacter(queued.key)) sessions.typeCharacter(queued.key);
      }
      return;
    }
    const buffered = deferredKeys.splice(0);
    if (move) {
      if (target?.kind === "append") {
        const table = store.tables.find((table) => table.id === target.tableId);
        const row = table?.rows.findIndex((row) => row.id === target.rowId) ?? -1;
        const col = table?.colIds.indexOf(target.colId) ?? -1;
        if (table && row >= 0 && col >= 0) store.selection = { tableId: table.id, row, col };
        store.prepareCellMove(key, backwards)();
      } else move();
      store.focusGrid();
      await replayCellKeys(buffered);
      return;
    }
    await nextTick();
    if (key === "Tab") {
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          'input:not(:disabled), select:not(:disabled), button:not(:disabled):not(.formula-editor__pick), a[href], [tabindex="0"]',
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
    for (const queued of buffered) {
      if (queued.key === "Tab") focusNextControl(queued.backwards);
      else if (isCharacter(queued.key)) typeIntoFocusedControl(queued.key);
    }
  } finally {
    commitPending = false;
    discardDeferredKeys = false;
  }
}

function isCharacter(key: string): boolean {
  return key.length === 1;
}

function isNavigationKey(key: string): key is "Enter" | "Tab" {
  return key === "Enter" || key === "Tab";
}

function queueKey(key: string, backwards = false): void {
  if (!discardDeferredKeys && (isCharacter(key) || isNavigationKey(key)))
    deferredKeys.push({ key, backwards });
}

function capturePendingKey(event: KeyboardEvent): void {
  const saving = commitPending && session.value?.saving;
  if ((!opening && !saving) || event.isComposing) return;
  if (saving && event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    deferredKeys.length = 0;
    discardDeferredKeys = true;
    return;
  }
  const character = isCharacter(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey;
  const navigation =
    isNavigationKey(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey;
  if (!character && !navigation) return;
  event.preventDefault();
  event.stopPropagation();
  if (character && session.value && !session.value.saving) sessions.typeCharacter(event.key);
  else if (!discardDeferredKeys) queueKey(event.key, event.shiftKey);
}

function replayOpeningKeys(): void {
  const buffered = deferredKeys.splice(0);
  const navigation = buffered.find(({ key }) => isNavigationKey(key));
  const navigationIndex = navigation ? buffered.indexOf(navigation) : -1;
  const beforeNavigation = navigationIndex < 0 ? buffered : buffered.slice(0, navigationIndex);
  for (const queued of beforeNavigation) {
    if (isCharacter(queued.key)) sessions.typeCharacter(queued.key);
  }
  if (navigation) {
    deferredKeys.push(...buffered.slice(navigationIndex + 1));
    void commit(navigation.key as "Enter" | "Tab", navigation.backwards);
  }
}

async function replayCellKeys(keys: DeferredKey[]): Promise<void> {
  for (const queued of keys) {
    if (isCharacter(queued.key)) {
      if (sessions.active) sessions.typeCharacter(queued.key);
      else if (store.selection) {
        const request = cellEditingRequest(store.selection, queued.key);
        if (request) void sessions.start(request, store.submitFormulaDraft);
      }
      continue;
    }
    if (!isNavigationKey(queued.key)) continue;
    const move = store.prepareCellMove(queued.key, queued.backwards);
    if (sessions.active && !(await sessions.submit(store.submitFormulaDraft))) {
      sessions.focus();
      return;
    }
    move();
    store.focusGrid();
  }
}

function focusNextControl(backwards: boolean): void {
  const controls = [
    ...document.querySelectorAll<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), button:not(:disabled):not(.formula-editor__pick), a[href], [tabindex="0"]',
    ),
  ];
  const index = controls.indexOf(document.activeElement as HTMLElement);
  controls[index + (backwards ? -1 : 1)]?.focus();
}

function typeIntoFocusedControl(character: string): void {
  const target = document.activeElement;
  if (
    !(target instanceof HTMLInputElement) ||
    target.disabled ||
    target.readOnly ||
    !["email", "password", "search", "tel", "text", "url"].includes(target.type)
  )
    return;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  target.setRangeText(character, start, end, "end");
  target.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: character }),
  );
}

function deferKey(key: string, backwards = false): void {
  queueKey(key, backwards);
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
defineExpose({
  submit,
  begin,
  commitKey: (key: "Enter" | "Tab", backwards: boolean) => commit(key, backwards),
  deferKey,
});
</script>

<template>
  <div
    ref="root"
    class="session-formula-field"
    data-formula-field
    @keydown.capture="capturePendingKey"
  >
    <strong v-if="showLabel" class="formula-column-label">{{ targetLabel }}</strong>
    <FormulaEditor
      v-if="ownsEditor && session"
      ref="editor"
      :state="session.state"
      :picking-key="session.id"
      :show-picking-control="!cellNavigation"
      :same-row-picking="session.target.kind === 'column' || session.target.kind === 'filter'"
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
