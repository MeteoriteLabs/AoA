# E8 — Browser automation — findings

## E8-F001 — A frozen fixture and shipped code name DIFFERENT approval authorities for `browser_request`, and nothing can see the disagreement

**Status:** open · **Owner:** `unowned` (BRW-004 shipped its half; see the disposition)
**Severity:** MED
**Filed:** 2026-09-03, by BRW-004 terrain mapping at `203853b3a`.

**What.** For a `browser_request` source, the frozen golden-journey fixture says the approval rides
the **product-approval** authority; shipped JOB-011 code says that authority is `"none"` and the
approval is a **runtime permission decision**. No guard compares the two.

**The two claims, verbatim.**

`tests/fixtures/distributed-execution/browser-approval-download.json:205-207` (frozen; `source.kind`
is `browser_request`):

```json
"control": { "cancellation": "none", "productApproval": "requested_granted", "runtimeDecision": "none" }
```

`server/src/services/job-approval-bridge.ts:173-183`, shipped and test-pinned:

```ts
case "browser_request":
  return { kind: "browser_request",
    productApprovalAuthority: "none",
    runtimeDecisionAuthority: "permission_download_egress",
    aggregateKind: "agent_runtime_decisions",
    projectionKind: "runtime_decision",
    mintsAggregate: true };
```

`job-source-governance-matrix.test.ts:134-140` pins the code side. The sibling fixture
`browser-denied-egress.json` agrees with the *code* (`"runtimeDecision": "egress_denied"`), so the two
browser fixtures do not even agree with each other.

**Why nothing catches it.** `validateFixtureSourceParity`
(`scripts/check-distributed-execution-foundation.mjs:2722-2752`) validates a fixture's requester
principal, executor principal, and required/forbidden `source` fields against
`docs/architecture/distributed-execution-legacy-parity.json`. It **never reads the `control` block**.
The parity contract's own prose for `browser_request` is ambiguous enough to license both readings —
*"Download and egress approval (requested_granted / requested_denied); runtime egress decisions gate
outbound bytes"* — naming an approval and a runtime decision in one sentence.

**Propagation, which is the actual harm.** `BRW-003-terrain.md:205-208` read the fixture and recorded
for BRW-004's benefit that *"a browser approval rides the **product approval** authority, which
already has a command and a bridge. That is BRW-004's, and recording it here saves BRW-004 a needless
Custodian ticket."* The Custodian conclusion is right; the authority is wrong. Acting on it would
have built BRW-004's approval half on the `approvals` table, which has **no `expiresAt`, no TTL and no
timeout of any kind** — making the acceptance clause "denial/**timeout** fails closed" unbuildable.
A false terrain claim propagating into a dependent ticket's design is the failure mode
`BRW-003-terrain.md`'s own CORRECTIONS section exists to prevent.

**Not live.** Nothing in production submits a `browser_request` job, so no wrong approval has been
raised. This is a design-time defect.

**Disposition (REVISED 2026-09-03, Codex review).** BRW-004 takes the code's side (design §2 D2).
The original disposition said slice (b) would express the guard's expectation as "the fixture's
`productApproval` spelling maps to the profile's runtime-decision authority." **That was wrong twice
over and is withdrawn.** (1) `tests/fixtures/distributed-execution/README.md` names *repurposing a
field* as a breaking change requiring a **new versioned directory**, so the mapping is not permitted.
(2) `control.productApproval` and `control.runtimeDecision` are separate enum fields, so mapping the
first would leave the second still reading `"none"` — the guard would have blessed the contradiction
it exists to detect.

The revised disposition: slice (b)'s guard binds both `control` fields to the shipped
`describeSourceGovernance` profile for every fixture **except a pinned historical-divergence list**,
and reports the pinned divergences as a SECOND always-printed verdict that never fails the gate.
(An earlier revision made the gate stay RED on `browser-approval-download.json`; that was withdrawn
on Codex re-review — a permanently-red required check is a check that gets deleted, and the CLI-008
Unit A precedent is a second verdict computed beside `ok`, not a red `ok`.) The pin records the
VALUE tuple, so a new contradicting fixture, or any change to the pinned one's `control` block,
turns the gate red. The real resolution is a **v2 fixture directory** with
`control` corrected, leaving v1 intact — a fixture-owner / Protocol Custodian decision, raised as
BRW-004 design §7 Q5 and **not** BRW-004's to take. This finding therefore stays open until that
decision is made, and **must not be closed by weakening the guard**.

**UPDATE 2026-09-04 — BRW-004 SHIPPED its half; the residual is UNOWNED.** Slice (b) landed the
guard (`scripts/check-distributed-execution-foundation.mjs`): every fixture's `control` block is now
bound to the shipped `describeSourceGovernance` profile, this divergence is pinned by VALUE TUPLE,
and an always-printed census names it and this finding on every `policy` run. A NEW fixture with the
same contradiction is RED; any change to the pinned fixture's `control` block is RED. Eight mutation
cases prove the gate can fire, and an anti-vacuity mutation — replacing the check with an empty
census — turns exactly those eight red and nothing else.

★ One correction to the design, made while building it: the guard's runtime-decision arm is narrower
than §3 slice (b) specifies. `control.runtimeDecision` is a 7-value SCENARIO enum spanning unrelated
mechanisms, while `RuntimeDecisionAuthority` has four members, so binding all seven is a category
error that would have red-lit three innocent fixtures on the first run. The arm binds `egress_denied`
and `budget_stop`; the other four are declared `unmodelled` with a written reason and censused.

What remains is not buildable by any E8 ticket. The resolution is a **new versioned fixture
directory** with `control` corrected, and no ticket in the programme owns the fixture corpus — the
README states the rule but names no authority who may create a v2. BRW-004 design §7 Q5 raised it;
BRW-004's result doc §1 re-escalated it unanswered. Ownership therefore moves to `unowned` with the
successor recorded as "none exists yet", rather than left pointing at a ticket that has shipped —
which is E4-F013's exact failure. Repoint when a fixture owner is named.

---

## E8-F002 — `agent_runtime_decisions` is the designated aggregate for `browser_request` and cannot hold a row for one

**Status:** resolved · **Owner:** BRW-004 (`epics/E8-browser-automation/tickets/BRW-004-result.md` §4, slice (d))
**Severity:** MED
**Filed:** 2026-09-03, by BRW-004 terrain mapping at `203853b3a`.

**What.** `describeSourceGovernance("browser_request")` designates
`aggregateKind: "agent_runtime_decisions"` (`job-approval-bridge.ts:176-182`). That table cannot
store a row for a distributed browser job.

`packages/db/src/schema/agent_runtime_decisions.ts:22-23`:

```ts
agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
runId:   uuid("run_id").notNull().references(() => heartbeatRuns.id, { onDelete: "cascade" }),
```

Both NOT NULL, both foreign-keyed to legacy tables. A `browser_request` job has no `agents` row and
no `heartbeat_runs` row — it has a `jobs` row, an attempt, a lease and a fence.
`RuntimeDecisionOpenRequest` (`job-approval-bridge.ts:226-228`) requires `agentId: string` and
`runId: string` for the same reason. The parity contract additionally permits
`founder | team_lead | team_member | agent` as a browser requester, so for three of the four there is
no agent to name even in principle.

**Why it looks fine.** The one end-to-end exercise —
`server/src/__tests__/job-approval-parity.integration.test.ts:146-171`, *"[runtime] browser_request:
a permission DENY resolves to an E1 result carrying deny"* — passes because it **manufactures** the
missing rows: a seeded `AGENT` constant, `await seedRun(runId)` before the call, and a synthetic
`adapterType: "claude_local"` for a browser session. The test proves the bridge's logic; it does not
prove a browser job can mint the aggregate, and nothing else tries.

**Not live.** `jobApprovalBridge` has zero production callers and is flag-gated off
(`AOA_DISTRIBUTED_EXECUTION_ENABLED` defaults false), and nothing submits a browser job. The failure
would surface on the first real browser approval.

**Disposition.** BRW-004 design §2 D2 relaxes both columns to nullable behind a
`(agent_id IS NULL) = (run_id IS NULL)` CHECK so the legacy pair stays all-or-nothing, and relies on
`job_projection_receipts` — which already carries `jobId`, `attemptId`, `sourceFence`,
`targetAggregateId` and is written fence-guarded by the bridge — for the distributed binding. Two
null branches follow: the bridge's request shape, and the timeout sweeper's `runCanceller`
(`server/src/index.ts:2116-2118`), which today would call `heartbeatService.cancelRun` on a null
`runId`. Rejected alternatives (minting synthetic `agents`/`heartbeat_runs` rows; a parallel browser
decision table) are costed in the design.

**RESOLVED, 2026-09-04, by BRW-004 slice (d)** — `packages/db/src/migrations/0272_browser_request_decision_binding.sql`.

The named defect is fixed: both columns are nullable, `db:generate` emitted the DDL (nothing
hand-authored), and the all-or-nothing CHECK `(agent_id IS NULL) = (run_id IS NULL)` means no row
can be half-bound. Both null branches the disposition names are landed — the bridge's
`RuntimeDecisionOpenRequest` shape and the timeout sweeper's `runCanceller`.

★★★ The disposition named TWO null branches — the sweeper's `runCanceller` and "the bridge's
request shape". There were **NINE**, and two of the seven it missed were lethal: `createPrompt`'s
zombie-run guard and `answerPrompt`'s liveness gate both call `getRunStatus(...)`, which with a null
finds no row and reads that as "the run is terminal" — so the relaxation would have shipped an
approval feature that refuses every one of its own prompts at creation and rejects every answer,
with a completely green typecheck. All nine are closed and mutation-tested, each as a
distributed/legacy PAIR so "correctly skipped" cannot be confused with "accidentally disabled for
everyone"; the full table is in the result doc §4.

★ The second design-named branch (`RuntimeDecisionOpenRequest`, the bridge's entry point) was
initially MISSED BY THIS BUILD and surfaced only because the E4-F013 successor guard forced a
re-read of this disposition. Widening the service beneath an entry point is a silent no-op — a
widened parameter still accepts a narrower argument — so `tsc` stayed green while the relaxation was
unreachable through the only door that matters.

One of them is left in place deliberately and filed separately: `listStrandedAnswers`' INNER JOIN
excludes distributed decisions from the R2 sweep. The exclusion is correct; the sweep that should
replace it cannot exist before JOB-015. That is `E8-F004`.

★ Resolved on the MECHANISM, not on a writer. Nothing submits a `browser_request` job and
`jobApprovalBridge` still has zero production callers, so no distributed decision exists yet. The
finding said the aggregate *cannot hold a row*; it can now, and that is proven by 13 tests and 8
killed mutants. The absence of a writer is BRW-004's own unbuilt scope (result doc §10), not this
finding's residual.

---

## E8-F003 — A sandbox guest can reach the cloud instance-metadata endpoint, and AoA's only egress-shaped provider input does nothing

**Status:** open · **Owner:** `unowned`
**Severity:** HIGH
**Filed:** 2026-09-04, by BRW-004 slice (a), MEASURED against real E2B sandboxes in workflow run
`33857218680` (`.github/workflows/keyed-e2b-egress-constraint-probe.yml`).

**What was measured, and how.** BRW-004 design §D3 option (b) and §7 Q2 both rest on a question
terrain §12 recorded as unestablished: can the sandbox provider constrain a sandbox's outbound
egress at all? The probe answers it differentially — sandbox **A** created with
`metadata.egressAllowlist = "example.com"` (production's exact spelling,
`sandbox-provider-runtime.ts:785-789`), sandbox **B** with none — and runs the identical target set
from inside each guest.

| target | role | A (allowlist declared) | B (control) |
|---|---|---|---|
| `https://example.com/` | positive control | REACHED 200 | REACHED 200 |
| `https://api.github.com/` — **NOT allowlisted** | **the question** | **REACHED 200** | **REACHED 200** |
| `http://169.254.169.254/latest/meta-data/` | observation | **REACHED 401** | **REACHED 401** |
| `https://…invalid/` | apparatus control | FAILED (curl 6) | FAILED (curl 6) |

Both controls held: the allowlisted host succeeded (so the run is not a total-failure artefact) and
the RFC-2606 `.invalid` host failed (so the instrument can observe a failure). This is the third
run; runs `33855470353` and `33856090430` were reported INCONCLUSIVE by the apparatus control and
no verdict was taken from either.

**Two findings in one measurement.**

1. **`SandboxProviderAcquireInput.egressAllowlist` is INERT.** A host absent from the declared
   allowlist was reached from inside sandbox A exactly as from the control sandbox B. Its producers'
   comments already say *"NOT a security boundary"* (`mcp-connectors-env.ts:61-64`); this measures
   that they are correct rather than quoting them. **Consequence:** BRW-004 §D3 option (b) is
   unavailable, so the in-sandbox enforcement point (D3(c)) is the **ONLY** layer, not defence in
   depth. A browser induced to reconfigure its own proxy is not contained by anything else.
2. **The cloud instance-metadata endpoint answers from inside the guest.** `169.254.169.254`
   returned HTTP 401 — an IMDSv2 token challenge, i.e. a live metadata service, not a dropped
   packet. Only IMDSv2's token requirement stands between sandboxed agent-authored code and instance
   credentials. `NETWORK_DENIAL_CLASSES` names `metadata` as the **highest-precedence** deny class
   (`egress-policy.ts:69-74`) and `classifyEgressDestination` implements it correctly — but nothing
   calls it in production (terrain §5), so the classification exists and the enforcement does not.

**Scope, stated so it is not over-read.** This measures the seam AoA production actually uses. It
says nothing about an E2B capability AoA does not call, and it does not establish that the metadata
endpoint is exploitable — only that it is reachable and answering.

**Why `unowned`.** Enforcement is BRW-004 slice (f), which is not in this ticket's landed scope, and
the metadata half is broader than E8: every workload in a sandbox shares the reachability, not just
browser sessions. Recording it against a live successor rather than silently absorbing it into a
result doc.

---

## E8-F004 — A distributed runtime decision has no stranded-answer sweep, and the exclusion is invisible

**Status:** open · **Owner:** `unowned`
**Severity:** LOW
**Filed:** 2026-09-04, by BRW-004 slice (d) while closing E8-F002.

**What.** `listStrandedAnswers` (`server/src/services/agent-runtime-decisions.ts`) is an INNER JOIN
on `run_id`. Now that `run_id` is nullable, every distributed decision is silently excluded from the
R2 stranded-answer sweep wired at `server/src/index.ts`. There is no type error, no runtime error and
no wrong row — a hole, not a crash, which is why it needed measuring rather than typechecking.

**The exclusion is correct; the absence it leaves is not recorded anywhere else.** That sweep exists
to catch an answer whose HEARTBEAT RUN went terminal before the in-band relay could deliver it. A
distributed decision has no heartbeat run and no in-band relay, so the sweep has nothing to say about
it. The join is therefore left as a join.

**But the equivalent does not exist.** Noticing that a job/attempt went terminal before its queued
`runtime_decision_result` was delivered has no implementation. It cannot have one yet: no
control-plane hop delivers a control command to a running worker at all (BRW-004 terrain §4), so
there is no delivery to be stranded from. The sweep belongs beside **JOB-015**'s delivery hop, not in
front of it.

**Not live.** Nothing submits a `browser_request` job and the bridge has no production callers, so no
distributed decision exists to be stranded.

**Disposition.** Repoint to JOB-015, or to whichever ticket lands the distributed delivery path, once
one exists. Do not close it by deleting the join — the join is right; the missing sweep is the gap.
