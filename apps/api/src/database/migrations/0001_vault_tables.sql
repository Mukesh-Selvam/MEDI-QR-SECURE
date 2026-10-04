CREATE TYPE "public"."document_scan_status" AS ENUM('pending', 'scanning', 'clean', 'infected', 'scan_failed');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('quarantined', 'ready', 'deleted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('scan', 'lab', 'prescription', 'vaccination', 'discharge');--> statement-breakpoint
CREATE TYPE "public"."upload_source" AS ENUM('patient-uploaded', 'facility-verified');--> statement-breakpoint
CREATE TABLE "document_crypto_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"wrapped_dek" text NOT NULL,
	"kms_key_id" varchar(255) NOT NULL,
	"algorithm" varchar(32) DEFAULT 'aes-256-gcm' NOT NULL,
	"iv" varchar(32) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"sha256_plaintext" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_crypto_keys_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"storage_bucket" varchar(128) NOT NULL,
	"uploader_id" uuid NOT NULL,
	"sha256_plaintext" varchar(64) NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"upload_source" "upload_source" NOT NULL,
	"document_type" "document_type" NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"storage_bucket" varchar(128) NOT NULL,
	"mime_type" varchar(64) NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"status" "document_status" DEFAULT 'quarantined' NOT NULL,
	"scan_status" "document_scan_status" DEFAULT 'pending' NOT NULL,
	"scan_completed_at" timestamp with time zone,
	"scan_threat_name" varchar(255),
	"document_date" timestamp with time zone,
	"facility_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "fhir_document_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"resource" jsonb NOT NULL,
	"fhir_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fhir_document_references_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "fhir_document_references_fhir_id_unique" UNIQUE("fhir_id")
);
--> statement-breakpoint
ALTER TABLE "document_crypto_keys" ADD CONSTRAINT "document_crypto_keys_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fhir_document_references" ADD CONSTRAINT "fhir_document_references_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_crypto_keys_document_id_idx" ON "document_crypto_keys" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_versions_document_id_idx" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_patient_id_idx" ON "documents" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "documents_uploader_id_idx" ON "documents" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX "documents_document_date_idx" ON "documents" USING btree ("document_date");--> statement-breakpoint
CREATE INDEX "documents_scan_status_idx" ON "documents" USING btree ("scan_status");--> statement-breakpoint
CREATE UNIQUE INDEX "fhir_doc_refs_document_id_idx" ON "fhir_document_references" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fhir_doc_refs_fhir_id_idx" ON "fhir_document_references" USING btree ("fhir_id");