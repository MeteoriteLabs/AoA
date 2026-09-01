# BLOCKER E-2 + E-3 — what should CLOSURE mean?

> **Status: DESIGN, revision 2 — reviewed against the tree, NOT yet built.**
> Revision 1 survived its own review on the *diagnosis* and failed it on the *remedy*: three of
> §4's mechanisms cannot be built as written. See §8 for the findings, which are applied inline
> below rather than silently corrected.
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
  first slice".

★ **F8 — revision 1 handed the cleanup half to "CLI-004", which does not exist.** `CLI-004`
appears in this repository ONLY as a comment, in the two orphaned modules themselves
(`legacy-resource-reconciliation.ts:19`, `:153`, `:169`; `legacy-resource-reconciliation-store.ts:60`).
There is no implementation. The real, wired cleanup path is the **warm sandbox reaper**:
`listTerminalUncleanedLeases` → `claimTerminalUncleaned` (`warm-sandbox-reaper.ts:291`, `:157`) and
`listPausedLeasesWithKeyGeneration` (`:234`).

That correction cuts both ways, and the second half matters more:

- **Today's CAS is not decorative.** `expireLeaseIfPaused` sets `status='expired'` +
  `cleanupStatus='pending'`, which is exactly the predicate `listTerminalUncleanedLeases` selects
  on — so the pass's claim is a deliberate *handoff into a running sweeper*, not bookkeeping.
- **Option R changes which lifecycle a paused snapshot rides.** Left `paused`, it is no longer in
  the terminal sweep set; it is reaped by the warm reaper's TTL grace path instead. Defensible —
  the target is real and already wired, which is more than the CAS's stated rationale could say —
  but it is a different lifecycle with a different latency, and Option R must be argued on that,
  not on "CLI-004 will handle it".

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
- `canary_preflight_evidence_scalars(...)` covers the default env + key generation and **is NOT
  reusable as revision 1 claimed — F1.** Every `0267` function is **organization-bound**, and
  `reconcileCompanyLegacyResources(companyId, deps)` holds no `organizationId`. `0267` ships
  org→companies (`_companies`) and **no company→org lookup**, so a company-scoped pass structurally
  cannot call any of them.

  **Fix: the pass becomes organization-scoped.** It takes an `organizationId`, enumerates via
  `canary_preflight_evidence_companies`, and reconciles each company. That is strictly better
  than adding a company→org lookup: it matches the gate's own scope (`canary-preflight.ts:21-26`),
  it matches the CLI's cutover framing ("reconcile this org before flipping it"), and it avoids
  minting a reverse-direction lookup whose only caller would be this pass.

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

★ **F2 — that filter cannot live where revision 1 put it.** The gate does not read lease rows; it
reads `canary_preflight_evidence_leases`, which projects **`lease_id` only** (`0267`). There is no
`created_at` client-side to compare, so "the gate's inventory becomes …" is not implementable as a
predicate in TypeScript. The watermark must be pushed **into the definer function** as a parameter.
That means an arity change — which CREATES a new function rather than replacing the old one — so it
carries the full `0267` ceremony: a new migration that DROPs the old signature, a new manifest
entry with a fresh `bodySha256`, `REVOKE … FROM aoa_app`, `GRANT … TO aoa_operator`, and the boot
certificate updated in the same commit. Budget for it; it is not a one-line predicate.
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
3. ★★★ **F3 — the watermark inverts the gate's failure direction, and revision 1 under-read this.**
   Today the gate gets *stricter* with traffic: every new lease adds an unmapped key. The watermark
   makes it get *looser with age*, because everything newer than the pass is out of scope. Run the
   pass, let a month go by, let the fleet churn completely: the in-scope inventory is **empty**,
   closure is **vacuous**, and the gate **opens** while fifty live unreconciled legacy leases exist.
   Calling that "the intended semantics" (revision 1) is true of one lease and false of a stale
   fleet. **A freshness bound is REQUIRED, not optional.**

   One partial bound already exists and should be named rather than relied on: a provider-key
   rotation retags the current generation, every record keeps the old one, and
   `canary-preflight.ts:157-171` refuses on `superseded`. That forces a re-pass — **but only if the
   key rotates.** It is not a clock.

4. ★ **F4 — an `unattributable` record bricks the canary permanently, with no remedy in code.**
   `assertClosure` fails on *any* unattributable disposition (`legacy-resource-reconciliation.ts:290`),
   and `resolveResourceType` returns null for a lease that is not `ephemeral` and carries no
   `agentId` / `commanderConversationId` / `executionWorkspaceId` (`:95-101`). The crosswalk is
   append-only: `0256` grants no DELETE, and the schema comment states there is no update path in
   application code. So one unclassifiable lease refuses the gate **forever**, and neither the pass
   (idempotent insert-if-absent) nor the gate (read-only) can clear it. The design must state the
   operator's remedy — or admit there isn't one, which is itself a decision.
5. A record tagged with a superseded key generation still refuses (`canary-preflight.ts:157-171`,
   unchanged) — the watermark must not become a way around the credential-authority check.
6. ★ **F5 — the operator CLI must ASSERT the role it connected as.** The precedent
   (`verify-e7-1-distributed-run.ts:58-64`) is `createDb(process.env.DATABASE_URL)`: the operator
   chooses the role. Run the pass with an owner URL and every definer function and grant argument in
   §4.2 is **decorative** — it would succeed while proving nothing about the grant model, which is
   the E-1 defect wearing a different hat. `assertNonOwnerConnection` and
   `assertExactServingRoleAuthority` already exist and are already used this way
   (`distributed-execution-databases.ts:1764-1765`). The CLI calls both before its first read, and
   exits non-zero if it is not `aoa_operator`.
7. The new definer function is manifested, certified at boot, and grants `EXECUTE` to no role
   containing `aoa_app` (the condition enforced in `security-definer-manifest.test.ts`).
8. The pass performs **no** write to `environment_leases`. Asserted structurally, by the store seam
   not exposing one.

---

## 6. Not in scope

- **Unit 2 / capability** (E7-F003): MCP surface, instructions bundle, workspace, output capture.
  Still unowned, still not started. Fixing E-2/E-3 opens the gate; it does not make an agent capable.
- Teardown of paused snapshots at cutover. Option R leaves them on the **warm reaper's** TTL path
  (`warm-sandbox-reaper.ts:234`), not on "CLI-004", which does not exist (F8).
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

---

## 8. Review round 1 — findings

Eight findings, all verified against the tree at `c7ead3a73` rather than reasoned about. The
diagnosis (§1-§3) survived. **Three of §4's mechanisms did not.**

| # | Sev | Finding | Where |
|---|-----|---------|-------|
| F1 | HIGH | The pass is company-scoped; every `0267` function is org-bound, and no company→org lookup exists. §4.2's "reusable as-is" is not buildable. → make the pass org-scoped. | §4.2 |
| F2 | HIGH | The watermark filter cannot run in the gate: `_leases` projects `lease_id` only. It must be pushed into the definer function — an arity change, so a new migration + manifest entry + `bodySha256` + certificate update. | §4.3 |
| F3 | HIGH | The watermark **inverts the failure direction**: today's gate tightens with traffic, the proposed one loosens with age, and a stale pass over a churned fleet opens it vacuously. A freshness bound is required. Key rotation is a partial bound only. | §5.3 |
| F4 | MED-HIGH | An `unattributable` record refuses the gate permanently — append-only table, no DELETE grant, no application update path. One unclassifiable lease bricks the canary with no remedy in code. | §5.4 |
| F5 | MED | The CLI's role is operator-supplied via `DATABASE_URL`. Without a role assertion the entire §4.2 grant argument is decorative. | §5.6 |
| F6 | LOW | Correction, in the design's favour: `classifyLease` has **no** non-test caller but the pass, so Option R is cheaper than §4.1 claimed. Do not confuse it with `classifyLeaseTruth` (`adapter-manager-control.ts:103`), which is the reaper's and unrelated. | §4.1 |
| F7 | LOW | Correction: `environment_leases.created_at` has **no** application consumer — the single grep hit (`job-operations.ts:95`) is the *job* leases table. The `acquireLease` clock switch is lower-risk than §3.3 implies, but still needs its pinning test: the risk was never "something reads it", it was "the two clocks must agree". | §3.3 |
| F8 | MED | "CLI-004" exists only as a comment in the two orphaned modules. The real wired path is the warm reaper — and today's CAS is a deliberate handoff *into* it, not bookkeeping, so Option R must be argued as a lifecycle change rather than a cleanup deferral. | §4.1, §6 |

**What this changes about sequencing.** F1 + F2 together mean the read surface is not "one new
definer function" but a **new org-scoped, watermark-aware definer surface** — closer in size to
`0267` itself than to a patch. F3 and F4 are semantics that must be settled *before* any of it is
built, because both change what the gate is allowed to answer.

**Still open from §7**, unchanged by this round: Option R vs keeping the CAS (F8 sharpens the
question rather than settling it); watermark storage shape; `legacyStatus` on a paused-but-mapped
record; per-company vs per-organization watermark.
