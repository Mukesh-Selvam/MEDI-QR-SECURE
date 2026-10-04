ALTER TYPE "access_request_status" ADD VALUE IF NOT EXISTS 'revoked';--> statement-breakpoint
CREATE TYPE "consent_status" AS ENUM ('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "access_request_id" uuid NOT NULL UNIQUE REFERENCES "access_requests"("id") ON DELETE CASCADE,
  "patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "grantee_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "scope" jsonb NOT NULL,
  "purpose" "access_purpose" NOT NULL,
  "status" "consent_status" DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "consents_patient_status_idx" ON "consents" USING btree ("patient_id", "status");--> statement-breakpoint
CREATE INDEX "consents_grantee_idx" ON "consents" USING btree ("grantee_user_id");--> statement-breakpoint
CREATE INDEX "consents_expiry_idx" ON "consents" USING btree ("expires_at");
