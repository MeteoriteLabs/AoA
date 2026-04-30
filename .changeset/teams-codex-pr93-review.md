---
"aoa": patch
---

Post-review polish for Teams feature (Codex review on PR #93 + Windows manual smoke):

**Codex P1-1 — Export URL mismatch:** `TeamDetail.tsx` `handleExport`
was navigating to `/api/companies/${cid}/teams/${id}/export`, but the
server route is `GET /api/teams/:id/export` (no `/companies/:cid`
prefix because team UUIDs are globally unique). The mis-prefixed URL
returned 404 on click. Fixed by dropping the `/companies/${cid}`
segment so the URL matches the server route.

**Codex P2-1 — Import preflight throws plain Error → generic 500:**
`teamImportService.install` had three preflight validation checks
(`missing skills`, `>1 leads`, `slug already exists`) that threw
`new Error(...)`. The global error handler only maps HttpError /
ZodError to client status codes, so plain Errors fell through to
"Internal server error" instead of the actionable 400 message.
Fixed by converting the three preflight throws to `badRequest(...)`
(matches the existing pattern at line 84 of the same file). The 4th
plain Error at line 261 (resolution-says-replace-but-no-collision)
remains as plain Error because that's an internal invariant
violation that should genuinely 500.

**Codex P2-2 — `api.delete<void>` blew up on 204 No Content:** The
shared `request<T>` helper always called `res.json()` on success, but
204 has an empty body — `res.json()` throws SyntaxError. Affects any
DELETE route that returns 204 (archive, removeMember). Fixed by
short-circuiting on `res.status === 204` to resolve `undefined` (cast
to T) before attempting JSON parse. `api.delete<void>` now works as
intended; `api.delete<X>` callers receive `undefined` rather than a
parse error.

**Manual smoke discovery — Windows postgres WIN1252 encoding:** Local
UI smoke on Windows discovered that the Slice 3 "Regenerate
coordination" action returned 500 with
`character with byte sequence 0xe2 0x86 0x92 in encoding "UTF8" has
no equivalent in encoding "WIN1252"`. Root cause: on Windows,
`embedded-postgres` runs `initdb` with the OS locale, producing a
cluster whose storage encoding is WIN1252 — physically unable to
store UTF-8 characters outside Latin-1 (right-arrow `→`, em-dashes,
emoji, CJK). Three layers of fix:

  1. `server/src/index.ts` — `initdbFlags: ["--encoding=UTF8",
     "--locale=C"]` passed to EmbeddedPostgres so new clusters
     initialize as UTF-8 + locale=C. Existing WIN1252 clusters
     need to be re-init'd or pg_dump/restore'd to switch.
  2. `packages/db/src/client.ts` — `connection: { client_encoding:
     "UTF8" }` passed to postgres-js. Defensive: explicit client
     encoding regardless of server-side defaults.
  3. `server/src/services/team-scaffolder.ts` — replace `→` with
     `->` and `—` with `--` in scaffoldInitial +
     regenerateAutoContent output. ASCII-only output is portable
     across cluster encodings.

All four fixes are scoped to the Teams feature paths. Existing tests
remain green (38/38 teams-service tests pass).
