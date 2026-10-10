<script setup lang="ts">
import { LIMITS } from "@spreadsheet-app/shared";
import { errorDocs } from "@spreadsheet-app/engine";
</script>

<template>
  <div>
    <section id="sharing">
      <h2>Sharing</h2>
      <p>
        <strong>Share</strong>, at the top of a document, gives it to another person who has an
        account here. Type their email address and choose what they can do.
      </p>
      <ul>
        <li>
          Someone who <strong>can edit</strong> can change everything in the document and run its
          buttons. Someone who <strong>can view</strong> can read it and open copies from its
          history.
        </li>
        <li>
          Only the owner can share the document, change what someone can do, stop sharing, or delete
          it. A person it is shared with can leave it.
        </li>
        <li>
          A shared document shows in the other person's list, marked as shared with them. Everyone
          who has it open sees changes within a second. When two people change the same cell, the
          later change stays.
        </li>
        <li>The person must sign up before the document can be shared with them.</li>
      </ul>
    </section>

    <section id="history">
      <h2>History</h2>
      <p>
        The app keeps versions of a document as it changes. <strong>History</strong>, at the top of
        a document, lists them.
      </p>
      <ul>
        <li>
          A version is kept before anything is deleted: a row, a column, a table, a chart, a text
          view, or a page. One is also kept before a paste or an import that changes many cells, and
          every ten minutes while the document is being changed.
        </li>
        <li>
          <strong>Restore</strong> puts the whole document back as the version has it. The current
          document is saved as a version first, so you can undo the restore.
        </li>
        <li>
          <strong>Open a copy</strong> makes a new document from the version and leaves this one
          alone. Use it to look at an old version, or to take one table from it.
        </li>
        <li>The newest {{ LIMITS.versions }} versions are kept.</li>
        <li>
          Ctrl+Z and Ctrl+Y undo and redo changes made since this page was opened, including cell
          edits, formatting, and structural changes. A later edit can make an undo unsafe; when that
          happens, the app explains why and moves to the next change. Use History to restore an
          older version of the whole document.
        </li>
        <li>
          A change is sent to the server as soon as it is made. The top of the editor says
          <q>Saving…</q> until the server has it, and the browser asks before closing or reloading
          the page while it does.
        </li>
      </ul>
    </section>

    <section id="files">
      <h2>Files</h2>
      <ul>
        <li>
          <strong>Export</strong>, at the top of a document, saves the whole document as a file: its
          pages, the blocks on them, and everything typed into cells, formulas included.
          <strong>Import</strong>, on the list of documents, makes a new document from such a file.
          <strong>New from template</strong> creates an editable copy of an invoice, contacts list,
          to-do list, or inventory example from the same document list. Use
          <strong>Browse samples and templates</strong> to choose one of those templates or a sample
          document. The gallery makes a copy in your account and opens it; repeated copies get a
          numbered name.
        </li>
        <li>
          On the Documents page, click a document's name to open it. Its <strong>⋯</strong> menu
          renames or deletes a document you own, and duplicates any document you can read. A
          duplicate is created in your workspace, and the list stays open. Deleting a document asks
          for confirmation and cannot be undone. The separate <strong>Move</strong> menu files a
          document into one of your folders.
        </li>
        <li>
          <strong>Export CSV</strong> in a table's block menu saves the values its cells show as a
          CSV file that other spreadsheet apps can open. The file does not contain formulas.
        </li>
        <li>
          <strong>Import CSV</strong> in a table's block menu replaces its contents, starting at A1.
          The table grows to fit, up to {{ LIMITS.tableRows }} rows and
          {{ LIMITS.tableCols }} columns. A cell in the file that starts with <code>=</code> becomes
          a formula. Files with semicolons or tabs between cells are read too.
        </li>
        <li>
          <strong>Append CSV rows</strong> in a table's block menu adds rows after the last row of a
          data table or the last used row of a plain table. In a data table, the first row is a
          header; names match without regard to case, unmatched CSV columns are ignored, and table
          columns missing from the file stay blank. In a plain table, every row is appended,
          including the first, and columns match by position. Appending is one undoable change.
        </li>
      </ul>
    </section>

    <section id="errors">
      <h2>Errors</h2>
      <p>
        A cell that cannot be computed shows one of these. Hover over the cell to read the specific
        reason. A formula that reads a cell holding an error shows the same error, unless
        <code>IFERROR</code> catches it.
      </p>
      <p>
        Error details in the document errors list can be selected and copied. Copy copies one error,
        and Copy all copies the list with a blank line between errors. Go to error opens the cell,
        chart, or text view that shows the error. When an error is raised inside a script function,
        the list also identifies the function and shows how the formula reached it; Open definition
        opens the script at the function definition.
      </p>
      <table>
        <tbody>
          <tr v-for="(explanation, code) in errorDocs" :key="code" :data-error="code">
            <th scope="row">
              <code>{{ code }}</code>
            </th>
            <td>{{ explanation }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
