CREATE TYPE "public"."place_precision" AS ENUM('exact', 'approximate', 'only_me');--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "place_precision" "place_precision" DEFAULT 'approximate' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "place_precision" "place_precision" DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "location_name" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "place_precision" "place_precision" DEFAULT 'approximate' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_places" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_place_point" CHECK (("chapters"."lat" is null) = ("chapters"."lon" is null));--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_place_point" CHECK (("ideas"."lat" is null) = ("ideas"."lon" is null));--> statement-breakpoint
-- Points that plans already had (made by the Oracle and the Loracle) were never shown to anyone, and an
-- Oracle plan's text says how far it is from home: they start as "Only me" (the organiser can share them).
UPDATE "events" SET "place_precision" = 'only_me' WHERE "lat" IS NOT NULL;
