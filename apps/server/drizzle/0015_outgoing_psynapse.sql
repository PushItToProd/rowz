ALTER TABLE "action_runs" ALTER COLUMN "table_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "action_runs" ALTER COLUMN "row_index" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "action_runs" ALTER COLUMN "col_index" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "action_runs" ADD COLUMN "view_id" uuid;--> statement-breakpoint
ALTER TABLE "action_runs" ADD COLUMN "button_index" integer;--> statement-breakpoint
ALTER TABLE "action_runs" ADD CONSTRAINT "action_runs_target" CHECK (("action_runs"."table_id" IS NOT NULL AND "action_runs"."row_index" IS NOT NULL AND "action_runs"."col_index" IS NOT NULL AND "action_runs"."view_id" IS NULL AND "action_runs"."button_index" IS NULL) OR ("action_runs"."table_id" IS NULL AND "action_runs"."row_index" IS NULL AND "action_runs"."col_index" IS NULL AND "action_runs"."view_id" IS NOT NULL AND "action_runs"."button_index" IS NOT NULL AND "action_runs"."button_index" >= 0));