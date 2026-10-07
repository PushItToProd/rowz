import { z } from "zod";

export const searchScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document") }),
  z.object({ kind: z.literal("page"), id: z.uuid() }),
  z.object({ kind: z.literal("block"), id: z.uuid() }),
]);
export const searchTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cell"), blockId: z.uuid(), rowId: z.uuid(), colId: z.uuid() }),
  z.object({ kind: z.literal("source"), blockId: z.uuid() }),
  z.object({ kind: z.literal("column"), blockId: z.uuid(), colId: z.uuid() }),
  z.object({ kind: z.literal("filter"), blockId: z.uuid() }),
  z.object({ kind: z.literal("name"), blockId: z.uuid(), name: z.string() }),
]);
export const replaceBody = z.object({
  query: z.string().min(1),
  replacement: z.string(),
  scope: searchScope,
  caseSensitive: z.boolean().default(false),
  whole: z.boolean().default(false),
  one: z
    .object({ target: searchTarget, offset: z.number().int().nonnegative(), expected: z.string() })
    .optional(),
});
export type SearchScope = z.infer<typeof searchScope>;
export type SearchTarget = z.infer<typeof searchTarget>;
export type ReplaceBody = z.infer<typeof replaceBody>;
export interface SkippedReplacement {
  pageId: string;
  blockId: string;
  target: SearchTarget;
  label: string;
  reason: "skipped: would not parse";
}
export interface ReplaceReport {
  skippedCount: number;
  skipped: SkippedReplacement[];
}
export interface SearchOptions {
  caseSensitive: boolean;
  whole: boolean;
}

/** Literal, non-overlapping matches. Offsets refer to the original UTF-16 source. */
export function matchOffsets(text: string, query: string, options: SearchOptions): number[] {
  return [...createLiteralMatcher(query, options)(text)];
}

/** Compile once and stream offsets, so callers can count without keeping every match. */
export function createLiteralMatcher(query: string, options: SearchOptions) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    options.whole ? `^(?:${escaped})$` : escaped,
    options.caseSensitive ? "g" : "gi",
  );
  return function* (text: string): Generator<number> {
    if (!query || !text) return;
    for (const match of text.matchAll(pattern)) {
      if (!options.whole || match[0].length === text.length) yield match.index;
    }
  };
}
