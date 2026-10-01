import type { ChartType, Effect } from "@spreadsheet-app/engine";
import { sql } from "drizzle-orm";
import {
  boolean,
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
    createdAt,
    updatedAt,
  },
  (table) => [index("spreadsheets_workspace").on(table.workspaceId)],
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
    rowCount: integer("row_count").notNull(),
    colCount: integer("col_count").notNull(),
  },
  (table) => [uniqueIndex("tables_name").on(table.pageId, sql`lower(${table.name})`)],
);

export type ViewKind = "chart" | "text";

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

/** Holds what the user typed. Computed values are derived by the engine. Empty cells have no row. */
export const cells = pgTable(
  "cells",
  {
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    row: integer("row_index").notNull(),
    col: integer("col_index").notNull(),
    input: text("input").notNull(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.tableId, table.row, table.col] })],
);

export type RunStatus = "pending" | "succeeded" | "failed";

/** The audit log of button clicks: who clicked which cell, what it asked for, and how it ended. */
export const actionRuns = pgTable(
  "action_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheets.id, { onDelete: "cascade" }),
    // Not a foreign key: the record outlives the table the button was in.
    tableId: uuid("table_id").notNull(),
    row: integer("row_index").notNull(),
    col: integer("col_index").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    effects: jsonb("effects").$type<Effect[]>().notNull(),
    status: text("status").$type<RunStatus>().notNull(),
    error: text("error"),
    createdAt,
  },
  (table) => [index("action_runs_user_time").on(table.userId, table.createdAt)],
);
