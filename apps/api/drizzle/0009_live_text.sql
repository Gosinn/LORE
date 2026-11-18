CREATE TABLE "copy_overrides" (
	"key" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"original" text NOT NULL,
	"context" text,
	"followed_from" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copy_overrides_text_len" CHECK (char_length("copy_overrides"."text") between 1 and 8000)
);
--> statement-breakpoint
CREATE TABLE "copy_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'publish' NOT NULL,
	"published_by" uuid,
	"undo_of" uuid,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copy_revisions_kind" CHECK ("copy_revisions"."kind" in ('publish', 'undo', 'follow'))
);
--> statement-breakpoint
CREATE TABLE "copy_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"version" uuid
);
--> statement-breakpoint
ALTER TABLE "copy_overrides" ADD CONSTRAINT "copy_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_revisions" ADD CONSTRAINT "copy_revisions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copy_revisions_created_idx" ON "copy_revisions" USING btree ("created_at");