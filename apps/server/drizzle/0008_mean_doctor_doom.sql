CREATE TABLE "journal" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "journal_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"spreadsheet_id" uuid NOT NULL,
	"step" uuid NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text,
	"undone" boolean DEFAULT false NOT NULL,
	"rewrites" boolean NOT NULL,
	"label" text NOT NULL,
	"data" jsonb,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_spreadsheet_id_spreadsheets_id_fk" FOREIGN KEY ("spreadsheet_id") REFERENCES "public"."spreadsheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_spreadsheet_seq" ON "journal" USING btree ("spreadsheet_id","seq");