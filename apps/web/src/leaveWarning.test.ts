import { afterEach, describe, expect, it } from "vitest";
import { warnBeforeLeaving } from "./leaveWarning";

/** Whether the browser would ask before leaving: a handler prevented the event's default. */
function asksBeforeLeaving(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("warnBeforeLeaving", () => {
  let stop = (): void => undefined;
  afterEach(() => {
    stop();
  });

  it("asks only while there are unsaved changes", () => {
    let unsaved = false;
    stop = warnBeforeLeaving(() => unsaved);
    expect(asksBeforeLeaving()).toBe(false);
    unsaved = true;
    expect(asksBeforeLeaving()).toBe(true);
    unsaved = false;
    expect(asksBeforeLeaving()).toBe(false);
  });

  it("no longer asks once stopped", () => {
    stop = warnBeforeLeaving(() => true);
    stop();
    expect(asksBeforeLeaving()).toBe(false);
  });
});
