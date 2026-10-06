CREATE TABLE "facility_staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"affiliation_id" uuid NOT NULL,
	"invited_user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facility_staff_invitations" ADD CONSTRAINT "facility_staff_invitations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_staff_invitations" ADD CONSTRAINT "facility_staff_invitations_affiliation_id_facility_staff_affiliations_id_fk" FOREIGN KEY ("affiliation_id") REFERENCES "public"."facility_staff_affiliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_staff_invitations" ADD CONSTRAINT "facility_staff_invitations_invited_user_id_users_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_staff_invitations" ADD CONSTRAINT "facility_staff_invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "facility_staff_invitations_token_hash_idx" ON "facility_staff_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "facility_staff_invitations_affiliation_idx" ON "facility_staff_invitations" USING btree ("affiliation_id");