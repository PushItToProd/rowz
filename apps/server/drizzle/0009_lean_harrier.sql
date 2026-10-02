CREATE TABLE "table_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"order_key" text COLLATE "C" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "col_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "table_rows" ADD CONSTRAINT "table_rows_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "table_rows_order" ON "table_rows" USING btree ("table_id","order_key");--> statement-breakpoint
CREATE UNIQUE INDEX "table_rows_table_id" ON "table_rows" USING btree ("table_id","id");
--> statement-breakpoint
INSERT INTO table_rows (table_id, order_key)
SELECT t.id, 'f' || lpad(r::text, 5, '0') || 'V'
FROM tables t CROSS JOIN LATERAL generate_series(0, t.row_count - 1) r;
--> statement-breakpoint
UPDATE tables t SET col_ids = (
  SELECT jsonb_agg(gen_random_uuid() ORDER BY c)
  FROM generate_series(0, t.col_count - 1) c
);
--> statement-breakpoint
DELETE FROM journal;
