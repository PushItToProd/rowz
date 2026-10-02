CREATE TABLE "deleted_rows" (
	"row_id" uuid PRIMARY KEY NOT NULL,
	"spreadsheet_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deleted_rows" ADD CONSTRAINT "deleted_rows_spreadsheet_id_spreadsheets_id_fk" FOREIGN KEY ("spreadsheet_id") REFERENCES "public"."spreadsheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deleted_rows_spreadsheet_time" ON "deleted_rows" USING btree ("spreadsheet_id","deleted_at");--> statement-breakpoint
ALTER TABLE "journal" ADD COLUMN "formulas" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spreadsheets" ADD COLUMN "revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spreadsheets" ADD COLUMN "rewrite_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cells" ADD COLUMN "row_id" uuid;--> statement-breakpoint
ALTER TABLE "cells" ADD COLUMN "col_id" uuid;--> statement-breakpoint
UPDATE "cells" SET "row_id" = placed.id
FROM (
  SELECT id, table_id, row_number() OVER (PARTITION BY table_id ORDER BY order_key) - 1 AS position
  FROM table_rows
) placed
WHERE placed.table_id = cells.table_id AND placed.position = cells.row_index;
--> statement-breakpoint
UPDATE "cells" SET "col_id" = (tables.col_ids ->> cells.col_index)::uuid
FROM tables
WHERE tables.id = cells.table_id;
--> statement-breakpoint
DO $$
DECLARE unmatched bigint;
BEGIN
  SELECT count(*) INTO unmatched FROM cells WHERE row_id IS NULL OR col_id IS NULL;
  IF unmatched > 0 THEN
    RAISE EXCEPTION '% cells are outside the rows or columns of their table. Nothing was migrated.', unmatched;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "cells" ALTER COLUMN "row_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cells" ALTER COLUMN "col_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cells" DROP CONSTRAINT "cells_table_id_row_index_col_index_pk";--> statement-breakpoint
ALTER TABLE "cells" ADD CONSTRAINT "cells_row_id_col_id_pk" PRIMARY KEY("row_id","col_id");--> statement-breakpoint
ALTER TABLE "cells" ADD CONSTRAINT "cells_row" FOREIGN KEY ("table_id","row_id") REFERENCES "public"."table_rows"("table_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cells_table" ON "cells" USING btree ("table_id");--> statement-breakpoint
ALTER TABLE "cells" DROP COLUMN "row_index";--> statement-breakpoint
ALTER TABLE "cells" DROP COLUMN "col_index";--> statement-breakpoint
ALTER TABLE "tables" DROP COLUMN "row_count";--> statement-breakpoint
ALTER TABLE "tables" DROP COLUMN "col_count";--> statement-breakpoint
DELETE FROM journal;
