import { formatAddress } from "@spreadsheet-app/engine";
import type {
  DocumentSearchKind,
  DocumentSearchMatch,
  DocumentSearchResponse,
} from "@spreadsheet-app/shared";
import { sql } from "drizzle-orm";
import type { RepositoryContext } from "./context";

type SearchRow = Record<string, unknown> & {
  spreadsheetId: string;
  name: string;
  kind: DocumentSearchKind;
  pageName: string | null;
  blockName: string | null;
  addressRow: number | null;
  addressColumn: number | null;
  snippet: string;
  matchStartCodePoint: number;
  matchEndCodePoint: number;
};

/** Finds literal text across only the documents this repository's caller may read. */
export async function searchDocuments(
  ctx: RepositoryContext,
  q: string,
  limit: number,
): Promise<DocumentSearchResponse> {
  const result = (await ctx.db.execute(sql`
    WITH accessible AS (
      SELECT DISTINCT access.id AS spreadsheet_id
      FROM ${ctx.access}
      WHERE access.user_id = ${ctx.userId}
    ), candidates AS (
      SELECT s.id AS spreadsheet_id, s.name AS spreadsheet_name,
        'name'::text AS kind, NULL::text AS page_name, NULL::text AS block_name,
        s.name AS content, 0::int AS priority,
        NULL::uuid AS table_id, NULL::uuid AS row_id, NULL::uuid AS col_id,
        NULL::text AS order_key
      FROM spreadsheets s
      INNER JOIN accessible a ON a.spreadsheet_id = s.id
      WHERE position(lower(${q}) in lower(s.name)) > 0

      UNION ALL

      SELECT s.id, s.name, 'page'::text, p.name, NULL::text,
        p.name, 1::int, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text
      FROM pages p
      INNER JOIN spreadsheets s ON s.id = p.spreadsheet_id
      INNER JOIN accessible a ON a.spreadsheet_id = s.id
      WHERE position(lower(${q}) in lower(p.name)) > 0

      UNION ALL

      SELECT s.id, s.name, 'table'::text, p.name, t.name,
        t.name, 2::int, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text
      FROM tables t
      INNER JOIN pages p ON p.id = t.page_id
      INNER JOIN spreadsheets s ON s.id = p.spreadsheet_id
      INNER JOIN accessible a ON a.spreadsheet_id = s.id
      WHERE position(lower(${q}) in lower(t.name)) > 0

      UNION ALL

      SELECT s.id, s.name, 'column'::text, p.name, t.name,
        column_definition.value ->> 'name', 3::int,
        NULL::uuid, NULL::uuid, NULL::uuid, NULL::text
      FROM tables t
      INNER JOIN pages p ON p.id = t.page_id
      INNER JOIN spreadsheets s ON s.id = p.spreadsheet_id
      INNER JOIN accessible a ON a.spreadsheet_id = s.id
      CROSS JOIN LATERAL jsonb_array_elements(t.columns) AS column_definition(value)
      WHERE position(lower(${q}) in lower(column_definition.value ->> 'name')) > 0

      UNION ALL

      SELECT s.id, s.name, 'cell'::text, p.name, t.name,
        c.input, 4::int, t.id, c.row_id, c.col_id, tr.order_key
      FROM cells c
      INNER JOIN table_rows tr ON tr.id = c.row_id AND tr.table_id = c.table_id
      INNER JOIN tables t ON t.id = c.table_id
      INNER JOIN pages p ON p.id = t.page_id
      INNER JOIN spreadsheets s ON s.id = p.spreadsheet_id
      INNER JOIN accessible a ON a.spreadsheet_id = s.id
      WHERE position(lower(${q}) in lower(c.input)) > 0

      UNION ALL

      SELECT s.id, s.name, v.kind, p.name, v.name,
        v.source, CASE v.kind WHEN 'text' THEN 5 ELSE 6 END::int,
        NULL::uuid, NULL::uuid, NULL::uuid, NULL::text
      FROM views v
      INNER JOIN pages p ON p.id = v.page_id
      INNER JOIN spreadsheets s ON s.id = p.spreadsheet_id
      INNER JOIN accessible a ON a.spreadsheet_id = s.id
      WHERE v.kind IN ('text', 'script')
        AND position(lower(${q}) in lower(v.source)) > 0

      UNION ALL

      SELECT s.id, s.name, 'chart'::text, p.name, v.name,
        v.source, 7::int, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text
      FROM views v
      INNER JOIN pages p ON p.id = v.page_id
      INNER JOIN spreadsheets s ON s.id = p.spreadsheet_id
      INNER JOIN accessible a ON a.spreadsheet_id = s.id
      WHERE v.kind = 'chart'
        AND position(lower(${q}) in lower(v.source)) > 0
    ), ranked AS (
      SELECT candidates.*,
        position(lower(${q}) in lower(content)) AS match_position,
        row_number() OVER (
          PARTITION BY spreadsheet_id
          ORDER BY priority, COALESCE(page_name, ''), COALESCE(block_name, ''),
            COALESCE(order_key, ''), COALESCE(col_id::text, ''), content
        ) AS match_number
      FROM candidates
    ), top_matches AS (
      SELECT * FROM ranked WHERE match_number <= 5
    ), limited_documents AS (
      SELECT spreadsheet_id, spreadsheet_name, min(priority) AS priority
      FROM top_matches
      GROUP BY spreadsheet_id, spreadsheet_name
      ORDER BY min(priority), lower(spreadsheet_name), spreadsheet_id
      LIMIT ${limit}
    ), ordered_documents AS (
      SELECT limited_documents.*,
        row_number() OVER (
          ORDER BY priority, lower(spreadsheet_name), spreadsheet_id
        ) AS document_number
      FROM limited_documents
    ), selected_matches AS (
      SELECT ordered_documents.document_number, top_matches.*
      FROM ordered_documents
      INNER JOIN top_matches USING (spreadsheet_id)
    ), snippet_ranges AS (
      SELECT selected_matches.*,
        greatest(1, match_position - 40) AS snippet_start,
        least(char_length(content), match_position + char_length(${q}) + 39) AS snippet_end
      FROM selected_matches
    ), snippets AS (
      SELECT snippet_ranges.*,
        (CASE WHEN snippet_start > 1 THEN '…' ELSE '' END) ||
          substring(content FROM snippet_start FOR snippet_end - snippet_start + 1) ||
          (CASE WHEN snippet_end < char_length(content) THEN '…' ELSE '' END) AS snippet,
        (CASE WHEN snippet_start > 1 THEN 1 ELSE 0 END) + match_position - snippet_start
          AS match_start_code_point,
        (CASE WHEN snippet_start > 1 THEN 1 ELSE 0 END) + match_position - snippet_start +
          char_length(${q}) AS match_end_code_point
      FROM snippet_ranges
    )
    SELECT snippets.spreadsheet_id AS "spreadsheetId",
      snippets.spreadsheet_name AS name,
      snippets.kind AS kind,
      snippets.page_name AS "pageName",
      snippets.block_name AS "blockName",
      CASE WHEN snippets.kind = 'cell' THEN (
        SELECT count(*)::int - 1
        FROM table_rows earlier
        WHERE earlier.table_id = snippets.table_id
          AND earlier.order_key <= snippets.order_key
      ) ELSE NULL::int END AS "addressRow",
      CASE WHEN snippets.kind = 'cell' THEN (
        SELECT (column_id.ordinality - 1)::int
        FROM tables address_table
        CROSS JOIN LATERAL jsonb_array_elements_text(address_table.col_ids)
          WITH ORDINALITY AS column_id(id, ordinality)
        WHERE address_table.id = snippets.table_id
          AND column_id.id = snippets.col_id::text
        LIMIT 1
      ) ELSE NULL::int END AS "addressColumn",
      snippets.snippet AS snippet,
      snippets.match_start_code_point AS "matchStartCodePoint",
      snippets.match_end_code_point AS "matchEndCodePoint"
    FROM snippets
    ORDER BY snippets.document_number, snippets.match_number
  `)) as { rows: SearchRow[] };

  const documents = new Map<string, DocumentSearchResponse[number]>();
  for (const row of result.rows) {
    let document = documents.get(row.spreadsheetId);
    if (!document) {
      document = { spreadsheetId: row.spreadsheetId, name: row.name, matches: [] };
      documents.set(row.spreadsheetId, document);
    }
    const match: DocumentSearchMatch = {
      kind: row.kind,
      pageName: row.pageName,
      blockName: row.blockName,
      snippet: row.snippet,
      matchStart: utf16Offset(row.snippet, row.matchStartCodePoint),
      matchEnd: utf16Offset(row.snippet, row.matchEndCodePoint),
    };
    if (row.addressRow !== null && row.addressColumn !== null) {
      match.address = formatAddress({ row: row.addressRow, col: row.addressColumn });
    }
    document.matches.push(match);
  }
  return [...documents.values()];
}

/** Converts PostgreSQL character offsets into JavaScript String.slice offsets. */
function utf16Offset(text: string, codePointOffset: number): number {
  return Array.from(text).slice(0, codePointOffset).join("").length;
}
