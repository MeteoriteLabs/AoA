ALTER TABLE "companies" ADD COLUMN "human_question_sla_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "human_question_sla_hours" integer;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "sla_duration_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "sla_source" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "sla_source_id" uuid;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "due_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "sla_breached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "escalation_recipient_user_id" text;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_escalation_recipient_user_id_user_id_fk" FOREIGN KEY ("escalation_recipient_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_questions_open_due_at_idx" ON "work_questions" USING btree ("status","due_at");
