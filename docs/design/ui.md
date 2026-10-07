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
- An action in a thing's menu is not repeated as a button beside it. A block's header holds its name and the ellipsis, not a row of buttons for what the menu already lists. A control that switches a mode the person moves in and out of, such as a text view's Edit and Done, stays as a button. Nine actions shown as buttons, in the ellipsis menu, and in the right-click menu make three copies to scan past.
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

Keep an explicit control for the same action, so that a gesture is never the only way. The control may be a menu item. A text view opens for editing on double-click and also has Edit and Done buttons.

A name that can be renamed in place, such as a block's or a document's, opens for editing on one click. A script or text block opens on double-click, because one click there would replace rendered text with its source on a click that may only be meant to select or scroll.

Make the target of a frequent action large. The strip along the bottom and right edge of a table adds a row or column from a click anywhere on it.

## Editing in place

- **An editor includes its controls.** Focus-change saving applies when the person leaves the editor as a whole: the text, its buttons, and any popover it opened. Using one of the editor's own controls, such as "Pick reference", is not leaving, and does not save or close the editor.
- **A thing keeps its place and size when it switches between showing and editing.** The editor occupies the box the content occupied and grows only as the content grows. A block that changes size when editing starts or ends moves everything below it.
- **The editing state is finished work.** It has the same spacing, borders, and button sizes as the rest of the block. This goes for every state a component has: empty, loading, error, and editing.

## A small action gets a small response

A click that only selects, places focus, or leaves a field does not rearrange the page. What is under the pointer stays under the pointer, so the next click lands where the person aimed it.

A large change to what is on screen follows from an action that asks for one: going to a page, opening a panel, starting to edit, adding or deleting something.

## Saving and discarding

- Enter, Tab, and moving focus save. A field does not need a Done button to keep its contents.
- Escape discards a single-line edit. A multiline editor has a Cancel button, and Escape does not discard there.
- Escape closes any menu, popover, dialog, or panel.

[DECISIONS.md](../../DECISIONS.md) has the cases specific to formula editing.

## Confirmation

A confirmation protects against a mistake that is expensive to discover late. Undo is linear, so getting back something deleted by mistake means undoing every edit made since. The longer the mistake goes unnoticed, the more it costs.

Confirm an action when either is true:

- Undo cannot reverse it.
- It removes a whole container, such as a page, a block, or a document, whose loss the person may not notice at once. A deleted page replaces the whole screen, which reads as navigation, and the only lasting sign is one missing tab.

Do not confirm a small edit that happens in view and that undo reverses, such as deleting a row or a column. The prompt would interrupt every use to prevent a mistake the person sees at once and the app can put right.

### Confirm where the click was

A confirmation should not send the pointer across the screen. When a delete is chosen from a menu, the second step happens in or beside the menu: the item changes to ask for confirmation, or a small confirmation opens next to it. A second click on the same spot counts only after a short delay, so an accidental double click does not confirm. The delay is short enough not to slow a deliberate one.

Use a dialog when the confirmation has to explain what will be lost, as shrinking a table over filled cells or replacing a table's contents on import does. The dialog says what will be lost.

### After a delete

A delete that is not confirmed shows a notice with an Undo action, so the change is noticed and can be reversed from where the person is.

## Destructive controls look destructive

A control that deletes shows a trash can icon or the danger color. A delete item in a menu is in the danger color. A plain "×" means close or dismiss, which destroys nothing, and is used only for that.

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
- A block's header repeats its menu's actions as a row of buttons.
- A text view's editor closes when one of its own buttons takes focus, and the block changes size between showing and editing.
- A delete chosen from a menu is confirmed in a dialog in the middle of the screen, and a delete item is not in the danger color.
- Deleting a page is not confirmed.
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
