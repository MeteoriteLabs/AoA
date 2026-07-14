CREATE TABLE IF NOT EXISTS "user_entity_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_entity_follows_entity_type_check" CHECK (entity_type IN ('task', 'project', 'goal'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_question_continuation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer_version" integer NOT NULL,
	"target_run_kind" text NOT NULL,
	"target_agent_id" uuid,
	"target_conversation_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"last_error" text,
	"downstream_idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_question_continuation_status_check" CHECK (status IN ('pending', 'claimed', 'dispatched', 'failed', 'cancelled')),
	CONSTRAINT "work_question_continuation_target_kind_check" CHECK (target_run_kind IN ('heartbeat', 'internal_agent')),
	CONSTRAINT "work_question_continuation_answer_version_check" CHECK (answer_version > 0),
	CONSTRAINT "work_question_continuation_attempts_check" CHECK (attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "work_questions" DROP CONSTRAINT "work_questions_issue_id_issues_id_fk";
--> statement-breakpoint
ALTER TABLE "work_questions" DROP CONSTRAINT "work_questions_asking_agent_id_agents_id_fk";
--> statement-breakpoint
DROP INDEX "agent_wakeup_requests_company_idempotency_key_uq";--> statement-breakpoint
ALTER TABLE "work_questions" ALTER COLUMN "issue_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_questions" ALTER COLUMN "asking_agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ADD COLUMN "continuation_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "issue_identifier_snapshot" text;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "issue_title_snapshot" text;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "asking_agent_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "source_commander_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "user_entity_follows" ADD CONSTRAINT "user_entity_follows_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entity_follows" ADD CONSTRAINT "user_entity_follows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_question_continuation_requests" ADD CONSTRAINT "work_question_continuation_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_question_continuation_requests" ADD CONSTRAINT "work_question_continuation_requests_question_id_work_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."work_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_question_continuation_requests" ADD CONSTRAINT "work_question_continuation_requests_target_agent_id_agents_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_question_continuation_requests" ADD CONSTRAINT "work_question_continuation_requests_target_conversation_id_internal_agent_conversations_id_fk" FOREIGN KEY ("target_conversation_id") REFERENCES "public"."internal_agent_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_entity_follows_user_company_entity_uq" ON "user_entity_follows" USING btree ("user_id","company_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_entity_follows_company_entity_idx" ON "user_entity_follows" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_question_continuation_question_answer_uq" ON "work_question_continuation_requests" USING btree ("question_id","answer_version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_question_continuation_company_downstream_uq" ON "work_question_continuation_requests" USING btree ("company_id","downstream_idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_question_continuation_pending_retry_idx" ON "work_question_continuation_requests" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_question_continuation_company_question_idx" ON "work_question_continuation_requests" USING btree ("company_id","question_id");--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_source_commander_conversation_id_internal_agent_conversations_id_fk" FOREIGN KEY ("source_commander_conversation_id") REFERENCES "public"."internal_agent_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_asking_agent_id_agents_id_fk" FOREIGN KEY ("asking_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ia_runs_continuation_idempotency_uq" ON "internal_agent_runs" USING btree ("company_id","continuation_idempotency_key") WHERE continuation_idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_questions_source_commander_created_idx" ON "work_questions" USING btree ("source_commander_conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_wakeup_requests_company_idempotency_key_uq" ON "agent_wakeup_requests" USING btree ("company_id","idempotency_key") WHERE idempotency_key is not null and reason in ('max_turn_continuation_retry', 'issue_monitor_due', 'finish_successful_run_handoff', 'work_question_continuation');
