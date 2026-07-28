ALTER TABLE "commander_login_challenges" ADD COLUMN IF NOT EXISTS "resource_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commander_login_challenges_active_resource_uq" ON "commander_login_challenges" USING btree ("resource_key") WHERE "commander_login_challenges"."status" = 'pending' AND "commander_login_challenges"."resource_key" IS NOT NULL;
