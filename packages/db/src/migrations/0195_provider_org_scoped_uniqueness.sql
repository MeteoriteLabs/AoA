-- 0195 (multi-tenant cloud hardening): org-scope the two provider uniqueness
-- constraints introduced by 0190. Before this, provider_assignments_scope_uq and
-- provider_connections_identity_uq omit organization_id, so org-level rows
-- (company_id NULL) collapse to ONE row per provider per INSTALL under
-- NULLS NOT DISTINCT -- a second tenant could never mint its own org_default
-- assignment or org-level connection. Adding organization_id as the LEADING
-- column strictly WIDENS the key (can only reduce collisions), so it is safe on
-- populated data. Idempotent: DROP ... IF EXISTS + guarded ADD (duplicate_object).
ALTER TABLE "provider_assignments" DROP CONSTRAINT IF EXISTS "provider_assignments_scope_uq";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_assignments" ADD CONSTRAINT "provider_assignments_scope_uq" UNIQUE NULLS NOT DISTINCT("organization_id","company_id","provider","scope_type","scope_id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "provider_connections" DROP CONSTRAINT IF EXISTS "provider_connections_identity_uq";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_identity_uq" UNIQUE NULLS NOT DISTINCT("organization_id","company_id","provider","auth_method","owner_user_id","execution_target_id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;
