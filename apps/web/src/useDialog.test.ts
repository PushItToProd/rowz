import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appDialog, fillDialogInput, mountDialogHost, respondToDialog } from "./testing";
import { useDialog } from "./useDialog";

let host: VueWrapper;
let trigger: HTMLButtonElement;

beforeEach(() => {
  host = mountDialogHost();
  trigger = document.createElement("button");
  trigger.textContent = "Open dialog";
  document.body.append(trigger);
  trigger.focus();
});

afterEach(() => {
  host.unmount();
  trigger.remove();
});

describe("useDialog", () => {
  it("confirms through an accessible alert dialog, traps focus, and restores focus", async () => {
    const result = useDialog().confirm({
      title: "Delete document",
      message: "Delete Budget? This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    await flushPromises();

    const element = appDialog()!;
    expect(element.getAttribute("role")).toBe("alertdialog");
    expect(element.getAttribute("aria-modal")).toBe("true");
    expect(element.querySelector("h2")?.id).toBe(element.getAttribute("aria-labelledby"));
    expect(element.querySelector("p")?.id).toBe(element.getAttribute("aria-describedby"));
    const cancel = element.querySelector<HTMLButtonElement>('[data-dialog-action="cancel"]')!;
    const confirm = element.querySelector<HTMLButtonElement>('[data-dialog-action="confirm"]')!;
    expect(document.activeElement).toBe(cancel);

    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(confirm);
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(cancel);

    await respondToDialog("confirm");
    expect(await result).toBe(true);
    await nextTick();
    expect(document.activeElement).toBe(trigger);
  });

  it("returns the edited prompt value when Enter is pressed and null on Escape", async () => {
    const result = useDialog().prompt({
      title: "Rename table",
      label: "Table name",
      initial: "Table 1",
    });
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>("[data-dialog-input]")!;
    expect(document.activeElement).toBe(input);
    await fillDialogInput("Sales");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(await result).toBe("Sales");

    const cancelled = useDialog().prompt({ title: "Rename table", label: "Table name" });
    await flushPromises();
    appDialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await cancelled).toBeNull();
  });

  it("shows alerts with a single safe close button", async () => {
    const result = useDialog().alert({
      title: "Import complete",
      message: "The document is ready.",
    });
    await flushPromises();
    const element = appDialog()!;
    expect(element.getAttribute("role")).toBe("alertdialog");
    expect(document.activeElement).toBe(element.querySelector('[data-dialog-action="close"]'));
    await respondToDialog("close");
    await result;
  });
});
