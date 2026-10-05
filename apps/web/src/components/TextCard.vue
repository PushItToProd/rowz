<script setup lang="ts">
import {
  formatValue,
  isError,
  renderTemplate,
  type ErrorValue,
  type TemplateInline,
} from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed } from "vue";
import type { ViewRecord } from "../api/client";
import { markdown } from "../markdown";
import { useWorkbookStore } from "../stores/workbook";
import ChartView from "./ChartView.vue";
import ViewSourceEditor from "./ViewSourceEditor.vue";
import { sameEditingTarget, useFormulaSessionStore } from "../formula/session";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";

const props = defineProps<{ view: ViewRecord }>();
const store = useWorkbookStore();

const sessions = useFormulaSessionStore();
const target = { kind: "markdown" as const, viewId: props.view.id };
const active = computed(() =>
  sessions.active && sameEditingTarget(sessions.active.target, target)
    ? sessions.active
    : undefined,
);
const editing = computed(() => !!active.value);
const draft = computed(() => active.value?.state.doc.toString() ?? props.view.source);
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

function remove(): void {
  if (window.confirm(`Delete ${props.view.name}?`)) void store.deleteView(props.view.id);
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

function markersIn(text: string, chips: ReadonlyMap<string, ErrorValue>): [string, ErrorValue][] {
  const found: [string, ErrorValue][] = [];
  for (const match of text.matchAll(/ROWZERROR\d+END/g)) {
    const marker = match[0];
    const error = chips.get(marker);
    if (error !== undefined) found.push([marker, error]);
  }
  return found;
}

/** Renders Markdown text and inserts error chips after Markdown has escaped its source. */
function renderMarkdown(parts: TemplateInline[]): string {
  const literal = parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  if (!parts.some((part) => part.type === "error")) return markdown.render(literal);

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
    for (const match of text.matchAll(/ROWZERROR\d+END/g)) usedMarkers.add(match[0]);
  }

  const chips = new Map<string, ErrorValue>();
  let markerIndex = 0;
  const source = parts
    .map((part) => {
      if (part.type === "text") return part.text;
      let marker: string;
      do {
        marker = `ROWZERROR${String(markerIndex)}END`;
        markerIndex += 1;
      } while (usedMarkers.has(marker));
      chips.set(marker, part.error);
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
    for (const match of node.data.matchAll(/ROWZERROR\d+END/g)) {
      const marker = match[0];
      const error = chips.get(marker);
      const next = match.index;
      if (error === undefined) continue;
      found = true;
      replacement.append(document.createTextNode(node.data.slice(from, next)));
      replacement.append(errorChip(error));
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
      errors: markersIn(attribute.value, chips),
    }));
    const urlAttribute =
      element.tagName === "A" ? "href" : element.tagName === "IMG" ? "src" : undefined;
    const urlErrors =
      urlAttribute === undefined
        ? undefined
        : attributeErrors.find(({ attribute }) => attribute.name === urlAttribute)?.errors;
    if (urlErrors && urlErrors.length > 0 && element.tagName === "A") {
      const replacement = document.createDocumentFragment();
      while (element.firstChild) replacement.append(element.firstChild);
      for (const [, error] of urlErrors) {
        replacement.append(document.createTextNode(" "));
        replacement.append(errorChip(error));
      }
      element.replaceWith(replacement);
      continue;
    }
    if (urlErrors && urlErrors.length > 0 && element.tagName === "IMG") {
      const replacement = document.createDocumentFragment();
      for (const [, error] of urlErrors) replacement.append(errorChip(error));
      element.replaceWith(replacement);
      continue;
    }

    const found = new Map<string, ErrorValue>();
    for (const { attribute, errors } of attributeErrors) {
      for (const [marker, error] of errors) {
        found.set(marker, error);
        attribute.value = attribute.value.replaceAll(marker, "");
      }
    }
    if (found.size > 0) {
      const chipsAfter = document.createDocumentFragment();
      for (const error of found.values()) {
        chipsAfter.append(document.createTextNode(" "));
        chipsAfter.append(errorChip(error));
      }
      element.after(chipsAfter);
    }
  }
  return rendered.innerHTML;
}

/** What the view shows. While editing, it follows what is being typed. */
const parts = computed(() =>
  renderTemplate(editing.value ? draft.value : props.view.source, (expression, names) =>
    store.evaluateOnPage(props.view.pageId, expression, names),
  ).map((part) =>
    part.type === "markdown" ? { ...part, html: renderMarkdown(part.parts) } : part,
  ),
);
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
        <button v-if="!editing" type="button" @click="edit">Edit</button>
        <button type="button" class="danger" @click="remove">Delete text</button>
      </div>
    </header>

    <ViewSourceEditor v-if="editing" :view="view" mode="markdown" label="Text view source" />

    <div
      class="text-view"
      :title="store.canEdit && !editing ? 'Double-click to edit' : undefined"
      @dblclick="edit"
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
