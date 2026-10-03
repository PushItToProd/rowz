ALTER TABLE "tables" ADD COLUMN "display" jsonb DEFAULT '{"sort":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "conditional_formats" jsonb DEFAULT '[]'::jsonb NOT NULL;