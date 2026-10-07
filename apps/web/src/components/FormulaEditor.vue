<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { EditorState, StateEffect, StateField, Prec } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionStatus,
  moveCompletionSelection,
} from "@codemirror/autocomplete";
import { analyzeSource } from "@spreadsheet-app/engine";
import { syntaxTree } from "@codemirror/language";
import { markdownDecorations, markdownLanguage } from "../formula/markdown";
import { referenceHighlights } from "../formula/references";
import { pickingSpan, useReferencePickingStore } from "../formula/picking";
import { applySuggestion, signatureAt, suggestionsAt, type NamingContext } from "../formula/assist";
import { selectNextOccurrenceKeymap } from "../formula/selectNextOccurrence";
import type { FormulaMode } from "../formula/session";

const props = withDefaults(
  defineProps<{
    state: EditorState;
    mode: FormulaMode;
    context: NamingContext;
    label: string;
    readonly?: boolean;
    maxLength: number;
    pickingKey?: string;
    sameRowPicking?: boolean;
    showPickingControl?: boolean;
  }>(),
  { showPickingControl: true, pickingKey: undefined },
);
const emit = defineEmits<{
  "update:state": [state: EditorState];
  commit: [key: "Enter" | "Tab", backwards: boolean];
  cancel: [];
  blur: [];
  focus: [];
}>();

const host = ref<HTMLElement>();
const picking = useReferencePickingStore();
const localPickingKey = Symbol();
const pickingKey = computed(() => props.pickingKey ?? localPickingKey);
const current = shallowRef(props.state);
const canPick = computed(
  () => !props.readonly && pickingSpan(current.value, props.mode, true) !== undefined,
);
const ownsPicking = computed(() => picking.key === pickingKey.value);
let view: EditorView | undefined;
let navigated = false;
let publishedState: EditorState | undefined;
let keyboardCharacter = false;
const signature = computed(() =>
  signatureAt(current.value.doc.toString(), current.value.selection.main.head, props.mode),
);

function highlight(state: EditorState): DecorationSet {
  const analysis = analyzeSource(state.doc.toString(), props.mode);
  const spans = [
    ...analysis.regions.flatMap((region) =>
      region.tokens.map((token) => ({
        from: token.position,
        to: token.end,
        type: token.type,
      })),
    ),
    ...analysis.decorations,
  ];
  return Decoration.set(
    spans
      .filter((span) => span.to > span.from)
      .map((span) =>
        Decoration.mark({ class: `formula-token--${span.type}` }).range(span.from, span.to),
      )
      .concat(
        props.mode === "markdown" ? markdownDecorations(state, analysis) : [],
        referenceHighlights(
          state.doc.toString(),
          props.mode,
          state.selection.main.head,
          props.context,
        ).map(({ from, to, color }) =>
          Decoration.mark({
            class: "formula-reference",
            attributes: { style: `color: ${color}`, "data-reference-color": color },
          }).range(from, to),
        ),
      ),
    true,
  );
}
const multiline = computed(() => props.mode === "script" || props.mode === "markdown");

const tokens = StateField.define<DecorationSet>({
  create: highlight,
  update: (decorations, transaction) =>
    transaction.docChanged ||
    transaction.selection ||
    transaction.reconfigured ||
    syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? highlight(transaction.state)
      : decorations,
  provide: (field) => EditorView.decorations.from(field),
});

function extensions() {
  return [
    history(),
    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    ...(multiline.value ? [EditorView.lineWrapping] : []),
    ...(props.mode === "markdown" ? [markdownLanguage] : []),
    tokens,
    EditorState.readOnly.of(props.readonly),
    EditorView.editable.of(!props.readonly),
    EditorView.contentAttributes.of({
      "aria-label": props.label,
      "aria-multiline": String(multiline.value),
      tabindex: "0",
    }),
    EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged) return transaction;
      if (props.readonly) return [];
      const text = transaction.newDoc.toString();
      return text.length <= props.maxLength && (multiline.value || !/[\r\n]/.test(text))
        ? transaction
        : [];
    }),
    EditorState.transactionExtender.of((transaction) => {
      // Literal/formula transitions change page-navigation behavior. Keep them
      // separate from adjacent typing regardless of timing or editor transfers.
      if (
        props.mode === "cell" &&
        transaction.docChanged &&
        transaction.startState.doc.toString().startsWith("=") !==
          transaction.newDoc.toString().startsWith("=")
      )
        return { annotations: isolateHistory.of("full") };
      return null;
    }),
    autocompletion({
      defaultKeymap: false,
      interactionDelay: 0,
      override: [
        (context) => {
          if (props.readonly) return null;
          const source = context.state.doc.toString();
          const found = suggestionsAt(source, context.pos, props.context, props.mode);
          if (!found.items.length) return null;
          return {
            from: found.from,
            filter: false,
            options: found.items.map((suggestion) => ({
              label: suggestion.label,
              detail: suggestion.detail,
              type: suggestion.kind === "function" ? "function" : "variable",
              apply: (editor: EditorView) => {
                const text = editor.state.doc.toString();
                const caret = editor.state.selection.main.head;
                const result = applySuggestion(
                  text,
                  { from: found.from, items: found.items },
                  caret,
                  suggestion,
                );
                // Replace only the token; one transaction gives completion one undo step.
                const suffix = text.length - (result.text.length - result.caret);
                editor.dispatch({
                  changes: {
                    from: found.from,
                    to: suffix,
                    insert: result.text.slice(found.from, result.caret),
                  },
                  selection: { anchor: result.caret },
                  userEvent: "input.complete",
                });
                closeCompletion(editor);
              },
            })),
          };
        },
      ],
    }),
    Prec.highest(
      keymap.of([
        ...selectNextOccurrenceKeymap,
        {
          key: "Mod-Enter",
          run: (editor) => {
            if (!multiline.value) return false;
            if (!editor.composing && !props.readonly) emit("commit", "Enter", false);
            return true;
          },
        },
        {
          key: "ArrowDown",
          run: (editor) => {
            if (completionStatus(editor.state) !== "active") return false;
            navigated = moveCompletionSelection(true)(editor);
            return navigated;
          },
        },
        {
          key: "ArrowUp",
          run: (editor) => {
            if (completionStatus(editor.state) !== "active") return false;
            navigated = moveCompletionSelection(false)(editor);
            return navigated;
          },
        },
        {
          key: "Enter",
          run: (editor) => {
            if (editor.composing) return false;
            if (navigated && acceptCompletion(editor)) return true;
            if (multiline.value) return props.readonly ? true : insertNewlineAndIndent(editor);
            if (!props.readonly) emit("commit", "Enter", false);
            return true;
          },
        },
        {
          key: "Tab",
          run: (editor) => {
            if (editor.composing) return false;
            if (acceptCompletion(editor)) return true;
            if (!props.readonly) emit("commit", "Tab", false);
            return true;
          },
          shift: (editor) => {
            if (editor.composing) return false;
            if (!props.readonly) emit("commit", "Tab", true);
            return true;
          },
        },
        {
          key: "Escape",
          run: (editor) => {
            if (editor.composing) return false;
            if (completionStatus(editor.state) === "active" && closeCompletion(editor)) return true;
            closeCompletion(editor);
            if (ownsPicking.value && picking.cancel()) return true;
            if (!props.readonly && !multiline.value) emit("cancel");
            return true;
          },
        },
      ]),
    ),
    keymap.of([...historyKeymap, ...defaultKeymap]),
    EditorView.domEventHandlers({
      compositionstart: () => {
        if (ownsPicking.value && picking.drag) picking.cancel();
        return false;
      },
      keydown: (event) => {
        keyboardCharacter =
          event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.isComposing;
        return false;
      },
      keyup: () => {
        keyboardCharacter = false;
        return false;
      },
      beforeinput: (event, editor) => {
        const typing = keyboardCharacter;
        keyboardCharacter = false;
        // Browser target ranges can lag behind syntax decorations during rapid typing.
        // Keyboard characters use the editor selection; IME, paste, and fill stay native.
        if (
          !typing ||
          props.readonly ||
          event.isComposing ||
          editor.composing ||
          event.inputType !== "insertText" ||
          event.data?.length !== 1
        )
          return false;
        editor.dispatch(editor.state.replaceSelection(event.data), {
          userEvent: "input.type",
          scrollIntoView: true,
        });
        return true;
      },
      focus: () => {
        connectPicking();
        emit("focus");
      },
      blur: () => {
        emit("blur");
        if (!props.pickingKey)
          void nextTick(() => {
            if (ownsPicking.value && !host.value?.parentElement?.contains(document.activeElement)) {
              picking.cancel();
              picking.disconnect(pickingKey.value, localPickingKey);
            }
          });
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet) navigated = false;
      current.value = update.state;
      picking.update(pickingKey.value, update.state);
      publishedState = update.state;
      emit("update:state", update.state);
    }),
    EditorView.theme({
      "&": { fontSize: "inherit" },
      ".cm-content": {
        fontFamily: "inherit",
        padding: "2px 0",
        whiteSpace: multiline.value ? "pre-wrap" : "pre",
        minHeight: multiline.value ? "10em" : "0",
        paddingRight: props.readonly || !props.showPickingControl ? "0" : "96px",
      },
      ".cm-line": { padding: "0 4px" },
      ".formula-token--comment": { color: "#667085", fontStyle: "italic" },
      ".formula-prose--heading": { color: "#175cd3", fontWeight: "600" },
      ".formula-prose--strong": { fontWeight: "700" },
      ".formula-prose--emphasis": { fontStyle: "italic" },
      ".formula-prose--link": { color: "#175cd3", textDecoration: "underline" },
      ".formula-prose--code": { color: "#8b4513", backgroundColor: "#f2f4f7" },
      ".formula-prose--quote": { color: "#667085", fontStyle: "italic" },
      ".formula-prose--list, .formula-prose--punctuation": { color: "#667085" },
      ".formula-token--definition, .formula-token--keyword": {
        color: "#6543a1",
        fontWeight: "600",
      },
      ".formula-token--delimiter": { color: "#176b87", fontWeight: "600" },
      ".formula-token--number": { color: "#176b87" },
      ".formula-token--string": { color: "#8b4513" },
      ".formula-token--identifier, .formula-token--quotedName, .formula-token--column": {
        color: "#6543a1",
      },
      ".formula-token--operator, .formula-token--punctuation": { color: "#596373" },
      ".formula-token--error, .formula-token--invalid": { color: "#b42318" },
      ".formula-reference, .formula-reference [class*='formula-token--']": { color: "inherit" },
    }),
  ];
}

onMounted(() => {
  view = new EditorView({ state: props.state, parent: host.value });
  view.dispatch({ effects: StateEffect.reconfigure.of(extensions()) });
  current.value = view.state;
  emit("update:state", view.state);
  if (props.pickingKey && !props.readonly) connectPicking();
});
watch(
  () => props.state,
  (state) => {
    if (view && state !== view.state && state !== publishedState) {
      view.setState(state.update({ effects: StateEffect.reconfigure.of(extensions()) }).state);
      current.value = view.state;
      picking.update(pickingKey.value, view.state);
      emit("update:state", view.state);
    }
  },
);
watch(
  () => props.pickingKey,
  () => {
    connectPicking();
  },
);
watch(
  [
    () => props.mode,
    () => props.label,
    () => props.readonly,
    () => props.maxLength,
    () => props.showPickingControl,
    () => JSON.stringify(props.context),
  ],
  () => {
    view?.dispatch({ effects: StateEffect.reconfigure.of(extensions()) });
  },
);
onBeforeUnmount(() => {
  picking.disconnect(pickingKey.value, localPickingKey);
  view?.destroy();
});
defineExpose({ focus: () => view?.focus() });

function onKeydownCapture(event: KeyboardEvent): void {
  // Let the browser finish composition without invoking CodeMirror's commit keymap.
  if (event.isComposing) event.stopPropagation();
  // Restore the pre-drag document before an ordinary key edits it.
  else if (event.key !== "Escape" && ownsPicking.value && picking.drag) picking.cancel();
}

function connectPicking(): void {
  const editor = view;
  if (!editor || props.readonly) return;
  picking.connect(
    pickingKey.value,
    {
      state: () => editor.state,
      mode: () => props.mode,
      readonly: () => props.readonly || editor.composing,
      maxLength: () => props.maxLength,
      context: () => props.context,
      sameRow: () => props.sameRowPicking,
      hasControl: () => props.showPickingControl && !props.readonly,
      dispatch: (spec) => {
        editor.dispatch(spec);
        closeCompletion(editor);
      },
      restore: (state) => {
        editor.setState(state);
        current.value = state;
        publishedState = state;
        picking.update(pickingKey.value, state);
        emit("update:state", state);
      },
      focus: () => {
        editor.focus();
      },
    },
    localPickingKey,
  );
}
function requestPicking(): void {
  connectPicking();
  picking.request();
}
</script>

<template>
  <div
    class="formula-editor"
    :class="{ 'formula-editor--multiline': multiline }"
    @keydown.capture="onKeydownCapture"
    @keydown.stop
  >
    <div ref="host"></div>
    <button
      v-if="!readonly && showPickingControl"
      type="button"
      class="formula-editor__pick"
      :disabled="!canPick"
      :aria-pressed="ownsPicking && picking.explicit"
      @mousedown.prevent
      @click.stop="requestPicking"
    >
      Pick reference
    </button>
    <span
      v-if="ownsPicking && picking.message"
      class="formula-editor__pick-message"
      role="status"
      >{{ picking.message }}</span
    >
    <span v-if="signature" class="formula-editor__signature">{{ signature.syntax }}</span>
  </div>
</template>

<style scoped>
.formula-editor {
  position: relative;
}
.formula-editor__pick {
  position: absolute;
  right: 2px;
  top: 2px;
  padding: 0 4px;
  font-size: 11px;
  line-height: 20px;
}
.formula-editor__pick[aria-pressed="true"] {
  background: #dbeafe;
}
.formula-editor__pick-message {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  background: #fff7e6;
  color: #7a2e0e;
  padding: 6px;
  border: 1px solid #e7b45c;
  min-width: 240px;
}
</style>
