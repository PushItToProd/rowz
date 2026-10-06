ALTER TABLE "action_runs" ADD COLUMN "kind" text;--> statement-breakpoint
UPDATE "action_runs" SET "kind" = 'unknown';--> statement-breakpoint
ALTER TABLE "action_runs" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "action_runs_spreadsheet_time" ON "action_runs" USING btree ("spreadsheet_id","created_at");
