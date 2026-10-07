<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from "vue";
import { closeContextMenu } from "./contextMenuState";

const props = defineProps<{
  message: string;
  returnFocus?: HTMLElement;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const cancelButton = ref<HTMLButtonElement>();
const confirmButton = ref<HTMLButtonElement>();
const id = useId();
const titleId = `${id}-title`;
const messageId = `${id}-message`;
let originalFocus: HTMLElement | undefined;

onMounted(() => {
  closeContextMenu();
  originalFocus =
    props.returnFocus ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  cancelButton.value?.focus();
});

onBeforeUnmount(() => {
  if (originalFocus?.isConnected) originalFocus.focus({ preventScroll: true });
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
  } else if (event.key === "Tab") {
    const active = document.activeElement;
    if (event.shiftKey && active !== confirmButton.value) {
      event.preventDefault();
      confirmButton.value?.focus();
    } else if (!event.shiftKey && active !== cancelButton.value) {
      event.preventDefault();
      cancelButton.value?.focus();
    }
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="confirm-dialog__backdrop" @click.self="emit('cancel')">
      <section
        class="confirm-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="messageId"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <h2 :id="titleId">Confirm action</h2>
        <p :id="messageId">{{ message }}</p>
        <div class="confirm-dialog__actions">
          <button ref="cancelButton" type="button" @click="emit('cancel')">Cancel</button>
          <button ref="confirmButton" type="button" @click="emit('confirm')">Run button</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-dialog__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: grid;
  place-items: center;
  padding: 16px;
  background: #0006;
}

.confirm-dialog {
  width: min(440px, 100%);
  padding: 24px;
  border-radius: 8px;
  background: white;
  box-shadow: 0 8px 32px #0004;
}

.confirm-dialog h2 {
  margin: 0 0 12px;
}

.confirm-dialog p {
  margin: 0;
  white-space: pre-wrap;
}

.confirm-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}
</style>
