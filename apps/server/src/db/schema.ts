import type {
  ChartType,
  ColumnDefinition,
  ConditionalRule,
  Effect,
  FormatRule,
  TableDisplay,
  TableName,
} from "@spreadsheet-app/engine";
import type { GridSizes, SpreadsheetFile } from "@spreadsheet-app/shared";
import type { JournalData } from "../repo/journal";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// The first four tables belong to better-auth. Its adapter finds columns by
// property name, so the property names here must match its field names.

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt,
  updatedAt,
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt,
  updatedAt,
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt,
  updatedAt,
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt,
  updatedAt,
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt,
});

export type Role = "owner" | "editor" | "viewer";

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user").on(table.userId),
  ],
);

export const spreadsheets = pgTable(
  "spreadsheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Counts the changes to what the spreadsheet holds. Open sessions apply changes in this order. */
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    /**
     * The revision of the last change to what references mean: a row or column
     * inserted or deleted, or something renamed or moved. A formula written
     * before it is refused.
     */
    rewriteRevision: bigint("rewrite_revision", { mode: "number" }).notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [index("spreadsheets_workspace").on(table.workspaceId)],
);

/**
 * People a spreadsheet is shared with, who are not members of its workspace.
 * A share gives the role of editor or viewer on that one spreadsheet.
 */
export const spreadsheetMembers = pgTable(
  "spreadsheet_members",
  {
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.spreadsheetId, table.userId] }),
    index("spreadsheet_members_user").on(table.userId),
  ],
);

// Formulas refer to pages and tables by name without regard to case, so names
// are unique within their parent the same way.

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [uniqueIndex("pages_name").on(table.spreadsheetId, sql`lower(${table.name})`)],
);

export const tables = pgTable(
  "tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** The ids of the table's columns, in order. Its rows are in `table_rows`. */
    colIds: jsonb("col_ids").$type<string[]>().notNull().default([]),
    gridSizes: jsonb("grid_sizes").$type<GridSizes>().notNull().default({ rows: {}, columns: {} }),
    /** The named columns of a data table, one for each column. Null for a plain table. */
    columns: jsonb("columns").$type<ColumnDefinition[]>(),
    /** How cells are shown: rules applied in order, later ones over earlier ones. */
    formats: jsonb("formats").$type<FormatRule[]>().notNull().default([]),
    /**
     * How a data table's rows are shown: a sort and a filter. They leave the
     * stored row order alone, so `A2` keeps its meaning under any sort.
     */
    display: jsonb("display").$type<TableDisplay>().notNull().default({ sort: [] }),
    /** Formats a cell gets when its value meets a condition, laid over `formats`. */
    conditionalFormats: jsonb("conditional_formats")
      .$type<ConditionalRule[]>()
      .notNull()
      .default([]),
    /** The names a plain table holds, each with its formula. A data table holds none. */
    names: jsonb("names").$type<TableName[]>().notNull().default([]),
  },
  (table) => [uniqueIndex("tables_name").on(table.pageId, sql`lower(${table.name})`)],
);

/**
 * The rows of every table. A row's place in its table is the place of its
 * order key among the table's keys in byte order, so inserting a row writes
 * one record. `order_key` has the C collation, which makes Postgres order keys
 * as JavaScript compares strings. The migration states it, because this
 * schema cannot.
 */
export const tableRows = pgTable(
  "table_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    orderKey: text("order_key").notNull(),
  },
  (row) => [
    uniqueIndex("table_rows_order").on(row.tableId, row.orderKey),
    uniqueIndex("table_rows_table_id").on(row.tableId, row.id),
  ],
);

export type ViewKind = "chart" | "text" | "script";

/**
 * Things on a page that show data without being tables. A chart's source is
 * the formula for its data, and a text view's source is its Markdown
 * template. Views share one ordering with the page's tables.
 */
export const views = pgTable("views", {
  id: uuid("id").primaryKey().defaultRandom(),
  pageId: uuid("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  kind: text("kind").$type<ViewKind>().notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  source: text("source").notNull(),
  /** Set for charts only. */
  chartType: text("chart_type").$type<ChartType>(),
});

/**
 * Rows that were deleted, so that a request repeated after its row was
 * deleted cannot bring the row back. Entries are pruned with the journal.
 */
export const deletedRows = pgTable(
  "deleted_rows",
  {
    rowId: uuid("row_id").primaryKey(),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheets.id, { onDelete: "cascade" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [index("deleted_rows_spreadsheet_time").on(table.spreadsheetId, table.deletedAt)],
);

/**
 * Holds what the user typed. Computed values are derived by the engine. Empty
 * cells have no record. A cell is named by the ids of its row and column, so
 * inserting or deleting a row or column moves no cell. The database refuses a
 * cell whose row is in another table. Column ids live in `tables.col_ids`,
 * where no foreign key reaches, so the repository checks them.
 */
export const cells = pgTable(
  "cells",
  {
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    rowId: uuid("row_id").notNull(),
    colId: uuid("col_id").notNull(),
    input: text("input").notNull(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.rowId, table.colId] }),
    foreignKey({
      name: "cells_row",
      columns: [table.tableId, table.rowId],
      foreignColumns: [tableRows.tableId, tableRows.id],
    }).onDelete("cascade"),
    index("cells_table").on(table.tableId),
  ],
);

/**
 * A spreadsheet as it was at some moment, kept so that it can be restored.
 * `created_at` is the clock time of the insert, not the start of its
 * transaction, so that versions and changes made in one transaction are in
 * the order they happened.
 */
export const versions = pgTable(
  "versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    /** What was about to happen when the version was kept. Null for one kept as time passed. */
    reason: text("reason"),
    data: jsonb("data").$type<SpreadsheetFile>().notNull(),
  },
  (table) => [index("versions_spreadsheet_time").on(table.spreadsheetId, table.createdAt)],
);

/** A content change in one tab's undo and redo history. */
export const journal = pgTable(
  "journal",
  {
    seq: bigint("seq", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheets.id, { onDelete: "cascade" }),
    step: uuid("step").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id"),
    undone: boolean("undone").notNull().default(false),
    /** Whether the change altered what references mean, whether or not it changed any formula. */
    rewrites: boolean("rewrites").notNull(),
    /** Whether the state the change left holds formula text that it wrote. */
    formulas: boolean("formulas").notNull().default(false),
    label: text("label").notNull(),
    data: jsonb("data").$type<JournalData | null>(),
    bytes: integer("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [index("journal_spreadsheet_seq").on(table.spreadsheetId, table.seq)],
);

export type RunStatus = "pending" | "succeeded" | "failed";
export type RunKind = "cell_button" | "cell_input" | "view_button" | "view_input" | "unknown";
export type ActionRunKind = Exclude<RunKind, "unknown">;

/** The audit log of button clicks and control inputs: who acted, what it changed, and how it ended. */
export const actionRuns = pgTable(
  "action_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheets.id, { onDelete: "cascade" }),
    // Target IDs are not foreign keys: a run outlives the button it came from.
    tableId: uuid("table_id"),
    viewId: uuid("view_id"),
    kind: text("kind").$type<RunKind>().notNull(),
    // A cell position, or an action/control occurrence in a text view.
    row: integer("row_index"),
    col: integer("col_index"),
    buttonIndex: integer("button_index"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    effects: jsonb("effects").$type<Effect[]>().notNull(),
    /**
     * How many emails the run sent: one for each recipient of each message.
     * While the run is pending it is how many the run set out to send, which
     * holds their place in the user's hourly limit.
     */
    emails: integer("emails").notNull().default(0),
    status: text("status").$type<RunStatus>().notNull(),
    error: text("error"),
    createdAt,
  },
  (table) => [
    index("action_runs_user_time").on(table.userId, table.createdAt),
    index("action_runs_spreadsheet_time").on(table.spreadsheetId, table.createdAt),
    check(
      "action_runs_target",
      sql`(${table.tableId} IS NOT NULL AND ${table.row} IS NOT NULL AND ${table.col} IS NOT NULL AND ${table.viewId} IS NULL AND ${table.buttonIndex} IS NULL) OR (${table.tableId} IS NULL AND ${table.row} IS NULL AND ${table.col} IS NULL AND ${table.viewId} IS NOT NULL AND ${table.buttonIndex} IS NOT NULL AND ${table.buttonIndex} >= 0)`,
    ),
  ],
);

/** A user's private groups for the documents in their list. */
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("folders_name").on(table.userId, sql`lower(${table.name})`),
    uniqueIndex("folders_user_id").on(table.userId, table.id),
  ],
);

/** A document's folder in one user's list; absence means it is in the root. */
export const documentFolders = pgTable(
  "document_folders",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheets.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").notNull(),
  },
  (table) => [
    uniqueIndex("document_folders_user_spreadsheet").on(table.userId, table.spreadsheetId),
    foreignKey({
      name: "document_folders_folder_owner",
      columns: [table.userId, table.folderId],
      foreignColumns: [folders.userId, folders.id],
    }).onDelete("cascade"),
  ],
);
