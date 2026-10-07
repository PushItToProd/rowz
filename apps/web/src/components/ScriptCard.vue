<script setup lang="ts">
import { parseScript } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import ViewSourceEditor from "./ViewSourceEditor.vue";
import { sameEditingTarget, useFormulaSessionStore } from "../formula/session";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";
import { shown } from "./shownValue";
import { useDialog } from "../useDialog";

const props = withDefaults(defineProps<{ view: ViewRecord; collapsed?: boolean }>(), {
  collapsed: false,
});
const emit = defineEmits<{ actions: [event: MouseEvent]; "toggle-collapse": [] }>();
const store = useWorkbookStore();
const dialog = useDialog();

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

async function remove(): Promise<void> {
  if (
    await dialog.confirm({
      title: "Delete script",
      message: `Delete ${props.view.name}?`,
      confirmLabel: "Delete script",
      danger: true,
    })
  ) {
    await store.deleteView(props.view.id);
  }
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
      value: shown(store.nameValue(props.view.id, statement.name, statement.line)),
    };
  }),
);

const content = ref<HTMLElement>();
const contentScrollable = ref(false);
let resizeObserver: ResizeObserver | undefined;
function updateScrollable(): void {
  const element = content.value;
  contentScrollable.value = !!element && element.scrollHeight > element.clientHeight + 1;
}
watch([statements, editing], async () => {
  await nextTick();
  updateScrollable();
});
onMounted(() => {
  if (typeof ResizeObserver !== "undefined" && content.value) {
    resizeObserver = new ResizeObserver(updateScrollable);
    resizeObserver.observe(content.value);
  }
  updateScrollable();
});
onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <section
    :id="`script-${view.id}`"
    class="view-card"
    :data-view="view.name"
    data-view-kind="script"
  >
    <header class="view-card__header" :class="{ 'view-card__header--collapsed': collapsed }">
      <div class="block-card__title">
        <button
          type="button"
          class="block-collapse"
          :aria-expanded="!collapsed"
          :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${view.name}`"
          @click.stop="emit('toggle-collapse')"
        >
          <span aria-hidden="true">{{ collapsed ? "›" : "⌄" }}</span>
        </button>
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
      </div>
      <div class="view-card__actions">
        <div v-if="store.canEdit" v-show="!collapsed" class="view-card__direct-actions">
          <button v-if="!editing" type="button" data-block-action="Edit" @click="edit">Edit</button>
          <button type="button" data-block-action="Delete script" class="danger" @click="remove">
            Delete script
          </button>
        </div>
        <button
          type="button"
          class="view-card__menu-trigger"
          aria-haspopup="menu"
          :aria-label="`Block actions for ${view.name}`"
          @click.stop="emit('actions', $event)"
        >
          ⋮
        </button>
      </div>
    </header>

    <div v-show="!collapsed" class="block-card__body" :inert="collapsed">
      <div
        ref="content"
        class="script__content"
        :role="contentScrollable ? 'region' : undefined"
        :tabindex="contentScrollable ? 0 : undefined"
        :aria-label="contentScrollable ? `${view.name} source and results` : undefined"
      >
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
        <p v-if="statements.length === 0" class="view-card__problem">
          This script defines no names.
        </p>
      </div>
    </div>
  </section>
</template>
