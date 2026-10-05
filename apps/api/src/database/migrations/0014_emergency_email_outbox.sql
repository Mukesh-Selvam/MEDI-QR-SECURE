CREATE TABLE "notification_email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_email_outbox_notification_id_unique" UNIQUE("notification_id"),
	CONSTRAINT "notification_email_outbox_attempts_check" CHECK ("notification_email_outbox"."attempts" >= 0),
	CONSTRAINT "notification_email_outbox_terminal_state_check" CHECK (not ("notification_email_outbox"."sent_at" is not null and "notification_email_outbox"."failed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "notification_email_outbox" ADD CONSTRAINT "notification_email_outbox_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_email_outbox_due_idx" ON "notification_email_outbox" USING btree ("next_attempt_at","locked_until");