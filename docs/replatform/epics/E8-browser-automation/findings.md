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

**RESOLVED, 2026-09-04, by BRW-004 slice (d)** — `packages/db/src/migrations/0272_browser_request_decision_binding.sql`
and `0273_trust_rule_agent_binding.sql`.

The named defect is fixed: both columns are nullable, `db:generate` emitted the DDL (nothing
hand-authored), and the all-or-nothing CHECK `(agent_id IS NULL) = (run_id IS NULL)` means no row
can be half-bound. Both null branches the disposition names are landed — the bridge's
`RuntimeDecisionOpenRequest` shape and the timeout sweeper's `runCanceller`.

★★★ The disposition named TWO null branches — the sweeper's `runCanceller` and "the bridge's
request shape". There were **TEN**, and three of the eight it missed were lethal: `createPrompt`'s
zombie-run guard and `answerPrompt`'s liveness gate both call `getRunStatus(...)`, which with a null
finds no row and reads that as "the run is terminal" — so the relaxation would have shipped an
approval feature that refuses every one of its own prompts at creation and rejects every answer,
with a completely green typecheck. The third granted too much instead of too little: see below. All
ten are closed and mutation-tested, each as a distributed/legacy PAIR so "correctly skipped" cannot
be confused with "accidentally disabled for everyone"; the full table is in the result doc §4.

★★★ **THIS RESOLUTION WAS PREMATURE WHEN FIRST WRITTEN, and said NINE.** The tenth was found by
adversarial review of PR #356 after this finding had already been marked resolved and the branch was
CI-green on 16 checks. It is the one hazard design §D5 predicted by name — *"the moment slice (c)
populates `networkTarget` … `allow_always` becomes reachable for browser egress"* — and slice (c)
DID land a §D5 refusal, in the GUEST (`classifyBrowserPermissionDecision`), which decides whether
the browser acts on a decision and not whether the control plane writes a trust rule. `answerPrompt`
mints the rule first. So `buildTrustRuleInsert` copied the newly-nullable `agentId` into
`agent_runtime_trust_rules` — whose own `agent_id` was nullable and, unlike its sibling declared
directly above it, carried NO check — and `trustRuleMatchesPrompt` read `rule.agentId && …`, making
an unbound rule a **wildcard in the AGENT dimension**: one founder answering "always allow this
browser session to reach example.com" would have authorised sessions they never saw.

★ Blast radius RE-DERIVED, not asserted. A match also needs equal `riskClass` and an exact
`networkScope`, and the browser seam emits `network_egress` + a URL ORIGIN while the CLI hook bridge
emits `network` + a bare HOSTNAME — so heartbeat prompts are out of reach TODAY by a two-clause
coincidence nobody designed, not by any guard. In reach: every other distributed browser prompt in
the company on the same adapter and origin, for 90 days, and forever for `allow_run` (`expiresAt:
null`). The fix is written on the BINDING rather than on the coincidence, because the coincidence is
one edited string away from disappearing.

★★ **The relaxation did not add the wildcard; it woke it up.** That clause was dead code while
`agent_runtime_decisions.agent_id` was NOT NULL, because the only production writer of the trust
table copies from it. Nothing in the ticket's diff is near `trustRuleMatchesPrompt`, and no test
could have gone red — *relaxing a column can promote unreachable code to reachable code somewhere
the diff never touches.*

Closed in three layers: `standingGrantBinding` refuses a standing grant for an unbound decision
(one call site; both builders take the narrowed `string` it returns, so the guard cannot be
bypassed), the matcher compares agents strictly, and migration **0273** makes
`agent_runtime_trust_rules.agent_id` NOT NULL — which turns the exact defect line into a `tsc`
error. **Not the sibling's check:** `(agent_id IS NULL) = (run_id IS NULL)` would reject every
persistent grant, because such a grant is agent-bound and run-less by design. Proven against real
Postgres (8/8, including the `23502` rejection) and re-appliable
(`migration-readiness.integration.test.ts` 4/4, the suite that caught 0272).

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
finding said the aggregate *cannot hold a row*; it can now, and that is proven by 23 unit tests, 8
real-Postgres cases and 16 killed mutants (D1–D11 + E1–E5, counted from the result doc's log rather
than carried forward — this sentence said "13 tests and 8 killed mutants" while the log had grown
past it). The absence of a writer is BRW-004's own unbuilt scope (result doc §10), not this
finding's residual.

---

## E8-F003 — Sandbox egress is enforced at none of the three candidate points, and four programme records state the constraint as fact

**Status:** open · **Owner:** `unowned`
**Severity:** HIGH
**Filed:** 2026-09-04, by BRW-004 slice (a), MEASURED against real E2B sandboxes in workflow run
`33857218680` (`.github/workflows/keyed-e2b-egress-constraint-probe.yml`).
**Re-verified and re-scoped 2026-09-04** at `da1a90597` by the E8-F003 disposition unit. Every
claim below was re-measured rather than inherited; §3 and §4 are new, and §5 corrects a claim the
triage that opened this unit carried.

### 1. What was measured, and how

BRW-004 design §D3 option (b) and §7 Q2 both rest on a question terrain §12 recorded as
unestablished: can the sandbox provider constrain a sandbox's outbound egress at all? The probe
answers it differentially — sandbox **A** created with `metadata.egressAllowlist = "example.com"`
(production's exact spelling, `sandbox-provider-runtime.ts:785-789`), sandbox **B** with none — and
runs the identical target set from inside each guest.

| target | role | A (allowlist declared) | B (control) |
|---|---|---|---|
| `https://example.com/` | positive control | REACHED 200 | REACHED 200 |
| `https://api.github.com/` — **NOT allowlisted** | **the question** | **REACHED 200** | **REACHED 200** |
| `http://169.254.169.254/latest/meta-data/` | observation | **REACHED 401** | **REACHED 401** |
| `https://…invalid/` | apparatus control | FAILED (curl 6) | FAILED (curl 6) |

Both controls held: the allowlisted host succeeded (so the run is not a total-failure artefact) and
the RFC-2606 `.invalid` host failed (so the instrument can observe a failure). This is the third
run; runs `33855470353` and `33856090430` were reported INCONCLUSIVE by the apparatus control and
no verdict was taken from either. The per-run record, including both inconclusive runs and what
each fixed, is `.github/keyed-e2b-egress-constraint-trigger`.

**The metadata row is an observation in its own right, and the status code is the whole point.**
`169.254.169.254` returned **HTTP 401**, not a timeout and not a connection error — that is an
IMDSv2 token challenge, i.e. a **live metadata service answering**, not a dropped packet. It
answered in BOTH arms. So only IMDSv2's token requirement stands between sandboxed, agent-authored
code and that endpoint. This half is broader than E8: every workload in a sandbox shares the
reachability, not only browser sessions.

**Consequence for BRW-004's design.** §D3 option (b) — constrain egress at the provider — is
**unavailable**, so the in-sandbox enforcement point D3(c) is the ONLY layer rather than defence in
depth. A browser induced to reconfigure its own proxy is contained by nothing else.

### 2. The producer seam, traced end to end

Both production sites compute the allowlist and pass it into a real acquire — verified at this SHA,
not quoted: `heartbeat.ts:4448` (org runs) and `internal-agent/aoa-agents/runner.ts:714` (crew runs)
call `loadConnectorEgressHosts` and hand the result to `acquireExecutionContext` as
`egressAllowlist` (`:4490` and `:724`). It is forwarded verbatim through
`acquire-execution-context.ts:76` → `environment-runtime.ts:575` →
`environment-run-orchestrator.ts:331` and lands in exactly three places, **all of which record and
none of which enforce**: the E2B `Sandbox.create` call's `metadata` as a comma-joined string
(`:787-789`), our own lease-metadata row (`buildE2bLeaseMetadata`, `:621`), and the fake provider's
metadata (`:385`). There is no fourth consumer. The comment at the E2B site says so itself —
*"S4 — best-effort managed recording only"*.

### 3. ★ There is no enforcement layer at ANY of the three candidate points

This is the part that makes the finding what it is, and each point was measured separately.

1. **Provider level — MEASURED INERT.** §1. A host absent from the declared allowlist was reached
   from inside the sandbox that declared it, identically to a control sandbox that declared none.
2. **In-sandbox — UNBUILT.** BRW-004 §D3 option (c) is the chosen enforcement point and is slice
   (f). `BRW-004-result.md:15` and `:99` record slices (f)–(h) as not attempted, and `:366` books
   the acceptance condition *"allowed domains … are enforced"* as `deferred`.
3. **Proxy — ZERO PRODUCTION CALLERS.** `classifyEgressDestination` (`egress-policy.ts:228`) is
   correct, ranks `metadata` highest (`:69-74`), and is dual-driven in the always-on `policy` lane
   against two committed fixture corpora. Its **only** non-test consumer is
   `createFenceAwareEgressProxy` (`egress-proxy.ts:146,239`) — and `egress-proxy.ts` is imported by
   exactly one file in the repository, the integration test
   `server/src/__tests__/egress-proxy.integration.test.ts:29`. Two production comments assert the
   same independently (`routes/worker-control.ts:160`, `services/execution-secret-resolve.ts:7`).
   The chain is unreachable from boot: the classifier's only route into production is a module
   nothing imports.

**So the classification exists and the enforcement does not — at any layer.** What that blocks is
therefore not a build task. It is THE CLAIM that sandbox egress is constrained.

### 4. ★★ Where the constraint is claimed — the answer is both, and the line is sharp

The producer comments already say *"NOT a security boundary"*
(`mcp-connectors-env.ts:59-66`: "NOT a security boundary … advisory, managed-E2B-best-effort").
The measurement **CONFIRMS** them, and confirms the rest of the honest set too:

- **The deployed system's own spec discloses it.** `docs/aoa/plans/2026-08-05-cloud-execution-isolation-e2b-spec.md`
  §12 first bullet: *"Managed-E2B egress is not fully lockable. On managed E2B, sandboxes get fairly
  open egress; the 'allowlist' (Q2) may be closer to open in practice there."* Its §9 **Security
  invariants** list contains **no egress invariant at all**, and Q2's own rationale (§3) says the
  choice is *"not a cross-tenant control (data plane owns that)"*. Nothing at the deployed
  `cloud_auth` layer represents egress as a security boundary, so the measurement breaks no promise
  there.
- **Every ticket-level document is honest.** `DAT-005-result.md:14` records its own outbound channel
  as the inert E4-D12 seam; `DSK-001-lane-B-design.md:20-31` states the zero-caller fact up front
  and calls it the plan rather than an oversight; `DSK-002-result.md:161-163` explicitly refuses to
  report `sandbox.filtered_egress` because *"neither Docker's default bridge nor a bare OS sandbox
  filters egress"*.

Four **programme-level** records, however, state the constraint in the present indicative, and it is
these the measurement **CONTRADICTS**:

1. `docs/replatform/program-design.md:149`, in a section headed **"Security invariants"**, beside
   invariants that are genuinely enforced (non-owner role + forced RLS; secret handles, not
   plaintext): *"Sandbox egress is default deny. Metadata endpoints, RFC1918 destinations,
   worker-host control ports, and the AoA data plane are denied unless explicitly required."*
   `:146` adds *"Every governed or metered external effect uses a fence-aware egress proxy…"*.
   Nothing in the section distinguishes an invariant that holds from one that must be built.
2. `docs/architecture/distributed-execution-threat-controls.json`, **DE-08**, severity **Critical**:
   `confidentiality` = *"internal metadata and control-plane ranges are unreachable"*;
   `authorization` = *"default-deny; only allowlisted destinations are permitted"*; `trustedSide` =
   *"filtered egress and a credential-injecting proxy"*. Its `failureMode` is *"a workload reaches
   cloud metadata or the control plane"* — **which is literally what §1 measured**. Its sole
   `ownerTickets` entry is DAT-005, whose chartered outcome (`program-design.md:726`) is to
   *"**Enforce** default-deny destination policy … and block private/metadata/control-plane ranges
   and direct bypass"* and which is marked **COMPLETE**. The owner column is exhausted; the control
   is absent; the record carries no field that could tell those apart.
3. `docs/architecture/distributed-execution-threat-model.md` renders DE-08 and then, in **"Residual
   risks and release exclusions"** — the one place an unmitigated Critical would be disclosed —
   omits it, **while listing a sibling egress exclusion** (*"Unvalidated gVisor bridge egress"*). A
   reader is entitled to infer from that asymmetry that this one is covered.
4. `epics/E5-workspaces-secrets/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md` grades the E5 exit-gate
   clause **"denied egress"** as one of only two clauses `proven_in_d1`. Its basis is
   `tests/d1/e6f-08-egress-isolation.test.mjs`, which proves unreachability of *the identical
   targets* — `169.254.169.254`, an arbitrary public address — by **docker-compose `internal: true`
   network segmentation around a container analog** (`worker-a` plus `fake-provider`). It never
   touches `createFenceAwareEgressProxy`, `classifyEgressDestination`, or the real provider. The
   same words name two different subjects, and on the real one the result is the opposite.

**The answer to "confirms or contradicts" is therefore: confirms at the layer that runs, contradicts
at the layer that claims.** The deployed `cloud_auth` path never asserted egress as a control; the
distributed programme asserts it four times and is default-off, so nothing is currently exploitable
*through the claiming path*. That is the reason this is not an incident — and it is a reason with an
expiry date, because it holds only while distributed execution stays off.

### 5. A correction to the record

The triage that opened this unit stated that the zero-caller status is evidenced in part by the
symbol's *"presence in the repo's own unprovable-clause inventory"*. At `da1a90597` that was **not
true of the live register**: `scripts/gate-clause-wiring.json` had stopped tracking the egress path
entirely, because DAT-008 slice 5 re-pointed clause `E5-5`'s symbol from `createFenceAwareEgressProxy`
to `synthesiseRunSecrets` — correctly for its own purpose, since Direction A never uses the egress
proxy, but the clause it was standing in for went with it. Only the library **header**
(`scripts/lib/gate-clause-wiring.mjs:9`) still named the symbol, as prose. So between that re-point
and this finding, the guard whose entire purpose is to make "declared working, nothing calls it"
impossible reported nothing about the one capability that was in exactly that state.
Fixed in the same branch: re-enrolled as `E5-6-denied-egress` → `unwired`, mutation-proven to go red
if it is ever flipped to `wired`, and now printed in the DORMANT line on every green run.

### 6. Disposition — HIGH is unchanged, and here is why it does not move

The evidence that arrived since filing **raises** the case rather than lowering it: three
enforcement points instead of one are measured absent (§3); four programme records assert the
control (§4), one of them rating the exact measured event Critical with an exhausted owner; and the
mechanism that would have kept the gap visible had gone silent (§5). No evidence supports a
downgrade. The nearest thing to an argument for one — "the claiming system is default-off" — is a
statement about *reachability of the claim*, not about the truth of it, and it is already the reason
this is filed rather than escalated.

**Scope, stated so it is not over-read.** This measures the seam AoA production actually uses. It
says nothing about an E2B capability AoA does not call; it does not establish that the metadata
endpoint is exploitable, only that it is reachable and answering; and the `169.254.169.254` service
belongs to the **provider's** infrastructure, so what credentials it might yield to a token-bearing
caller is unmeasured. Nothing here asserts a cross-tenant breach: the deployed blast-radius reframe
(spec §9) is untouched.

**Why `unowned`, and what it blocks.** No ticket in the roster is chartered to wire egress
enforcement for the path that was measured. BRW-004 slice (f) is real, open (`gate_review`) and the
only chartered candidate — but it is scoped to browser sessions, and the measurement is of org
heartbeat runs and crew runs, neither of which is a browser session. The two tickets that *were*
chartered to reach this path have both shipped without it and said so: DAT-005 (COMPLETE) and
DSK-002 (`…mediate device-local handles through the DAT-004 broker plus fence-aware egress path`).
Naming either as the successor would be filing against a closed ticket; naming a new one would be
inventing an owner. So this stays `unowned` **with a reason saying what it blocks**: until an
enforcement point exists, `program-design.md:149`, DE-08's `confidentiality`/`authorization`/
`integrity` clauses, and the E5 gate's "denied egress" clause cannot be asserted of the real
provider. **Repoint it when a ticket takes egress enforcement for the sandbox path — not for the
browser path alone. Do NOT close it by citing `classifyEgressDestination`, the `policy`-lane vectors
gates, or `e6f-08`: the first two exercise a pure function no production path reaches, and the third
measures a docker network, not a sandbox.**

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

---

## E8-F005 — Nothing in CI compares the Drizzle schema to the migrations, so a narrowing can be silently reverted

**Status:** open · **Owner:** `unowned`
**Severity:** MED
**Filed:** 2026-09-04, by BRW-004 while closing E8-F002's tenth null-hazard. MEASURED by mutation,
not inferred.

**What.** `packages/db/src/schema/*.ts` and `packages/db/src/migrations/*.sql` are two independent
statements of the same truth, and no check compares them. The `migrations` CI job validates the
JOURNAL (idx contiguity, a SQL file per entry, the committed-snapshot `prevId` chain) — all of which
stay perfectly valid when the schema and the DDL disagree. `drizzle-kit generate` is run by a human
and its output is committed; nothing re-runs it in check mode.

**How it was measured.** Mutation E5 of BRW-004: revert `agentRuntimeTrustRules.agentId`'s
`.notNull()` in the schema while leaving migration `0273` in place. Before a pin was hand-written
for that one column, **the mutation was GREEN** — `tsc` passes (`string` is assignable to
`string | null`), every service test passes, `migrations` passes, `policy` passes. The drift is
invisible, and the next `db:generate` would silently emit a re-narrowing migration as if it were a
new intent.

**Why it matters more than tidiness.** The direction that goes undetected is the RELAXING one. A
narrowing is usually load-bearing — `0273`'s NOT NULL is what makes a company-wide wildcard trust
rule unrepresentable, and what turns the defect line into a compile error. A revert of that one
token restores the hazard while the migration that "closed" it is still sitting in the tree, still
applied on every existing database, still cited in a result doc. **The artifact that proves the fix
and the artifact that enforces it are different files, and only one of them is checked.**

**Scope, stated so it is not over-read.** This is a DETECTION gap, not a live defect: the schema and
the migrations agree at this SHA (verified against real Postgres by
`brw-004-decision-binding.integration.test.ts`, 8/8). It says nothing about whether any existing
migration has already drifted — that is exactly what nothing can currently answer.

**What BRW-004 did about it, which is not a fix.** One hand-written assertion in
`packages/db/src/__tests__/agent-runtime-decisions-schema.test.ts` pins `agent_id`'s `notNull` and
`run_id`'s nullability for this one table. A per-column pin written by whoever remembers to write
it is the "check that only exists where someone thought of it" pattern, not a guard over the class.

**Disposition.** The real closure is a CI step that regenerates and fails on a non-empty delta
(`drizzle-kit generate` into a scratch dir, then diff), which is a `policy`-lane change with a
blast radius across every schema file — larger than any E8 ticket and unrelated to browser
automation. **Do not close it by adding more per-column pins.**

