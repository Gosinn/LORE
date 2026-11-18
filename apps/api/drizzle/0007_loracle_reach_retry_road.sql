ALTER TABLE "loracle_spend" ADD COLUMN "road_id" uuid;--> statement-breakpoint
ALTER TABLE "oracle_settings" ADD COLUMN "loracle_reach_km" integer;--> statement-breakpoint
ALTER TABLE "wish_roads" ADD COLUMN "retried_on" date;