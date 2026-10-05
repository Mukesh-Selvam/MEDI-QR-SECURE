CREATE TABLE "emergency_profiles" (
	"patient_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_payload" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"kms_key_id" varchar(255) NOT NULL,
	"iv" varchar(64) NOT NULL,
	"auth_tag" varchar(64) NOT NULL,
	"sha256_plaintext" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emergency_profiles" ADD CONSTRAINT "emergency_profiles_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_profiles" ADD CONSTRAINT "emergency_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emergency_profiles_enabled_idx" ON "emergency_profiles" USING btree ("enabled");