CREATE TABLE "patient_facility_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"valid_until" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "facility_id" uuid;--> statement-breakpoint
ALTER TABLE "patient_facility_relationships" ADD CONSTRAINT "patient_facility_relationships_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_facility_relationship_pair_idx" ON "patient_facility_relationships" USING btree ("patient_id","facility_id");--> statement-breakpoint
CREATE INDEX "patient_facility_relationship_facility_idx" ON "patient_facility_relationships" USING btree ("facility_id");