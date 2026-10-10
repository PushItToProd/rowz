<template>
  <div>
    <section id="actions">
      <h2>Buttons and actions</h2>
      <p>
        An <em>action</em> is a function that changes something: <code>EXECUTE</code> writes to a
        cell, and <code>SEND_EMAIL</code> sends a message. An action does nothing by being in a
        cell. It runs when it is inside <code>BUTTON</code> and someone clicks the button in a cell
        or text view.
      </p>
      <pre><code>=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))
=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3))
=BUTTON("Reset", CLEAR(A1:A3), "Clear these cells?")</code></pre>
      <p>
        The first shows a button that writes the sum of A1 and A2 into A3. The second shows a button
        that sends an email to the address in A1, with the subject in A2 and the body in A3.
      </p>
      <ul>
        <li>
          An action reads its cells at the moment of the click, not when the sheet recalculates. A
          button can therefore read and write the same cell:
          <code>=BUTTON("Add one", EXECUTE(A1 + 1, A1))</code> is a counter.
        </li>
        <li>
          The optional third argument to <code>BUTTON</code> asks for confirmation before the click
          is sent. Give it a message, or use <code>TRUE</code> for “Run this button?”. This guards
          against accidental clicks; the server still derives the action from the stored formula.
        </li>
        <li>
          <code>EXECUTE</code> writes to one cell. The target can be in another table or on another
          page, written like any other reference.
        </li>
        <li>
          <code>APPEND_ROW</code> appends after the last stored row of a data table when the range
          has no fixed bottom. In a plain grid it writes below the last row with content.
          <code>CLEAR</code> empties cells. <code>DO</code> runs several actions from one click, so
          a button can save a form and then reset it:
          <code>=BUTTON("Save", DO(APPEND_ROW(Log!A:B, A1, A2), CLEAR(A1:A2)))</code>.
        </li>
        <li>
          Three actions move many rows at once. <code>INSERT(data, range)</code> adds every row of
          each data row below the range's existing content.
          <code>UPDATE(data, key_columns, range)</code> writes each row over the row with the same
          key and adds the rows with new keys, so running it twice does not add anything twice. In a
          data table, open-ended INSERT and UPDATE destinations append after the last stored row.
          <code>OVERWRITE(data, range)</code>
          empties the range first and deletes surplus rows of a data table when the range covers
          every writable column. The data can be a range or a formula:
          <code>=BUTTON("Archive", INSERT(FILTER(A2:C99, C2:C99 = "done"), Archive!A:C))</code>.
        </li>
        <li>
          When an action cannot run, a message says why and nothing is changed. Examples are a
          recipient that is not an email address, and a target cell outside its table.
        </li>
        <li>
          <code>TODAY()</code> and <code>NOW()</code> inside an action give the time of the click on
          your clock, so <code>=BUTTON("Log", APPEND_ROW(Log!A:B, NOW(), A1))</code> stamps each
          row.
        </li>
        <li>
          When <code>SMTP_URL</code> is set, the server sends email through that mail server.
          Without it, the server records each message in its log and sends nothing. The server
          limits how many emails one person's clicks can send in an hour.
        </li>
        <li>Someone who can only view a document cannot run its buttons or change its controls.</li>
        <li>
          An action typed without <code>BUTTON</code> around it shows its name in gray and never
          runs.
        </li>
        <li>
          To change a button's formula, select its cell and press Enter, or use the formula bar.
        </li>
      </ul>
    </section>

    <section id="controls">
      <h2>Input controls</h2>
      <p>
        A control is a cell that shows an input bound to another cell. It shows that cell's value,
        and committing a change with Enter or by leaving the input writes the new value there.
      </p>
      <ul>
        <li>
          <code>=CHECKBOX(B1, "Paid")</code> is ticked when B1 holds TRUE. Ticking or clearing it
          writes TRUE or FALSE to B1.
        </li>
        <li>
          <code>=DROPDOWN(D1:D5, B2)</code> offers the values of D1 to D5 and writes the choice to
          B2. The choices can also be written out: <code>=DROPDOWN("low, medium, high", B2)</code>.
        </li>
        <li>
          <code>=TEXTBOX(B1, "Name")</code> shows B1 in a text input and stores committed text as
          text. <code>=NUMBERBOX(C1, "Count")</code> accepts a number and clears C1 when left empty.
        </li>
        <li>
          Formulas read the bound cell, not the control: <code>=IF(B1, "thanks", "waiting")</code>.
        </li>
        <li>
          A control must target a stored cell without a formula. It cannot target a formula column
          or a cell filled by an array formula.
        </li>
      </ul>
    </section>
  </div>
</template>
