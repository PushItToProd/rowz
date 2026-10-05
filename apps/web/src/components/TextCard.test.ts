import { EditorView } from "@codemirror/view";
import { wireSnapshot, changeWith } from "../testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, clickResult, identifiedAt, snapshotWith, type MockedApi } from "../testing";
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

const confirm = vi.spyOn(window, "confirm");

async function render(source: string, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue(
    wireSnapshot({
      ...snapshotWith(CELLS, role),
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
  confirm.mockReturnValue(true);
  server.updateView.mockImplementation((_id, changes) =>
    Promise.resolve(changeWith({ ...TEXT, ...changes })),
  );
});
afterEach(() => {
  wrapper.unmount();
});

describe("TextCard", () => {
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
    expect(shown().findAll(".chart__slice")).toHaveLength(2);
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
    confirm.mockReturnValue(false);
    await button("Delete text").trigger("click");
    expect(server.deleteView).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await button("Delete text").trigger("click");
    expect(server.deleteView).toHaveBeenCalledWith("v1");
  });

  it("shows a viewer the text without the means to change it", async () => {
    await render("hello", "viewer");
    expect(shown().text()).toBe("hello");
    expect(wrapper.find("button").exists()).toBe(false);
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
