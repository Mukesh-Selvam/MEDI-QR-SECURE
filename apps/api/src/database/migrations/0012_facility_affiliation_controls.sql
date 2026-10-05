ALTER TABLE "facility_staff_affiliations" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "facility_staff_affiliations" ADD COLUMN "platform_suspended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_staff_affiliations" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "facility_staff_affiliations" ADD CONSTRAINT "facility_staff_affiliations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;