CREATE TABLE "spreadsheet_members" (
	"spreadsheet_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spreadsheet_members_spreadsheet_id_user_id_pk" PRIMARY KEY("spreadsheet_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "spreadsheet_members" ADD CONSTRAINT "spreadsheet_members_spreadsheet_id_spreadsheets_id_fk" FOREIGN KEY ("spreadsheet_id") REFERENCES "public"."spreadsheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_members" ADD CONSTRAINT "spreadsheet_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spreadsheet_members_user" ON "spreadsheet_members" USING btree ("user_id");