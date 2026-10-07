import { nextTick, readonly, shallowRef } from "vue";
import { closeContextMenu } from "./components/contextMenuState";

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptDialogOptions {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface AlertDialogOptions {
  title: string;
  message: string;
  closeLabel?: string;
}

type DialogKind = "confirm" | "prompt" | "alert";
type DialogResult = boolean | string | null | undefined;

interface DialogRequest {
  id: number;
  kind: DialogKind;
  title: string;
  message: string | undefined;
  label: string | undefined;
  value: string;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  danger: boolean;
  returnFocus: HTMLElement | undefined;
  resolve(value: DialogResult): void;
}

const active = shallowRef<DialogRequest | null>(null);
const pending: DialogRequest[] = [];
let nextId = 0;

function cancellation(request: DialogRequest): DialogResult {
  if (request.kind === "confirm") return false;
  if (request.kind === "prompt") return null;
  return undefined;
}

function resolveActive(value: DialogResult): void {
  const request = active.value;
  if (!request) return;
  active.value = pending.shift() ?? null;
  request.resolve(value);
  if (!active.value) {
    void nextTick(() => {
      if (request.returnFocus?.isConnected) request.returnFocus.focus({ preventScroll: true });
    });
  }
}

function enqueue(
  request: Omit<DialogRequest, "id" | "returnFocus" | "resolve">,
): Promise<DialogResult> {
  closeContextMenu();
  return new Promise((resolve) => {
    const returnFocus =
      active.value?.returnFocus ??
      (typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined);
    const next: DialogRequest = {
      ...request,
      id: ++nextId,
      returnFocus,
      resolve,
    };
    if (active.value) pending.push(next);
    else active.value = next;
  });
}

function confirm(options: ConfirmDialogOptions): Promise<boolean> {
  return enqueue({
    kind: "confirm",
    title: options.title,
    message: options.message,
    label: undefined,
    value: "",
    confirmLabel: options.confirmLabel ?? "Continue",
    cancelLabel: options.cancelLabel ?? "Cancel",
    closeLabel: "",
    danger: options.danger ?? false,
  }).then((result) => result === true);
}

function prompt(options: PromptDialogOptions): Promise<string | null> {
  return enqueue({
    kind: "prompt",
    title: options.title,
    message: undefined,
    label: options.label,
    value: options.initial ?? "",
    confirmLabel: options.confirmLabel ?? "OK",
    cancelLabel: options.cancelLabel ?? "Cancel",
    closeLabel: "",
    danger: false,
  }).then((result) => (typeof result === "string" ? result : null));
}

function alert(options: AlertDialogOptions): Promise<void> {
  return enqueue({
    kind: "alert",
    title: options.title,
    message: options.message,
    label: undefined,
    value: "",
    confirmLabel: "",
    cancelLabel: "",
    closeLabel: options.closeLabel ?? "OK",
    danger: false,
  }).then(() => undefined);
}

function cancel(): void {
  if (active.value) resolveActive(cancellation(active.value));
}

function accept(): void {
  const request = active.value;
  if (!request) return;
  if (request.kind === "confirm") resolveActive(true);
  else if (request.kind === "prompt") resolveActive(request.value);
  else resolveActive(undefined);
}

function setPromptValue(value: string): void {
  if (active.value?.kind === "prompt") active.value.value = value;
}

function dispose(): void {
  const requests = [active.value, ...pending].filter(
    (request): request is DialogRequest => request !== null,
  );
  active.value = null;
  pending.length = 0;
  for (const request of requests) request.resolve(cancellation(request));
  const returnFocus = requests[0]?.returnFocus;
  if (returnFocus) {
    void nextTick(() => {
      if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    });
  }
}

const dialogs = {
  active: readonly(active),
  confirm,
  prompt,
  alert,
  accept,
  cancel,
  setPromptValue,
  dispose,
};

/** A single promise-based dialog service shared by app components and the router. */
export function useDialog(): typeof dialogs {
  return dialogs;
}
