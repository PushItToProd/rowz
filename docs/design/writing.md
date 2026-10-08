# Writing for the interface

How labels, messages, errors, and help text read. This covers every string a person sees, including the engine's error messages and the function help in `packages/engine/src/docs.ts`.

## Plain and direct

Write what a person would say to a colleague looking at the same screen.

- Use the ordinary name for a thing. "Right-click a column to set its type", not "to choose what it holds".
- Do not explain what the screen already makes obvious. A table needs no "Select a cell to insert or delete its row or column."
- No marketing voice, no apology, no exclamation.

| Instead of                                                                                                | Write                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Edit the selected cell, keeping what it holds.                                                            | Edit the selected cell's current contents.                                                                             |
| Put the document back as it was on {date}? What it holds now is kept as a version, so this can be undone. | Restore the version from {date}? The current document is saved as a version first, so you can restore it from History. |
| column of this row                                                                                        | this row's value                                                                                                       |

## Vocabulary

| Word     | Meaning                                        | Not                   |
| -------- | ---------------------------------------------- | --------------------- |
| document | What a person opens, names, and shares         | spreadsheet, workbook |
| page     | A tab within a document                        | sheet                 |
| block    | A table, chart, text view, or script on a page | card, component       |
| range    | A rectangle of cells                           | block                 |

Code may use other names, such as `Card` in component names. The interface and the help page use these.

## Error messages

An error message says what failed, why, what that means for the person's work, and what to do. It leaves out any of these only when the screen already shows it.

> Your file could not be saved because the request timed out. Check your network connection and try again.
>
> `TypeError: NetworkError when attempting to fetch resource.`

### Say that an attempt failed, and join it to its cause

Write "could not be saved", not "was not saved". "Could not" says the app tried and something stopped it. "Was not" reports a state and leaves open whether anything was tried, whether it was meant to happen, and whether it is a problem.

Put the failure and its cause in one sentence with a word that states the relation: "because", "due to". Two facts placed side by side leave the reader to work out how they relate.

| Instead of                                            | Write                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| The file was not saved.                               | The file could not be saved.                                |
| Network error during saving. Your file was not saved. | Your file could not be saved because the request timed out. |

### Every sentence carries the same message

A person reading an error may be skimming, tired, or overwhelmed, and may take in one sentence of it. Each sentence should point the same way as the whole, so that a reader who catches only one still understands what happened. As a check, delete each sentence in turn: what remains may say less, and must not say something different or leave the reader unsure whether anything is wrong.

Leave out a sentence that adds nothing to what failed, why, what it means, or what to do.

### Name the actual error, and show the underlying one

- **Name the specific failure.** "The request timed out" or "The server answered 500", not "Network error".
- **Show the underlying error word for word** when the failure came from outside rowz's own vocabulary: the browser, the network, the server, a parser. Put it below the summary, after a paragraph break, in a monospace font, where it can be selected and copied. The summary is still required. The underlying error supports it and does not replace it.
- **Use the actual names and numbers.** "The result needs 12 rows and 26 columns, but the table is only 11 rows and 15 columns", not "The result does not fit".
- **Do not invent a cause.** When the cause is unknown, say what failed, show the underlying error, and say what to try.
- **Do not name a cause the person did not create.** When a result cannot spill because the table is too small, do not name a target cell.

A formula error such as `#VALUE!` with its explanation is already the actual error and needs no second line.

### Say what to do, and make it easy

- **Say how to fix it when the fix is known.** A table name with a space, written without quotes, gets a message that says the name needs single quotes, not "Expected )".
- **List the alternatives when the problem is a choice.** "Total has more than one meaning: February!Total, March!Total. Use one of these qualified names."
- **Offer the fix as an action when the app can perform it.** A spill error caused by table size has a "Resize to fit" button.
- **Link to where the error arose.** See "Errors are always visible, and an error leads to its origin" in [README.md](README.md).

### Keep it short

Use as few sentences as answer the questions above. No "please" and no "sorry": they add length, and "please" makes a required step read as optional.

## Sentences

- **Lead with what matters.** "Select **Filters** to add effects to your image", not "If you want to add effects to your image, select **Filters**".
- **Use the active voice for what the person does.** "Restart the app to see your changes", not "The changes will be applied when the app is restarted".
- **An error summary has the thing that failed as its subject.** "The file could not be saved because the request timed out." rowz does not speak as "we", so nothing else can be the subject, and the passive is correct there.
- **Address the person as "you" when telling them what to do.** A summary of what failed, a label, and function help need no "you".
- **Sentence case everywhere**: capitalize the first word and proper nouns only. "Add chart", not "Add Chart".
- **A full sentence ends with a period.** A button, label, menu item, or heading does not.

## Buttons, menu items, and dialogs

- Name the action and its object: "Delete rows 3-6", "Add chart".
- A button is one or two words where the object is clear from its surroundings: "Resize to fit" in a table's error popover, not "Resize table to fit". A third word is acceptable when two would be unclear.
- A dialog's title says what is being asked in a few words and does not explain the remedy. Its buttons answer the title: a confirmation's button repeats the action ("Delete table"), not "OK" or "Yes".
- A dialog that asks for a decision offers a way out.

## Sources

The rules under "Plain and direct" and the examples come from the author's corrections. The rules on sentences, dialog titles and buttons, invented causes, and politeness are taken from the Atlassian Design System's error-message guidance and Microsoft's writing style guidance for Windows apps, where they agree with the author's corrections.

Two points in those guides are not adopted. Microsoft asks for a warm, casual voice and for "we" as the app's voice ("We couldn't save your file"). rowz states what failed without a speaker: "The file could not be saved because the request timed out."
