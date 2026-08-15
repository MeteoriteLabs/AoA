CREATE TABLE "worker_admission_rate_limits" (
	"organization_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_admission_rate_limits_pkey" PRIMARY KEY("organization_id","window_start")
);
--> statement-breakpoint
ALTER TABLE "worker_admission_rate_limits" ADD CONSTRAINT "worker_admission_rate_limits_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;