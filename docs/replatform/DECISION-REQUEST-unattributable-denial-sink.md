# DECISION REQUEST — where a denial with no FK-valid tenant goes

**Answers:** `E0-F013` → *"Decisions this slice did not take"* → **Decision 2**
(`docs/replatform/epics/E0-foundation/findings.md`).
**Date:** 2026-09-09. **Measured at:** `fffc7e1de` (PR #396, the DE-06 landing + re-triage merge).
**Status:** OPEN — awaiting a founder ruling. **Changes no finding's status and wires no code.**

**Queued behind this decision:** four clause-halves — **DE-03**, **DE-21's board/session half**,
**DE-15**, and **DE-06's fence-resolution throws** (the fourth was added by PR #396's own
measurement).

---

## ★ THE HEADLINE — TWO OF THE FOUR ARE NOT ACTUALLY BLOCKED BY THIS DECISION

The count of four was inherited from the prose, not from the code. It was re-measured at the
throw/deny sites for this paper, and **it is wrong in the direction that matters**:

1. **DE-06's fence half is 1/6 already resolvable.** `resolveWorkerFenceContext` has **six** throw
   sites, not one. At the sixth (`worker-fence-context.ts:122`, the post-resolution tuple-integrity
   branch) `context.lease.companyId` is **DB-resolved, NOT NULL and FK-valid**. That branch needs
   no decision — only a unit.
2. **DE-21's agent-key branches are fully resolvable today.** `authorizeUpgrade` has **seven**
   `return null` deny branches, not one. At two of them (`live-events-ws.ts:377`, `:395`)
   `key.companyId` — and at `:395` also `agent.companyId` — is DB-resolved and FK-valid. PR #396
   already said "DE-21 splits into a closable agent-key half"; this paper confirms it at the line
   and adds that **branch `:358` also holds an FK-valid company** (the actor's own membership list,
   already SELECTed at `:343-352` for the authorization decision itself).
3. **DE-15's "no tenant at all" is FALSE as written.** At the drain return
   (`job-leasing.ts:731-740`) the poll holds a token-attested `organizationId` **and** a
   `candidates` array whose rows carry the **full `jobs` row** including a NOT NULL, FK-valid
   `companyId` (`job-control.ts:1930-1941`, `select({ job: jobs, … })`). The right description is
   **"an organization and zero-or-many companies"**, not "no tenant". That is a different
   blocker and it argues for a different fix.

**What is genuinely unresolvable is narrower than four halves: it is the ORGANIZATION-ONLY
RESIDUE.** DE-03 in full, five of DE-06's six fence throws, and DE-15's kill verdict all hold a
**verified organization** and no singular company — because `organization → company` is **1:N and
therefore not a function**: `companies.organization_id` is `notNull().references(organizations.id)`
(`companies.ts:20`) and the only unique constraint over it is the composite
`companies_org_id_uq (organization_id, id)` (`companies.ts:87`). There is no reverse lookup to
select, not merely one not currently selected.

---

## §1 — The four sinks, measured at the deny site

Legend for the provenance column, which is a **three-way** distinction and not the two-way one the
finding's prose uses:

- **caller-supplied** — arrives on the wire, unvalidated at that point.
- **token-attested** — carried in a signed artefact the control plane itself minted and verified
  (`verifyWorkerOperationProof` → `verifyWorkerSessionToken`, `worker-operation-proof.ts:47-60`).
  Trustworthy for attribution; **not** proof that a matching row still exists.
- **DB-resolved** — read out of a row in this transaction. Only this class is FK-valid by
  construction.

### 1.1 DE-03 — replay rejection / unenrolled worker

`recordProof` (`packages/db/src/repositories/tenant/worker-enrollment.ts:267-277`, the
`onConflictDoNothing().returning()` → `rows.length === 1`), refused at **nine** production call
sites: `worker-session-auth.ts:151`, `job-control-ack.ts:93`, `job-events.ts:169`,
`job-fencing.ts:133`, `job-leasing.ts:546` and `:816`, `worker-enrollment.ts:315`,
`worker-fence-context.ts:68` and `:162`.

| In hand at the throw | Provenance | Tenant axis |
|---|---|---|
| `auth.organizationId`, `auth.workerId`, `auth.targetId`, `auth.deviceThumbprint`, `auth.proofId` (eight session-bound sites) | **token-attested** | organization |
| `authoritativeOrganizationId` (the enrollment site, `worker-enrollment.ts:315`) | **DB-resolved** from `worker_enrollment_code_routes.candidate_organization_id` (`:289-294`) — **but typed `string \| null`** | organization, or none |
| Any company | — | **absent** |

A pre-code refusal (`worker-enrollment.ts:295`, expired/unknown route) has **no organization
either**. `workers.organization_id` (`workers.ts:26`) and `execution_targets.organization_id`
(`execution_targets.ts:25`) are the only tenant columns on the identities in play, and both are
themselves nullable for platform scope.

**Verdict: genuinely unresolvable on the company axis.** Resolvable on the organization axis at
eight of nine sites, and at the ninth only when the enrollment code was org-routed.

### 1.2 DE-21 — WebSocket upgrade refusal, `authorizeUpgrade` (`live-events-ws.ts:251-407`)

Seven `return null` branches. The finding treats them as one; they are not one shape.

| # | Branch | What is in hand | Provenance | FK-valid company? |
|---|---|---|---|---|
| 1 | `:293` mode has no session resolver | `companyId` from `parseCompanyId(url.pathname)` | caller-supplied | **verifiable, not verified** |
| 2 | `:304` untrusted / missing `Origin` | `companyId`, `origin` | caller-supplied | same |
| 3 | `:311` no session → no `userId` | `companyId` | caller-supplied | same |
| 4 | `:322` `cloud_auth`, `hasActiveCloudMembership` false | **`userId`** | **DB-resolved** (session) | probed company: verifiable. Actor's own: not selected |
| 5 | `:358` `authenticated`, no `instance_admin` row **and** no membership | **`userId`** and **`memberships[]`** — the actor's own company ids, already SELECTed at `:343-352` | **DB-resolved** | ★ **YES — the actor's own company ids are literally in the local variable** |
| 6 | `:376-377` `!key \|\| key.companyId !== companyId` | **`key.companyId`** when the key exists | **DB-resolved** (`agent_api_keys`) | ★ **YES** |
| 7 | `:395` agent missing / `terminated` / `pending_approval` | **`key.companyId`**, **`agent.companyId`** | **DB-resolved** | ★ **YES** |

**Verdict: NOT blocked, for a majority of the branches.** Branches 6 and 7 are the agent-key half
and are wireable today with no schema change and no decision. Branch 5 holds an FK-valid company of
a *different kind* (the actor's own tenants, plural) — usable, but it needs an attribution rule.
Branches 1–4 hold a **caller-supplied but decidable** company: one `SELECT id FROM companies WHERE
id = :companyId` separates "probe against a real tenant" (the interesting case, FK-valid) from
"probe against a random uuid" (uninteresting). **So what actually blocks DE-21's board half is not
Decision 2 (no FK-valid tenant) — it is Decision 3 (whose log does a cross-tenant probe land in).**
The register should say the true blocker.

### 1.3 DE-15 — kill-switch drain (`job-leasing.ts:731-740`)

| In hand at the `return` | Provenance | Notes |
|---|---|---|
| `pollInput.auth.organizationId` | **token-attested** | present on every call |
| `guardedAuthority.currentTarget.kind`, `normalizedCurrentTarget.*` | **DB-resolved** | `execution_targets` — organization axis only |
| `candidates[].job` — **the whole `jobs` row**, including `companyId` (NOT NULL) | **DB-resolved** | `lockEligibleLeaseCandidates`, `job-control.ts:1930-1941`. ★ **0..N of them** |

The kill verdict is evaluated **after** candidate selection and **before** any claim, so the array
is in scope and may be empty.

**Verdict: the tenant is not ABSENT, it is NOT SINGULAR.** And attributing a fleet-wide provider
kill to one arbitrary queued job's company would be a **category error**: no company was refused
anything — the *worker* was told to drain, and the audited fact ("image admission, scan, and kill
events") is a property of the provider, not of a tenant. DE-15's correct home is the organization
axis, which `activity_log` has no column for.

### 1.4 DE-06 — the fence-resolution throws (added by PR #396)

`resolveWorkerFenceContext` (`worker-fence-context.ts:59-135`), shared by **four** services:
`artifact-commit.ts:162`, `artifact-transfer-grant.ts:115`, `patch-apply.ts:101`,
`secret-broker.ts:269`.

| Throw | Code | In hand | Provenance | Company? |
|---|---|---|---|---|
| `:75` | `unauthorized` (proof replay) | `auth.*` | token-attested | **no** |
| `:89` (`!authority`) | `unauthorized` | `auth.*` | token-attested | **no** |
| `:89` (`authority` present) | `target_revoked` | `authority.worker` + `authority.target` | **DB-resolved** (`lockWorkerLeaseAuthority`, `job-control.ts:1846-1895`) — **organization only**, verified against the selected column list | **no** |
| `:92` | `target_revoked` (target inactive) | same | **DB-resolved**, organization only | **no** |
| `:97` | `target_revoked` (profile drift) | same | **DB-resolved**, organization only | **no** |
| `:110` | `stale_fence` (`!context`) | same — the lease is exactly what failed to resolve | **DB-resolved**, organization only | **no** |
| `:122` | `stale_fence` (tuple integrity) | ★ **`context.lease.companyId`** | **DB-resolved** | ★ **YES** |

★ **One more thing is in hand and the finding does not say so:** `presented.jobId` is
caller-supplied, and the whole call runs inside `runInTenant` under the worker's own org GUC.
`jobs` is `FORCE ROW LEVEL SECURITY` with
`USING (organization_id = current_setting('aoa.organization_id', true)::uuid)`
(`0211_tenant_rls_enforcement.sql:20-28`). **A `jobs → company_id` lookup therefore CANNOT be aimed
at a foreign tenant: RLS fails it closed.** That narrows option (c)'s attack (see §3.3) — it does
not eliminate it.

**Verdict: 1 of 6 resolvable today; 5 of 6 are organization-only residue.**

### 1.5 The measured summary

| Half | Company FK-valid at the deny site? | Blocked by Decision 2? |
|---|---|---|
| DE-06 fence, `:122` | **Yes**, DB-resolved | **No.** Needs a unit, not a ruling |
| DE-21 branches 6–7 (agent key) | **Yes**, DB-resolved | **No.** Needs a unit, not a ruling |
| DE-21 branch 5 (`authenticated` board) | **Yes**, but plural (actor's own) | Needs an attribution rule; not a storage ruling |
| DE-21 branches 1–4 (board/session probe) | Caller-supplied, **decidable** by one SELECT | **No — blocked by Decision 3**, not Decision 2 |
| DE-06 fence, `:75/:89×2/:92/:97/:110` | No — organization only | **Yes** |
| DE-03 (all nine sites) | No — organization only, sometimes none | **Yes** |
| DE-15 | No — organization + 0..N companies | **Yes** |

---

## §2 — What `activity_log` actually is (storage facts, measured)

| Fact | Evidence |
|---|---|
| `company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE` | `packages/db/src/schema/activity_log.ts:10` |
| **No `organization_id` column** | same file, whole table |
| **Not in the RLS kernel** — no `ENABLE`/`FORCE ROW LEVEL SECURITY`, no policy, ever | `0245_job_activity_audit_rls.sql:15-18` states it deliberately; a sweep of all migrations for `activity_log` + `ROW LEVEL`/`POLICY` returns **zero** hits |
| `aoa_app` holds **`SELECT, INSERT` only** — no `UPDATE`, no `DELETE` | `0213_e2_serving_role_correction.sql:98`, `0214_e2_serving_role_hardening.sql:166` |
| **11** production read sites; **10** filter `eq(activityLog.companyId, …)` | `activity.ts` (×2), `cockpit.ts:514`, `costs.ts:230`, `home.ts:181`, `proactive.ts:478`, `memory-feedback.ts:54`, `productivity-review.ts` (×3), `github.ts:74`, `seed-commander-review.ts:270` |
| The **one** company-unscoped reader filters by `entityType`/`entityId` | `marketplace-reconcile.ts:1649-1656` |
| ★ **No production reader of `security.denied.*` exists anywhere** | grep over `server/src` + `ui/src`: only the two writers, the namespace guard, and prose |
| …but denial rows **do** surface in the generic company Activity feed: `activityService.list` applies **no** action-prefix filter, and `GET /companies/:cid/activity` gates on `assertCompanyAccess` — **any company member**, not founder-only | `services/activity.ts:18-57`, `routes/activity.ts:45-47` |
| **Attribution precedent already set**: both live writers attribute to the **actor's own** tenant, never the probed one | DE-19 uses `ctx.companyId` (`read-tools.ts:299`); DE-06 uses the **locked lease's** company and its test asserts the probed tenant's `activity_log` is **empty** |
| There is **no sentinel/system company row** to borrow. `organizations` has a `slug = 'default'` sentinel; `companies` has none | `organizations.ts:11`, `companies.ts:11-20` |

**One adjacent observation, deliberately not claimed as a resolution.** Decision 3(b) says a hostile
tenant can cascade-delete their own denial history. `aoa_app` has **no `DELETE` on `activity_log`
and no `DELETE` on `companies`** (`0213:68`, `0214:136` grant `SELECT, UPDATE` only), while
`companies.ts:656-659` contains an application delete path that explicitly issues
`tx.delete(activityLog)`. Those two facts do not agree, and which role that transaction runs as was
**not measured here**. It belongs to Decision 3 and needs its own unit. It is recorded so nobody
reads the grant fact alone as an exoneration.

---

## §3 — The options

Each is scored against the **residue** that Decision 2 actually owns (DE-03, DE-15, DE-06's five
org-only throws) and against the halves §1 showed are already resolvable.

### (a) Make `activity_log.company_id` nullable

- **Unblocks:** the whole residue — DE-03, DE-15, DE-06's five throws — as *tenantless* rows.
- **Cost:** one `db:generate` migration (`ALTER COLUMN company_id DROP NOT NULL`). Drizzle emits it;
  **no hand-authored DDL**, so C14 is not engaged.
- **RLS posture:** unchanged — the table is outside the kernel by design (`0245:15-18`), so there is
  no policy to widen and no `USING` clause to reason about. A tenantless row is readable by
  `aoa_app` with no gate.
- **Who can READ a tenantless row:** *nobody, through any existing surface.* All ten company-scoped
  readers use `eq(companyId, X)`, which a NULL never matches; the eleventh filters on
  `entityType`/`entityId` and would need `marketplace_reconciliation` to match. **This is a feature
  and a defect at once** — it is the correct non-disclosure posture, and it means the rows are
  write-only until a reader is built (§4 makes that an acceptance condition).
- **Cascade semantics:** a NULL row **does not cascade**. For the evidence class most exposed to
  Decision 3(b), that is a strict improvement.
- **Breaks:** nothing at read time. What it costs is an **invariant**: today `NOT NULL` is the only
  thing that catches a product writer omitting `companyId`, across **34** direct
  `insert(activityLog)` sites — and `E0-F013` has already recorded the decision **not** to ship a
  static guard over those writers. Relaxing the column relaxes it for all thirty-four.
- **Proof:** a migration test that the column is nullable; a recorder test that a null-company
  denial inserts; a **positive control** that every company-scoped reader still returns the same
  rows with a tenantless row present.

### (a2) Nullable `company_id` **and** a new nullable `organization_id` ★

Everything in (a), plus `organization_id uuid REFERENCES organizations(id)`.

- **Unblocks:** the same residue, **but attributably**. This is the only option that records what is
  actually known at those sites: DE-03's eight session-bound refusals, DE-15's drain, and DE-06's
  five org-only throws all hold a verified organization. Under (a) they become "some denial
  happened somewhere"; under (a2) they become "this organization was refused."
- **Extra cost over (a):** one `ADD COLUMN` + one index in the same generated migration. ★ Note the
  programme's own lesson that `ADD COLUMN` is not idempotent — which is precisely why this must be
  `db:generate` output and must not be hand-appended.
- **Breaks:** the same invariant relaxation as (a), plus a second nullable tenant column that the
  other thirty-three writers will never populate — a column that is null on ~100% of rows is a
  standing invitation to misread.
- **Proof:** as (a), plus an assertion that the organization on the row equals the one the refusing
  control verified (read from the branch, not stamped — the DE-19 discipline).

### (b) A separate unattributed-denial table

- **Unblocks:** the same residue, with any column set one likes (`organization_id` nullable,
  `company_id` nullable, actor, reason, control).
- **Cost:** a schema unit (Drizzle + `db:generate`) **plus** a Decision #122 posture call —
  RLS/GRANT DDL is hand-authored `--custom` and must be argued, not guessed. The closest analogue
  (`activity_log`) is deliberately non-RLS, and this table would hold **cross-tenant evidence**,
  which `E0-F013` itself flags as "a live-fire question". Also: a second recorder, a second
  redaction path, a second namespace convention, and a second thing that can be silently broken.
- **Who reads it:** **nobody, same as (a)** — and this is the honest comparison. The "who reads it"
  objection is not a cost of (b) relative to (a); it is a cost the whole class already carries,
  because no reader of `security.denied.*` exists at all today (§2).
- **Breaks:** nothing existing. Preserves `activity_log`'s `NOT NULL` invariant intact — its single
  real advantage over (a2), and a genuine one.
- **Proof:** the same provocation discipline, against a new table.

### (c) Resolve the company from a caller-supplied id (e.g. `jobId`)

- **Unblocks:** DE-06's five org-only throws only — and only the three that occur *after* a `jobId`
  is presented. It does **nothing** for DE-03 (no job in the request) or DE-15 (the drain is not
  about a job).
- **★ The attack, stated plainly, and not presented as neutral.** The prober **chooses the record's
  destination.** It supplies a `jobId`, the recorder resolves that job's `company_id`, and the
  evidence of its own refusal lands wherever it aimed. It can therefore **dilute** its history
  across many of its own companies, **flood** one company's Activity feed (which any member of that
  company can read, §2) to bury a real signal, or **omit** a resolvable `jobId` to force the record
  back into the tenantless bucket. A prober that controls the attribution controls the audit.
- **The one mitigation, measured:** the lookup runs under the worker's own org GUC and `jobs` is
  `FORCE RLS` on `organization_id` (`0211:20-28`), so the destination cannot be **another
  organization**. The true statement is *"a prober chooses which of the companies inside its own
  already-authenticated organization absorbs the record"* — narrower than cross-tenant, still an
  attacker-chosen audit destination. The register should carry the true statement, not the loose
  one.
- **Cost:** near zero in code. The cost is the property.
- **Proof:** you cannot prove this one *safe*; you can only bound it. Any wiring would need a test
  that a foreign-org `jobId` resolves to nothing (RLS fail-closed), which pins the bound and not the
  property.

### (d) Widen the post-resolution tuple-integrity branch (`worker-fence-context.ts:111-123`)

- **Unblocks:** exactly **one** throw of DE-06's six (`:122`). Nothing else — not DE-03, not DE-15,
  not the five earlier throws.
- **Cost:** ★ measured blast radius — the helper is shared by **four** services
  (`artifact-commit.ts:162`, `artifact-transfer-grant.ts:115`, `patch-apply.ts:101`,
  `secret-broker.ts:269`). Any signature change (adding a `db` handle or a denial-intent sink)
  touches all four; any behaviour change on that branch changes the refusal semantics of four
  independent surfaces at once, two of which (`patch-apply`, `secret-broker`) have no denial-audit
  wiring at all today.
- **The cheaper shape the blast radius suggests:** do **not** widen the helper. Catch
  `JobLeasingError` at the **caller** — outside `runInTenant`, on the pool handle, where each of the
  four already knows its own surface slug — exactly the drain shape PR #396 built for the
  `rejected` path. But a caller-side catch has only the `JobLeasingError` code and **not**
  `context.lease.companyId`, which never leaves the helper. So closing `:122` attributably really
  does require touching the helper: either returning the resolved company alongside the throw, or
  moving the tuple check out.
- **Breaks:** nothing, if the four callers are updated together. The risk is the usual one — a
  shared helper changed for one caller's benefit.
- **Proof:** a provocation per branch. PR #396 already demonstrated that this class of fixture is
  easy to get wrong: its DE-06 test *appeared* to cover `:122` while its lease tuple still matched,
  so the refusal actually landed on a later catch. Any unit here must pin **which** throw it reached.

### (e) Record nothing, and say so in the register

- **Unblocks:** nothing. **Closes** the ambiguity, which is not nothing.
- **Cost:** an amendment to each affected `audit` clause in
  `docs/architecture/distributed-execution-threat-controls.json`, plus the finding text.
- **Breaks:** nothing in code. What it costs is coverage: DE-03's replay rejection is *the* signal
  for a stolen worker session, and choosing not to record it means an attacker replaying proofs
  leaves the same durable trace as a worker with a clock skew — none.
- **Why it is on the list anyway:** it is the only option that is honest by construction. This
  programme's stated failure class is a mechanism that covers part of a class while the register
  asserts all of it. If (a2)/(b) are not funded, (e) is **mandatory** — the alternative is not
  "nothing happens", it is "the register keeps claiming coverage that does not exist".
- **Proof:** the register diff, and no gate-clause enrolment.

---

## §4 — Recommendation

**Rule (a2), and split the four.**

**1. Rule (a2) for the residue.** Make `activity_log.company_id` nullable and add a nullable
`organization_id`, in one `db:generate` migration. Reasoning:

- It is the only option that records **what is actually known** at the three residual sinks. All of
  DE-03's session-bound sites, DE-15's drain and DE-06's five org-only throws hold a *verified
  organization*. Options (a) and (b)-with-only-a-nullable-company throw that away and produce
  "someone was refused"; (c) invents an attribution the attacker picks; (e) records nothing.
- It breaks **no existing reader**, measured: ten of eleven filter `eq(companyId, …)`, which a NULL
  never matches, and the eleventh filters on `entityType`. Non-disclosure of tenantless evidence is
  the default rather than something to build.
- It needs **no RLS or GRANT decision**. `activity_log` is deliberately outside the kernel
  (`0245:15-18`) with `SELECT, INSERT`-only grants — the exact posture a cross-tenant denial sink
  wants, already argued and already shipped. Option (b) re-opens that argument on a new table under
  Decision #122 and must win it again.
- Cascade improves for the residue: a tenantless row does not cascade with any company.
- It is one migration and one recorder change, against (b)'s table + recorder + redaction path +
  namespace + posture argument.

**2. Do NOT hold the two resolvable halves behind it.** DE-06's `:122` and DE-21's branches 6–7 need
a **unit, not a ruling**, and should be scheduled now — with §3(d)'s warning about the four-service
helper, and with a test that pins **which** throw was reached.

**3. Send DE-21's board/session branches to Decision 3, where they belong.** Their company is
decidable (§1.2); what is undecided is *whose log a cross-tenant probe lands in*. Both live writers
already answer the analogous question the same way — attribute to the actor's own tenant, never the
probed one — so Decision 3 has a precedent to ratify or overturn, and Decision 2 should stop being
recorded as their blocker.

**4. Two acceptance conditions on the ruling, or it becomes the failure it is meant to fix.**

   a. **A reader must ship in the same wave.** §2 measured that **no production reader of
      `security.denied.*` exists**. Adding a fourth writer to a store nobody queries produces
      evidence that is present and unreachable — a claim of coverage with no observation behind it.
   b. **The register must be amended for DE-15 in the same commit.** Even under (a2), an
      organization-attributed drain record does **not** satisfy "image admission, scan, and kill
      events are audited" as a *tenant* fact, and DE-15's clause should say what the programme
      actually intends before any row is written against it.

### The strongest argument AGAINST this recommendation

**A nullable tenant column turns `activity_log` into two tables wearing one name, and pays for four
sinks with a weakening that lands on thirty-four writers.**

`NOT NULL` on `company_id` is, today, the **only** enforcement that every product row in that table
belongs to a company. There are **34** direct `insert(activityLog)` sites, and `E0-F013` has already
recorded — with reasons this paper does not dispute — the decision **not** to ship a static guard
over them. Drop the constraint and the next writer that forgets `companyId` inserts a row that
silently vanishes from all ten company-scoped readers, and **no test, no guard and no constraint
fires**. That is this programme's signature defect: a thing that appears to work and observes
nothing. Option (b) pays one table to keep that invariant whole, and one table is cheap next to a
class of silent product-data loss.

Two things push back, and neither fully answers it: 32 of the 34 writers hard-code their values and
pass `companyId` explicitly (`activity-namespace.ts` docblock, re-derived at `12660dbd6`), so the
exposure is narrower than 34; and a `CHECK (company_id IS NOT NULL OR action LIKE 'security.denied.%')`
would restore the invariant for every non-denial writer at the cost of hand-authored DDL under C14.
**If the founder weighs the invariant above the storage saving, (b) is the correct ruling and this
paper's recommendation should be overturned.** The measurement in §1 stands either way.

---

## DECISION BLOCK — for founder signature

> **Decision 2 of `E0-F013`: where a denial with no FK-valid tenant goes.**
>
> **The count is corrected first.** Of the four clause-halves recorded as queued behind this
> decision, **two are not blocked by it**: DE-06's tuple-integrity throw
> (`worker-fence-context.ts:122`) and DE-21's agent-key branches (`live-events-ws.ts:377`, `:395`)
> hold a DB-resolved, FK-valid company today. DE-21's board/session branches are blocked by
> **Decision 3**, not this one. The residue this decision owns is **DE-03**, **DE-15**, and
> **five of DE-06's six fence throws** — all of which hold a verified *organization* and no
> singular company.
>
> Choose ONE:
>
> - [ ] **(a2) — RECOMMENDED.** `activity_log.company_id` becomes nullable and a nullable
>       `organization_id` is added, by `db:generate`. Residual denials are recorded
>       organization-attributed. **Conditional on both:** a reader for `security.denied.*` ships in
>       the same wave, and DE-15's register clause is amended in the same commit.
> - [ ] **(b)** A separate unattributed-denial table is minted, keeping `activity_log`'s `NOT NULL`
>       invariant intact. Its RLS/GRANT posture is argued under Decision #122 before it lands.
>       Same two conditions apply.
> - [ ] **(a)** Nullable `company_id` only; residual denials are recorded tenantless.
> - [ ] **(c)** REJECTED unless explicitly overridden — resolution from a caller-supplied id lets a
>       prober choose which of its own organization's companies absorbs the record.
> - [ ] **(e)** Nothing is recorded for the residue, and the `audit` clauses of DE-03, DE-15 and
>       DE-06 are AMENDED in `distributed-execution-threat-controls.json` to say so.
>
> And separately:
>
> - [ ] DE-06 `:122` and DE-21 branches 6–7 are scheduled as units **now**, not behind this ruling.
> - [ ] DE-21 branches 1–5 are re-recorded against **Decision 3**.
>
> Signed: ____________________  Date: ____________

**No finding status is changed by this document.** `E0-F010` and `E0-F013` remain `open`; no
`deliveryStatus` moves; nothing is enrolled in `scripts/gate-clause-wiring.json`.
