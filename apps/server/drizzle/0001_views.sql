CREATE TABLE "views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"source" text NOT NULL,
	"chart_type" text
);
--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;