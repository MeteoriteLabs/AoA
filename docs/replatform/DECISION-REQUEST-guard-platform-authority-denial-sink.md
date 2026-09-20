# DECISION REQUEST — the `guardPlatformAuthority` denial sink: the two shared-platform throws JOB-003 deferred, and whether to amend the frozen contract to audit them

**Answers:** the named deferral **`DEFERRED-DECISION: guardPlatformAuthority denial sink`** that the
register carries at HEAD on DE-18's `audit` clause and DE-04's worker-authority-currency arm
(`docs/architecture/distributed-execution-threat-controls.json`, DE-18 `audit`: *"guardPlatformAuthority's
two shared-platform throws are attributed to DEFERRED-DECISION: guardPlatformAuthority denial sink (a
named, owner-visible future decision, NOT accepted-as-gap; their blocker is the pinned helper/call
shape, not the ack drain)"*).
**Date:** 2026-09-20. **Measured at:** `95b3ba97d` (the `docs/replatform-program` HEAD this paper ships on).
**Status:** RULED 2026-09-20 — **Option (B) accept-the-gap-made-honest.** Reclassify G1 (`job-leasing.ts:596`) as a data-integrity fallthrough; accept G2 (`:638`) on the `security.denied.worker_session` session-arm adjacency, naming the adjacent-not-identical residual window in the DE-18/DE-04 register rows, and close the §5.4 deferral task. Enactment owned by the **Session-2 guard-sink/register track** (`HANDOFF-2026-09-20-session-2-guard-sink-register.md`) — **register + docs ONLY; the frozen JOB-003 contract is NOT amended and `job-leasing.ts` is NOT edited.** (Original status line preserved below.)
> **Status (superseded):** OPEN — awaiting a founder ruling. **Changes no finding's status and wires no code.**

This paper is the **option-A paper** that
[`DECISION-REQUEST-job003-ack-drain.md`](./DECISION-REQUEST-job003-ack-drain.md) §4 promised when the
founder ruled Option B on 2026-09-14: *"if they are wanted, option A is a paper of its own with its own
provocations"*, and §5.4 filed a follow-on task *"so the deferral has an owner-visible handle."* It does
**not** relitigate the ack-drain ruling — those ack-body arms are wired and the ack authority-currency
arm shipped (PR #480). It asks the one question that ruling deliberately left open: **what happens to the
two `guardPlatformAuthority` throws**, whose blocker is not storage and not the ack drain, but the frozen
JOB-003 contract that pins the helper's shape.

Nothing below was run against the contract suite: this environment has no `node_modules`, so the dynamic
red counts in §2 are cited to the JOB-003 paper's §2 run (at `5237b057a`) and the wiring unit must
re-observe them at HEAD. Every **static** pin the citations lean on was re-read at `95b3ba97d` and is
named by symbol.

---

## THE HEADLINE — THE SINK EXISTS; THE PROBLEM IS THAT NOTHING CAN REACH IT FROM INSIDE THE HELPER

Three separate pieces of denial-sink work have shipped or been ruled, and it is easy to read this
deferral as already covered by one of them. It is not. The distinction is the whole decision:

1. **`DECISION-REQUEST-unattributable-denial-sink.md` (E0-F013 Decision 2, RULED (a2), migration `0274`)**
   answered a **storage** question — *where* a denial with no FK-valid tenant is written. It made
   `activity_log.company_id` nullable, added a nullable `organization_id`, and added the partial
   `CHECK (company_id IS NOT NULL OR action LIKE 'security.denied.%')`. After it, the table **can hold**
   an organization-attributed denial row for exactly the class the guard throws belong to.
2. **PR #480 (`ackAuthorityCurrencyIntent`)** wired the **ack authority-currency** arm — the
   `ackAuthorityCurrent` recheck reject in `job-control-ack.ts`, keyed DE-18 `ack_generation_superseded`
   / DE-04 `ack_authority_stale`, drained in that path's `.finally`. That is a **different arm** than the
   guard throws.
3. **The guard throws (this paper)** are blocked by neither. The sink can hold the row (1); the ack-path
   analogue already records its own reject (2); but **no denial intent can be threaded out of
   `guardPlatformAuthority` at all**, because the frozen JOB-003 contract pins the helper's parameter
   list at three, pins both call expressions, and audits the helper body. This is a **contract-shape**
   blocker, not a storage blocker and not the ack drain.

So the question is narrow and real: **do we amend the most-pinned helper in the codebase to admit a
denial-intent holder (option A), accept the deny-site gap on the strength of the adjacent session arm
(option B), or keep it as a named deferral (option C)?**

**Recommendation (§4): (B) — accept the deny-site gap, made honest.** G1 is a data-integrity
fallthrough that should never have been counted as an authority denial; G2's event class (a shared-platform
worker losing physical authority mid-lease) is already recorded one surface over by the session arm. The
marginal coverage (A) buys is low, and its cost — a caller-supplied mutable collaborator inside the
30-conjunct platform-authority helper — is the highest on the table. (A) remains the correct ruling if the
founder weighs deny-site completeness above minimal contract surface; the case for it is stated in full,
not buried.

---

## §1 — The two throws, measured at HEAD

All code citations are to `server/src/services/job-leasing.ts` (the service factory body) and
`server/src/__tests__/job-leasing-contract.test.ts` (the frozen JOB-003 contract), by symbol. The
throw-site facts are determinate — read from the named function body at `95b3ba97d`, not cohort or
convention figures.

`guardPlatformAuthority` is declared once in the service body (`job-leasing.ts:588`) and pinned there
(`declarations.length !== 1` / helper-binding parent → `builder:trusted-service-authority-guard`,
`job-leasing-contract.test.ts:3498`). It is called at exactly two sites, both as a bare `await`
expression: the poll admission path (`job-leasing.ts:734`,
`guardPlatformAuthority(repos, pollInput.auth, lockedAuthority)`) and the ack path (`job-leasing.ts:1094`,
the `authority ? await guardPlatformAuthority(...) : null` ternary). Its two throws:

- **G1 — the platform-scope fallthrough** (`job-leasing.ts:596`):
  `if (locked.target.scope !== "platform") throw new JobLeasingError("target_revoked")`. It fires only
  when `locked.target.scope` is **none of** `organization` / `owner` / `platform` — the organization and
  owner scopes return early at `:593-594`, so this line is reached only by a row whose scope is an
  unexpected fourth value. It is a **row-integrity fallthrough**, the same class the register already
  leaves unrecorded at poll's two post-authority data-integrity throws (DE-18 `audit`, *"NOT RECORDED,
  deliberately: the poll post-authority data-integrity refusals ..."*). Pinned to directly throw
  (`directlyThrowsFromGuard` on `platformScopeReject`, `job-leasing-contract.test.ts:3631`).
- **G2 — the 30-conjunct platform physical-authority recheck** (`job-leasing.ts:638`): the single
  validation `if` inside the `operatorDb.transaction` callback (`:608-639`), whose OR-expression is
  pinned conjunct-for-conjunct (`exactPlatformChecks`, `expectedPlatformChecks.length === 30`,
  `job-leasing-contract.test.ts:3702`) and which is also required to directly throw. This is the real
  authority denial: a shared-platform worker whose live device generation, profile hash, public key,
  thumbprint, status, or heartbeat freshness no longer matches the locked authority.

Both throw `new JobLeasingError("target_revoked")`. Per the register's 2026-09-13 per-conjunct
discipline, G2 serves **DE-18** when the failing conjunct is the generation cutoff and **DE-04**'s
worker-authority-currency arm otherwise. **Neither records anything today, on either path** — the guard
returns a value on success and throws bare on failure, with no denial-intent write between.

### 1.1 Why the code already names this, and where

The service body carries the attribution in prose (`job-leasing.ts:578-587`): the two throws are
*"attributed to DEFERRED-DECISION: guardPlatformAuthority denial sink (a named, owner-visible future
decision, not accepted-as-gap)"*, and *"their blocker is the pinned helper/call shape"* — a bare `await`
expression at both call sites that *"neither a sink parameter nor a wrapping capture is admissible
without a contract amendment."* This paper is the decision that comment defers to.

---

## §2 — Why no denial intent can leave the helper (each route, and the check that refuses it)

The JOB-003 paper (§2) enumerated every intent-threading route out of the guard and either ran it or
refuted it by the checker's own text. This section restates that measurement, source-verifies the
**static** pins at HEAD, and attributes the **dynamic** red counts to the JOB-003 run (this environment
cannot re-run vitest). If option A is chosen, the wiring unit must re-observe each red at HEAD before it
merges.

- **2.1 A fourth (sink) parameter.** Reds twice, independently: the helper-shape branch of
  `builder:trusted-service-authority-guard` (helper parameter count pinned at three,
  `job-leasing-contract.test.ts:3498`) and, at the poll call site,
  `builder:physical-from-authority-guard` (the call expression pinned to exactly three arguments,
  `:3305`). **JOB-003 §2 arm (g-a), run at `5237b057a`: observed RED — 1 fail / 19 pass, exactly those
  two violations.**
- **2.2 A wrapping `try`/`catch` capture at the poll call site.** The binding
  `const guardedAuthority = ...` must be a direct statement of the tenant callback body; moving it into a
  `try` block removes the direct binding and forces a `let`, which reds independently. **JOB-003 §2 arm
  (g-b), run at `5237b057a`: observed RED — 1 fail / 19 pass, seven violations** (including
  `binding:reassigned:guardedAuthority`, `binding:protected-value-escape`,
  `candidate:canonical-chain-dominates-return`). The wrap that reds seven checks does not even capture
  anything yet — it rethrows unconditionally; any version that reads the error first is a superset.
- **2.3 A comma-expression intent write inside the guard.** The throw-shape pins would tolerate it, but
  the write needs a sink the guard can see, and the guard closes over **service** scope while every honest
  sink is **per-request** (`createWorkerDenialSink()` inside `poll`). A service-scope shared sink is not a
  contract violation — it is a **correctness** violation: concurrent polls would cross-attribute denials.
  The recorder discipline this wave established (auditing atomically with, or at least attributably to,
  the refusal it describes) rules it out without a red.
- **2.4 Attaching intent to the thrown error object.** `Object.assign` inside the helper body is swept by
  `auditDynamicMetaprogramming(helperBody)` (`job-leasing-contract.test.ts:3505`, and the whole-file sweep
  at `:2445`); and a plain subclass-with-field would still need a **read** point, which does not exist —
  poll's `catch` is the frozen classifier/exhaustion/continue triple, and the `finally` has no binding to
  the in-flight error.
- **2.5 AsyncLocalStorage or module state.** Module-scope mutable state written from inside the authority
  helper is the same cross-request attribution hazard as 2.3 with extra machinery, and any import into
  `job-leasing.ts` feeds whole-file sweeps that exist precisely so no unreviewed conduit appears beside
  the authority chain. Every spelling is an unreviewed conduit into the most-pinned helper in the
  codebase — if this route is ever wanted, it is option A by another name and needs the same review.

The conclusion is the same one the code comment states: **the sink existing (migration `0274`) does not
help, because the contract lets no intent reach it.** Closing the guard deny-site *attributably* requires
amending the contract — that is option A, and there is no honest fourth route.

---

## §3 — Options

### (A) Amend the frozen contract to admit a denial-intent holder

In one reviewed commit against `job-leasing-contract.test.ts`: widen the helper-shape pin (3 → 4
parameters, the 4th pinned by name and by the single property it may carry), amend both call-expression
pins (the poll pin `builder:physical-from-authority-guard`; the ack ternary, not separately pinned today,
should be pinned rather than left unchecked), and — the lesson the JOB-003 measurement bought — **sweep
the new argument's flow for the protected names, with the sweep's own red observed before merge** (the
obvious version of this amendment would ship green while opening a hole, e.g. if the holder could alias
`repos`). Then classify per-conjunct inside the guard (a pure registered classifier in the mold of
`pollAuthorityCurrencyIntent`) and drain: poll's existing retry-`try` `finally` covers G1/G2 on poll; ack
coverage additionally rides the already-adopted `.finally` ack drain.

- **Cost:** the widest relaxation on the table. A caller-supplied mutable collaborator enters the
  platform-authority helper — the exact **shape** the contract refuses on purpose elsewhere
  (`service:no-context-or-guard-injection`, `job-leasing-contract.test.ts:4705`, exists because an
  injectable collaborator is a substitutable one). The hazard is weaker here — substituting a sink loses
  audit rows, never authority — but the review must argue that explicitly, and the 30-conjunct helper is
  the worst possible place to be wrong.
- **Buys:** the last two unaudited authority-denial arms on the worker poll/ack surface, recorded at the
  deny site itself (shape-independent: the crossing's audit no longer depends on which surface the worker
  hit).

### (B) ★ Accept the deny-site gap, made honest

Rule that G1/G2 are **not** amended, and amend the register to say precisely why the deny-site gap is
acceptable — split by throw, because the two throws are not the same kind of thing:

- **G1** is reclassified as a **data-integrity fallthrough**, not an authority denial. It fires only on a
  scope value that is none of organization/owner/platform — a corrupt/unexpected row, the same class the
  register already leaves unrecorded at poll's post-authority data-integrity throws. Counting it as an
  audited "denial" would miscategorize a row-integrity anomaly as an authorization event.
- **G2**'s deny-site gap is accepted on the **session-arm adjacency**: the shared-platform physical
  recheck is already audited one surface over (`worker-session-auth.ts`, `security.denied.worker_session`,
  shared-platform physical recheck, 2026-09-13), so a shared-platform worker losing physical authority
  mid-lease already leaves a durable trail. The register records that the guard **deny site** is
  unrecorded by design, with the event class covered adjacently — **honestly**, without claiming the arm
  is covered at the guard.

- **Cost:** DE-18 and DE-04 keep one honestly-named partial arm each. And the adjacency is **adjacent, not
  identical** — the session arm fires on the session recheck's own trigger, not on every guard
  invocation, so a guard throw without a co-firing session refusal is a real (narrow) window with no row.
  §4 states this rather than papering over it.
- **Buys:** no relaxation of the most-pinned helper, a register that names the true residual, and a
  **closed** decision rather than an aging deferral.

### (C) Hold — keep the named deferral open

Status quo: leave `DEFERRED-DECISION: guardPlatformAuthority denial sink` open, wire nothing, revisit only
if the helper is reopened for another reason (at which point the sink folds in at lower marginal cost).

- **Cost:** the JOB-003 paper's own warning applies — *"deferral has a way of becoming acceptance; the
  programme's own record shows named follow-ons aging."* An indefinite hold risks silent rot: the register
  keeps a named-but-unresolved arm that no unit is scheduled to close.
- **Buys:** optionality, at the price of an open loop with no owner-scheduled resolution.

### (D) Out-of-band, no amendment — refuted

§2. Not an honest option; listed so the ruling is a choice among real ones.

---

## §4 — Recommendation: **(B)**, split by throw

One recommendation, two clauses, one reasoning.

1. **Reclassify G1 as a data-integrity fallthrough.** It was never an authority denial; it is a
   row-integrity refusal on an impossible scope value, and the register should file it beside poll's
   post-authority data-integrity throws — unrecorded, by the same rule, not as an exception carved for
   this arm.
2. **Accept G2's deny-site gap on the session-arm adjacency, and say exactly what that does and does not
   cover.** The event class — a shared-platform worker losing physical authority mid-lease — is recorded
   at `security.denied.worker_session`. What the deferral costs is observability at the **deny site**, not
   observability of the **event class**; and because the adjacency is adjacent-not-identical, the register
   note must name the residual window (a guard throw with no co-firing session refusal), not claim
   completeness.

The marginal value of (A) is low precisely because G1 is not a denial and G2's class is covered adjacently;
its cost is the highest on the table. Resolving the deferral honestly (B) is better than paying that cost
for that margin (A), and better than letting the named deferral age (C).

### The strongest argument AGAINST this recommendation

**Deny-site completeness is a real property, and the session-arm adjacency is not identical coverage.** The
programme's signature defect is a mechanism that covers part of a class while a register asserts all of it;
an audit clause that records the authority-currency event on poll, session, heartbeat and ack but is silent
at the guard is **shape-dependent** — recorded when the worker takes one path, invisible when it takes
another. The mitigation here is that the register is *already honest* about the gap (it names the deferral
"NOT accepted-as-gap"), and that G2's class is recorded adjacently. But if the founder weighs deny-site
completeness — every deny site records, no shape-dependence, no adjacent-not-identical window — above the
cost of injecting a mutable collaborator into the 30-conjunct helper, then **(A) is the correct ruling and
this recommendation is overturned.** The measurement in §1–§2 stands either way; only the trade changes.

---

## §5 — Consequential edits (none taken by this paper)

If **(B)** is ruled:

1. Amend DE-18's `audit` clause and DE-04's worker-authority-currency arm in
   `distributed-execution-threat-controls.json`: replace *"attributed to DEFERRED-DECISION:
   guardPlatformAuthority denial sink"* with the resolved disposition — G1 filed as a data-integrity
   fallthrough (unrecorded by the poll-data-integrity rule), G2's deny-site gap accepted on the session-arm
   adjacency with the residual window named. No cohort/count change; `deliveryStatus` stays `partial`.
2. Update `job-leasing.ts:578-587` from the deferral note to the ruling reference.
3. Close the `DEFERRED-DECISION` follow-on task (JOB-003 §5.4's handle) as ruled-B.
4. No finding status moves; nothing is enrolled in `scripts/gate-clause-wiring.json`.

If **(A)** is ruled:

1. A wiring unit lands the contract amendment (its own sweep red observed first at HEAD), the 4th-parameter
   pin, both call-expression pins, the per-conjunct classifier, and the drain — one reviewed PR against the
   most-pinned helper in the codebase.
2. Prove G1/G2 RED-first over embedded PG in the DE-18/DE-04 integration suites (the poll and ack arms).
3. Amend the register to mark the guard deny-site arms `wired`, keyed per-conjunct (generation → DE-18,
   else → DE-04), mirroring the poll/session/heartbeat/ack arms.

If **(C)** is ruled: no edits; the deferral remains open with its §5.4 task handle, and this paper is its
option space of record.

---

## DECISION BLOCK — for founder signature

> **The `guardPlatformAuthority` denial sink** — the disposition of the two shared-platform throws
> (`job-leasing.ts:596` G1, `:638` G2) that the 2026-09-14 Option-B ruling deferred. The sink can hold the
> row (migration `0274`); the ack authority-currency arm is wired (PR #480); the blocker that remains is the
> frozen JOB-003 contract, which lets no denial intent leave the helper (§2). This is a contract-shape
> decision, not a storage one.
>
> Choose ONE:
>
> - [ ] **(B) — RECOMMENDED.** Accept the deny-site gap, made honest: G1 reclassified as a data-integrity
>       fallthrough (unrecorded by the poll-data-integrity rule); G2's deny-site gap accepted on the
>       session-arm adjacency (`security.denied.worker_session`), with the register naming the
>       adjacent-not-identical residual window. Amend DE-18/DE-04 accordingly; close the deferral's §5.4
>       task; no code wired.
> - [ ] **(A)** Amend the frozen contract to admit a denial-intent holder (helper 3 → 4 params, both call
>       pins, the new-argument flow sweep with its red observed first, a per-conjunct classifier, the
>       drain). Records both throws at the deny site, shape-independent. Cost: a caller-supplied mutable
>       collaborator inside the 30-conjunct platform-authority helper — the widest contract relaxation on
>       the table.
> - [ ] **(C)** Hold — keep `DEFERRED-DECISION: guardPlatformAuthority denial sink` open with its §5.4
>       task handle, revisit only if the helper is reopened for another reason.
> - [ ] **(D)** REJECTED unless explicitly overridden — an out-of-band conduit into the helper is option A
>       without its review (§2).
>
> Signed: ____________________  Date: ____________

**No finding status is changed by this document.** DE-18 and DE-04 remain `partial`; E0-F010 and E0-F013
are untouched; nothing is enrolled in `scripts/gate-clause-wiring.json`.
