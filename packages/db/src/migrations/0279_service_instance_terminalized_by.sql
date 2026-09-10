-- SVC-005a - WHO drove a service instance terminal, and it is a FENCE INPUT rather than
-- telemetry.
--
-- E9-F009 recorded the gap and named this half open: `service_instances` carried `status`
-- and `updated_at` and nothing that said WHO moved the row, so a worker that REPORTED itself
-- gone and a control plane that GAVE UP on a worker it could not reach were indistinguishable
-- in durable state. That distinction is load-bearing for the generation rollout fence: only
-- the first is a WITNESS that the old generation stopped; the second leaves E9-F007's window
-- open, where the old worker may still be running and performing external effects.
--
-- ONE nullable column and ONE CHECK. Everything below is `db:generate` output apart from the
-- C14 class (a) idempotency guards, which drizzle-kit cannot emit and which this file needs
-- for the same measured reason 0275 and 0278 state: migration-idempotency's static check
-- matches only /^\s*CREATE (UNIQUE )?(TABLE|INDEX)\s+"/, so a bare `ADD COLUMN` is covered by
-- NO static check at all and a re-apply raises 42701, and a bare `ADD CONSTRAINT` raises
-- 42710. No C14 class (b) block is involved: `service_instances` is an already-registered
-- relation whose grants, RLS and policy are in place, and adding a column to it changes no
-- ACL.
--
-- NULLABLE, AND WITH NO DEFAULT, deliberately, and the reason is the same fail-closed one
-- 0278 gives for `last_observed_at`. A DEFAULT would FORGE AN AUTHOR. For a live row NULL
-- means "not terminalized"; for a terminal row it means "terminalized before this column
-- existed", and the fence must read that as UNKNOWN -- which is NOT-A-WITNESS, so an
-- unattributable terminal row STALLS a cross-generation placement rather than admitting it.
-- The fail-closed direction is the whole point of the column.
--
-- NO BACKFILL, and it is safe to omit rather than merely convenient. `service_instances` had
-- ZERO production writers until SVC-002 (0275) and no route could create a service until
-- SVC-007a, so a deployment that has run neither has an EMPTY table; and where rows do exist,
-- NULL is the correct and conservative value for them -- inventing 'worker_event' for a row
-- nobody witnessed is exactly the forged author this column exists to prevent.
--
-- NO NEW INDEX. The fence's read is per (organization_id, service_id) over that service's
-- instances -- `service_instances_service_idx` on (service_id) plus the organization
-- predicate serves it, and the row count per service is bounded by one live instance plus its
-- terminal history. Re-measure with EXPLAIN when a service has accumulated a long restart
-- history (SVC-004 owns that); the fix would be one db:generate index on
-- (organization_id, service_id, generation).
ALTER TABLE "service_instances" ADD COLUMN IF NOT EXISTS "terminalized_by" text;--> statement-breakpoint
-- The three authors, spelled once in the database. Reconciled against the server-side
-- constant `SERVICE_INSTANCE_TERMINAL_AUTHORS` by an assertion that asserts set EQUALITY, so
-- an author added on one side and not the other is caught rather than silently storable.
DO $$ BEGIN
 ALTER TABLE "service_instances" ADD CONSTRAINT "service_instances_terminalized_by_check" CHECK (terminalized_by IS NULL OR terminalized_by IN ('worker_event', 'liveness_deadline', 'control_plane_backstop'));
EXCEPTION
 -- 0275's lesson, applied to a CHECK rather than a FK: catch BOTH codes. A CHECK replay
 -- raises duplicate_object (42710); duplicate_table (42P07) is caught too because catching
 -- only one code is what made 0264 non-idempotent.
 WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
