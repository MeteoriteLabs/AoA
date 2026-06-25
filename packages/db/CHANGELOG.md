# @paperclipai/db

## 1.0.1

### Patch Changes

- f11ee90: feat(db): add `0115_enable_pgvector.sql` preflight migration that runs `CREATE EXTENSION IF NOT EXISTS vector` ahead of any future vector-column migrations (Thread-Native Agent Coordination Pre-Task 0.5). Wrapped in `DO $$ ... EXCEPTION` so it no-ops on installs without pgvector (embedded-postgres bundle, CI postgres:16) and only enables the extension where the binary is available. Memory semantic-search paths remain gated by `probeDbCapabilities()`.
- 74ac332: fix(db): add `IF NOT EXISTS` to every `CREATE TABLE` / `CREATE INDEX` / `CREATE UNIQUE INDEX` in the 9 migration files that pre-dated PR #121's fix on 0080. Prevents the half-applied-migration footgun in `applyPendingMigrationsManually` (`packages/db/src/client.ts:222`) where a partially-applied migration with one new + one existing object would permanently wedge the chain. Adds a regression test that fails CI on any future migration that introduces the same bug class. Closes C14.
- 7c8955e: feat(db): add HNSW index on `memory_items.embedding` for fast cosine-distance semantic memory retrieval. Closes C12 (the index was claimed in CLAUDE.md but never existed). Conditional on pgvector being installed; partial index skips NULL rows. HNSW chosen over IVFFlat for AoA's incremental ingest pattern. CLAUDE.md updated to reflect reality.
- Updated dependencies [adc7c55]
- Updated dependencies [1f11d51]
- Updated dependencies [f6ad056]
- Updated dependencies [a94df0d]
- Updated dependencies [44fbf74]
  - @armyofagents/shared@1.0.1

## 0.2.7

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.7

## 0.2.6

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.6

## 0.2.5

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.5

## 0.2.4

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.4

## 0.2.3

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.3

## 0.2.2

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.2

## 0.2.1

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.1
