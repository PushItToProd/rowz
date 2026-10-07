import { onBeforeUnmount, ref } from "vue";
import { writeClipboardText } from "../clipboard";

export function useCopyFeedback() {
  const status = ref("");
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(text: string): Promise<void> {
    if (!(await writeClipboardText(text))) return;
    status.value = "Copied";
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      status.value = "";
      timer = undefined;
    }, 2000);
  }

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
  });

  return { status, copy };
}
