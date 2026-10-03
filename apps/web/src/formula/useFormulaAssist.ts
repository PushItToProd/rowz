import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from "vue";
import { useWorkbookStore } from "../stores/workbook";
import {
  applySuggestion,
  signatureAt,
  suggestionsAt,
  type NamingContext,
  type Suggestion,
  type Suggestions,
} from "./assist";
import type { FunctionDoc } from "@spreadsheet-app/engine";

export interface FormulaAssist {
  suggestions: ComputedRef<Suggestions>;
  /** The function the caret is inside, shown when there is nothing to suggest. */
  signature: ComputedRef<FunctionDoc | undefined>;
  /** Index of the highlighted suggestion. */
  active: Ref<number>;
  /** Reads the caret position from the input. Call it whenever the caret may have moved. */
  track(): void;
  accept(suggestion?: Suggestion): void;
  /** Lets the suggestion list use a key. Returns whether it did, in which case the caller ignores the key. */
  onKeydown(event: KeyboardEvent): boolean;
}

/**
 * Suggestions and a function hint for a formula being typed into an input.
 *
 * @param text what the input holds, or `null` when nothing is being edited
 * @param input the input element, for reading and moving the caret
 * @param tableId the table the edited cell is in, which decides the tables a bare name can mean
 */
export function useFormulaAssist(
  text: Ref<string | null>,
  input: () => HTMLInputElement | undefined,
  tableId: () => string | undefined,
): FormulaAssist {
  const store = useWorkbookStore();
  const caret = ref(0);
  const active = ref(0);
  /** Whether the arrow keys have moved the highlight. Until then Enter saves the cell. */
  const navigated = ref(false);
  /** Whether Escape closed the list. Typing opens it again. */
  const dismissed = ref(false);

  const context = computed<NamingContext>(() => ({
    pages: store.pages,
    tables: store.tables,
    pageId: store.tables.find((table) => table.id === tableId())?.pageId,
    columns: store.tables.find((table) => table.id === tableId())?.columns,
    names: store.documentNames,
  }));
  const suggestions = computed<Suggestions>(() =>
    text.value === null || dismissed.value
      ? { from: 0, items: [] }
      : suggestionsAt(text.value, caret.value, context.value),
  );
  const signature = computed(() =>
    text.value === null ? undefined : signatureAt(text.value, caret.value),
  );

  function track(): void {
    caret.value = input()?.selectionStart ?? text.value?.length ?? 0;
  }

  watch(text, (value) => {
    dismissed.value = false;
    // Text set from outside the input, such as the first typed character, puts the caret at its end.
    if (input()?.selectionStart === undefined) caret.value = value?.length ?? 0;
    else track();
  });
  // Saving another cell can refresh the naming context without changing the
  // completions. Keep the arrow-key choice unless the text, caret, or list changes.
  watch([text, caret, () => JSON.stringify(suggestions.value)], () => {
    active.value = 0;
    navigated.value = false;
  });

  function accept(suggestion = suggestions.value.items[active.value]): void {
    if (!suggestion || text.value === null) return;
    const result = applySuggestion(text.value, suggestions.value, caret.value, suggestion);
    text.value = result.text;
    caret.value = result.caret;
    void nextTick(() => {
      input()?.focus();
      input()?.setSelectionRange(result.caret, result.caret);
      caret.value = result.caret;
    });
  }

  function onKeydown(event: KeyboardEvent): boolean {
    const count = suggestions.value.items.length;
    if (count === 0) return false;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        active.value = (active.value + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
        navigated.value = true;
        break;
      case "Tab":
        accept();
        break;
      case "Enter":
        // Enter saves the cell unless the user has picked from the list with the arrows.
        if (!navigated.value) return false;
        accept();
        break;
      case "Escape":
        dismissed.value = true;
        break;
      default:
        return false;
    }
    event.preventDefault();
    return true;
  }

  return { suggestions, signature, active, track, accept, onKeydown };
}
