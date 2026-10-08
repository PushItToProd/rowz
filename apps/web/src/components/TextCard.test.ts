import { EditorView } from "@codemirror/view";
import { wireSnapshot, changeWith } from "../testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import {
  appDialog,
  at,
  clickResult,
  identifiedAt,
  mountDialogHost,
  respondToDialog,
  snapshotWith,
  TABLE,
  type MockedApi,
} from "../testing";
import TextCard from "./TextCard.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

const TEXT: ViewRecord = {
  id: "v1",
  pageId: "p1",
  kind: "text",
  name: "Text 1",
  position: 1,
  source: "",
  chartType: null,
};
const CELLS = { A1: "apples", B1: "3", A2: "pears", B2: "5" };

let wrapper: VueWrapper;
async function editorView(): Promise<EditorView> {
  await flushPromises();
  return EditorView.findFromDOM(wrapper.get(".cm-content").element as HTMLElement)!;
}
async function replaceDraft(text: string): Promise<void> {
  const editor = await editorView();
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text },
    selection: { anchor: text.length },
    userEvent: "input.type",
  });
  await flushPromises();
}

let dialogHost: VueWrapper;

async function render(
  source: string,
  role = "owner",
  options: { cells?: Record<string, string>; table?: Partial<typeof TABLE> } = {},
): Promise<void> {
  server.getSnapshot.mockResolvedValue(
    wireSnapshot({
      ...snapshotWith(options.cells ?? CELLS, role),
      tables: [{ ...TABLE, ...options.table }],
      views: [{ ...TEXT, source }],
    }),
  );
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(
    {
      components: { TextCard },
      setup: () => ({ store }),
      template: `<TextCard v-if="store.views[0]" :view="store.views[0]" />`,
    },
    { attachTo: document.body },
  );
}

function button(name: string) {
  const found = wrapper.findAll("button").find((candidate) => candidate.text() === name);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

const shown = () => wrapper.get(".text-view");

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  dialogHost = mountDialogHost();
  server.updateView.mockImplementation((_id, changes) =>
    Promise.resolve(changeWith({ ...TEXT, ...changes })),
  );
});
afterEach(() => {
  wrapper.unmount();
  dialogHost.unmount();
});

describe("TextCard", () => {
  it("uses a direct cell's number or date format, and leaves other values alone", async () => {
    await render(
      "{{ 'Table 1'!A1 }} | {{ 'Table 1'!B1 }} | {{ 'Table 1'!A2 }} | {{ 'Table 1'!B2 }} | {{ 'Table 1'!A1 * 2 }}",
      "owner",
      {
        cells: { A1: "7.5", B1: "0.256", A2: "2026-09-30", B2: "6.2" },
        table: {
          formats: [
            {
              startRow: 0,
              endRow: 0,
              startCol: 0,
              endCol: 0,
              format: { numberFormat: "$#,##0.00" },
            },
            { startRow: 0, endRow: 0, startCol: 1, endCol: 1, format: { numberFormat: "0.0%" } },
            {
              startRow: 1,
              endRow: 1,
              startCol: 0,
              endCol: 0,
              format: { numberFormat: "mmm d, yyyy" },
            },
          ],
        },
      },
    );
    expect(shown().text()).toBe("$7.50 | 25.6% | Sep 30, 2026 | 6.2 | 15");
  });

  it("uses the positional number format of a computed formula-column cell", async () => {
    await render("{{ 'Table 1'!C1 }}", "owner", {
      cells: { B1: "7.5" },
      table: {
        columns: [
          { name: "Name", type: "any" },
          { name: "Amount", type: "number" },
          { name: "Double", type: "formula", formula: "=[Amount]*2" },
        ],
        formats: [
          { startRow: 0, endRow: 0, startCol: 2, endCol: 2, format: { numberFormat: "$#,##0.00" } },
        ],
      },
    });
    expect(shown().text()).toBe("$15.00");
  });

  it("uses a conditional number format without carrying its visual styles", async () => {
    await render("{{ 'Table 1'!A1 }}", "owner", {
      cells: { A1: "7.5" },
      table: {
        conditionalFormats: [
          {
            kind: "criterion",
            startRow: 0,
            endRow: 0,
            startCol: 0,
            endCol: 0,
            criterion: ">0",
            format: { numberFormat: "$#,##0.00", bold: true, color: "red", fill: "yellow" },
          },
        ],
      },
    });
    expect(shown().text()).toBe("$7.50");
    expect(shown().find("strong").exists()).toBe(false);
  });

  it("uses stored cell formats when a data table is sorted", async () => {
    await render("{{ 'Table 1'!B1 }} | {{ 'Table 1'!B2 }}", "owner", {
      cells: { A1: "apples", B1: "7.5", A2: "pears", B2: "0.256" },
      table: {
        display: { sort: [{ colId: "c1", descending: true }] },
        formats: [
          { startRow: 0, endRow: 0, startCol: 1, endCol: 1, format: { numberFormat: "$#,##0.00" } },
          { startRow: 1, endRow: 1, startCol: 1, endCol: 1, format: { numberFormat: "0.0%" } },
        ],
      },
    });
    expect(shown().text()).toBe("$7.50 | 25.6%");
  });

  it("shows Markdown with the values of its formulas written in", async () => {
    await render("## Fruit\n\nWe have **{{ SUM('Table 1'!B1:B2) }}** pieces.");
    expect(shown().get("h2").text()).toBe("Fruit");
    expect(shown().get("p").text()).toBe("We have 8 pieces.");
    expect(shown().get("strong").text()).toBe("8");
  });

  it("updates when a cell changes", async () => {
    await render("{{ 'Table 1'!B1 * 2 }}");
    expect(shown().text()).toBe("6");
    await useWorkbookStore().setCell(at("B1"), "10");
    await flushPromises();
    expect(shown().text()).toBe("20");
  });

  it("repeats a part for each row of a range", async () => {
    await render("{% for name, count in 'Table 1'!A1:B2 %}\n- {{ name }}: {{ count }}\n{% end %}");
    expect(
      shown()
        .findAll("li")
        .map((item) => item.text()),
    ).toEqual(["apples: 3", "pears: 5"]);
  });

  it("shows a range as a table, with numbers to the right", async () => {
    await render("{{ 'Table 1'!A1:B2 }}");
    const cells = shown().findAll(".text-view__table td");
    expect(cells.map((cell) => cell.text())).toEqual(["apples", "3", "pears", "5"]);
    expect(cells.map((cell) => cell.classes("text-view__number"))).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("shows errors in a range table as chips with their message", async () => {
    await render("{{ 'Table 1'!A1:B2 }}");
    await useWorkbookStore().setCell(at("A2"), "=nonexistentvar");
    await flushPromises();
    const chip = shown().get(".text-view__table .md-error");
    expect(chip.text()).toContain("#NAME? Unknown name 'nonexistentvar'");
    expect(chip.attributes("title")).toBe("Unknown name 'nonexistentvar'");
  });

  it("draws a chart a formula gives", async () => {
    await render(`{{ PIE_CHART('Table 1'!A1:B2, "Fruit") }}`);
    expect(shown().get(".chart").attributes("data-chart")).toBe("pie");
    expect(shown().findAll("[data-chart-value]")).toHaveLength(2);
    expect(shown().get("figcaption").text()).toBe("Fruit");
  });

  it("renders safe text-view buttons and sends only their occurrence index", async () => {
    await render(
      `{{ BUTTON("<img src=x onerror=alert(1)>", EXECUTE(1, 'Table 1'!A1)) }} {{ BUTTON("Second", EXECUTE(2, 'Table 1'!A1)) }}`,
    );
    expect(shown().find("img").exists()).toBe(false);
    expect(
      shown()
        .findAll(".text-view__button")
        .map((item) => item.text()),
    ).toEqual(["<img src=x onerror=alert(1)>", "Second"]);
    expect(
      shown()
        .findAll(".text-view__button")
        .every((item) => item.element.tagName === "BUTTON"),
    ).toBe(true);

    server.clickViewButton.mockResolvedValue(clickResult());
    await button("Second").trigger("click");
    await flushPromises();
    expect(server.clickViewButton).toHaveBeenCalledExactlyOnceWith("v1", 1);
    expect(useWorkbookStore().notice).toEqual({ kind: "success", text: "Done" });
  });

  it("waits for confirmation before sending a text-view button click", async () => {
    await render(`{{ BUTTON("Clear", CLEAR('Table 1'!A1), "Clear this value?") }}`);
    server.clickViewButton.mockResolvedValue(clickResult());

    await button("Clear").trigger("click");
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Clear this value?");
    expect(server.clickViewButton).not.toHaveBeenCalled();

    const cancel = document.querySelector<HTMLButtonElement>(
      ".confirm-dialog__actions button:first-child",
    );
    cancel?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(server.clickViewButton).not.toHaveBeenCalled();
    cancel?.click();

    await button("Clear").trigger("click");
    document
      .querySelector<HTMLButtonElement>(".confirm-dialog__actions button:last-child")
      ?.click();
    await flushPromises();
    expect(server.clickViewButton).toHaveBeenCalledExactlyOnceWith("v1", 0);
  });

  it("restores focus to the same text-view button after a confirmed click finishes", async () => {
    await render(
      `{{ BUTTON("Keep", EXECUTE(1, 'Table 1'!A1)) }} {{ BUTTON("Clear", CLEAR('Table 1'!A1), "Clear this value?") }}`,
    );
    let finish!: (result: ReturnType<typeof clickResult>) => void;
    server.clickViewButton.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const trigger = button("Clear").element as HTMLButtonElement;
    trigger.focus();
    await button("Clear").trigger("click");
    document
      .querySelector<HTMLButtonElement>(".confirm-dialog__actions button:last-child")
      ?.click();
    await flushPromises();
    expect(server.clickViewButton).toHaveBeenCalledExactlyOnceWith("v1", 1);
    expect(button("Running…").attributes("disabled")).toBeDefined();

    finish(clickResult());
    await flushPromises();
    expect(button("Clear").element).not.toBe(trigger);
    expect(document.activeElement).toBe(button("Clear").element);
  });

  it("sends the selected loop button occurrence without serializing its bindings", async () => {
    await render(
      "{% for name in 'Table 1'!A1:A2 %}{{ BUTTON(name, EXECUTE(name, 'Table 1'!B1)) }}{% end %}",
    );
    expect(
      shown()
        .findAll(".text-view__button")
        .map((item) => item.text()),
    ).toEqual(["apples", "pears"]);
    server.clickViewButton.mockResolvedValue(clickResult());
    await button("pears").trigger("click");
    await flushPromises();
    expect(server.clickViewButton).toHaveBeenCalledExactlyOnceWith("v1", 1);
  });

  it("shows busy and error feedback while a text-view action runs", async () => {
    await render(`{{ BUTTON("Run", EXECUTE(1, 'Table 1'!A1)) }}`);
    let finish!: (result: ReturnType<typeof clickResult>) => void;
    server.clickViewButton.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    await button("Run").trigger("click");
    await flushPromises();
    expect(button("Running…").attributes("disabled")).toBeDefined();
    finish(clickResult({ status: "failed", error: "The action failed" }));
    await flushPromises();
    expect(button("Run").attributes("disabled")).toBeUndefined();
    expect(useWorkbookStore().notice).toEqual({ kind: "error", text: "The action failed" });
  });

  it("renders safe text and number inputs and commits them with their target fingerprints", async () => {
    await render(`Name: {{ TEXTBOX('Table 1'!A1, "Name") }} Count: {{ NUMBERBOX('Table 1'!B1) }}`);
    const textInput = shown().get<HTMLInputElement>(".text-view__input--textbox");
    const numberInput = shown().get<HTMLInputElement>(".text-view__input--numberbox");
    expect(textInput.element.type).toBe("text");
    expect(textInput.element.value).toBe("apples");
    expect(numberInput.element.type).toBe("number");
    expect(numberInput.element.value).toBe("3");

    const html = '<img src=x onerror="alert(1)">';
    server.inputViewControl.mockImplementation((_viewId, occurrence, input) =>
      Promise.resolve(
        clickResult({
          cells: [
            {
              ...at(occurrence === 0 ? "A1" : "B1"),
              input: occurrence === 0 ? `'${html}` : String(input.value),
            },
          ],
        }),
      ),
    );
    await textInput.setValue(html);
    await textInput.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(server.inputViewControl).toHaveBeenCalledExactlyOnceWith("v1", 0, {
      fingerprint: { control: "textbox", target: identifiedAt("A1") },
      value: html,
    });
    expect(shown().find("img").exists()).toBe(false);
    expect(textInput.element.value).toBe(html);

    const refreshedNumberInput = shown().get<HTMLInputElement>(".text-view__input--numberbox");
    await refreshedNumberInput.setValue("4.5");
    await refreshedNumberInput.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(server.inputViewControl).toHaveBeenNthCalledWith(2, "v1", 1, {
      fingerprint: { control: "numberbox", target: identifiedAt("B1") },
      value: 4.5,
    });
  });

  it("does not commit an incomplete number input", async () => {
    await render(`Count: {{ NUMBERBOX('Table 1'!B1) }}`);
    const input = shown().get<HTMLInputElement>(".text-view__input--numberbox");
    const reportValidity = vi.spyOn(input.element, "reportValidity").mockReturnValue(false);
    Object.defineProperty(input.element, "validity", {
      configurable: true,
      value: { badInput: true },
    });
    Object.defineProperty(input.element, "value", {
      configurable: true,
      get: () => "",
    });

    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(server.inputViewControl).not.toHaveBeenCalled();
    expect(input.element.value).toBe("");
    expect(reportValidity).toHaveBeenCalledOnce();
  });

  it("does not report validity when an incomplete number input loses focus", async () => {
    await render(`Count: {{ NUMBERBOX('Table 1'!B1) }}`);
    const input = shown().get<HTMLInputElement>(".text-view__input--numberbox");
    const reportValidity = vi.spyOn(input.element, "reportValidity").mockReturnValue(false);
    Object.defineProperty(input.element, "validity", {
      configurable: true,
      value: { badInput: true },
    });
    Object.defineProperty(input.element, "value", {
      configurable: true,
      get: () => "",
    });

    await input.trigger("focusout");
    await flushPromises();

    expect(server.inputViewControl).not.toHaveBeenCalled();
    expect(reportValidity).not.toHaveBeenCalled();
  });

  it("still commits an empty number input", async () => {
    await render(`Count: {{ NUMBERBOX('Table 1'!B1) }}`);
    const input = shown().get<HTMLInputElement>(".text-view__input--numberbox");

    await input.setValue("");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(server.inputViewControl).toHaveBeenCalledExactlyOnceWith("v1", 0, {
      fingerprint: { control: "numberbox", target: identifiedAt("B1") },
      value: "",
    });
  });

  it("shows an error beside a text-view input when its commit is refused", async () => {
    await render("{{ TEXTBOX('Table 1'!A1) }}");
    server.inputViewControl.mockResolvedValue(
      clickResult({
        status: "failed",
        error: "This input changed. Refresh the view and try again",
      }),
    );
    const input = shown().get<HTMLInputElement>("input");
    await input.setValue("new name");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(shown().get(".text-view__input-error").text()).toBe(
      "This input changed. Refresh the view and try again",
    );
    expect(shown().get("input").attributes("aria-invalid")).toBe("true");
    expect(shown().get("input").element.value).toBe("new name");
  });

  it("shows HTML in the source and in cell values as text, and does not run it", async () => {
    await render("<img src=x onerror=alert(1)> {{ 'Table 1'!C1 }}");
    await useWorkbookStore().setCell(at("C1"), "<script>alert(2)</script>");
    await flushPromises();
    expect(shown().find("img").exists()).toBe(false);
    expect(shown().find("script").exists()).toBe(false);
    expect(shown().text()).toContain("<img src=x onerror=alert(1)>");
    expect(shown().text()).toContain("<script>alert(2)</script>");
  });

  it("does not make a link out of a javascript: address", async () => {
    await render("[click](javascript:alert(1)) and [fine](https://example.com)");
    expect(
      shown()
        .findAll("a")
        .map((link) => link.attributes("href")),
    ).toEqual(["https://example.com"]);
  });

  it("formats Markdown that a formula made on purpose", async () => {
    await render(`{{ MARKDOWN("**" & 'Table 1'!A1 & "**") }} and {{ "**plain**" }}`);
    expect(
      shown()
        .findAll("strong")
        .map((found) => found.text()),
    ).toEqual(["apples"]);
    expect(shown().text()).toBe("apples and **plain**");
  });

  it("shows formula errors as accessible chips with their message", async () => {
    await render("Before {{ nonexistentvar }} after");
    const chip = shown().get(".md-error");
    expect(chip.text()).toBe("#NAME? Unknown name 'nonexistentvar'");
    expect(chip.attributes("title")).toBe("Unknown name 'nonexistentvar'");
    expect(chip.attributes("aria-label")).toBe("#NAME? Unknown name 'nonexistentvar'");
  });

  it("escapes HTML in an unknown name before inserting the error chip", async () => {
    await render("{{ '<img src=x onerror=alert(1)>' }}");
    const chip = shown().get(".md-error");
    expect(shown().find("img").exists()).toBe(false);
    expect(chip.text()).toBe("#NAME? Unknown name '<img src=x onerror=alert(1)>'");
    expect(chip.attributes("title")).toBe("Unknown name '<img src=x onerror=alert(1)>'");
    expect(chip.get(".md-error__message").element.innerHTML).toContain("&lt;img");
    expect(chip.find("img").exists()).toBe(false);
  });

  it("shows Markdown punctuation in an error message as plain text", async () => {
    const name = "name_*# [label](https://example.com)";
    await render(`{{ '${name}' }}`);
    const chip = shown().get(".md-error");
    expect(chip.text()).toBe(`#NAME? Unknown name '${name}'`);
    expect(chip.find("strong").exists()).toBe(false);
    expect(chip.find("a").exists()).toBe(false);
  });

  it("does not put error markers into Markdown link attributes", async () => {
    await render("[missing]({{ nonexistentvar }})");
    expect(shown().find("a").exists()).toBe(false);
    expect(shown().get(".md-error").text()).toBe("#NAME? Unknown name 'nonexistentvar'");
  });

  it("preserves formatting and label chips when a link destination errors", async () => {
    await render("[**{{ missingLabel }}**]({{ missingHref }})");
    expect(shown().find("a").exists()).toBe(false);
    expect(shown().get("strong").get(".md-error").text()).toBe(
      "#NAME? Unknown name 'missingLabel'",
    );
    expect(
      shown()
        .findAll(".md-error")
        .map((chip) => chip.text()),
    ).toEqual(["#NAME? Unknown name 'missingLabel'", "#NAME? Unknown name 'missingHref'"]);
  });

  it("replaces an image whose URL errors with an error chip", async () => {
    await render("![diagram]({{ Missing!A1 }})");
    expect(shown().find("img").exists()).toBe(false);
    expect(shown().get(".md-error").text()).toContain("#REF!");
  });

  it("does not confuse an encoded marker in the source with an error chip", async () => {
    await render("{{ 1/0 }} ROWZERROR&#48;END");
    expect(shown().findAll(".md-error")).toHaveLength(1);
    expect(shown().text()).toContain("ROWZERROR0END");
    expect(shown().get(".md-error").text()).toBe("#DIV/0! Division by zero");
  });

  it("does not let a cell's text become Markdown", async () => {
    await render("{{ 'Table 1'!C1 }}");
    await useWorkbookStore().setCell(at("C1"), "[x](https://example.com) **bold**");
    await flushPromises();
    expect(shown().find("a").exists()).toBe(false);
    expect(shown().find("strong").exists()).toBe(false);
    expect(shown().text()).toBe("[x](https://example.com) **bold**");
  });

  it("names the line of a tag that is written wrong", async () => {
    await render("fine\n{% for %}");
    expect(shown().get('[role="alert"]').text()).toMatch(/^Line 2: /);
  });

  it("says so when it is empty", async () => {
    await render("   ");
    expect(shown().text()).toBe("This view is empty.");
  });

  it("previews what is typed while editing, and saves on Done", async () => {
    await render("old");
    expect(wrapper.find(".cm-content").exists()).toBe(false);

    await button("Edit").trigger("click");
    const editor = await editorView();
    expect(editor.state.doc.toString()).toBe("old");
    await replaceDraft("new {{ 1 + 1 }}");
    expect(shown().text()).toBe("new 2");
    expect(server.updateView).not.toHaveBeenCalled();

    await button("Done").trigger("click");
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledWith("v1", {
      source: "new {{ 1 + 1 }}",
    });
    expect(wrapper.find(".cm-content").exists()).toBe(false);
    expect(shown().text()).toBe("new 2");
  });

  it("saves and stops editing when the editor loses focus", async () => {
    await render("old");
    await button("Edit").trigger("click");
    const editor = await editorView();
    expect(document.activeElement).toBe(editor.contentDOM);
    await replaceDraft("new");
    editor.contentDOM.blur();
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledExactlyOnceWith("v1", {
      source: "new",
    });
    expect(wrapper.find(".cm-content").exists()).toBe(false);
    expect(button("Edit").exists()).toBe(true);
  });

  it("keeps editing while focus moves to the reference control", async () => {
    await render("{{ 'Table 1'!A1 }}");
    await button("Edit").trigger("click");
    const editor = await editorView();
    const referenceEnd = editor.state.doc.toString().indexOf("A1") + 2;
    editor.dispatch({ selection: { anchor: referenceEnd } });
    await flushPromises();

    const pick = wrapper.get<HTMLButtonElement>(".formula-editor__pick");
    expect(pick.attributes("disabled")).toBeUndefined();
    pick.element.focus();
    await flushPromises();
    expect(wrapper.find(".cm-content").exists()).toBe(true);
    expect(server.updateView).not.toHaveBeenCalled();

    await pick.trigger("click");
    await flushPromises();
    expect(pick.attributes("aria-pressed")).toBe("true");
    expect(wrapper.find(".cm-content").exists()).toBe(true);
    expect(server.updateView).not.toHaveBeenCalled();
  });

  it("keeps editing when reference picking is unavailable", async () => {
    await render("plain text");
    await button("Edit").trigger("click");
    await editorView();
    const pick = wrapper.get<HTMLButtonElement>(".formula-editor__pick");
    expect(pick.attributes("aria-disabled")).toBe("true");
    expect(pick.element.disabled).toBe(false);

    const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    pick.element.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);
    await pick.trigger("click");
    await flushPromises();

    expect(pick.attributes("aria-pressed")).toBe("false");
    expect(wrapper.find(".cm-content").exists()).toBe(true);
    expect(server.updateView).not.toHaveBeenCalled();
  });

  it.each(["cm-tooltip", "context-menu"])(
    "keeps editing while focus moves into its %s popup",
    async (popupClass) => {
      await render("old");
      await button("Edit").trigger("click");
      const editor = await editorView();
      await replaceDraft("new");

      const popup = document.createElement("div");
      popup.className = popupClass;
      const control = document.createElement("button");
      popup.append(control);
      document.body.append(popup);
      const outside = document.createElement("button");
      document.body.append(outside);
      try {
        control.focus();
        await flushPromises();
        expect(wrapper.find(".cm-content").exists()).toBe(true);
        expect(server.updateView).not.toHaveBeenCalled();

        editor.focus();
        outside.focus();
        await flushPromises();
        expect(server.updateView).toHaveBeenCalledExactlyOnceWith("v1", {
          source: "new",
        });
        expect(wrapper.find(".cm-content").exists()).toBe(false);
      } finally {
        popup.remove();
        outside.remove();
      }
    },
  );

  it("goes on editing when it is the window that loses focus", async () => {
    await render("old");
    await button("Edit").trigger("click");
    await replaceDraft("new");
    // The browser sends a blur and leaves the editor as the document's active element.
    (await editorView()).contentDOM.dispatchEvent(new FocusEvent("blur"));
    await flushPromises();
    expect(server.updateView).not.toHaveBeenCalled();
    expect(wrapper.find(".cm-content").exists()).toBe(true);
  });

  it("starts editing on a double click of the text", async () => {
    await render("old");
    await shown().trigger("dblclick");
    const editor = await editorView();
    expect(editor.state.doc.toString()).toBe("old");
    expect(document.activeElement).toBe(editor.contentDOM);
    expect(button("Done").exists()).toBe(true);
  });

  it("does not save when nothing changed", async () => {
    await render("same");
    await button("Edit").trigger("click");
    await button("Done").trigger("click");
    expect(server.updateView).not.toHaveBeenCalled();
  });

  it("deletes the view after confirming", async () => {
    await render("text");
    await button("Delete text").trigger("click");
    expect(appDialog()?.textContent).toContain("Delete Text 1?");
    await respondToDialog("cancel");
    expect(server.deleteView).not.toHaveBeenCalled();

    await button("Delete text").trigger("click");
    await respondToDialog("confirm");
    expect(server.deleteView).toHaveBeenCalledWith("v1");
  });

  it("shows a viewer the text without the means to change it", async () => {
    await render("hello", "viewer");
    expect(shown().text()).toBe("hello");
    expect(
      wrapper.findAll("button").map((candidate) => candidate.attributes("aria-label")),
    ).toEqual(["Collapse Text 1", "Block actions for Text 1"]);
    await shown().trigger("dblclick");
    expect(wrapper.find(".cm-content").exists()).toBe(false);
  });
});

it("Cancel restores the saved preview and Escape retains a multiline draft", async () => {
  await render("saved {{ 1 }}");
  await button("Edit").trigger("click");
  await replaceDraft("draft {{ 2 }}");
  expect(shown().text()).toBe("draft 2");
  await wrapper.get(".cm-content").trigger("keydown", { key: "Escape" });
  expect(wrapper.find(".cm-content").exists()).toBe(true);
  await button("Cancel").trigger("click");
  await flushPromises();
  expect(shown().text()).toBe("saved 1");
  expect(server.updateView).not.toHaveBeenCalled();
});
