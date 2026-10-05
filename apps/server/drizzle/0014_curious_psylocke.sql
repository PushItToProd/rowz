CREATE TABLE "document_folders" (
	"user_id" text NOT NULL,
	"spreadsheet_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_spreadsheet_id_spreadsheets_id_fk" FOREIGN KEY ("spreadsheet_id") REFERENCES "public"."spreadsheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_user_spreadsheet" ON "document_folders" USING btree ("user_id","spreadsheet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_name" ON "folders" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "folders_user_id" ON "folders" USING btree ("user_id","id");--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_folder_owner" FOREIGN KEY ("user_id","folder_id") REFERENCES "public"."folders"("user_id","id") ON DELETE cascade ON UPDATE no action;
