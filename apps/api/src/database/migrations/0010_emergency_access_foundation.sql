CREATE TYPE "public"."emergency_reason_code" AS ENUM('PATIENT_UNABLE_TO_CONSENT', 'GUARDIAN_UNAVAILABLE', 'TIME_CRITICAL_EMERGENCY_CARE', 'OTHER_EMERGENCY_CIRCUMSTANCE');--> statement-breakpoint
CREATE TYPE "public"."emergency_request_status" AS ENUM('granted', 'denied', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."emergency_review_outcome" AS ENUM('appropriate', 'inappropriate', 'referred');--> statement-breakpoint
CREATE TYPE "public"."facility_staff_status" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."facility_type" AS ENUM('hospital-emergency-department', 'pharmacy');--> statement-breakpoint
CREATE TYPE "public"."facility_verification_status" AS ENUM('pending', 'verified', 'rejected', 'suspended', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'emergency-department-staff' BEFORE 'facility-admin';--> statement-breakpoint
CREATE TABLE "emergency_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"provider_type" "facility_type" NOT NULL,
	"reason_code" "emergency_reason_code" NOT NULL,
	"status" "emergency_request_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"notification_channel_missing" boolean DEFAULT false NOT NULL,
	"priority_review" boolean DEFAULT false NOT NULL,
	CONSTRAINT "emergency_access_requests_fixed_ttl_check" CHECK ("emergency_access_requests"."status" <> 'granted' or ("emergency_access_requests"."granted_at" is not null and "emergency_access_requests"."expires_at" = "emergency_access_requests"."granted_at" + interval '30 minutes'))
);
--> statement-breakpoint
CREATE TABLE "emergency_access_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"review_due_at" timestamp with time zone NOT NULL,
	"reviewer_user_id" uuid,
	"outcome" "emergency_review_outcome",
	"reviewed_at" timestamp with time zone,
	"escalated_to_user_id" uuid,
	"escalated_at" timestamp with time zone,
	CONSTRAINT "emergency_access_reviews_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "emergency_access_reviews_decision_state_check" CHECK (("emergency_access_reviews"."reviewer_user_id" is null and "emergency_access_reviews"."outcome" is null and "emergency_access_reviews"."reviewed_at" is null) or ("emergency_access_reviews"."reviewer_user_id" is not null and "emergency_access_reviews"."outcome" is not null and "emergency_access_reviews"."reviewed_at" is not null)),
	CONSTRAINT "emergency_access_reviews_escalation_state_check" CHECK (("emergency_access_reviews"."escalated_to_user_id" is null and "emergency_access_reviews"."escalated_at" is null) or ("emergency_access_reviews"."escalated_to_user_id" is not null and "emergency_access_reviews"."escalated_at" is not null and "emergency_access_reviews"."escalated_to_user_id" is distinct from "emergency_access_reviews"."reviewer_user_id"))
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_type" "facility_type" NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"registration_number" varchar(128) NOT NULL,
	"registration_jurisdiction" varchar(128) NOT NULL,
	"verification_status" "facility_verification_status" DEFAULT 'pending' NOT NULL,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_staff_affiliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "facility_staff_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facility_staff_affiliations_role_check" CHECK ("facility_staff_affiliations"."role"::text in ('emergency-department-staff', 'pharmacy-staff', 'facility-admin'))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "emergency_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "emergency_access_requests" ADD CONSTRAINT "emergency_access_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_access_requests" ADD CONSTRAINT "emergency_access_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_access_requests" ADD CONSTRAINT "emergency_access_requests_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_access_reviews" ADD CONSTRAINT "emergency_access_reviews_request_id_emergency_access_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."emergency_access_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_access_reviews" ADD CONSTRAINT "emergency_access_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_access_reviews" ADD CONSTRAINT "emergency_access_reviews_escalated_to_user_id_users_id_fk" FOREIGN KEY ("escalated_to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_staff_affiliations" ADD CONSTRAINT "facility_staff_affiliations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_staff_affiliations" ADD CONSTRAINT "facility_staff_affiliations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emergency_access_requests_patient_created_idx" ON "emergency_access_requests" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "emergency_access_requests_provider_created_idx" ON "emergency_access_requests" USING btree ("requester_user_id","created_at");--> statement-breakpoint
CREATE INDEX "emergency_access_requests_facility_created_idx" ON "emergency_access_requests" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE INDEX "emergency_access_requests_expiry_idx" ON "emergency_access_requests" USING btree ("expires_at") WHERE "emergency_access_requests"."status" = 'granted';--> statement-breakpoint
CREATE INDEX "emergency_access_reviews_due_idx" ON "emergency_access_reviews" USING btree ("review_due_at","reviewed_at");--> statement-breakpoint
CREATE INDEX "emergency_access_reviews_reviewer_idx" ON "emergency_access_reviews" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_registration_idx" ON "facilities" USING btree ("registration_jurisdiction","registration_number");--> statement-breakpoint
CREATE INDEX "facilities_verification_status_idx" ON "facilities" USING btree ("verification_status");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_staff_affiliations_facility_user_idx" ON "facility_staff_affiliations" USING btree ("facility_id","user_id");--> statement-breakpoint
CREATE INDEX "facility_staff_affiliations_user_status_idx" ON "facility_staff_affiliations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "documents_emergency_visible_idx" ON "documents" USING btree ("patient_id","document_date") WHERE "documents"."emergency_visible" = true and "documents"."document_type" = 'prescription' and "documents"."status" = 'ready';