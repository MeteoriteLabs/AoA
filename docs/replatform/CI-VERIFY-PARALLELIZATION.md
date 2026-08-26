# CI hardening — parallelize `verify` (retire the §2.0 timeout)

**Not a re-platform ticket — a CI-platform task.** Lives here (not under `epics/*/tickets/`) so the
ticket-graph coverage checker does not require a `#### ID` node for it. Scoping only; the session
writes the full plan at Step 1.

## The problem, measured at tip

- `.github/workflows/pr.yml` `verify` is **ONE job**, `timeout-minutes: 60`, running `pnpm test:run`
  (`vitest run`) over the **entire monorepo** (`vitest.config.ts` `projects: [...23 projects...]`).
- The tree has **~165 `*.integration.test.ts`** files, each of which **boots embedded PostgreSQL**,
  plus ~1,724 unit test files. That volume — Postgres-heavy, one lane — is what pushes wall-clock
  past the 60-minute cap. It has hit the cap on 6+ consecutive runs (go-book §2.0).
- **After E4-F017** (Sprint 5 fixed the `refreshWorkerProfile` authority-writer contract), `verify`'s
  **only remaining red reason is the timeout itself** — a *volume* problem, not a failing test. That
  is the state that makes sharding a clean fix rather than a mask.

## Do NOT

- **Do NOT raise `timeout-minutes`.** The go-book §2.0 forbids it because it masks the regression.
  Sharding is the opposite: it distributes real load, and a genuinely hung test still hangs its own
  shard and surfaces.
- **Do NOT break the `ci-required` aggregator wiring.** `ci-required.needs` lists `verify` **by name**
  (`pr.yml:1317`), and its verdict is computed from `needs.*.result` + the `changes` output. A matrix
  job surfaces as several check runs; `needs.verify.result` aggregates them, but the interaction is
  subtle — **a mis-wire can let a shard failure pass through as pass-by-skip**, which is the exact
  silent-green failure the whole programme guards against. Prove a forced single-shard failure turns
  `ci-required` RED before landing.
- **Do NOT add a `paths`/`paths-ignore` trigger filter** (go-book CI notes) — route all conditional
  execution through `ci-required`.

## The fix (the session decides the exact shape and proves it)

Shard `verify` into a **parallel matrix** — the textbook fix and the direct answer to "in parallel":

```yaml
verify:
  strategy:
    fail-fast: false
    matrix: { shard: [1, 2, 3, 4] }
  timeout-minutes: <measured, well under 60 per shard — NOT raised>
  # ... same setup + pre-build steps ...
  - name: Run tests
    run: pnpm test:run -- --shard=${{ matrix.shard }}/4
```

Each shard runs a disjoint subset on its **own runner**, all concurrently; because each runner has
its own machine, embedded-PG instances stop contending across the split. Aggregate through
`ci-required` (verify `needs.verify.result` already collapses the matrix legs — verify that, and that
`fail-fast: false` still lets every shard report).

**Open choices the session measures and justifies:**
- **Shard count** — pick from the measured per-file timing so the slowest shard is comfortably under
  cap (4 is a starting guess, not a mandate). vitest `--shard` splits by file, so 165 embedded-PG
  files distribute across shards.
- **Whether to also split by kind** (fast unit lane vs slow embedded-PG lane) instead of / on top of
  count-sharding. Count-sharding is simpler and usually enough; justify whichever you pick.
- The pre-build steps (`worker-daemon`/`sandbox-e2b-provider` dist, etc.) run in **every** shard —
  confirm that is acceptable or hoist them.

**Diagnostic first (20 min, before sharding):** confirm the slowness is *volume*, not a single
pathological/hung test. `verify` went from ~40 min (green, `b296d9ee9`) to ~60 min around
2026-08-24; if one test went pathological, sharding hides it in a shard rather than fixing it. Name
what you find. (Sharding fixes the volume case cleanly either way.)

## Acceptance

- `verify` runs as a matrix; each shard completes **well under** its (un-raised) cap on a real run.
- Every shard's result folds into `ci-required`, and a **forced single-shard failure turns
  `ci-required` RED** (proven, not assumed) — no pass-by-skip.
- `fail-fast: false` so a red shard does not cancel the others (you want the full picture).
- Total test COUNT is unchanged (no files silently dropped) — the census/inventory guards stay green.
- go-book §2.0 and §5 updated: the timeout debt is retired (or, if the diagnostic found a real hang,
  that is filed as its own finding and §2.0 is narrowed to it).

## Non-goals

- Fixing any actual failing test (there is none after E4-F017; if the diagnostic finds one, file it).
- Touching the `e2e`/`e2e-pgvector`/keyed lanes — only `verify`.
