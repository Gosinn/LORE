CREATE TABLE "oracle_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"mode" text NOT NULL,
	"futures" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oracle_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"home_label" text,
	"home_lat" double precision,
	"home_lon" double precision,
	"radius_km" integer DEFAULT 80 NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "oracle_readings" ADD CONSTRAINT "oracle_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oracle_settings" ADD CONSTRAINT "oracle_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oracle_readings_user_day_idx" ON "oracle_readings" USING btree ("user_id","day");