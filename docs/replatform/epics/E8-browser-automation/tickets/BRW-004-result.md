# BRW-004 Result — Browser secrets, network, and human approval (slices (a)–(d))

**Status:** `gate_review`
**Date (UTC):** `2026-09-04`
**Epic:** `E8-browser-automation`
**Plan task:** `program-design.md:984 — #### BRW-004`
**Implementer:** Claude Opus 5 (Track D)
**Start SHA:** 6c2fe6482b425a6a99507bdc53f49e8f94969c31

> The design records `203853b3a` as its own Start SHA. This build began at `6c2fe6482`, which is
> the branch tip after the design (`919fcd3c4`) and its seven-finding amendment (`6f3c6e893`)
> landed. Recorded as measured rather than copied from the design.

**Scope:** slices **(a)–(d)** only. Slice (e) is chartered as **JOB-015** and is not built here
(§1). Slices (f)–(h) are not attempted; (f) is now materially affected by slice (a)'s measurement.

---

## 1. The two open escalations — resolved and re-escalated

The design's header names two escalations that gate the slices below. Both are answered here, with
the evidence, and one is handed back.

### §2 D1 / §7 Q1 — "Does BRW-004 own the control-command delivery hop?" — **RESOLVED: NO.**

Three independent pieces of evidence, in order of weight:

1. **A ticket exists for it, in a different epic.**
   `docs/replatform/epics/E3-job-control/tickets/JOB-015-design.md` is on disk and its §3 slices
   (b) and (c) are precisely the server-side projection and the worker-side consumer the hop needs.
   It is E3's, not E8's.
2. **The finding register already points there.** `scripts/finding-ownership.json` binds the
   delivery-hop finding to `"ticket": "JOB-015"`, with the note that it "exists for exactly this
   defect".
3. **The orchestrator confirmed it in the build brief**, adding that JOB-015 is being built in
   parallel on `claude/job-015-control-delivery` and that this track must neither build (e) nor
   duplicate it.

**Consequence, stated plainly rather than absorbed:** BRW-004 stops at slice (d), and the
acceptance clause **"denial/timeout fails closed" is DEFERRED** — the decision is produced,
classified and durably recorded (slices (c) and (d)); nothing delivers it to a running worker.
JOB-015 §6.3 already lists BRW-004 as a consumer to notify when it lands.

### §7 Q5 — "Who authorises a v2 fixture directory, and will they?" — **RE-ESCALATED, unchanged.**

This is a fixture-owner / Protocol Custodian decision and I have no authority to take it. Nothing
in the repository names that authority: `tests/fixtures/distributed-execution/README.md` states the
rule (a breaking change, including *repurposing a field*, requires a new versioned directory
leaving v1 intact) but names no one who may create one.

It does **not** gate slice (b). Slice (b) take-2 is written to land without it — the divergence is
pinned by value and censused — and it is built and green. **`E8-F001` stays open** and its
disposition is unchanged: it must not be closed by deleting the pin, by weakening the gate, or by
making the gate permanently red (all three were tried and withdrawn in the design's own history).

### The other four §7 questions, answered by measurement

- **Q2 — "Can the sandbox constrain outbound egress at all?"** **NO.** Measured, slice (a). See §3.
- **Q3 — "What is a `browser_request` job's `agentId` when the requester is a founder?"** **NULL**,
  in an all-or-nothing pair with `runId`, enforced by a DB CHECK (slice (d)).
- **Q4 — "Does anything read `agent_runtime_decisions.agentId` unconditionally?"** **YES — eight
  places, and the design named one of them.** See §4. The UI half is better than feared:
  `ui/src/api/agent-runtime-decisions.ts` already typed both fields nullable and
  `RuntimeDecisionPanel` reads neither.
- **Q6 — "What component turns a broker-resolved credential into browser session state?"** Still
  **none**. Unchanged by this build; slice (g) is not attempted and the login-fixture test remains
  impossible.

---

## 2. Delivered scope

**Delivered**

- **(a)** A keyed real-provider probe that MEASURES whether the sandbox provider can constrain
  outbound egress, with a positive control and an apparatus control. Verdict taken from a real run.
  No product code.
- **(b)** A `policy`-lane check binding every golden-journey fixture's `control` block to the
  **shipped** `describeSourceGovernance` profile, plus an always-printed divergence census as a
  second verdict. Closes the blind spot behind `E8-F001`.
- **(c)** An injected approval seam on `runBrowserSession` gating navigation and downloads, D5's
  refusal of standing grants, and a frozen-source parity test for the mirrored vocabulary.
- **(d)** Migration 0272 relaxing `agent_runtime_decisions.agent_id`/`run_id` to nullable behind an
  all-or-nothing CHECK, plus closure of all eight null-hazards the relaxation creates.

**Explicit non-goals preserved**

- No `packages/worker-protocol` edit. `check:frozen-worker-protocol-v1` is untouched by design.
- No fixture bytes edited — the README forbids it, including "corrections" in place.
- No Lane A file touched: `job-leasing.ts`, `worker-control.ts`, `execution-secret-*.ts` and
  `job_secret_handles.ts` are unchanged, exactly as design §6 says slices (a)–(d) require.
- Slice (e) not built (JOB-015). Slices (f), (g), (h) not attempted.

---

## 3. ★ Slice (a): the measurement, and what it changes

Run **`33857218680`**, success. Two sandboxes, identical except that A declares
`metadata.egressAllowlist = "example.com"` in production's exact spelling
(`sandbox-provider-runtime.ts:785-789`) and B declares none. Identical target set, run from inside
each guest.

| target | role | A (allowlist declared) | B (control) |
|---|---|---|---|
| `https://example.com/` | positive control | REACHED 200 | REACHED 200 |
| `https://api.github.com/` — **NOT allowlisted** | **the question** | **REACHED 200** | **REACHED 200** |
| `http://169.254.169.254/latest/meta-data/` | observation | **REACHED 401** | **REACHED 401** |
| `https://…invalid/` | apparatus control | FAILED (curl 6) | FAILED (curl 6) |

**VERDICT: the allowlist is INERT.** Design §D3 option (b) is unavailable. **The in-sandbox
enforcement point of D3(c) is the ONLY layer, not defence in depth** — and a browser induced to
reconfigure its own proxy is contained by nothing else. Slice (f) must be written against that
threat statement, not the optimistic one.

**The more serious half** is the observation row: the cloud instance-metadata endpoint ANSWERED
HTTP 401 from inside the guest, in both arms — a live IMDSv2 token challenge, not a dropped packet.
Filed as **`E8-F003` (HIGH, unowned)**.

### ★★ The controls did the work, twice, and both times they changed the outcome

Runs `33855470353` and `33856090430` were reported **INCONCLUSIVE** and no verdict was taken from
either: the apparatus control produced no result row while the three other targets returned
normally. Without it, "not_allowlisted REACHED in both arms" was sitting right there and would have
read as a finished measurement taken from an instrument provably dropping one of its four rows.

The cause, once every target's raw channel was printed: curl writes `-w "%{http_code}"` to stdout
and its error to stderr; `2>&1` interleaves them; on the Linux guest the failing case arrived as
**two lines**. On Windows the same command emits one line — **which is exactly why the local
dry-run passed and the real sandbox did not**. A dry-run on a different platform is not a control
for the real one.

### A reusable CI fact, measured

`workflow_dispatch` does fire from a non-default branch (CLI-008 Unit D, `c48259358`) — but only
for a workflow GitHub has already INDEXED. Dispatching this new lane by name on the branch that
introduced it returned `HTTP 404: workflow ... not found on the default branch`. **A new lane
cannot bootstrap itself with `workflow_dispatch`; its first run must come from a `push` trigger on
the branch that introduces it.** The two older keyed workflows' comments state the rule wrongly in
the other direction.

---

## 4. ★★★ Slice (d): the design named ONE null-hazard of eight, and two of the seven were lethal

Design §D2 names the timeout sweeper's `runCanceller`. Measuring Q3/Q4 found seven more. **Two of
them would have shipped an approval feature that refuses every one of its own prompts and rejects
every answer — with a completely green typecheck.**

| # | Hazard | Named by design? | Failure shape |
|---:|---|---|---|
| 1 | `createPrompt` zombie-run guard: `getRunStatus(null)` finds no row → "run is terminal" | **no** | **every distributed decision refused at creation** |
| 2 | `answerPrompt` liveness gate: same shape on the answer side | **no** | **every founder answer cancelled + 409'd** |
| 3 | `runCanceller` aimed at a null run | yes | swallowed by the catch; indistinguishable from a successful cancel |
| 4 | `sourceUniqueKey` template-interpolates `runId` → the literal string `"null"` | no | an identity that works by accident |
| 5 | connector auto-allow probe scoped to an absent agent | no | a probe against a scope that does not exist |
| 6 | two hub projections claim `relatedEntityType: "heartbeat_run"` beside a null id | no | a row that lies quietly (columns are nullable; nothing crashes) |
| 7 | `listStrandedAnswers` INNER JOIN on `run_id` | no | **silent exclusion** — no type error, no runtime error, no wrong row |
| 8 | `RuntimeDecisionDetail` is `.strict()` with `z.string().uuid()` | no | the decision exists in the DB and is unreadable through the hub |

★ A ninth, caught only because the E4-F013 successor guard forced a re-read of the finding's own
disposition: **`RuntimeDecisionOpenRequest` — the bridge's entry point — was still `string`-only.**
Widening the service beneath it is a silent no-op, because a widened parameter still accepts a
narrower argument: `tsc` stays green while a browser job can never reach the relaxed aggregate at
all. Fixed, and while fixing it the bridge's own `runtimeSourceIdentity` — a SECOND implementation
of the dedupe-key rule, bound to the service's only by a comment saying they must be byte-identical
— was replaced by a delegation to the shared helper. The bridge already imported that module, so
there had never been a dependency reason for the copy. A divergence there does not fail loudly: the
receipt fast-path simply never hits, so every replay mints a duplicate aggregate. Mutation D8
reintroduces the copy and is caught by a source-text assertion.

Hazards 1 and 2 are the ticket's own worst-case shape: *a guard that cannot pass looks exactly like
a guard that works.* Both are skipped when there is no run, because a distributed decision's
liveness is the **job fence**, checked by the bridge before either is reached.

Hazard 7 is left in place deliberately — the exclusion is correct (that sweep is about a heartbeat
run going terminal before an in-band relay, and a distributed decision has neither) — and the
absence it leaves is filed as **`E8-F004`**, successor JOB-015.

**Every case is a PAIR.** The distributed arm proves the new branch is taken; the LEGACY arm proves
the guard it skips still fires for a heartbeat run. A test that only shows the null path succeeding
cannot tell "correctly skipped" from "accidentally disabled for everyone" — and mutation D2/D4
below proves the pairs catch exactly that.

---

## 5. Changed files

| File | Responsibility |
|---|---|
| `packages/sandbox-e2b-provider/scripts/probe-e2b-egress-constraint.mjs` | (a) the differential outbound-egress probe |
| `.github/workflows/keyed-e2b-egress-constraint-probe.yml` | (a) its keyed lane; push-bootstrapped because a new lane cannot dispatch itself |
| `.github/keyed-e2b-egress-constraint-trigger` | (a) the trigger + the run-by-run record incl. the two INCONCLUSIVE runs |
| `scripts/check-distributed-execution-foundation.mjs` | (b) the control-block↔authority binding, the value-tuple pin, the census |
| `scripts/check-distributed-execution-foundation.test.mjs` | (b) 8 mutation cases + the authority copied into the fixture root |
| `packages/browser-runtime/src/approval.ts` | (c) the seam, D5's refusal, the fail-closed deadline |
| `packages/browser-runtime/src/run-session.ts` | (c) the navigation and download gates, before the action |
| `packages/browser-runtime/src/index.ts` | (c) exports, so the seam is reachable from a consumer |
| `packages/browser-runtime/src/__tests__/approval.test.ts` | (c) 24 cases, every fail-closed one paired with its positive control |
| `packages/browser-runtime/src/__tests__/approval-frozen-parity.test.ts` | (c) binds the mirrored vocabulary to the frozen source |
| `packages/db/src/schema/agent_runtime_decisions.ts` | (d) nullable pair + the all-or-nothing CHECK |
| `packages/db/src/migrations/0272_browser_request_decision_binding.sql` | (d) `db:generate` output, slot re-pinned at generation |
| `packages/shared/src/validators/hub.ts` | (d) hazard 8: the API boundary would have rejected the null |
| `server/src/services/agent-runtime-decisions.ts` | (d) hazards 1–7 |
| `server/src/services/job-approval-bridge.ts` | (d) hazard 9: the entry point, and the duplicate identity implementation removed |
| `server/src/__tests__/brw-004-distributed-decision-binding.test.ts` | (d) 12 cases, each a distributed/legacy pair |
| `docs/replatform/epics/E8-browser-automation/findings.md` | E8-F003, E8-F004 |
| `scripts/finding-ownership.json` | their `unowned` entries with checkable successors |

---

## 6. Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| "allowed domains … are enforced" | **Not delivered.** Slice (f) not attempted. Slice (a) MEASURED that the provider adds no boundary, so the enforcement point is the only layer | `deferred` |
| "denial/timeout fails closed" — decision produced | (c) `awaitApprovalDecision` refuses on deadline, on denial, on a throwing resolver, on an unknown decision, and on a missing resolver; (d) the aggregate can hold the row | `pass` |
| "denial/timeout fails closed" — decision delivered | **DEFERRED to JOB-015** (§1). Nothing carries a control command to a running worker | `deferred` |
| D5: a browser prompt accepts `allow_once` only | (c) `classifyBrowserPermissionDecision` + frozen-source parity test asserting exactly one frozen decision proceeds | `pass` |
| E8-F001 is visible to a guard | (b) `node scripts/check-distributed-execution-foundation.mjs` prints the census naming E8-F001; a different fixture with the same contradiction is RED | `pass` |
| E8-F002: the aggregate can hold a distributed row | (d) migration 0272 + the CHECK + 12 tests | `pass` |
| "session state is destroyed at terminal state" | Slice (h) not attempted | `deferred` |
| "OAuth refresh remains control-plane-owned" | Unchanged by this build; no browser path touches the refresh lease | `pass (by inheritance)` |
| Test: login fixture / connector rotation / log-leak | Slice (g) not attempted; §7 Q6 still unanswered | `deferred` |

---

## 7. Commands

| Command | Exit code | Result summary |
|---|---:|---|
| `node scripts/check-distributed-execution-foundation.mjs` | `0` | PASS; census names E8-F001 + 4 unmodelled values |
| `node --test scripts/check-distributed-execution-foundation.test.mjs` | `0` | 190 pass / 0 fail (182 before, +8) |
| `npx vitest run` (packages/browser-runtime) | `0` | 127 pass / 17 skipped (93 before; +24 approval, +10 frozen-parity) |
| `npx vitest run src/__tests__/brw-004-distributed-decision-binding.test.ts` | `0` | 13 pass |
| `npx vitest run` × 4 neighbouring decision suites | `0` | 90 pass / 0 fail — no regression |
| `npx tsc -p . --noEmit` (server) | `0` | clean (pre-existing `TS18046` noise in `routes/plugins.ts` unrelated) |
| `npx tsc -p . --noEmit` (ui) | `0` | clean |
| `npx tsc --noEmit` (packages/browser-runtime) | `0` | clean |
| `node scripts/check-finding-ownership.mjs` | `0` | OK, 30 open findings across 10 registers |
| `drizzle-kit generate` | `0` | `0272_browser_request_decision_binding.sql`, only the intended table |
| GH run `33857218680` | `0` | the slice (a) measurement, both controls satisfied |

### Mutation log — every guard shown RED, then restored

| # | Mutation | Killed by | Restored |
|---:|---|---|---|
| B1 | slice (b)'s check call replaced by an empty census | 8 tests (182/8) | 190/190 |
| C1 | `allow_always` proceeds (D5 removed) | 5, incl. the frozen-parity pair | ✔ |
| C2 | missing resolver fails OPEN | 1 | ✔ |
| C3 | the gate neutered entirely | 5, incl. the download half | ✔ |
| C4 | a throwing resolver fails OPEN | 1 | ✔ |
| C5 | the timeout returns proceed | 2 | ✔ |
| D1 | `createPrompt` guard un-skipped for a null run | 1 | ✔ |
| D2 | `createPrompt` guard removed for **everyone** | 2 (both positive controls) | ✔ |
| D3 | `answerPrompt` gate un-skipped | 1 | ✔ |
| D4 | `answerPrompt` gate removed for **everyone** | 1 (the positive control) | ✔ |
| D5 | canceller aimed at a null run | 1 | ✔ |
| D6 | sentinel replaced by template-null | 3 | ✔ |
| D7 | hub type claim restored unconditionally | 1 | ✔ |
| D8 | the bridge's duplicate identity implementation reintroduced | 1 | ✔ |

Final restored state verified green, not assumed: 127 (browser-runtime), 190 (foundation), 77
(server decision suites; 78 after the bridge change).

---

## 8. Deviations

1. **★★★ Slice (b)'s runtime-decision arm is narrower than the design specifies, and the design as
   written would have red-lit three innocent fixtures.** §3 slice (b) says to bind BOTH
   `control.productApproval` and `control.runtimeDecision` to the shipped profile. That is right for
   `productApproval` — a 3-value enum whose non-`none` values each assert "a product approval
   existed here", which is exactly where E8-F001 lives. It is a **category error** for
   `runtimeDecision`, a 7-value SCENARIO enum spanning unrelated mechanisms:
   `RuntimeDecisionAuthority` has four members and four of the seven scenario values name mechanisms
   it does not model at all. Taken literally, `plaintext-secret-in-argv-rejected`,
   `service-provider-pause-resume` and `service-restart-checkpoint` would each have failed a
   contract they never claimed to satisfy. The arm therefore binds only `egress_denied` and
   `budget_stop`; the other four are declared `unmodelled` **with a written reason** and printed in
   the census. Naming an omission is the `unowned`-with-reason pattern; leaving it silent would be
   the blanket exemption the whole slice exists to avoid.
2. **The design's §D2 null-branch list is incomplete by seven.** §4 above. Not a disagreement with
   the decision — the decision is right and is implemented as specified — but the work it implies is
   materially larger than "two call sites then need a null branch".
3. **Slice (c) does not emit a `runtime_decision_requested` event, and cannot.** The design says the
   seam emits it "through the worker's existing `EventSequencer`". The sequencer is host-side, in
   the worker daemon; `packages/browser-runtime` is staged into the guest as bare files with no
   `node_modules`. More importantly the frozen event requires a `requestDigest` (SHA-256 over
   canonical bytes) and a `sourceRevision`, and the guest has neither the canonicalizer nor the
   counter. A digest the control plane recomputes differently is **worse** than none: it fails as a
   request that never verifies, which reads as a hung session. The guest therefore produces an
   INTENT of only the fields it is the authority for, pinned field-by-field against the frozen
   schema's source. **The completion step is not built.**
4. **Slice (a)'s workflow carries a build-branch push trigger.** Required, not decorative: without
   it the lane could not run before its own PR merged, and an unrun probe measures nothing (§3).

---

## 9. Findings

- **`E8-F001`** — **still open, now `unowned`.** BRW-004 shipped its half: the divergence is
  VISIBLE to a guard for the first time, pinned by value tuple, and censused on every `policy` run.
  The residual — a v2 fixture directory — is §7 Q5's escalation, handed back (§1), and **no ticket
  in the programme owns the fixture corpus**. Moved to `unowned` with "none exists yet" rather than
  left pointing at a ticket that has now shipped, which is E4-F013's exact failure.
- **`E8-F002`** — **RESOLVED.** Migration 0272 + the all-or-nothing CHECK + both null branches the
  disposition names (the bridge's `RuntimeDecisionOpenRequest` shape and the sweeper's
  `runCanceller`) + the six further hazards the disposition missed. 13 tests, 8 killed mutants.
  Resolved on the MECHANISM: the finding said the aggregate *cannot hold a row*, and it can now. The
  absence of a production writer is BRW-004's own unbuilt scope (§10), not this finding's residual —
  saying otherwise would leave a fixed defect open forever.
- **`E8-F003`** — **NEW, HIGH, unowned.** The sandbox's egress allowlist is inert and the cloud
  instance-metadata endpoint answers from inside the guest. Successor named.
- **`E8-F004`** — **NEW, LOW, unowned.** No stranded-delivery sweep for a distributed decision;
  it cannot exist before JOB-015. Successor named; must not be closed by deleting the join.

---

## 10. ★ Built but NOT wired — read this before believing anything above is live

- **Nothing submits a `browser_request` job** (terrain §12). Every slice here is exercised by tests,
  not by production traffic.
- **Slice (c)'s seam has no real resolver.** It ships `inertRefusingResolver`, and the gate defaults
  **off**, because no control-plane hop delivers a decision to a running worker. Turning the gate on
  today makes every session refuse at its first step.
- **Slice (d) adds no writer.** `jobApprovalBridge` still has zero production callers and is
  flag-gated off. The aggregate is now *able* to hold a distributed row; nothing writes one. The
  bridge's `openGovernedDecision`/`resolveGovernedDecision` composition and the timeout sweeper's
  coupling to it are **not landed** — both are only observable end-to-end once JOB-015 delivers, and
  the sweeper change is a behavioural change to a boot-rooted 30-second loop.
- **Slice (a) is a probe.** It gates nothing and enforces nothing. It answers a question.

### ★★★ Capability: this work does NOT flip the E7-1 gate, and here is exactly what would

`capabilityProven` is cleared by `countProducedOutputs`
(`e7-distributed-run-verifier.ts:506`), an OR over `workspacePatchArtifacts` and `taskOutputs`. The
artifact arm filters `kind = "workspace_patch"`
(`e7-distributed-run-verifier-store.ts:205-209`).

**Nothing in slices (a)–(d) commits a `job_artifact` of any kind, let alone `workspace_patch`, and
nothing writes a `task_output`.** Slice (a) creates no job at all. Slices (b) and (d) are a CI check
and a schema relaxation. Slice (c) produces an approval intent, not an artifact.

So: **this advances the approval and governance path without moving the capability counter.** What
would still be required is unchanged from CLI-008 Unit F §1.6 — a file to export, a real
`exportArtifact`/`digestArtifact`, the worker-side consumer (DAT-009 slice 3), and (for task
projection, though not for the counter) an `artifactPrepared` announcement plus a projector. None of
that is here and none of it is claimed.

---

## 11. Follow-up tickets

- **JOB-015** — the delivery hop. Unblocks "denial/timeout fails closed" end-to-end and is the
  successor for `E8-F004`.
- **BRW-004 slices (f)/(g)/(h)** — egress enforcement, connector materialization, session-state
  destruction. Slice (f) must now be written against slice (a)'s measured threat statement: the
  in-sandbox enforcement point is the ONLY layer.
- **`E8-F003`'s metadata half needs an owner beyond E8** — every sandboxed workload shares the
  reachability, not only browser sessions.

---

## 12. Gate recommendation

**Ready for independent review**, for slices (a)–(d) as scoped.

Every fail-closed clause implemented here has a positive control that was shown to fire, and every
guard was mutated red and restored. The deferrals are named with their reasons rather than implied,
the capability question is answered in the negative rather than avoided, and the two escalations are
reported as resolved (Q1) and handed back (Q5).

**What a reviewer should attack first:** deviation 1 (I narrowed a design-specified binding — check
that the narrowing is honest and not convenient), and §4 hazard 7 (I left an INNER JOIN in place and
filed the gap; check the exclusion really is correct rather than merely convenient).

**Codex verdict: ABSENT.** No independent Codex review was obtained for this build. Recorded in
words rather than read as approval.

---

## 13. Independent review

**Reviewer:** `pending until first independent review`
**Reviewed revision:** `pending until first independent review`
**Disposition:** `pending`
**Review evidence:** `pending until first independent review`

## 14. Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- First independent reviewer appends attempt 1. -->
