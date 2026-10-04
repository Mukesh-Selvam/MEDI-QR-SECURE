CREATE TYPE "qr_credential_status" AS ENUM ('active', 'rotated', 'revoked');--> statement-breakpoint
CREATE TABLE "qr_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "status" "qr_credential_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rotated_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "qr_credentials_token_hash_length_check" CHECK (length("token_hash") = 64)
);--> statement-breakpoint
CREATE UNIQUE INDEX "qr_credentials_token_hash_idx" ON "qr_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "qr_credentials_patient_id_idx" ON "qr_credentials" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_credentials_one_active_per_patient_idx" ON "qr_credentials" USING btree ("patient_id") WHERE "status" = 'active';
