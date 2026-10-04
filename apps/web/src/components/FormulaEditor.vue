<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { EditorState, StateEffect, StateField, Prec } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionStatus,
  moveCompletionSelection,
} from "@codemirror/autocomplete";
import { analyzeFormula } from "@spreadsheet-app/engine";
import { applySuggestion, signatureAt, suggestionsAt, type NamingContext } from "../formula/assist";
import type { FormulaMode } from "../formula/session";

const props = defineProps<{
  state: EditorState;
  mode: FormulaMode;
  context: NamingContext;
  label: string;
  readonly?: boolean;
  maxLength: number;
}>();
const emit = defineEmits<{
  "update:state": [state: EditorState];
  commit: [key: "Enter" | "Tab", backwards: boolean];
  cancel: [];
  blur: [];
  focus: [];
}>();

const host = ref<HTMLElement>();
const current = shallowRef(props.state);
let view: EditorView | undefined;
let navigated = false;
const signature = computed(() =>
  signatureAt(current.value.doc.toString(), current.value.selection.main.head, props.mode),
);

function highlight(state: EditorState): DecorationSet {
  const source = state.doc.toString();
  if (props.mode === "cell" && !source.startsWith("=")) return Decoration.none;
  const analysis = analyzeFormula(source, {
    from: props.mode === "cell" ? 1 : 0,
    to: source.length,
  });
  return Decoration.set(
    analysis.tokens
      .filter((token) => token.end > token.position)
      .map((token) =>
        Decoration.mark({ class: `formula-token--${token.type}` }).range(token.position, token.end),
      ),
  );
}

const tokens = StateField.define<DecorationSet>({
  create: highlight,
  update: (decorations, transaction) =>
    transaction.docChanged || transaction.reconfigured ? highlight(transaction.state) : decorations,
  provide: (field) => EditorView.decorations.from(field),
});

function extensions() {
  return [
    history(),
    tokens,
    EditorState.readOnly.of(props.readonly),
    EditorView.editable.of(!props.readonly),
    EditorView.contentAttributes.of({
      "aria-label": props.label,
      "aria-multiline": "false",
      tabindex: "0",
    }),
    EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged) return transaction;
      if (props.readonly) return [];
      const text = transaction.newDoc.toString();
      return text.length <= props.maxLength && !/[\r\n]/.test(text) ? transaction : [];
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
            if (!props.readonly) emit("cancel");
            return true;
          },
        },
      ]),
    ),
    keymap.of([...historyKeymap, ...defaultKeymap]),
    EditorView.domEventHandlers({
      focus: () => {
        emit("focus");
      },
      blur: () => {
        emit("blur");
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet) {
        navigated = false;
        current.value = update.state;
        emit("update:state", update.state);
      }
    }),
    EditorView.theme({
      "&": { fontSize: "inherit" },
      ".cm-content": { fontFamily: "inherit", padding: "2px 0", whiteSpace: "pre" },
      ".cm-line": { padding: "0 4px" },
      ".formula-token--number": { color: "#176b87" },
      ".formula-token--string": { color: "#8b4513" },
      ".formula-token--identifier, .formula-token--quotedName, .formula-token--column": {
        color: "#6543a1",
      },
      ".formula-token--operator, .formula-token--punctuation": { color: "#596373" },
      ".formula-token--error, .formula-token--invalid": { color: "#b42318" },
    }),
  ];
}

onMounted(() => {
  view = new EditorView({ state: props.state, parent: host.value });
  view.dispatch({ effects: StateEffect.reconfigure.of(extensions()) });
  current.value = view.state;
  emit("update:state", view.state);
});
watch(
  () => props.state,
  (state) => {
    if (view && state !== view.state) {
      view.setState(state.update({ effects: StateEffect.reconfigure.of(extensions()) }).state);
      current.value = view.state;
      emit("update:state", view.state);
    }
  },
);
watch(
  () => [props.mode, props.context, props.label, props.readonly, props.maxLength],
  () => {
    view?.dispatch({ effects: StateEffect.reconfigure.of(extensions()) });
  },
);
onBeforeUnmount(() => view?.destroy());
defineExpose({ focus: () => view?.focus() });

function onKeydownCapture(event: KeyboardEvent): void {
  // Let the browser finish composition without invoking CodeMirror's commit keymap.
  if (event.isComposing) event.stopPropagation();
}
</script>

<template>
  <div class="formula-editor" @keydown.capture="onKeydownCapture" @keydown.stop>
    <div ref="host"></div>
    <span v-if="signature" class="formula-editor__signature">{{ signature.syntax }}</span>
  </div>
</template>
