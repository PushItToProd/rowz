<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api, type RunListItem } from "../api/client";

const props = defineProps<{ spreadsheetId: string }>();
const emit = defineEmits<{ close: [] }>();
const runs = ref<RunListItem[] | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const panel = ref<HTMLElement>();

const KIND_LABELS = {
  cell_button: "Cell button",
  cell_input: "Cell input",
  view_button: "View button",
  view_input: "View input",
  unknown: "Earlier run (kind not recorded)",
} as const;

async function refresh(): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    runs.value = await api.listRuns(props.spreadsheetId);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Something went wrong";
  } finally {
    busy.value = false;
  }
}

function when(run: RunListItem): string {
  return new Date(run.createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function targetLabel(run: RunListItem): string {
  const target = run.target;
  const fallback = target.type === "cell" ? "Deleted table" : "Deleted view";
  const name = target.name ?? fallback;
  const prefix = target.pageName ? target.pageName + " · " + name : name;
  if (target.type === "cell") return prefix + "!" + target.cell;
  const occurrenceKind =
    run.kind === "view_input" ? "Input" : run.kind === "view_button" ? "Button" : "Occurrence";
  return prefix + " · " + occurrenceKind + " " + String(target.occurrence + 1);
}

function effects(run: RunListItem): string {
  const parts: string[] = [];
  if (run.cellsWritten > 0)
    parts.push(
      String(run.cellsWritten) + (run.cellsWritten === 1 ? " cell write" : " cell writes"),
    );
  if (run.tablesExpanded > 0)
    parts.push(
      String(run.tablesExpanded) +
        (run.tablesExpanded === 1 ? " table expanded" : " tables expanded"),
    );
  if (run.rowsDeleted > 0)
    parts.push(
      String(run.rowsDeleted) + (run.rowsDeleted === 1 ? " row deleted" : " rows deleted"),
    );
  if (run.emails > 0) {
    const emailLabel = run.status === "pending" ? " recipient email pending" : " email sent";
    const emailSuffix = run.status === "pending" ? " recipient emails pending" : " emails sent";
    parts.push(String(run.emails) + (run.emails === 1 ? emailLabel : emailSuffix));
  }
  return parts.length === 0 ? "No recorded effects" : parts.join(" · ");
}

function statusLabel(status: RunListItem["status"]): string {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  return "Pending";
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  panel.value?.focus();
  void refresh();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <aside ref="panel" class="side-panel runs" role="dialog" aria-label="Runs" tabindex="-1">
    <header class="side-panel__header">
      <h2>Runs</h2>
      <div class="runs__header-actions">
        <button type="button" aria-label="Refresh runs" :disabled="busy" @click="refresh">
          Refresh
        </button>
        <button type="button" aria-label="Close runs" @click="emit('close')">×</button>
      </div>
    </header>
    <p class="history__about">The latest 100 button and control runs, newest first.</p>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-if="runs === null && !error">Loading…</p>
    <p v-else-if="runs?.length === 0">No runs have been recorded yet.</p>
    <ol v-else class="runs__list">
      <li v-for="run in runs" :key="run.id" class="runs__item">
        <dl class="runs__details">
          <dt>Who</dt>
          <dd>
            <strong>{{ run.user?.name ?? "Deleted account" }}</strong>
            <span v-if="run.user" class="runs__email">{{ run.user.email }}</span>
          </dd>
          <dt>When</dt>
          <dd>
            <time :datetime="run.createdAt">{{ when(run) }}</time>
          </dd>
          <dt>Kind</dt>
          <dd>{{ KIND_LABELS[run.kind] }}</dd>
          <dt>Target</dt>
          <dd>{{ targetLabel(run) }}</dd>
          <dt>Effects</dt>
          <dd>{{ effects(run) }}</dd>
          <dt>Outcome</dt>
          <dd>
            <strong :class="['runs__outcome', 'runs__outcome--' + run.status]">
              {{ statusLabel(run.status) }}
            </strong>
            <span v-if="run.error" class="runs__error">{{ run.error }}</span>
          </dd>
        </dl>
      </li>
    </ol>
  </aside>
</template>
