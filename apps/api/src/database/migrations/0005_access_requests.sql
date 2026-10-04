CREATE TYPE "access_request_status" AS ENUM ('pending', 'approved', 'denied', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "access_purpose" AS ENUM ('clinical-care', 'medication-review', 'vaccination-follow-up', 'continuity-of-care');--> statement-breakpoint
CREATE TYPE "access_scope" AS ENUM ('timeline', 'document:scan', 'document:lab', 'document:prescription', 'document:vaccination', 'document:discharge');--> statement-breakpoint
CREATE TABLE "access_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinician_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "source_qr_credential_id" uuid NOT NULL REFERENCES "qr_credentials"("id") ON DELETE RESTRICT,
  "purpose" "access_purpose" NOT NULL,
  "scope" jsonb NOT NULL,
  "status" "access_request_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  "decided_by_user_id" uuid REFERENCES "users"("id")
);--> statement-breakpoint
CREATE INDEX "access_requests_patient_status_idx" ON "access_requests" USING btree ("patient_id", "status");--> statement-breakpoint
CREATE INDEX "access_requests_clinician_idx" ON "access_requests" USING btree ("clinician_user_id");
