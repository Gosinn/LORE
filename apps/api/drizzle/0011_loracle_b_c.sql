CREATE TABLE "loracle_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"stage" text NOT NULL,
	"items" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wish_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waypoint_id" uuid NOT NULL,
	"wish_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"lane" text DEFAULT 'now' NOT NULL,
	"due_by" timestamp with time zone,
	"question" text,
	"status" text DEFAULT 'listening' NOT NULL,
	"failure" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_id" uuid,
	"heartbeat_at" timestamp with time zone,
	"signs" text[] DEFAULT '{}'::text[] NOT NULL,
	"answer" jsonb,
	"found" jsonb,
	"faults" text[] DEFAULT '{}'::text[] NOT NULL,
	"rough" boolean DEFAULT false NOT NULL,
	"batch" jsonb,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wish_asks_status" CHECK ("wish_asks"."status" in ('listening', 'dawn', 'answered', 'faded', 'silent')),
	CONSTRAINT "wish_asks_lane" CHECK ("wish_asks"."lane" in ('now', 'dawn')),
	CONSTRAINT "wish_asks_failure" CHECK ("wish_asks"."failure" is null or "wish_asks"."failure" in ('interrupted', 'overloaded', 'timeout', 'error'))
);
--> statement-breakpoint
CREATE TABLE "wish_walkers" (
	"waypoint_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wish_walkers_waypoint_id_user_id_pk" PRIMARY KEY("waypoint_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "loracle_spend" ADD COLUMN "ask_id" uuid;--> statement-breakpoint
ALTER TABLE "loracle_spend" ADD COLUMN "lane" text DEFAULT 'now' NOT NULL;--> statement-breakpoint
ALTER TABLE "wish_roads" ADD COLUMN "lane" text DEFAULT 'now' NOT NULL;--> statement-breakpoint
ALTER TABLE "wish_roads" ADD COLUMN "due_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wish_roads" ADD COLUMN "day" date;--> statement-breakpoint
ALTER TABLE "wish_roads" ADD COLUMN "batch" jsonb;--> statement-breakpoint
ALTER TABLE "wishes" ADD COLUMN "audience" text DEFAULT 'only_me' NOT NULL;--> statement-breakpoint
ALTER TABLE "wishes" ADD COLUMN "crew_id" uuid;--> statement-breakpoint
ALTER TABLE "wishes" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wishes" ADD COLUMN "sharing_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wish_asks" ADD CONSTRAINT "wish_asks_waypoint_id_wish_waypoints_id_fk" FOREIGN KEY ("waypoint_id") REFERENCES "public"."wish_waypoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_asks" ADD CONSTRAINT "wish_asks_wish_id_wishes_id_fk" FOREIGN KEY ("wish_id") REFERENCES "public"."wishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_asks" ADD CONSTRAINT "wish_asks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_walkers" ADD CONSTRAINT "wish_walkers_waypoint_id_wish_waypoints_id_fk" FOREIGN KEY ("waypoint_id") REFERENCES "public"."wish_waypoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_walkers" ADD CONSTRAINT "wish_walkers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wish_asks_user_day_idx" ON "wish_asks" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "wish_asks_waypoint_idx" ON "wish_asks" USING btree ("waypoint_id");--> statement-breakpoint
CREATE INDEX "wish_asks_lane_status_idx" ON "wish_asks" USING btree ("lane","status");--> statement-breakpoint
CREATE UNIQUE INDEX "wish_asks_one_open" ON "wish_asks" USING btree ("waypoint_id") WHERE "wish_asks"."status" in ('listening', 'dawn');--> statement-breakpoint
CREATE INDEX "wish_walkers_user_idx" ON "wish_walkers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wish_roads_lane_status_idx" ON "wish_roads" USING btree ("lane","status");--> statement-breakpoint
CREATE INDEX "wishes_crew_idx" ON "wishes" USING btree ("crew_id");--> statement-breakpoint
ALTER TABLE "wish_roads" ADD CONSTRAINT "wish_roads_lane" CHECK ("wish_roads"."lane" in ('now', 'dawn'));--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_audience" CHECK ("wishes"."audience" in ('only_me', 'crew'));