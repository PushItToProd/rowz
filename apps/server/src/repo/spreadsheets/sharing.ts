import { and, asc, eq, sql } from "drizzle-orm";
import { noteChange } from "../../changes";
import { spreadsheetMembers, spreadsheets, users, workspaceMembers } from "../../db/schema";
import { conflict, notFound, unprocessable } from "../../errors";
import { type MemberRecord } from "./records";
import type { RepositoryContext } from "./context";

/** Everyone who can open a spreadsheet: the members of its workspace, then the people it is shared with. */
export async function listMembers(
  ctx: RepositoryContext,
  spreadsheetId: string,
): Promise<MemberRecord[]> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "read");
  const person = { userId: users.id, name: users.name, email: users.email };
  const [inWorkspace, shared] = await Promise.all([
    ctx.db
      .select({ ...person, role: workspaceMembers.role })
      .from(spreadsheets)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, spreadsheets.workspaceId))
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(spreadsheets.id, spreadsheetId))
      .orderBy(asc(workspaceMembers.createdAt)),
    ctx.db
      .select({ ...person, role: spreadsheetMembers.role })
      .from(spreadsheetMembers)
      .innerJoin(users, eq(users.id, spreadsheetMembers.userId))
      .where(eq(spreadsheetMembers.spreadsheetId, spreadsheetId))
      .orderBy(asc(spreadsheetMembers.createdAt)),
  ]);
  return [
    ...inWorkspace.map((member) => ({ ...member, shared: false })),
    ...shared.map((member) => ({ ...member, shared: true })),
  ];
}

/**
 * Shares a spreadsheet with the account that has an email address, or
 * changes the role of someone it is already shared with. Only the owner can.
 */
export async function share(
  ctx: RepositoryContext,
  spreadsheetId: string,
  email: string,
  role: "editor" | "viewer",
): Promise<void> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "own");
  const [user] = await ctx.db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()));
  if (!user) {
    throw unprocessable(
      "no_such_account",
      `No account uses ${email}. Ask them to sign up, then share again`,
    );
  }
  if (ctx.options.sharesNeedVerifiedEmail && !user.emailVerified) {
    throw unprocessable(
      "email_not_confirmed",
      `The account for ${email} has not confirmed its email address yet. Share again once it has`,
    );
  }
  const members = await ctx.repository.listMembers(spreadsheetId);
  if (members.some((member) => member.userId === user.id && !member.shared)) {
    throw conflict(`${email} already has this document through its workspace`);
  }
  // A guest whose role changes sees it without reloading.
  noteChange(spreadsheetId);
  await ctx.db
    .insert(spreadsheetMembers)
    .values({ spreadsheetId, userId: user.id, role })
    .onConflictDoUpdate({
      target: [spreadsheetMembers.spreadsheetId, spreadsheetMembers.userId],
      set: { role },
    });
}

/** Stops sharing a spreadsheet with someone. The owner can remove anyone, and anyone can remove themselves. */
export async function unshare(
  ctx: RepositoryContext,
  spreadsheetId: string,
  userId: string,
): Promise<void> {
  await ctx.repository.findSpreadsheet(spreadsheetId, userId === ctx.userId ? "read" : "own");
  const removed = await ctx.db
    .delete(spreadsheetMembers)
    .where(
      and(
        eq(spreadsheetMembers.spreadsheetId, spreadsheetId),
        eq(spreadsheetMembers.userId, userId),
      ),
    )
    .returning({ userId: spreadsheetMembers.userId });
  if (removed.length === 0) throw notFound("Share");
  noteChange(spreadsheetId);
}
