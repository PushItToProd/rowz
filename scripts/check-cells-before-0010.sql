-- Run against a database that has applied migration 0009 but not 0010
-- (psql "$DATABASE_URL" -f scripts/check-cells-before-0010.sql).
-- Migration 0010 aborts if any cell lies outside its table's rows or columns.
-- Each query should return zero rows.

-- Cells whose row_index is past the table's row_count.
SELECT c.table_id, c.row_index, c.col_index, 'row outside table' AS problem
FROM cells c JOIN tables t ON t.id = c.table_id
WHERE c.row_index >= t.row_count;

-- Cells whose col_index is past the table's col_count.
SELECT c.table_id, c.row_index, c.col_index, 'column outside table' AS problem
FROM cells c JOIN tables t ON t.id = c.table_id
WHERE c.col_index >= t.col_count;

-- Tables with a partial identity backfill from an earlier 0009.
SELECT t.id AS table_id, 'partial backfill' AS problem
FROM tables t
WHERE (SELECT count(*) FROM table_rows r WHERE r.table_id = t.id) NOT IN (0, t.row_count)
   OR jsonb_array_length(t.col_ids) NOT IN (0, t.col_count);
