# SVC-004 — Service checkpoint policy + consumer (design stub)

**Status:** filed 2026-09-20 (founder-authorized). Build **DEFERRED** — migration-gated (see below).
**Owns:** the `checkpoint` half of E9-F008 (the checkpoint control-command producer + its worker-side consumer) and the checkpoint/restart policy E9-F004's residual references.

## Why this file exists now

`E9-F008` and `E9-F004`'s route (a) name SVC-004 as the owner of the checkpoint mechanism, but no SVC-004 file existed on disk — so `check-finding-ownership.mjs` could not resolve the owner without tripping `owner_ticket_missing`. This stub gives those findings a valid, non-completed owner id (there is deliberately **no** `SVC-004-result.md`, so the ownership guard treats SVC-004 as open, not complete). Creating it was authorized in the 2026-09-20 ruling sitting.

## Scope (when unblocked)

1. **Widen `job_control_commands_kind_check`** to admit the `checkpoint` command kind (`packages/db/src/schema/job_control_commands.ts`). This is a plain CHECK-constraint DDL that drizzle-kit provably emits → it **MUST be `db:generate` output** (Critical Rule 1; not a C14 hand-authored exemption). A `checkpoint` command row cannot even be persisted until this lands.
2. **`requestCheckpoint` producer** — a repo method sibling of the shipped `requestDrain` (SVC-005b, `packages/db/src/repositories/tenant/job-control.ts`): same lease→attempt→job lock order, monotonic per-lease `command_seq`, `(org,lease,command_id)` idempotency, frozen `checkpoint` body `{...base, commandKind:'checkpoint', deadline}` (`transport.ts` `controlCommandV1Schema` checkpoint variant), no job/attempt status transition. Widen `GovernedControlCommandInput.commandKind` (today admits only `product_approval_result`|`runtime_decision_result`).
3. **Worker consumer arm** — `applyOneControlCommand` (`packages/worker-daemon/.../lease-renewal.ts`) gains a `checkpoint` arm wiring into the provider checkpoint op that already exists (`effect-authority.ts` / `provider.ts`). Without this the producer is inert.
4. **Checkpoint/restart policy** — the SVC-004 mode/policy E9-F004's restart-policy residual depends on.

## The blocker (why it is DEFERRED)

Step 1 needs `db:generate`/drizzle-kit, which cannot run in a `node_modules`-less checkout (this program's default worktree hits deep-OneDrive `ENAMETOOLONG` on install). The founder deferred all migration-requiring items in the 2026-09-20 sitting. When a checkout that can run `pnpm install` + `pnpm db:generate` is available, this ticket becomes buildable — batch step 1 with any other pending CHECK migration under ONE session holding the migration slot (drizzle `NNNN_` numbering serializes).

Until then, `graceful_stop` (the OTHER E9-F008 producer, which needs **no** migration — `graceful_stop` is already in the CHECK) is the buildable half and is owned by the Session-1 E9-lifecycle track.
