# Interface rules

How controls in the web app behave and look. [README.md](README.md) holds the principles these follow from.

## Reuse the shared component

Each job below has one component. Use it, and extend it when it falls short. A second implementation of the same job behaves slightly differently, and the difference is what people notice.

| Job                                   | Use                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------ |
| A menu of actions on a thing          | `ContextMenu.vue`, with items described in `components/menu.ts`          |
| Confirm, ask for one value, or tell   | `useDialog()` in `useDialog.ts`, drawn by `DialogHost.vue`               |
| A passing message                     | `NoticeMessage.vue`                                                      |
| Details anchored to a cell or chip    | The popover in `CellError.vue`                                           |
| Any place a formula is typed          | `FormulaEditor.vue` and the session components built on it               |
| A name edited in place                | `EditableName.vue`                                                       |
| A list that opens beside the document | A side panel such as `ErrorsPanel.vue`. One side panel is open at a time |

## No interface drawn by the browser

Do not use `alert`, `confirm`, or `prompt`, the `title` attribute, a `<select>` element, or the browser's validation bubbles. They look and behave differently in each browser, cannot be styled or tested like the rest of the app, and a `title` tooltip appears late and in a place the app does not choose.

- For a choice from a list, use an in-app dropdown. Existing `<select>` elements remain until the shared dropdown replaces them. Add no new ones.
- For a hint on a control, use visible text or an in-app tooltip. Keep `aria-label` as the accessible name.
- For a field that fails validation, show the message beside the field.

The file chooser and the browser's own prompt when a tab closes with unsaved work are the exceptions. The browser controls both.

[native-browser-ui-audit.md](../native-browser-ui-audit.md) lists what remains to replace.

## Menus

Anything a person can act on has a menu of its actions that opens on right-click: a cell, a selection, a row or column header, a page tab, a block.

- The same menu also opens from a visible button, such as the vertical ellipsis on a block. Right-click alone is not discoverable.
- An item says what it will do to the current selection. With columns C to E selected, the items read "Insert 3 columns left" and "Delete columns C-E".
- Leave out an item that cannot apply to what was clicked. A column header's menu has no "Insert row".
- A right-click on a control opens the menu of the component the control is directly part of. A page tab's move and delete buttons open the tab's menu, and a block's header buttons open the block's menu. The browser's own menu does not appear over a part of the app that has a menu.
- A child component with a menu of its own takes precedence inside its area: within a block, a grid cell opens the cell menu. A text field or editor keeps the browser's menu, which has copy, paste, and spelling.
- A menu holds the actions of one thing. It does not also list the actions of the things that contain it, which would make every menu long. The containing things' menus are reached from tabs along the top of the menu: a right-click on a cell shows tabs such as Cell, Row, Column, Table, and Page, and choosing one shows that thing's menu.
- A menu, popover, or dialog draws above everything else on the page and stays inside the window. Nothing on the page covers part of it.

## Show controls unless there is a reason to hide them

Do not hide a control to make the page look cleaner. A person cannot use what they cannot see.

A control may appear only in context when showing it everywhere is impractical. A toolbar for the selected cell or block is the example: an ellipsis on every cell would be worse. When unsure, show it.

## Direct manipulation, with a button beside it

Acting on the thing itself is the first way to do something: drag a header border to resize, drag across headers to select, drag to reorder, double-click text to edit it.

Keep an explicit control for the same action. A text view opens for editing on double-click and also has Edit and Done buttons.

A name that can be renamed in place, such as a block's or a document's, opens for editing on one click.

Make the target of a frequent action large. The strip along the bottom and right edge of a table adds a row or column from a click anywhere on it.

## Saving and discarding

- Enter, Tab, and moving focus save. A field does not need a Done button to keep its contents.
- Escape discards a single-line edit. A multiline editor has a Cancel button, and Escape does not discard there.
- Escape closes any menu, popover, dialog, or panel.

[DECISIONS.md](../../DECISIONS.md) has the cases specific to formula editing.

## Confirmation

Ask for confirmation only for what undo cannot reverse, or when an action will destroy data the person may not expect it to, such as shrinking a table over filled cells. The prompt says what will be lost.

Do not confirm an action that undo reverses. The prompt interrupts every use to prevent a mistake the app can already put right.

## Destructive controls look destructive

A control that deletes shows a trash can icon or the danger color. A plain "×" means close or dismiss, which destroys nothing, and is used only for that.

Undo does not make the distinction unnecessary. A person who takes a delete for a close may keep working before noticing, and must then undo that work to get the deleted thing back.

## Say what an edit will affect

When an edit reaches further than the place it is typed, say so before it applies. The formula-column editor is labeled "Editing formula for every row in Sales[Amount]".

Before a change that will turn cells into errors or discard values, say how many.

## Messages and state

- A passing message closes without being dismissed, and closes on Escape.
- Recent messages stay available in a history after they close, so one that vanished can be read again.
- State that lasts is shown for as long as it lasts: saving, unsaved, errors present.

## Scrolling and focus

Do not scroll the page or move focus as a side effect. Leaving a script editor does not bring a selected cell into view.

Do scroll to, and focus, a thing the person just made or asked to be taken to: a new block, the location of an error.

After removing the thing that had focus, move focus to its neighbor.

## Keyboard

Everything can be done without a mouse. A feature gets there through shared means, not through a shortcut of its own:

- The command palette lists every action. An action with no parameters runs from it directly.
- An action that needs parameters opens a form in a dialog: Tab moves between fields, Enter submits, Escape cancels.
- A dedicated shortcut is for an action that Excel and Sheets also give one. Use theirs.

In the grid, keys do what they do in Sheets. Where rowz has a table feature that comes from Excel, such as structured references, Excel's keys apply.

Four cases need more than the palette and a form:

- **A context menu opens from the keyboard.** Shift+F10 or the Menu key opens the menu for whatever has focus, as the grid, page tabs, and blocks do. Every menu item is then reachable without a shortcut of its own.
- **A spatial action has a command.** What a drag does, a command also does: resize takes a number in a form, and reorder is "Move up" and "Move down".
- **Focus can move between regions.** Tab is taken inside the grid, so a separate key moves focus between the grid, a block's header, the next block, and an open side panel.
- **A control inside a popover is reachable.** A popover or menu that holds a link or button can be entered and operated from the keyboard, not only opened.

## Rules the app does not meet yet

New work follows these rules. The existing app falls short of them in the places below, and [todo.md](../../todo.md) tracks each.

- There is no command palette, and no general form dialog for an action's parameters.
- No key moves focus between regions of the page.
- The link in a cell's error popover cannot be reached with Tab.
- A context menu has no tabs for the menus of the containing things.
- Closed messages are not kept in a history.
- A notice holds one line of text and has no place for an underlying error, which [writing.md](writing.md) asks for.
- `EditableName.vue` opens on double-click.
- Native `<select>` elements and `title` attributes remain, as the audit lists.

## Look

Compact. The models are Excel and Sheets for the grid, and Jupyter and Grafana for the page of blocks. Prefer showing more of the document to adding whitespace.

- Colors, the corner radius, and the base font size are the custom properties at the top of `styles/base.css`. Use them; do not write a new color value in a component.
- A new panel or popover matches the existing ones in heading size, button size, and spacing between buttons.
- Show a color as a swatch of the color, not only as its name.
- An editor placed over a cell covers the cell.
