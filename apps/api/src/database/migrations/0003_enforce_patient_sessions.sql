ALTER TABLE "sessions" ADD COLUMN "access_token_id_hash" varchar(64);--> statement-breakpoint
UPDATE "sessions" SET "revoked_at" = COALESCE("revoked_at", now()) WHERE "access_token_id_hash" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_access_token_id_hash_idx" ON "sessions" USING btree ("access_token_id_hash");