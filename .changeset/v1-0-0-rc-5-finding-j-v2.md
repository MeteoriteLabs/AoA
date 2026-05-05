---
"aoa": patch
---

Finding J v2 — Memory item creation restored on pgvector-free installs.

rc.2's Finding J fix (conditional `embedding` column projection) covered SELECT/UPDATE/RETURNING paths but missed the primary INSERT path. Drizzle 0.38 enumerates every schema column in the generated INSERT statement — including `embedding` — even when the caller never supplies a value. On installs without pgvector the column physically doesn't exist, so every `POST /api/companies/:cid/memory` 500'd with `column "embedding" of relation "memory_items" does not exist`.

Routed the create through a new `buildMemoryInsert()` helper in `memory-projection.ts` that emits the INSERT via a Drizzle `sql` template, omitting `embedding` from both the column list and the RETURNING projection when `hasVectorSupport` is false. JSON-serializes jsonb columns (tags) with an explicit `::jsonb` cast so empty arrays don't expand to invalid `()` syntax.

Added `memory-insert-no-pgvector.test.ts` with four guards (column list omits embedding when hasVector=false, column list includes embedding when hasVector=true, empty tags serialize as jsonb parameter, RETURNING aliases return camelCase keys) to prevent regression.

Validated end-to-end on a fresh embedded-postgres instance: `POST /api/companies/:cid/memory → 201`, `GET → 200` with new item, `/TES/memory` UI renders the item with tags + layer.
