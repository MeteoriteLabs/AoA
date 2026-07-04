-- H4 suggestion dedupe: stable per-finding identity + partial unique index.
--
-- Coordinated changes shipped together:
--   1. New "dedupe_key" column on suggestions (nullable). runAllDetectors now
--      populates it as `${category}:${patternId}` (fallback
--      `${category}:sha256(action_payload)`) paired with `.onConflictDoNothing()`
--      so duplicate pending inserts across concurrent detector runs (Home load,
--      POST /detect, memory-feedback, Commander analysis) are rejected at the DB
--      layer instead of racing to two rows.
--   2. Partial unique index "suggestions_pending_dedupe_idx" — fires only while a
--      row is pending AND dedupe_key is not NULL, so a dismissed/accepted/expired
--      row may legitimately share a dedupe_key with the next pending suggestion.
--      NULL dedupe_key rows are excluded entirely (legacy rows + any detector
--      output without a stable key participate only via the in-memory pre-filter
--      and the runtime self-heal in runAllDetectors, never the DB index).
--      Precedent: agent_wakeup_requests_dedup_key_queued_uq (migration 0119).
--
-- ⚠️ Pre-index duplicate collapse (P1-1): drizzle-kit emits a bare
-- CREATE UNIQUE INDEX with no data step, and Postgres ABORTS index creation if
-- existing rows already violate it. Live instances carry pending duplicate pairs
-- minted by the old read-then-insert TOCTOU race (e.g. two identical
-- "No identity memory exists yet" suggestions). The app-runtime self-heal only
-- runs on the next detector pass — too late, migrations run first. So we collapse
-- the existing pending duplicates HERE, BEFORE the index, keeping the NEWEST
-- pending row per (company_id, category, action_payload) — which IS the duplicate
-- signature: identical category + payload, differing only by id — and marking the
-- older rows dismissed. (Editing a drizzle-GENERATED migration is allowed;
-- Rule #1 bans hand-authored raw-SQL migration FILES, not this. Precedent: the
-- hand-edited data steps in migrations 0092/0119.)
--
-- Backfill: after the collapse we set dedupe_key on the surviving pending rows so
-- the partial unique index immediately guards them. The key is category-scoped
-- (`category || ':' || md5(action_payload::text)`) — deterministic per
-- (category, payload), NULL-safe (a NULL action_payload yields '<category>:' ||
-- md5('null')). Rows the collapse already dismissed are left with a NULL
-- dedupe_key (excluded from the index, harmless); the next detector pass's
-- self-heal backfills any that later reappear.

-- 1. Collapse existing pending duplicates (keep newest per company/category/payload).
UPDATE "suggestions" AS s
SET "status" = 'dismissed', "updated_at" = now()
WHERE s."status" = 'pending'
  AND EXISTS (
    SELECT 1 FROM "suggestions" AS n
    WHERE n."company_id" = s."company_id"
      AND n."category" = s."category"
      AND n."action_payload" IS NOT DISTINCT FROM s."action_payload"
      AND n."status" = 'pending'
      AND (n."created_at" > s."created_at" OR (n."created_at" = s."created_at" AND n."id" > s."id"))
  );
--> statement-breakpoint
-- 2. Add the column.
ALTER TABLE "suggestions" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
-- 3. Backfill dedupe_key on the surviving pending rows (deterministic per
--    category+payload) so the partial unique index guards them immediately.
UPDATE "suggestions"
SET "dedupe_key" = "category" || ':' || md5(coalesce("action_payload"::text, 'null'))
WHERE "status" = 'pending' AND "dedupe_key" IS NULL;
--> statement-breakpoint
-- 4. Create the partial unique index (now safe — no pending dup violations remain).
CREATE UNIQUE INDEX "suggestions_pending_dedupe_idx" ON "suggestions" USING btree ("company_id","dedupe_key") WHERE status = 'pending' AND dedupe_key IS NOT NULL;
