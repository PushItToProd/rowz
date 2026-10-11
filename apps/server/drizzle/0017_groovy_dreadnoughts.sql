CREATE TABLE "block_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "block_row_id" uuid;--> statement-breakpoint
ALTER TABLE "views" ADD COLUMN "block_row_id" uuid;--> statement-breakpoint
ALTER TABLE "block_rows" ADD CONSTRAINT "block_rows_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_block_row_id_block_rows_id_fk" FOREIGN KEY ("block_row_id") REFERENCES "public"."block_rows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_block_row_id_block_rows_id_fk" FOREIGN KEY ("block_row_id") REFERENCES "public"."block_rows"("id") ON DELETE set null ON UPDATE no action;