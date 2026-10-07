import { expect, it, vi } from "vitest";
import { writeClipboardText } from "./clipboard";

it("restores the document selection and focus after fallback copying", async () => {
  const content = document.createElement("span");
  content.textContent = "selected error text";
  const button = document.createElement("button");
  document.body.append(content, button);
  button.focus();

  const selection = document.getSelection();
  if (!selection) throw new Error("The document has no selection object");
  const range = document.createRange();
  range.selectNodeContents(content);
  selection.removeAllRanges();
  selection.addRange(range);

  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  const commandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
  const execCommand = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
  const select = vi.spyOn(HTMLTextAreaElement.prototype, "select").mockImplementation(function (
    this: HTMLTextAreaElement,
  ) {
    selection.removeAllRanges();
    this.focus();
  });

  try {
    expect(await writeClipboardText("copied text")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(selection.toString()).toBe("selected error text");
    expect(document.activeElement).toBe(button);
  } finally {
    selection.removeAllRanges();
    select.mockRestore();
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
    if (commandDescriptor) Object.defineProperty(document, "execCommand", commandDescriptor);
    else Reflect.deleteProperty(document, "execCommand");
    content.remove();
    button.remove();
  }
});
