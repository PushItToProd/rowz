import type { SpreadsheetFile } from "@spreadsheet-app/shared";

export interface DocumentTemplate {
  name: string;
  description: string;
  document: SpreadsheetFile;
}

const invoice: SpreadsheetFile = {
  format: "spreadsheet-app",
  version: 1,
  name: "Invoice",
  pages: [
    {
      name: "Invoice",
      blocks: [
        {
          type: "table",
          name: "Invoice",
          rowCount: 5,
          colCount: 2,
          formats: [
            { startRow: 0, endRow: null, startCol: 0, endCol: 0, format: { bold: true } },
            {
              startRow: 1,
              endRow: 2,
              startCol: 1,
              endCol: 1,
              format: { numberFormat: "mmm d, yyyy" },
            },
            {
              startRow: 4,
              endRow: 4,
              startCol: 1,
              endCol: 1,
              format: { numberFormat: "0.0%" },
            },
          ],
          cells: [
            { row: 0, col: 0, input: "Invoice number" },
            { row: 0, col: 1, input: "INV-2026-041" },
            { row: 1, col: 0, input: "Issued" },
            { row: 1, col: 1, input: "2026-10-01" },
            { row: 2, col: 0, input: "Due" },
            { row: 2, col: 1, input: "2026-10-31" },
            { row: 3, col: 0, input: "Bill to" },
            { row: 3, col: 1, input: "Northstar Design Co." },
            { row: 4, col: 0, input: "Tax rate" },
            { row: 4, col: 1, input: "0.0825" },
          ],
        },
        {
          type: "table",
          name: "Line items",
          rowCount: 3,
          colCount: 4,
          columns: [
            { name: "Description", type: "text" },
            { name: "Quantity", type: "number" },
            { name: "Unit price", type: "number" },
            { name: "Line total", type: "formula", formula: "=[Quantity] * [Unit price]" },
          ],
          formats: [
            {
              startRow: 0,
              endRow: null,
              startCol: 2,
              endCol: 3,
              format: { numberFormat: "$#,##0.00", align: "right" },
            },
          ],
          cells: [
            { row: 0, col: 0, input: "Design review" },
            { row: 0, col: 1, input: "3" },
            { row: 0, col: 2, input: "125" },
            { row: 1, col: 0, input: "Implementation" },
            { row: 1, col: 1, input: "8" },
            { row: 1, col: 2, input: "140" },
            { row: 2, col: 0, input: "Training" },
            { row: 2, col: 1, input: "2" },
            { row: 2, col: 2, input: "95" },
          ],
        },
        {
          type: "table",
          name: "Totals",
          rowCount: 4,
          colCount: 2,
          formats: [
            { startRow: 0, endRow: null, startCol: 0, endCol: 0, format: { bold: true } },
            {
              startRow: 0,
              endRow: 0,
              startCol: 1,
              endCol: 1,
              format: { numberFormat: "$#,##0.00" },
            },
            {
              startRow: 1,
              endRow: 1,
              startCol: 1,
              endCol: 1,
              format: { numberFormat: "0.0%" },
            },
            {
              startRow: 2,
              endRow: 3,
              startCol: 1,
              endCol: 1,
              format: { numberFormat: "$#,##0.00" },
            },
            {
              startRow: 3,
              endRow: 3,
              startCol: 0,
              endCol: 1,
              format: { bold: true },
            },
          ],
          cells: [
            { row: 0, col: 0, input: "Subtotal" },
            { row: 0, col: 1, input: "=SUM('Line items'[Line total])" },
            { row: 1, col: 0, input: "Tax rate" },
            { row: 1, col: 1, input: "=Invoice!B5" },
            { row: 2, col: 0, input: "Tax" },
            { row: 2, col: 1, input: "=B1*B2" },
            { row: 3, col: 0, input: "Total due" },
            { row: 3, col: 1, input: "=B1+B3" },
          ],
        },
        {
          type: "text",
          name: "Invoice summary",
          source:
            '# Invoice {{ Invoice!B1 }}\n\n**Bill to:** {{ Invoice!B4 }}\n\nIssued {{ TEXT(Invoice!B2, "mmm d, yyyy") }} · due {{ TEXT(Invoice!B3, "mmm d, yyyy") }}.\n\n| | Amount |\n|---|---:|\n| Subtotal | {{ TEXT(Totals!B1, "$#,##0.00") }} |\n| Tax ({{ TEXT(Totals!B2, "0.0%") }}) | {{ TEXT(Totals!B3, "$#,##0.00") }} |\n| **Total due** | **{{ TEXT(Totals!B4, "$#,##0.00") }}** |\n',
        },
      ],
    },
  ],
};

const contacts: SpreadsheetFile = {
  format: "spreadsheet-app",
  version: 1,
  name: "Contacts list",
  pages: [
    {
      name: "Contacts",
      blocks: [
        {
          type: "text",
          name: "Contact overview",
          source:
            '# Contacts\n\n**{{ COUNTA(Contacts[Contact]) }} contacts** across the listed categories. Change a contact\'s status to Archived to remove it from the table view; category counts include all records.\n\n{{ QUERY(Contacts, "select Category, count(Contact) group by Category order by Category") }}\n',
        },
        {
          type: "table",
          name: "Contacts",
          rowCount: 5,
          colCount: 6,
          columns: [
            { name: "Contact", type: "text" },
            { name: "Company", type: "text" },
            { name: "Email", type: "text" },
            {
              name: "Category",
              type: "choice",
              choices: ["Customer", "Vendor", "Partner"],
            },
            {
              name: "Status",
              type: "choice",
              choices: ["New", "Active", "Follow-up", "Archived"],
            },
            { name: "Last contact", type: "date" },
          ],
          display: {
            sort: [{ column: 0, descending: false }],
            filter: '=[Status] <> "Archived"',
          },
          formats: [
            {
              startRow: 0,
              endRow: null,
              startCol: 5,
              endCol: 5,
              format: { numberFormat: "mmm d, yyyy" },
            },
          ],
          cells: [
            { row: 0, col: 0, input: "Avery Chen" },
            { row: 0, col: 1, input: "Northstar Design Co." },
            { row: 0, col: 2, input: "avery@example.com" },
            { row: 0, col: 3, input: "Customer" },
            { row: 0, col: 4, input: "Active" },
            { row: 0, col: 5, input: "2026-10-02" },
            { row: 1, col: 0, input: "Morgan Patel" },
            { row: 1, col: 1, input: "Brightline Paper" },
            { row: 1, col: 2, input: "morgan@example.com" },
            { row: 1, col: 3, input: "Vendor" },
            { row: 1, col: 4, input: "Follow-up" },
            { row: 1, col: 5, input: "2026-09-28" },
            { row: 2, col: 0, input: "Riley Brooks" },
            { row: 2, col: 1, input: "Fieldstone Studio" },
            { row: 2, col: 2, input: "riley@example.com" },
            { row: 2, col: 3, input: "Partner" },
            { row: 2, col: 4, input: "Active" },
            { row: 2, col: 5, input: "2026-09-30" },
            { row: 3, col: 0, input: "Jordan Lee" },
            { row: 3, col: 1, input: "Juniper Cafe" },
            { row: 3, col: 2, input: "jordan@example.com" },
            { row: 3, col: 3, input: "Customer" },
            { row: 3, col: 4, input: "New" },
            { row: 3, col: 5, input: "2026-10-04" },
            { row: 4, col: 0, input: "Taylor Kim" },
            { row: 4, col: 1, input: "Old Mill Supply" },
            { row: 4, col: 2, input: "taylor@example.com" },
            { row: 4, col: 3, input: "Vendor" },
            { row: 4, col: 4, input: "Archived" },
            { row: 4, col: 5, input: "2026-08-12" },
          ],
        },
      ],
    },
  ],
};

const todo: SpreadsheetFile = {
  format: "spreadsheet-app",
  version: 1,
  name: "To-do list",
  pages: [
    {
      name: "Tasks",
      blocks: [
        {
          type: "text",
          name: "Task overview",
          source:
            '# Task overview\n\n**{{ COUNTIF(Tasks[Status], "Open") + COUNTIF(Tasks[Status], "Overdue") + COUNTIF(Tasks[Status], "Unscheduled") }} open tasks** · {{ COUNTIF(Tasks[Status], "Overdue") }} overdue.\n\nCheck a task off when it is complete. Overdue status updates each day from the due date.\n',
        },
        {
          type: "table",
          name: "Tasks",
          rowCount: 4,
          colCount: 6,
          columns: [
            { name: "Task", type: "text" },
            { name: "Owner", type: "text" },
            { name: "Due date", type: "date" },
            {
              name: "Priority",
              type: "choice",
              choices: ["High", "Normal", "Low"],
            },
            { name: "Done", type: "checkbox" },
            {
              name: "Status",
              type: "formula",
              formula:
                '=IF([Done], "Done", IF([Due date] = "", "Unscheduled", IF([Due date] < TODAY(), "Overdue", "Open")))',
            },
          ],
          display: {
            sort: [{ column: 2, descending: false }],
            filter: '=[Status] <> "Done"',
          },
          formats: [
            {
              startRow: 0,
              endRow: null,
              startCol: 2,
              endCol: 2,
              format: { numberFormat: "mmm d, yyyy" },
            },
          ],
          conditionalFormats: [
            {
              startRow: 0,
              endRow: null,
              startCol: 5,
              endCol: 5,
              kind: "criterion",
              criterion: "Overdue",
              format: { fill: "red", bold: true },
            },
          ],
          cells: [
            { row: 0, col: 0, input: "Send the revised proposal" },
            { row: 0, col: 1, input: "Avery" },
            { row: 0, col: 2, input: "2026-10-07" },
            { row: 0, col: 3, input: "High" },
            { row: 0, col: 4, input: "FALSE" },
            { row: 1, col: 0, input: "Review supplier agreement" },
            { row: 1, col: 1, input: "Morgan" },
            { row: 1, col: 2, input: "2026-10-03" },
            { row: 1, col: 3, input: "High" },
            { row: 1, col: 4, input: "FALSE" },
            { row: 2, col: 0, input: "Schedule team check-in" },
            { row: 2, col: 1, input: "Riley" },
            { row: 2, col: 2, input: "2026-10-14" },
            { row: 2, col: 3, input: "Low" },
            { row: 2, col: 4, input: "FALSE" },
            { row: 3, col: 0, input: "Pay software renewal" },
            { row: 3, col: 1, input: "Avery" },
            { row: 3, col: 2, input: "2026-10-05" },
            { row: 3, col: 3, input: "Normal" },
            { row: 3, col: 4, input: "TRUE" },
          ],
        },
      ],
    },
  ],
};

const inventory: SpreadsheetFile = {
  format: "spreadsheet-app",
  version: 1,
  name: "Inventory",
  pages: [
    {
      name: "Inventory",
      blocks: [
        {
          type: "text",
          name: "Stock summary",
          source:
            '# Inventory\n\n{{ COUNTA(Products[Product]) }} products · {{ COUNTA(Movements[Quantity change]) }} stock movements. Receipts use positive quantities; issues use negative quantities.\n\n{{ VSTACK(HSTACK("Product", "Reorder at", "On hand", "Status"), HSTACK(Products[Product], Products[Reorder at], Products[On hand], Products[Status])) }}\n\nUse **Movement form** to record a receipt or issue. Each entry is kept in the Movements table and recalculates the product stock.\n',
        },
        {
          type: "table",
          name: "Products",
          rowCount: 3,
          colCount: 5,
          columns: [
            { name: "SKU", type: "text" },
            { name: "Product", type: "text" },
            { name: "Reorder at", type: "number" },
            {
              name: "On hand",
              type: "formula",
              formula: "=SUMIF(Movements[Product], [Product], Movements[Quantity change])",
            },
            {
              name: "Status",
              type: "formula",
              formula: '=IF([On hand] <= [Reorder at], "Reorder", "In stock")',
            },
          ],
          conditionalFormats: [
            {
              startRow: 0,
              endRow: null,
              startCol: 4,
              endCol: 4,
              kind: "criterion",
              criterion: "Reorder",
              format: { fill: "red", bold: true },
            },
          ],
          cells: [
            { row: 0, col: 0, input: "BR-01" },
            { row: 0, col: 1, input: "Arabica beans" },
            { row: 0, col: 2, input: "12" },
            { row: 1, col: 0, input: "MT-02" },
            { row: 1, col: 1, input: "Oat milk" },
            { row: 1, col: 2, input: "10" },
            { row: 2, col: 0, input: "PP-03" },
            { row: 2, col: 1, input: "Paper cups" },
            { row: 2, col: 2, input: "5" },
          ],
        },
        {
          type: "table",
          name: "Movements",
          rowCount: 4,
          colCount: 4,
          columns: [
            { name: "Date", type: "date" },
            {
              name: "Product",
              type: "choice",
              choicesFrom: { page: "Inventory", table: "Products", column: "Product" },
            },
            { name: "Reason", type: "text" },
            { name: "Quantity change", type: "number" },
          ],
          formats: [
            {
              startRow: 0,
              endRow: null,
              startCol: 0,
              endCol: 0,
              format: { numberFormat: "mmm d, yyyy" },
            },
          ],
          cells: [
            { row: 0, col: 0, input: "2026-10-01" },
            { row: 0, col: 1, input: "Arabica beans" },
            { row: 0, col: 2, input: "Opening inventory" },
            { row: 0, col: 3, input: "24" },
            { row: 1, col: 0, input: "2026-10-02" },
            { row: 1, col: 1, input: "Arabica beans" },
            { row: 1, col: 2, input: "Wholesale order SO-104" },
            { row: 1, col: 3, input: "-4" },
            { row: 2, col: 0, input: "2026-10-01" },
            { row: 2, col: 1, input: "Oat milk" },
            { row: 2, col: 2, input: "Opening inventory" },
            { row: 2, col: 3, input: "8" },
            { row: 3, col: 0, input: "2026-10-01" },
            { row: 3, col: 1, input: "Paper cups" },
            { row: 3, col: 2, input: "Opening inventory" },
            { row: 3, col: 3, input: "40" },
          ],
        },
        {
          type: "table",
          name: "Movement form",
          rowCount: 5,
          colCount: 3,
          formats: [{ startRow: 0, endRow: null, startCol: 0, endCol: 0, format: { bold: true } }],
          cells: [
            { row: 0, col: 0, input: "Date" },
            { row: 0, col: 1, input: '=TEXTBOX(C1, "YYYY-MM-DD")' },
            { row: 0, col: 2, input: "2026-10-06" },
            { row: 1, col: 0, input: "Product" },
            { row: 1, col: 1, input: "=DROPDOWN(Products[Product], C2)" },
            { row: 2, col: 0, input: "Reason" },
            { row: 2, col: 1, input: '=TEXTBOX(C3, "Receipt or issue")' },
            { row: 3, col: 0, input: "Quantity change" },
            { row: 3, col: 1, input: '=NUMBERBOX(C4, "Use a negative number for an issue")' },
            { row: 4, col: 0, input: "Add movement" },
            {
              row: 4,
              col: 1,
              input:
                '=IF(AND(C1 <> "", C2 <> "", C3 <> "", C4 <> 0), BUTTON("Add movement", DO(APPEND_ROW(Movements!A:D, C1, C2, C3, C4), CLEAR(C1), CLEAR(C2), CLEAR(C3), CLEAR(C4))), "Complete all fields to add a movement.")',
            },
          ],
        },
      ],
    },
  ],
};

export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    name: "Invoice",
    description: "Track line items, tax, and the balance due.",
    document: invoice,
  },
  {
    name: "Contacts list",
    description: "Keep categorized contacts and a live count by category.",
    document: contacts,
  },
  {
    name: "To-do list",
    description: "Track priorities, due dates, completion, and overdue tasks.",
    document: todo,
  },
  {
    name: "Inventory",
    description: "Track products and stock movements with a form that adds each movement.",
    document: inventory,
  },
];
