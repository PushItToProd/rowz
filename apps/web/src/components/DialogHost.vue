<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { useDialog } from "../useDialog";

const dialog = useDialog();
const current = dialog.active;
const panel = ref<HTMLElement>();
const promptInput = ref<HTMLInputElement>();
const safeButton = ref<HTMLButtonElement>();
const id = useId();
const titleId = computed(() => `${id}-title-${String(current.value?.id ?? "closed")}`);
const messageId = computed(() => `${id}-message-${String(current.value?.id ?? "closed")}`);
const inputId = `${id}-input`;

watch(
  () => current.value?.id,
  async (requestId) => {
    if (requestId === undefined) return;
    await nextTick();
    if (current.value?.kind === "prompt") promptInput.value?.focus();
    else safeButton.value?.focus();
  },
  { immediate: true },
);

onBeforeUnmount(dialog.dispose);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dialog.cancel();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [
    ...(panel.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? []),
  ];
  if (focusable.length === 0) {
    event.preventDefault();
    panel.value?.focus();
    return;
  }
  const first = focusable.at(0);
  const last = focusable.at(-1);
  if (!first || !last) return;
  const focused = document.activeElement;
  if (event.shiftKey && (focused === first || !focusable.includes(focused as HTMLElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (focused === last || !focusable.includes(focused as HTMLElement))) {
    event.preventDefault();
    first.focus();
  }
}

function updatePrompt(event: Event): void {
  dialog.setPromptValue((event.target as HTMLInputElement).value);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="current" class="dialog-host__backdrop" data-app-dialog @click.self="dialog.cancel">
      <section
        ref="panel"
        class="dialog-host"
        :role="current.kind === 'alert' || current.danger ? 'alertdialog' : 'dialog'"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="current.message ? messageId : undefined"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <h2 :id="titleId">{{ current.title }}</h2>
        <p v-if="current.message" :id="messageId">{{ current.message }}</p>
        <div v-if="current.kind === 'prompt'" class="dialog-host__field">
          <label :for="inputId">{{ current.label }}</label>
          <input
            :id="inputId"
            ref="promptInput"
            data-dialog-input
            :value="current.value"
            @input="updatePrompt"
            @keydown.enter.stop.prevent="dialog.accept"
          />
        </div>
        <div class="dialog-host__actions">
          <template v-if="current.kind !== 'alert'">
            <button
              ref="safeButton"
              type="button"
              data-dialog-action="cancel"
              @click="dialog.cancel"
            >
              {{ current.cancelLabel }}
            </button>
            <button
              type="button"
              data-dialog-action="confirm"
              :class="current.danger ? 'danger' : 'primary'"
              @click="dialog.accept"
            >
              {{ current.confirmLabel }}
            </button>
          </template>
          <button
            v-else
            ref="safeButton"
            type="button"
            data-dialog-action="close"
            class="primary"
            @click="dialog.accept"
          >
            {{ current.closeLabel }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-host__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: grid;
  place-items: center;
  overflow-y: auto;
  padding: 16px;
  background: rgb(0 0 0 / 45%);
}

.dialog-host {
  width: min(440px, 100%);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 8px 32px rgb(0 0 0 / 28%);
}

.dialog-host h2 {
  margin: 0 0 12px;
}

.dialog-host p {
  margin: 0;
  white-space: pre-wrap;
}

.dialog-host__field {
  display: grid;
  gap: 6px;
  margin-top: 16px;
}

.dialog-host__field input {
  width: 100%;
}

.dialog-host__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}

@media (max-width: 480px) {
  .dialog-host__backdrop {
    align-items: end;
    padding: 0;
  }

  .dialog-host {
    width: 100%;
    max-height: min(85dvh, 640px);
    padding: 20px 16px max(20px, env(safe-area-inset-bottom));
    border-radius: 12px 12px 0 0;
  }
}
</style>
