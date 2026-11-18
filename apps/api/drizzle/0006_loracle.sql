CREATE TABLE "loracle_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"wish_id" uuid,
	"utc_day" date NOT NULL,
	"day" date,
	"stage" text NOT NULL,
	"outcome" text NOT NULL,
	"model" text NOT NULL,
	"ms" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"searches" integer DEFAULT 0 NOT NULL,
	"fetches" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wish_roads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wish_id" uuid NOT NULL,
	"n" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"failure" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_id" uuid,
	"heartbeat_at" timestamp with time zone,
	"signs" text[] DEFAULT '{}'::text[] NOT NULL,
	"quest" jsonb,
	"forge" jsonb,
	"faults" text[] DEFAULT '{}'::text[] NOT NULL,
	"rough" boolean DEFAULT false NOT NULL,
	"this_week_reminder_id" uuid,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wish_roads_status" CHECK ("wish_roads"."status" in ('queued', 'searching', 'drawing', 'sealing', 'ready', 'drawn', 'faded', 'silent')),
	CONSTRAINT "wish_roads_failure" CHECK ("wish_roads"."failure" is null or "wish_roads"."failure" in ('interrupted', 'overloaded', 'timeout', 'error'))
);
--> statement-breakpoint
CREATE TABLE "wish_waypoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"road_id" uuid NOT NULL,
	"wish_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"emblem" text NOT NULL,
	"name" text NOT NULL,
	"when" text NOT NULL,
	"at" text,
	"place" text NOT NULL,
	"town" text,
	"country" text NOT NULL,
	"geo_query" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"precision" text,
	"clue" text NOT NULL,
	"lore" boolean DEFAULT false NOT NULL,
	"trial" text NOT NULL,
	"person" jsonb,
	"earns" text,
	"mystery" text,
	"steps" jsonb NOT NULL,
	"note_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"seal_broken_at" timestamp with time zone,
	"inked_at" timestamp with time zone,
	"inked_on" date,
	"note" text,
	"event_id" uuid,
	"idea_id" uuid,
	"chapter_id" uuid,
	"reminder_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"text_key" text NOT NULL,
	"context" jsonb NOT NULL,
	"realm" jsonb NOT NULL,
	"time_zone" text NOT NULL,
	"day" date NOT NULL,
	"status" text DEFAULT 'listening' NOT NULL,
	"weighing" jsonb NOT NULL,
	"ledger" jsonb,
	"ledger_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishes_status" CHECK ("wishes"."status" in ('listening', 'moon', 'revealed', 'faded', 'silent', 'fulfilled', 'released'))
);
--> statement-breakpoint
ALTER TABLE "oracle_settings" ADD COLUMN "loracle_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oracle_settings" ADD COLUMN "home_country" text;--> statement-breakpoint
ALTER TABLE "oracle_settings" ADD COLUMN "loracle_context" jsonb;--> statement-breakpoint
ALTER TABLE "loracle_spend" ADD CONSTRAINT "loracle_spend_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loracle_spend" ADD CONSTRAINT "loracle_spend_wish_id_wishes_id_fk" FOREIGN KEY ("wish_id") REFERENCES "public"."wishes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_roads" ADD CONSTRAINT "wish_roads_wish_id_wishes_id_fk" FOREIGN KEY ("wish_id") REFERENCES "public"."wishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_roads" ADD CONSTRAINT "wish_roads_this_week_reminder_id_notes_id_fk" FOREIGN KEY ("this_week_reminder_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_waypoints" ADD CONSTRAINT "wish_waypoints_road_id_wish_roads_id_fk" FOREIGN KEY ("road_id") REFERENCES "public"."wish_roads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_waypoints" ADD CONSTRAINT "wish_waypoints_wish_id_wishes_id_fk" FOREIGN KEY ("wish_id") REFERENCES "public"."wishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_waypoints" ADD CONSTRAINT "wish_waypoints_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_waypoints" ADD CONSTRAINT "wish_waypoints_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_waypoints" ADD CONSTRAINT "wish_waypoints_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_waypoints" ADD CONSTRAINT "wish_waypoints_reminder_id_notes_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loracle_spend_utc_day_idx" ON "loracle_spend" USING btree ("utc_day");--> statement-breakpoint
CREATE INDEX "loracle_spend_user_created_idx" ON "loracle_spend" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wish_roads_wish_n_idx" ON "wish_roads" USING btree ("wish_id","n");--> statement-breakpoint
CREATE INDEX "wish_roads_status_idx" ON "wish_roads" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "wish_waypoints_road_position_idx" ON "wish_waypoints" USING btree ("road_id","position");--> statement-breakpoint
CREATE INDEX "wish_waypoints_wish_idx" ON "wish_waypoints" USING btree ("wish_id");--> statement-breakpoint
CREATE INDEX "wishes_user_created_idx" ON "wishes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "wishes_user_day_key_idx" ON "wishes" USING btree ("user_id","day","text_key");--> statement-breakpoint
CREATE INDEX "wishes_status_idx" ON "wishes" USING btree ("status");