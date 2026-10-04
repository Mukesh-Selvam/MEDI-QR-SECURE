CREATE TYPE "public"."audit_outcome" AS ENUM('SUCCESS', 'FAILURE', 'DENIED');--> statement-breakpoint
CREATE TYPE "public"."guardianship_relationship" AS ENUM('mother', 'father', 'legal_guardian');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('patient', 'guardian', 'clinician', 'facility-admin', 'pharmacy-staff', 'platform-admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'pending_verification');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'rejected', 'revoked');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_role" varchar(50),
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"outcome" "audit_outcome" NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"user_agent" varchar(255),
	"integrity_hash" varchar(64) NOT NULL,
	"previous_hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinicians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"registration_number" varchar(100) NOT NULL,
	"state_medical_council" varchar(100) NOT NULL,
	"qualification" varchar(100),
	"specialization" varchar(100),
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinicians_registration_number_unique" UNIQUE("registration_number")
);
--> statement-breakpoint
CREATE TABLE "guardianships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guardian_patient_id" uuid NOT NULL,
	"ward_patient_id" uuid NOT NULL,
	"relationship" "guardianship_relationship" NOT NULL,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"proof_document_id" varchar(255),
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"health_id" varchar(64) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"date_of_birth" varchar(10),
	"gender" varchar(20),
	"blood_group" varchar(10),
	"phone_hash" varchar(64) NOT NULL,
	"encrypted_phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_health_id_unique" UNIQUE("health_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" varchar(64) NOT NULL,
	"device_info" varchar(255) DEFAULT 'Unknown Device',
	"ip_address" varchar(45) DEFAULT '127.0.0.1',
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keycloak_id" varchar(255),
	"phone" varchar(20),
	"email" varchar(255),
	"role" "user_role" DEFAULT 'patient' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinicians" ADD CONSTRAINT "clinicians_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinicians" ADD CONSTRAINT "clinicians_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_guardian_patient_id_patients_id_fk" FOREIGN KEY ("guardian_patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_ward_patient_id_patients_id_fk" FOREIGN KEY ("ward_patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_timestamp_idx" ON "audit_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "clinicians_user_id_idx" ON "clinicians" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "clinicians_verified_idx" ON "clinicians" USING btree ("is_verified");--> statement-breakpoint
CREATE INDEX "guardianships_guardian_idx" ON "guardianships" USING btree ("guardian_patient_id");--> statement-breakpoint
CREATE INDEX "guardianships_ward_idx" ON "guardianships" USING btree ("ward_patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_health_id_idx" ON "patients" USING btree ("health_id");--> statement-breakpoint
CREATE INDEX "patients_phone_hash_idx" ON "patients" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "patients_user_id_idx" ON "patients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_refresh_hash_idx" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_keycloak_id_idx" ON "users" USING btree ("keycloak_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");