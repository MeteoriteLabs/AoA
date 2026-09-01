# BLOCKER E-2 + E-3 — what should CLOSURE mean?

> **Status: DESIGN, revision 1. Not reviewed, not built.**
> Predecessor: [Units 1.6+1.7](./2026-09-01-unit-1-7-definer-grantee-plan.md) fixed **E-1** and
> merged as `c7ead3a73` (PR #333). The canary is still gated shut.
> Terrain: [§9e.2.2](./2026-08-31-campaign-blockers-and-fleet-terrain.md).

Every claim in §1 was read out of the tree at `c7ead3a73` and is cited. Nothing here is inherited
from an earlier summary — including my own, because two of the four facts below are **worse than
previously reported**.

---

## 1. Verified terrain

### 1.1 E-2 is bigger than filed: the whole WRITING HALF is orphaned

The filed defect was "`reconcileCompanyLegacyResources` has zero non-test callers". True — but
incomplete. Its **store** is orphaned too:

| Symbol | Definition | Non-test callers |
|---|---|---|
| `reconcileCompanyLegacyResources` | `legacy-resource-reconciliation.ts:324` | **0** (only `legacy-resource-reconciliation.test.ts`) |
| `createDrizzleReconciliationStore` | `legacy-resource-reconciliation-store.ts:23` | **0** (two comments + one `vi.mock`) |

So `legacy_resource_reconciliation` is **never written in production**. The gate reads it
(`canary-preflight-store.ts:63`), `assertClosure` finds every inventory key unmapped, and the answer
is `reconciliation_incomplete` forever.

★ This is the [[checks-that-nothing-runs]] class again, one layer deeper than the report said.
**Wiring a caller to the pass is not enough — the pass has no wired store to drive.**

### 1.2 E-3: the asymmetry is TWO mechanisms, not one

The gate re-derives its inventory from live rows — *every* lease the company currently holds,
whatever its status (`canary-preflight.ts:115-122`, `:141`). The pass's inventory
(`legacy-resource-reconciliation.ts:340-368`) differs in two independent ways:

1. **Post-pass leases.** `environmentService.acquireLease` inserts a new `environment_leases` row on
   every legacy acquisition (`environments.ts:141-165`), reached from three sites in
   `environment-runtime.ts` (`:219`, `:578`, `:636`). Any lease created after the pass has no record
   → `unmapped` → refuse.
2. **Lost-CAS paused rows.** On a lost `casClaimPaused` the pass `continue`s
   (`legacy-resource-reconciliation.ts:347-350`) — recording **nothing**. The row still exists, so
   the gate counts it, and it has no record → `unmapped` → refuse.

(1) alone makes the gate unopenable on any box with traffic. `canary-preflight.ts:16-19` calls this
"self-healing in the safe direction". It is safe. It is also **permanently shut**, which is not a
gate but a wall.

### 1.3 The pass cannot run as `aoa_operator` today

The crosswalk's own security model (`legacy_resource_reconciliation.ts:11-22`, migration
`0256_dizzy_bedlam.sql:69-102`) makes this an **operator** pass: `aoa_operator` holds
`SELECT, INSERT, UPDATE` (no DELETE); `aoa_app` holds `SELECT` only, behind the inverted qual
`current_setting('aoa.organization_id', true) IS NULL`.

But the pass must first *read* `environment_leases`, `environments`, and the
`runtime_provider_keys`→`company_secret_versions` chain — and **neither serving role holds any grant
on those four tables.** That is precisely why E-1 needed owner-owned `SECURITY DEFINER` functions.
None of the four appears anywhere in the authority manifest (`job-control-legacy-grants.ts`), which
is an exact allowlist, not a partial one.

★ Worse, the pass also **writes** to `environment_leases`: `casClaimPaused` →
`expireLeaseIfPaused` (`environments.ts:310-327`) flips `paused → expired` and stamps
`releasedAt`/`cleanupStatus`. So running the pass **destroys warm snapshots as a side effect**.

**Wiring the pass to `operatorDb` as it stands fails with 42501 on its first read.** This is the
E-1 defect a second time, in the writer instead of the reader.

### 1.4 One constraint that will bite the build

`JOB_CONTROL_LEGACY_GRANTS` (`job-control-legacy-grants.ts:49`) is **not a grant list** — `rls-tenant.ts`
reconstructs the bodies of already-applied migrations 0213/0214 by walking it, so adding a table
there retroactively rewrites two immutable migrations and reds a byte-identity test ~30 minutes into
`verify`. Two prior lanes hit this. **A new grant goes in its own `*_GRANTS` constant.**

### 1.5 What has NEVER run is free to change

The pass has zero production callers and has never executed against a real database. Its semantics
are asserted only by `legacy-resource-reconciliation.test.ts`. **Changing them costs test churn, not
operational risk.** That legitimately widens the design space, and §4 spends it.

---

## 2. The question

Not *"who calls the reconciler"*. That framing produces a caller, a green test, and a gate that is
still shut — because §1.2(1) is untouched by having a caller.

The real question is **what set must be closed** for the acceptance clause to be satisfied:

> "MIG-008 has reconciled legacy environment leases/resources and moved provider-control authority
> **before the rollout flag can transfer the first live execution**." (program-design.md:794)

A lease created *after* the reconciliation decision is not an unreconciled *legacy* resource. It is
ordinary current traffic on the legacy path, and it drains on the legacy path — the rollout flag
only steers **new** ownership decisions. Requiring it to carry a crosswalk record is a category
error, and it is the whole of E-3.

**Closure should mean: every legacy resource that existed as of the reconciliation decision point is
accounted for.** The decision point is the thing to pin.

---

## 3. Two answers that look right and are not

### 3.1 `max(records.created_at)` as the watermark — FAILS OPEN

Tempting, needs no schema. But the last record is written at pass *end* (T1), while the pass's
snapshot was taken at *start* (T0). A lease created in `[T0, T1]` is invisible to the pass, has no
record, and sits **below** the watermark — excluded from the gate's inventory. That is a genuine
legacy resource skipped silently. The boundary must be the snapshot instant, not the last write.

### 3.2 A stored "reconciled: true" attestation — the thing this module refuses to trust

`canary-preflight.ts:12-19` is explicit: closure is *computed, not stored*, and the gate re-derives
it "rather than trusting a flag". An attestation carrying a verdict is that flag.

**A watermark is not a verdict.** It narrows the *inventory*; the gate still recomputes closure over
it with MIG-008's own `assertClosure`. The property survives — but only if the stored value is a
boundary and never an outcome. Any reviewer will raise this; the answer is the distinction, and the
design must not blur it.

### 3.3 ★ And the clock trap underneath both

If the watermark comes from the DB and lease `created_at` comes from the app, they are two clocks.
`acquireLease` passes `createdAt: now` from JS (`environments.ts:140`, `:162`), so **today they
are**. A legacy lease on an app instance whose clock runs fast gets `created_at > W` and is
**excluded from the gate's inventory** — a real legacy resource waved through. Fail-open, in the
one direction that matters.

With both sides on the DB clock the hole closes, and closes *provably*: `now()` is transaction-start
time, so any lease committed before the pass began has `created_at < W` and is included. The
residual direction (a long transaction stamping `created_at < W` but committing after the pass) puts
an extra lease *into* the inventory → refuse → fail-closed. Acceptable.

**So the watermark is only sound if `acquireLease` stops stamping `created_at` from the app clock.**
That is not an implementation detail; it is load-bearing, and it must be tested as such.

---

## 4. The design

### 4.1 Option R — the pass becomes read-only

Drop `casClaimPaused` entirely. A paused row is recorded `mapped` (live legacy resource, hash-only,
left for drain) rather than CAS-claimed and recorded `terminal_cleanup`.

What this buys:

- **The 42501 problem shrinks to reads.** No `UPDATE` on `environment_leases` — so no definer
  function that mutates tenant data, and no table-level write grant to `aoa_operator`.
- **§1.2(2) disappears by construction.** There is no lost CAS, so there is no unrecorded row.
- **Invariant #2 gets stronger, not weaker.** The pass stops asserting terminality on a row that
  might resume, and stops destroying warm snapshots as a side effect of being consulted (§1.3).
- **It mirrors the shape that already worked.** Units 1.6+1.7 were "correct-layering, read-only
  first slice". The cleanup half is CLI-004's job at cutover, which is where it belonged.

What it costs: `skippedResumed` loses its meaning (one assertion, `legacy-resource-reconciliation.test.ts:233`),
and paused snapshots are no longer marked terminal *by the pass*. Per §1.5 that is test churn.

★ **Open:** a `mapped` record for a paused row carries `legacyStatus: 'paused'` — the status seen at
reconcile time. Honest, but a reader may take it for a live-active row. Recommend keeping the
observed status and carrying the distinction in `reason`. Flagged for review, not settled.

### 4.2 The reads move to owner authority, exactly as E-1 did

Three reads (`listLeases`, `platformDefaultEnv`, `currentKeyGeneration`) against tables neither
serving role can touch. `0267` already ships definer functions for **two** of them, org-bound and
granted to `aoa_operator`:

- `canary_preflight_evidence_leases(organizationId, companyId)` — but it projects `lease_id` only,
  and the pass needs the full `LegacyLeaseInput` to classify. **A new function is required**, not a
  reuse.
- `canary_preflight_evidence_scalars(...)` covers the default env + key generation and **is
  reusable as-is**.

So: one new `SECURITY DEFINER` function projecting the classification columns, manifested and
certified like the other three, `EXECUTE` to `aoa_operator` alone. The projection must be narrowed
to the fields `classifyLease` actually reads — the return type is the security boundary, and it
structurally cannot carry secret material.

★ The **grantee** is the argument, not the org parameter (Decision #122, 2026-09-01 amendment). Say
it that way; `p_organization_id` is caller-supplied and is defence in depth.

### 4.3 The watermark

- New column or marker recording the pass's **snapshot instant**, read from the DB (`now()`) *before*
  `listLeases`, written by the pass, per company.
- `acquireLease` stops passing `createdAt` so the column default (`defaultNow()`, DB clock) fires.
- The gate's inventory becomes `leases WHERE created_at <= W` for the company's latest completed
  pass; **no pass ⇒ no watermark ⇒ no inventory narrowing ⇒ refuse** (fail-closed, unchanged from
  today).
- `assertClosure` is untouched. The gate still recomputes.

### 4.4 The caller (E-2)

An **operator CLI command** under `server/src/cli/`, following the two existing precedents
(`verify-cp-am-keypair.ts`, `verify-e7-1-distributed-run.ts`, exposed as `pnpm verify:*`). Not an
HTTP route and not automatic: the crosswalk's security model calls this "a SERVER-SIDE
system/operator pass, NOT a per-tenant-request writer", and a cutover reconciliation is a deliberate
operator act. It binds `operatorDb`.

---

## 5. What must be true, or this fails open

Each of these is a test, not a note.

1. A legacy lease that existed before the pass is **never** excluded by the watermark. (The §3.3
   clock argument, pinned — including a test that reds if `acquireLease` reverts to the app clock.)
2. `no pass` and `pass but no watermark` both **refuse**.
3. ★ **The watermark WIDENS what passes.** More companies now close vacuously — a company whose only
   leases postdate the pass has an empty in-scope inventory and closes. That is the intended
   semantics, and it must be stated where it is summarised, not discovered later.
4. A record tagged with a superseded key generation still refuses (`canary-preflight.ts:157-171`,
   unchanged) — the watermark must not become a way around the credential-authority check.
5. The new definer function is manifested, certified at boot, and grants `EXECUTE` to no role
   containing `aoa_app` (the condition enforced in `security-definer-manifest.test.ts`).
6. The pass performs **no** write to `environment_leases`. Asserted structurally, by the store seam
   not exposing one.

---

## 6. Not in scope

- **Unit 2 / capability** (E7-F003): MCP surface, instructions bundle, workspace, output capture.
  Still unowned, still not started. Fixing E-2/E-3 opens the gate; it does not make an agent capable.
- CLI-004's cutover teardown of paused snapshots. Option R hands it back; it does not implement it.
- The two audit findings still open from PR #333: Decision #122 condition 3 has no checker, and a
  *new* unmanifested definer function goes undetected on flag-off boots.

---

## 7. Open questions for the review round

1. **Option R vs keeping the CAS.** R is recommended. The counter-argument is that MIG-008's design
   deliberately claimed paused rows so cutover found no ambiguous state. Is deferring that to CLI-004
   a retreat or a correction? (§1.5 says the cost is test churn; that is an argument about cost, not
   about intent.)
2. **Watermark storage shape** — a column on a new per-company pass marker, or a new table? A marker
   row per (company, pass) also gives an audit trail of *when* reconciliation was asserted.
3. **`legacyStatus` on a paused-but-mapped record** (§4.1).
4. **Does the gate need the watermark per company or per organization?** Closure is company-scoped;
   the flag is org-scoped. A per-company watermark means an org can be gated on passes taken at
   different instants. Probably fine — closure is asserted per company — but it is exactly the kind
   of scope seam that produced the org-vs-company defect in `0266`.
