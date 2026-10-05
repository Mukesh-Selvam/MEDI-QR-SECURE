CREATE TYPE "public"."facility_staff_status_v2" AS ENUM('pending', 'active', 'suspended', 'revoked');--> statement-breakpoint
ALTER TABLE "facility_staff_affiliations" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "facility_staff_affiliations" ALTER COLUMN "status" TYPE "public"."facility_staff_status_v2" USING "status"::text::"public"."facility_staff_status_v2";--> statement-breakpoint
DROP TYPE "public"."facility_staff_status";--> statement-breakpoint
ALTER TYPE "public"."facility_staff_status_v2" RENAME TO "facility_staff_status";