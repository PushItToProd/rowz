import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { Notice } from "../notice";
import NoticeMessage from "./NoticeMessage.vue";

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.useRealTimers();
});

it("dismisses errors after eight seconds", async () => {
  vi.useFakeTimers();
  wrapper = mount(NoticeMessage, {
    props: { notice: { kind: "error", text: "Offline" } },
  });

  await vi.advanceTimersByTimeAsync(7999);
  expect(wrapper.emitted("dismiss")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(wrapper.emitted("dismiss")).toHaveLength(1);
});

it("restarts the timer when the same message is shown again", async () => {
  vi.useFakeTimers();
  const notice: Notice = { kind: "error", text: "A folder named Work already exists" };
  wrapper = mount(NoticeMessage, { props: { notice } });

  await vi.advanceTimersByTimeAsync(7000);
  await wrapper.setProps({ notice: { ...notice } });
  await vi.advanceTimersByTimeAsync(7999);
  expect(wrapper.emitted("dismiss")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(wrapper.emitted("dismiss")).toHaveLength(1);
});

it("dismisses on Escape and keeps success notices brief", async () => {
  vi.useFakeTimers();
  wrapper = mount(NoticeMessage, {
    props: { notice: { kind: "success", text: "Saved" } },
  });

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(wrapper.emitted("dismiss")).toHaveLength(1);
  wrapper.unmount();

  wrapper = mount(NoticeMessage, {
    props: { notice: { kind: "success", text: "Saved" } },
  });
  await vi.advanceTimersByTimeAsync(3999);
  await flushPromises();
  expect(wrapper.emitted("dismiss")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(wrapper.emitted("dismiss")).toHaveLength(1);
});
