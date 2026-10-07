<script setup lang="ts">
import {
  formatValue,
  isError,
  renderTemplate,
  type ErrorValue,
  type TemplateInline,
} from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, reactive, ref, watch } from "vue";
import type { ViewRecord } from "../api/client";
import { markdown } from "../markdown";
import { formattedText } from "../formatStyle";
import { useWorkbookStore } from "../stores/workbook";
import ChartView from "./ChartView.vue";
import ViewSourceEditor from "./ViewSourceEditor.vue";
import { sameEditingTarget, useFormulaSessionStore } from "../formula/session";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { useDialog } from "../useDialog";

const props = defineProps<{ view: ViewRecord }>();
const emit = defineEmits<{ actions: [event: MouseEvent] }>();
const store = useWorkbookStore();
const dialog = useDialog();

const sessions = useFormulaSessionStore();
const target = { kind: "markdown" as const, viewId: props.view.id };
const active = computed(() =>
  sessions.active && sameEditingTarget(sessions.active.target, target)
    ? sessions.active
    : undefined,
);
const editing = computed(() => !!active.value);
const draft = computed(() => active.value?.state.doc.toString() ?? props.view.source);
// Drafts survive placeholder rerenders while a save is pending. The plain map
// does not trigger a rerender for every keystroke; errors do.
const inputDrafts = new Map<string, string>();
const inputErrors = reactive(new Map<string, string>());
const committingInputs = new Set<string>();
const inputRenderVersion = ref(0);
const confirmation = ref<string | null>(null);
const pendingButton = ref<number | null>(null);
const returnFocus = ref<HTMLElement>();
const textView = ref<HTMLElement>();
watch([() => props.view.id, () => props.view.source], () => {
  inputDrafts.clear();
  inputErrors.clear();
  inputRenderVersion.value += 1;
});
async function edit(): Promise<void> {
  if (!store.canEdit) return;
  await sessions.start(
    {
      target,
      context: { pageId: props.view.pageId, holderId: props.view.id },
      mode: "markdown",
      text: props.view.source,
      label: `${store.pages.find((page) => page.id === props.view.pageId)?.name ?? ""} · ${props.view.name} · Text view source`,
      maxLength: LIMITS.viewSourceLength,
    },
    store.submitFormulaDraft,
  );
  sessions.focus();
}

async function remove(): Promise<void> {
  if (
    await dialog.confirm({
      title: "Delete text view",
      message: `Delete ${props.view.name}?`,
      confirmLabel: "Delete text view",
      danger: true,
    })
  ) {
    await store.deleteView(props.view.id);
  }
}

function errorChip(error: ErrorValue): HTMLSpanElement {
  const message = error.message ?? error.code;
  const chip = document.createElement("span");
  chip.className = "md-error";
  chip.setAttribute("aria-label", `${error.code} ${message}`);
  chip.title = message;
  chip.append(document.createTextNode(`${error.code} `));
  const detail = document.createElement("span");
  detail.className = "md-error__message";
  detail.textContent = message;
  chip.append(detail);
  return chip;
}

type InlineReplacement = Extract<TemplateInline, { type: "error" | "button" | "input" }>;
const REPLACEMENT_MARKER = /ROWZ(?:ERROR|BUTTON|INPUT)\d+END/g;

function markersIn(
  text: string,
  replacements: ReadonlyMap<string, InlineReplacement>,
): [string, InlineReplacement][] {
  const found: [string, InlineReplacement][] = [];
  for (const match of text.matchAll(REPLACEMENT_MARKER)) {
    const marker = match[0];
    const replacement = replacements.get(marker);
    if (replacement !== undefined) found.push([marker, replacement]);
  }
  return found;
}

function inlineElement(part: InlineReplacement, viewId: string, isEditing: boolean): HTMLElement {
  if (part.type === "error") return errorChip(part.error);
  if (part.type === "button") {
    const button = document.createElement("button");
    const running = store.isViewButtonRunning(viewId, part.occurrence);
    button.type = "button";
    button.className = "text-view__button";
    button.dataset.viewButton = String(part.occurrence);
    if (part.action.confirm !== undefined) {
      button.dataset.confirmMessage = part.action.confirm;
      button.setAttribute("aria-haspopup", "dialog");
    }
    button.disabled = isEditing || !store.canEdit || running;
    if (running) button.setAttribute("aria-busy", "true");
    button.textContent = running ? "Running…" : part.label;
    return button;
  }

  const { control, occurrence } = part;
  const identity = store.identityOf(control.target);
  const running = store.isViewInputRunning(viewId, occurrence);
  const field = document.createElement("label");
  const input = document.createElement("input");
  field.className = "text-view__input-control";
  field.dataset.renderVersion = String(inputRenderVersion.value);
  input.type = control.control === "numberbox" ? "number" : "text";
  input.className = `text-view__input text-view__input--${control.control}`;
  input.dataset.viewInput = String(occurrence);
  input.dataset.fingerprint =
    identity === undefined ? "" : JSON.stringify({ control: control.control, target: identity });
  input.setAttribute(
    "aria-label",
    control.label || (control.control === "numberbox" ? "Number input" : "Text input"),
  );
  input.step = control.control === "numberbox" ? "any" : "";
  if (control.control === "textbox") input.maxLength = LIMITS.inputLength;
  const value = control.value === null ? "" : formatValue(control.value);
  if (control.control === "numberbox" && control.value !== null) input.placeholder = value;
  input.dataset.current = value;
  input.dataset.draftKey = `${String(occurrence)}:${input.dataset.fingerprint}`;
  const message = inputErrors.get(input.dataset.draftKey);
  input.defaultValue = inputDrafts.get(input.dataset.draftKey) ?? value;
  input.value = input.defaultValue;
  input.disabled = isEditing || !store.canEdit || !identity || running;
  if (running) input.setAttribute("aria-busy", "true");
  if (message) {
    input.setAttribute("aria-invalid", "true");
    input.title = message;
  }
  if (control.label) {
    const label = document.createElement("span");
    label.className = "text-view__input-label";
    label.textContent = control.label;
    field.append(label);
  }
  field.append(input);
  if (message) {
    const feedback = document.createElement("span");
    feedback.className = "text-view__input-error";
    feedback.setAttribute("role", "alert");
    feedback.textContent = message;
    field.append(feedback);
  }
  return field;
}

/** Renders Markdown, then inserts error chips and buttons through DOM nodes. */
function renderMarkdown(parts: TemplateInline[], viewId: string, isEditing: boolean): string {
  const literal = parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  if (!parts.some((part) => part.type !== "text")) return markdown.render(literal);

  const renderedLiteral = document.createElement("template");
  renderedLiteral.innerHTML = markdown.render(literal);
  const literalOutput: string[] = [];
  const literalWalker = document.createTreeWalker(renderedLiteral.content, NodeFilter.SHOW_TEXT);
  while (literalWalker.nextNode()) literalOutput.push((literalWalker.currentNode as Text).data);
  for (const element of renderedLiteral.content.querySelectorAll("*")) {
    literalOutput.push(...Array.from(element.attributes, (attribute) => attribute.value));
  }
  const usedMarkers = new Set<string>();
  for (const text of [literal, ...literalOutput]) {
    for (const match of text.matchAll(REPLACEMENT_MARKER)) usedMarkers.add(match[0]);
  }

  const replacements = new Map<string, InlineReplacement>();
  let markerIndex = 0;
  const source = parts
    .map((part) => {
      if (part.type === "text") return part.text;
      let marker: string;
      const prefix =
        part.type === "error" ? "ROWZERROR" : part.type === "button" ? "ROWZBUTTON" : "ROWZINPUT";
      do {
        marker = `${prefix}${String(markerIndex)}END`;
        markerIndex += 1;
      } while (usedMarkers.has(marker));
      usedMarkers.add(marker);
      replacements.set(marker, part);
      return marker;
    })
    .join("");

  const rendered = document.createElement("template");
  rendered.innerHTML = markdown.render(source);
  const walker = document.createTreeWalker(rendered.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const replacement = document.createDocumentFragment();
    let from = 0;
    let found = false;
    for (const match of node.data.matchAll(REPLACEMENT_MARKER)) {
      const marker = match[0];
      const inline = replacements.get(marker);
      const next = match.index;
      if (inline === undefined) continue;
      found = true;
      replacement.append(document.createTextNode(node.data.slice(from, next)));
      replacement.append(inlineElement(inline, viewId, isEditing));
      from = next + marker.length;
    }
    if (found) {
      replacement.append(document.createTextNode(node.data.slice(from)));
      node.replaceWith(replacement);
    }
  }

  for (const element of rendered.content.querySelectorAll("*")) {
    const attributes = Array.from(element.attributes);
    const attributeErrors = attributes.map((attribute) => ({
      attribute,
      replacements: markersIn(attribute.value, replacements),
    }));
    const urlAttribute =
      element.tagName === "A" ? "href" : element.tagName === "IMG" ? "src" : undefined;
    const urlReplacements =
      urlAttribute === undefined
        ? undefined
        : attributeErrors.find(({ attribute }) => attribute.name === urlAttribute)?.replacements;
    if (urlReplacements && urlReplacements.length > 0 && element.tagName === "A") {
      const replacement = document.createDocumentFragment();
      while (element.firstChild) replacement.append(element.firstChild);
      for (const [, inline] of urlReplacements) {
        replacement.append(document.createTextNode(" "));
        replacement.append(inlineElement(inline, viewId, isEditing));
      }
      element.replaceWith(replacement);
      continue;
    }
    if (urlReplacements && urlReplacements.length > 0 && element.tagName === "IMG") {
      const replacement = document.createDocumentFragment();
      for (const [, inline] of urlReplacements) {
        replacement.append(inlineElement(inline, viewId, isEditing));
      }
      element.replaceWith(replacement);
      continue;
    }

    const found = new Map<string, InlineReplacement>();
    for (const { attribute, replacements: inAttribute } of attributeErrors) {
      for (const [marker, inline] of inAttribute) {
        found.set(marker, inline);
        attribute.value = attribute.value.replaceAll(marker, "");
      }
    }
    if (found.size > 0) {
      const replacementsAfter = document.createDocumentFragment();
      for (const inline of found.values()) {
        replacementsAfter.append(document.createTextNode(" "));
        replacementsAfter.append(inlineElement(inline, viewId, isEditing));
      }
      element.after(replacementsAfter);
    }
  }
  return rendered.innerHTML;
}

/** What the view shows. While editing, it follows what is being typed. */
const parts = computed(() => {
  return renderTemplate(
    editing.value ? draft.value : props.view.source,
    (expression, names) => store.evaluateOnPage(props.view.pageId, expression, names),
    undefined,
    (expression, value) => {
      const cell = store.cellReferenceOnPage(props.view.pageId, expression);
      return cell ? formattedText(value, store.formatOf(cell)) : undefined;
    },
  ).map((part) =>
    part.type === "markdown"
      ? { ...part, html: renderMarkdown(part.parts, props.view.id, editing.value) }
      : part,
  );
});

function runTextButton(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>("button[data-view-button]");
  if (!button || !props.view.id) return;
  event.preventDefault();
  event.stopPropagation();
  const occurrence = Number(button.dataset.viewButton);
  const message = button.dataset.confirmMessage;
  if (message !== undefined) {
    pendingButton.value = occurrence;
    returnFocus.value = button;
    confirmation.value = message;
  } else {
    void store.clickViewButton(props.view.id, occurrence);
  }
}

async function confirmTextButton(): Promise<void> {
  const occurrence = pendingButton.value;
  const viewId = props.view.id;
  confirmation.value = null;
  pendingButton.value = null;
  await nextTick();
  returnFocus.value = undefined;
  if (occurrence !== null && viewId && store.canEdit) {
    await store.clickViewButton(viewId, occurrence);
    await nextTick();
    textView.value
      ?.querySelector<HTMLButtonElement>(`button[data-view-button="${String(occurrence)}"]`)
      ?.focus({ preventScroll: true });
  }
}

async function cancelConfirmation(): Promise<void> {
  confirmation.value = null;
  pendingButton.value = null;
  await nextTick();
  returnFocus.value = undefined;
}

function inputFrom(event: Event): HTMLInputElement | undefined {
  const target = event.target;
  if (!(target instanceof Element)) return undefined;
  return target.closest<HTMLInputElement>("input[data-view-input]") ?? undefined;
}

function rememberTextInput(event: Event): void {
  const input = inputFrom(event);
  if (!input) return;
  const key = input.dataset.draftKey;
  if (key) inputDrafts.set(key, input.value);
}

async function commitTextInput(event: Event): Promise<void> {
  if (event.type === "keydown") {
    const key = event as KeyboardEvent;
    if (key.key !== "Enter") return;
    key.preventDefault();
    key.stopPropagation();
  }
  const input = inputFrom(event);
  if (!input || !props.view.id) return;
  if (input.type === "number" && input.validity.badInput) {
    if (event.type === "keydown") input.reportValidity();
    return;
  }
  const occurrence = Number(input.dataset.viewInput);
  const key = input.dataset.draftKey;
  if (!Number.isInteger(occurrence) || !key || committingInputs.has(key)) return;
  const value = input.value;
  const fingerprint = input.dataset.fingerprint;
  if (!fingerprint) {
    inputErrors.set(key, "This input changed. Refresh the view and try again");
    return;
  }
  let parsed: {
    control: "textbox" | "numberbox";
    target: { tableId: string; rowId: string; colId: string };
  };
  try {
    parsed = JSON.parse(fingerprint) as typeof parsed;
  } catch {
    inputErrors.set(key, "This input changed. Refresh the view and try again");
    return;
  }

  if (inputDrafts.get(key) === undefined) return;
  if (input.dataset.current === value) {
    inputDrafts.delete(key);
    inputErrors.delete(key);
    return;
  }

  committingInputs.add(key);
  const committed =
    input.type === "number" && input.value !== "" && Number.isFinite(input.valueAsNumber)
      ? input.valueAsNumber
      : value;
  const result = await store.inputViewControl(props.view.id, occurrence, {
    fingerprint: parsed,
    value: committed,
  });
  if (result?.status === "failed") {
    inputErrors.set(key, result.error ?? "The input could not be saved");
  } else if (result) {
    inputDrafts.delete(key);
    inputErrors.delete(key);
    inputRenderVersion.value += 1;
  } else {
    inputErrors.set(key, store.notice?.text ?? "The input could not be saved");
  }
  committingInputs.delete(key);
}

function editFromText(event: MouseEvent): void {
  if (inputFrom(event)) return;
  void edit();
}
</script>

<template>
  <section class="view-card" :data-view="view.name">
    <header class="view-card__header">
      <h2>
        <ErrorWarning
          v-if="store.errorBlocks.has(view.id)"
          :label="`${view.name} contains errors`"
        />
        <EditableName
          :value="view.name"
          label="Text view name"
          :disabled="!store.canEdit"
          @rename="store.updateView(view.id, { name: $event })"
        />
      </h2>
      <div v-if="store.canEdit" class="view-card__actions">
        <button v-if="!editing" type="button" data-block-action="Edit" @click="edit">Edit</button>
        <button type="button" data-block-action="Delete text" class="danger" @click="remove">
          Delete text
        </button>
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

    <ViewSourceEditor v-if="editing" :view="view" mode="markdown" label="Text view source" />

    <ConfirmDialog
      v-if="confirmation !== null"
      :message="confirmation"
      :return-focus="returnFocus"
      @confirm="confirmTextButton"
      @cancel="cancelConfirmation"
    />

    <div
      ref="textView"
      class="text-view"
      :title="store.canEdit && !editing ? 'Double-click to edit' : undefined"
      @input="rememberTextInput"
      @keydown="commitTextInput"
      @focusout="commitTextInput"
      @click="runTextButton"
      @dblclick="editFromText"
    >
      <template v-for="(part, index) in parts" :key="index">
        <!-- eslint-disable-next-line vue/no-v-html -- markdown-it output with raw HTML disabled -->
        <div v-if="part.type === 'markdown'" class="text-view__markdown" v-html="part.html"></div>
        <table v-else-if="part.type === 'table'" class="text-view__table">
          <tbody>
            <tr v-for="(cells, row) in part.rows" :key="row">
              <td
                v-for="(cell, col) in cells"
                :key="col"
                :class="{ 'text-view__number': typeof cell === 'number' }"
              >
                <span
                  v-if="isError(cell)"
                  class="md-error"
                  :aria-label="`${cell.code} ${cell.message ?? cell.code}`"
                  :title="cell.message ?? cell.code"
                >
                  {{ cell.code }}
                  <span class="md-error__message">{{ cell.message ?? cell.code }}</span>
                </span>
                <template v-else>{{ formatValue(cell) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
        <ChartView
          v-else-if="part.type === 'chart'"
          :chart="part.chart.chart"
          :rows="part.chart.rows"
          :title="part.chart.title"
        />
        <p v-else class="view-card__problem" role="alert">{{ part.message }}</p>
      </template>
      <p v-if="parts.length === 0" class="view-card__problem">This view is empty.</p>
    </div>
  </section>
</template>
