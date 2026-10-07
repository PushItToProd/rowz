import { afterEach, describe, expect, it, vi } from "vitest";
import { closeContextMenu, registerContextMenu } from "./contextMenuState";

const unregister: (() => void)[] = [];

afterEach(() => {
  for (const remove of unregister.splice(0)) remove();
});

describe("active context menu", () => {
  it("closes the previous menu when a new one opens", () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    unregister.push(registerContextMenu(closeFirst));
    unregister.push(registerContextMenu(closeSecond));

    expect(closeFirst).toHaveBeenCalledOnce();
    closeContextMenu();
    expect(closeSecond).toHaveBeenCalledOnce();
  });

  it("does not let an old menu clear the new menu registration", () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const removeFirst = registerContextMenu(closeFirst);
    unregister.push(removeFirst);
    unregister.push(registerContextMenu(closeSecond));

    removeFirst();
    closeContextMenu();
    expect(closeSecond).toHaveBeenCalledOnce();
  });
});
