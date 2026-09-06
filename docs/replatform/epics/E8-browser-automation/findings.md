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

## E8-F003 — A Critical threat control is recorded as owned-and-delivered while its enforcement does not exist anywhere: sandbox egress is filtered at none of the three candidate points, and the cloud metadata endpoint answers from inside the guest

**Status:** open · **Owner:** `unowned`
**Severity:** HIGH
**Filed:** 2026-09-04, by BRW-004 slice (a), MEASURED against real E2B sandboxes in workflow run
`33857218680` (`.github/workflows/keyed-e2b-egress-constraint-probe.yml`).
**Re-verified 2026-09-04** at `da1a90597` by the E8-F003 disposition unit; **re-headlined, and the
machine-readable register entry repaired, 2026-09-05** after review. Every claim below was
re-measured rather than inherited. §7 states what changed on review — including a correction to
this unit's own first commit, which took a downgrade it said it had not taken.

### 0. CORRECTION, 2026-09-07 (W10A) — one of this finding's stated REASONS is unsupported. Its CONCLUSION is unchanged.

**Status, severity and ownership are NOT touched by this note**, and nothing below is a downgrade.
What changes is a premise, not a verdict.

§2 concludes *"§D3 option (b) — constrain egress at the provider — is **unavailable**, so the
in-sandbox enforcement point D3(c) is the ONLY layer rather than defence in depth."* The stated
ground for "unavailable" was the 2026-08-05 spec's §12 bullet, quoted approvingly in §5 below:
*"Managed-E2B egress is not fully lockable."* **That bullet is refuted as a CAPABILITY claim.**
Finding **`E8-F007`** measured the installed, lockfile-pinned `e2b@2.30.5` and found
`SandboxOpts.network` reaching the create body, `updateNetwork` for a running sandbox, and a
`getInfo()` read-back of the applied configuration. The provider layer therefore has a real,
shipped configuration surface that this finding recorded as absent.

**Three things this note does NOT say, stated so it is not over-read:**

1. **It does not close, weaken or reduce this finding.** §3's conclusion — *enforcement exists at
   NO layer* — is untouched and was measured independently at each of the three points. A
   capability that exists and is not called changes nothing about what runs.
2. **It does not say egress can be locked.** Whether the operator's E2B tier honours a `network`
   body is UNMEASURED. Nothing validates the body client-side (`buildNetworkEgress` is a
   passthrough; the only error path is HTTP status) and the API target is per-company configurable,
   so a tolerant or self-hosted server can return `200` and leave the sandbox unpoliced with
   identical code and identical logs. A read-back is mandatory before anyone relies on it.
3. **It does not move §2's measurement.** The probe measured `metadata.egressAllowlist`, which is
   what AoA actually sends. That result stands exactly as recorded: a `metadata` string is inert,
   and the SDK never claimed otherwise.

**What it does change for the disposition.** "Option (b) is unavailable" must now be read as
*"option (b) is UNADOPTED, and whether the operator's tier honours it is unmeasured"*. D3(c) is
still the only layer that exists **today**, but the reason is a build gap, not a missing capability
— and defence in depth at the provider is back on the table for whoever takes ownership. Do not
cite the §12 bullet as a reason for anything without reading `E8-F007` first.

### 1. ★★★ The headline: four programme records state this control as fact, and one is a Critical crossing whose sole owner has already shipped

This is what the finding is *for*. The measurement (§2–§4) is the evidence; **the misrepresentation
is the defect**, and it outranks the disposition question this unit was opened to answer.

**1. `docs/architecture/distributed-execution-threat-controls.json`, `DE-08`, severity `Critical`.**
Its `failureMode` is *"a workload reaches cloud metadata or the control plane"* — **which is
literally what §2 measured happening**. Its clauses are written as statements of fact:
`confidentiality` = *"internal metadata and control-plane ranges are unreachable"*; `authorization`
= *"default-deny; only allowlisted destinations are permitted"*; `integrity` = *"blocked IP/DNS
ranges cannot be reached via rebinding"*; `trustedSide` = *"filtered egress and a
credential-injecting proxy"*. Its **sole** `ownerTickets` entry is **DAT-005**, whose chartered
outcome (`program-design.md:726`) was to *"**Enforce** default-deny destination policy through the
fence-aware egress path, block private/metadata/control-plane ranges and direct bypass"* — and
whose result doc (`DAT-005-result.md:3`) reads **`Status: COMPLETE`**.

> **A Critical control whose owner column is exhausted, whose enforcement does not exist at any
> layer, and whose record carries no field able to distinguish *required* from *delivered*, is a
> live misrepresentation of this programme's security posture.** Nothing in the JSON is marked
> pending, deferred, or planned; a reader — human, or the `REL-001` release gate the record itself
> names as its `releaseTest` — has no way to tell it apart from a control that is genuinely
> enforced.

**2. `docs/replatform/program-design.md:149`, under a heading reading "Security invariants":**
*"Sandbox egress is default deny. Metadata endpoints, RFC1918 destinations, worker-host control
ports, and the AoA data plane are denied unless explicitly required."* `:146` adds *"Every governed
or metered external effect uses a fence-aware egress proxy…"*. It sits in a list beside invariants
that **do** hold (non-owner role plus forced RLS; secret handles, not plaintext secrets, in job
envelopes). Nothing in the section distinguishes an invariant that is enforced from one that must
still be built.

**3. `docs/architecture/distributed-execution-threat-model.md:121`, "Residual risks and release
exclusions"** — the one place in the programme where an unmitigated Critical would be disclosed —
**omits DE-08, while listing a sibling egress exclusion** (*"Unvalidated gVisor bridge egress"*,
`:129`). A reader is entitled to infer from that asymmetry that this one is covered. The section's
own preamble says the items it lists *"are not mitigated by the controls above"*, which places
everything absent from it on the mitigated side.

**4. `epics/E5-workspaces-secrets/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md:36`** grades the E5
exit-gate clause **"denied egress"** as one of only **two** clauses `proven_in_d1` — the strongest
grade the audit issues, in an audit whose own thesis is that most clauses are graded too generously.
Its basis is `tests/d1/e6f-08-egress-isolation.test.mjs`, which proves unreachability of *the
identical targets* — `169.254.169.254`, ECS metadata, private ranges, an arbitrary public address —
by **docker-compose `internal: true` network segmentation around a container analog** (`worker-a`
plus `fake-provider`). It never touches `createFenceAwareEgressProxy`, `classifyEgressDestination`,
or the real provider. **The same words name two different subjects, and on the real one the result
is the opposite.**

**The line is sharp, and it is worth stating precisely:** the layer that *runs today* never claimed
this — the deployed `cloud_auth` spec discloses the gap in writing, and every producer comment and
ticket-level doc is honest (§5), and the measurement CONFIRMS them. The layer that *claims* it is
the distributed programme, four times. **Confirms at the layer that runs; contradicts at the layer
that claims.** That the claiming path is default-off is why this is a finding and not an incident —
a reason with an expiry date, because it holds only while distributed execution stays off, and the
record's own `releaseTest` is chartered to turn it on.

### 2. What was measured, and how

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

**The metadata row is a second measured finding in its own right, not a footnote to the first, and
the status code is the whole point.** `169.254.169.254` returned **HTTP 401** — not a timeout and
not a connection error. That is an IMDSv2 token challenge: a **live metadata service answering**,
not a dropped packet. It answered in **both** arms. So only IMDSv2's token requirement stands
between sandboxed, agent-authored code and that endpoint. **This half is broader than E8**: every
workload in a sandbox shares the reachability, not only browser sessions — which is why a successor
scoped to browser sessions alone would not close it.

**Consequence for BRW-004's design.** §D3 option (b) — constrain egress at the provider — is
**unavailable**, so the in-sandbox enforcement point D3(c) is the ONLY layer rather than defence in
depth. A browser induced to reconfigure its own proxy is contained by nothing else.
**★ CORRECTED 2026-09-07 — read §0 first: "unavailable" was grounded in a capability claim that
`E8-F007` refutes. The correct reading is UNADOPTED-and-unmeasured, not absent. D3(c) being the
only layer today is unchanged; the reason for it is not.**

### 3. There is no enforcement layer at ANY of the three candidate points

Each point was measured separately, at this SHA.

1. **Provider level — MEASURED INERT.** §2. A host absent from the declared allowlist was reached
   from inside the sandbox that declared it, identically to a control sandbox that declared none.
2. **In-sandbox — UNBUILT.** BRW-004 §D3 option (c) is the chosen enforcement point and is slice
   (f). `BRW-004-result.md:15` and `:99` record slices (f)–(h) as not attempted, and `:366` books
   the acceptance condition *"allowed domains … are enforced"* as `deferred`.
3. **Proxy — ZERO PRODUCTION CALLERS.** `classifyEgressDestination` (`egress-policy.ts:228`) is
   correct, ranks `metadata` as the highest-precedence deny class (`NETWORK_DENIAL_CLASSES`,
   `:69-74`), and is dual-driven in the always-on `policy` lane against two committed fixture
   corpora. Its **only** non-test consumer is `createFenceAwareEgressProxy`
   (`egress-proxy.ts:146,239`) — and `egress-proxy.ts` is imported by exactly one file in the
   repository, the integration test `server/src/__tests__/egress-proxy.integration.test.ts:29`. Two
   production comments assert the same independently (`routes/worker-control.ts:160`,
   `services/execution-secret-resolve.ts:7`). The chain is unreachable from boot: the classifier's
   only route into production is a module nothing imports.

**So the classification exists and the enforcement does not — at any layer.** What that blocks is
therefore not a build task. It is THE CLAIM (§1) that sandbox egress is constrained.

### 4. The producer seam, traced end to end

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

### 5. The other side of the line — where the gap IS disclosed, honestly

The measurement **confirms** every one of these; none is contradicted, and none is the defect in §1.

- **The producer comments.** `mcp-connectors-env.ts:59-66`: the allowlist is *"NOT a security
  boundary … advisory, managed-E2B-best-effort"*. The probe measures that they are right, rather
  than quoting them.
- **The deployed system's own spec.** `docs/aoa/plans/2026-08-05-cloud-execution-isolation-e2b-spec.md`
  §12, first bullet: *"Managed-E2B egress is not fully lockable. On managed E2B, sandboxes get
  fairly open egress; the 'allowlist' (Q2) may be closer to open in practice there."*
  **★ The first sentence of that quotation is REFUTED as a capability claim — `E8-F007`, and §0
  above. The rest of the bullet, and this section's point that the deployed layer is honest about
  what it enforces, are unaffected: what is inert is `metadata`, which is what AoA sends.** Its §9
  **Security invariants** list contains **no egress invariant at all**, and Q2's rationale (§3)
  calls the choice *"not a cross-tenant control (data plane owns that)"*. Nothing at the deployed
  `cloud_auth` layer represents egress as a security boundary, so the measurement breaks no promise
  there.
- **Every ticket-level document.** `DAT-005-result.md:14` records its own outbound channel as the
  inert E4-D12 seam; `DSK-001-lane-B-design.md:20-31` states the zero-caller fact up front and calls
  it the plan rather than an oversight; `DSK-002-result.md:161-163` explicitly refuses to report
  `sandbox.filtered_egress` because *"neither Docker's default bridge nor a bare OS sandbox filters
  egress"*.

### 6. A correction to the record — the guard that should have kept this visible had gone silent

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

### 7. Disposition — HIGH is unchanged; and a correction to this unit's own first commit

**The severity does not move, and the reason is positive rather than an absence of evidence.**
Everything found since filing **raises** the case: three enforcement points instead of one measured
absent (§3); four programme records asserting the control (§1), one of them rating the exact
measured event `Critical` with an exhausted owner; and the mechanism that would have kept the gap
visible had itself gone silent (§6). The nearest thing to an argument for a downgrade — "the
claiming system is default-off" — is a statement about the *reachability of the claim*, not about
its truth, and it is already the reason this is filed rather than escalated.

**★ A downgrade was nevertheless taken, and this corrects it.** Commit `2e548fdae` on this branch
rewrote `scripts/finding-ownership.json`'s `E8-F003` entry and, in doing so, **dropped the entire
second measured half** — the metadata endpoint answering `401` from inside the guest, IMDSv2 as the
only remaining barrier, and the "broader than E8, every sandboxed workload" scope — from both
`reason` and `successor`, while that commit's own message asserted *"Nothing supports a downgrade,
so none is taken."* The `Severity` field never moved, so no guard could see it: **the register entry
had silently become weaker than the prose it indexes, which is a downgrade by subtraction.** Both
halves are restored, and the entry now leads with the §1 misrepresentation. The rule this cost:
*a machine-readable entry must never be weaker than the prose beside it, and a claim about a diff is
part of the deliverable and is reviewed like the diff.*

**Scope, stated so it is not over-read.** This measures the seam AoA production actually uses. It
says nothing about an E2B capability AoA does not call; it does not establish that the metadata
endpoint is **exploitable**, only that it is reachable and answering; and the `169.254.169.254`
service belongs to the **provider's** infrastructure, so what it would yield to a token-bearing
caller is unmeasured. Nothing here asserts a cross-tenant breach: the deployed blast-radius reframe
(spec §9) is untouched.

**Why `unowned`, and what it blocks.** No ticket in the roster is chartered to wire egress
enforcement for the path that was measured. BRW-004 slice (f) is real, open (`gate_review`) and the
only chartered candidate — but it is scoped to browser sessions, and the measurement is of org
heartbeat runs and crew runs, neither of which is a browser session; and the metadata half (§2) is
broader still, since every sandboxed workload shares the reachability. The two tickets that *were*
chartered to reach this path have both shipped without it and said so: DAT-005 (COMPLETE) and
DSK-002 (`…mediate device-local handles through the DAT-004 broker plus fence-aware egress path`).
Naming either as the successor would be filing against a closed ticket; naming a new one would be
inventing an owner. So this stays `unowned` **with a reason saying what it blocks**: until an
enforcement point exists, `program-design.md:149`, DE-08's `confidentiality`/`authorization`/
`integrity` clauses, and the E5 gate's "denied egress" clause **cannot be asserted of the real
provider**, and DE-08's own record cannot distinguish that from delivery. **Repoint it when a ticket
takes egress enforcement for the sandbox path — not for the browser path alone, and not for the
egress half alone. Do NOT close it by citing `classifyEgressDestination`, the `policy`-lane vectors
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


## E8-F006 — E8-1's promotion check cannot detect E8-1's promotion: the live route stages and execs `runBrowserSession`, it never references it

**Status:** open
**Severity:** MEDIUM — the auditor rated this HIGH; the downgrade is argued below and is the only
point on which this filing departs from the report.
**Filed:** 2026-09-06 (W5U1), measured at `e1f723df2`.

**What.** `E8-1-sandbox-local-browser` is declared `unwired` with `expectedReferences: 1`
(`scripts/gate-clause-wiring.json`). For an `unwired` entry the evaluator gives exactly ONE
mechanical signal, `scripts/lib/gate-clause-wiring.mjs:105-106`:

```js
const expected = typeof entry.expectedReferences === "number" ? entry.expectedReferences : 0;
if (count > expected) { …unwired_but_now_has_caller… }
```

and the library's own comment states the intent: acknowledging a known count "keeps the
promote-check sharp — it still fires the moment a NEW reference appears".

**Measured: the promotion this clause exists to watch for adds no reference.** The route to live is
written down in the code itself. `packages/browser-runtime/src/runner.ts:3-17` — "BRW-002 — THE
IN-GUEST ENTRYPOINT. This is the boot root." — describes the host side as:

```
host: writeFiles(runner + session.json) -> exec(node runner.js session.json)
```

The host **stages a file and execs it**. Nothing on the host imports `browser-runtime`, calls
`runFromConfig`, or names `runBrowserSession`; the package has no importer and is in no dependency
list (the clause's own reason says so, and `grep -rn runBrowserSession --include=*.ts .` confirms
the only non-test references are inside the package: the definition at `run-session.ts:139`, the
`index.ts:35` re-export, the `runner.ts:43` import and the `runner.ts:65` call). Wiring BRW-004
slice (f)+ — or any stage-and-exec delivery — leaves `countProductionCallers(runBrowserSession)` at
exactly **1**, which is `expectedReferences`, which is not `> expected`. The check stays silent
through the promotion.

**This is the [[checks-that-nothing-runs]] shape, one field over from the one the register already
guards.** `claimed_wired_but_no_caller` catches a clause claiming MORE than the code delivers.
`unwired_but_now_has_caller` is the mirror, and for this clause the mirror is blind — not because
the count is wrong, but because caller count is the wrong observable for a capability delivered by
process exec rather than by import.

**Why MEDIUM and not HIGH.** The error direction is PESSIMISTIC. If E8-1 goes live, the register
keeps printing `DORMANT, on the record: … E8-1-sandbox-local-browser` on every green `policy` run —
a false statement, but one that under-claims. Nothing ships on the strength of it; no gate opens
that should have stayed shut. The programme's stated calibration is that a FALSE CLAIM OF
ENFORCEMENT is the intolerable direction, and this is its opposite. A reviewer could argue HIGH on
the ground that the register's comment asserts an enforcement ("it still fires the moment a NEW
reference appears") that is untrue for this entry, and that argument is not silly — it is recorded
here rather than settled, so the next reader sees both.

**Scope, honestly — and this is wider than the report said.** `expectedReferences` is carried by
exactly two clauses. The other, `E7-1-coding-journey` (`E2bSandboxProvider`, `expectedReferences: 4`),
states its own promotion conditions as "the operator builds+deploys the adapter-manager image and
DEP-011 wires the daemon consumer". The FIRST of those is a deploy action and adds no reference to
anything, so at least half of E7-1's promotion is invisible to the same signal. I have not traced
whether DEP-011's daemon consumer would add a fifth `E2bSandboxProvider` reference — that is a claim
about unbuilt code and I will not guess it. What is measured is that the register's only
promote-detector is reference count, and that BOTH clauses relying on it have promotion routes at
least one of whose steps is invisible to it.

**What would close it.** Something other than a reference count as E8-1's promotion signal — e.g. a
declared assertion that no file outside `packages/browser-runtime` names `runner.js`/`run-session`,
or an entry in the existing `browser-spawn-expectation.json` / boot-root guards, which already
reason about spawn sites rather than imports. Deliberately not built here: choosing E8-1's
promotion observable is an E8 gate decision, and W5U1's charter is filing plus the one checker fix
(E4-F018).

---

## E8-F007 — The programme booked "managed-E2B egress is not fully lockable" as fact for a year; the installed SDK exposes the surface, and that false premise is what wrote off the only enforcement layer outside the guest

**Status:** open · **Owner:** `unowned`
**Severity:** HIGH — argued in §4, with the counter-argument for MEDIUM recorded rather than
settled.
**Filed:** 2026-09-07 (W10A), by reading the installed dependency rather than the record.

### 1. What was measured, and on what artifact

**Resolved package inspected: `e2b@2.30.5`** — the version `pnpm-lock.yaml` resolves (`e2b@2.30.5:`
in both the packages and snapshots sections) and the version installed on disk at
`node_modules/.pnpm/e2b@2.30.5/node_modules/e2b/package.json` (`"version": "2.30.5"`). It resolves
from both workspace packages that declare it — `server/package.json` and
`packages/sandbox-e2b-provider/package.json`, both `"e2b": "^2.30.5"`. Line numbers below are from
that build's `dist/`; they are given for a reader's convenience, and the literal strings — not the
line numbers — are what `scripts/w10a-sdk-capability-premise.json` pins.

**Types (`dist/index.d.ts`).** The option type exists, is carried by `Sandbox.create`'s own
options, is returned by the info endpoint, and can be replaced on a running sandbox:

```ts
type SandboxNetworkOpts = {                    // :7168
    allowOut?: SandboxNetworkSelector;         // "Allow outbound traffic … to the specified addresses"
    denyOut?: SandboxNetworkSelector;          // "Block all egress: ({ allTraffic }) => [allTraffic]"
    rules?: SandboxNetworkRules;
    allowPublicTraffic?: boolean;
    maskRequestHost?: string;
};
network?: SandboxNetworkOpts;                  // :7340 — on SandboxOpts, i.e. Sandbox.create
network?: SandboxNetworkInfo;                  // :7507 — on SandboxInfo, i.e. READ BACK
static updateNetwork(sandboxId: string, network: SandboxNetworkUpdate, opts?): Promise<void>; // :7622
```

**Runtime (`dist/index.js`).** The option is serialised and reaches the wire, and the read-back is
mapped — this is not a type-only stub:

```js
function buildNetworkBody(network) { … }                        // :4221
network: buildNetworkBody(opts?.network),                       // :4579, inside the POST /sandboxes body
client.api.PUT("/sandboxes/{sandboxID}/network", { … body: buildNetworkUpdateBody(network) }) // :4429
network: res.data.network ? { allowOut: …, denyOut: …, rules: … } : void 0  // :4307-4312, in getInfo
```

`SandboxOpts` additionally carries `allowInternetAccess`, documented as *"When set to false, it
behaves the same as specifying denyOut to 0.0.0.0/0 in the network config"* (`:2010`, `:7327`).

### 2. What the record says instead, in six tracked files

The claim is stated as fact, in the present indicative, with no hedge and no citation to any
measurement, in every one of these. The list came from scanning tracked files rather than from
trusting a hand-list — the site list has been incomplete in every prior round of this programme.
Every row below is a QUOTATION being corrected by this finding, `E8-F007`, not an assertion.

| file | what it says |
|---|---|
| `docs/aoa/plans/2026-08-05-cloud-execution-isolation-e2b-spec.md:180` | *"Managed-E2B egress is not fully lockable."* — §12, the deployed system's own spec |
| `docs/aoa/plans/2026-08-06-e2b-plan-wave4-files.md:16` | *"§11 documents managed egress is not fully lockable"* |
| `docs/aoa/plans/2026-08-06-e2b-plan-wave4-files.md:105` | *"do not throw if managed E2B cannot enforce it (§11 — managed egress is not fully lockable; enforcement is a self-hosted concern)"* |
| `server/src/services/sandbox-provider-runtime.ts:783-786` | a production comment, on the create call itself: *"§11/§12: managed E2B egress is not fully lockable"* |
| `server/src/__tests__/sandbox-egress-allowlist.test.ts:5, :88` | the same sentence, twice, as the stated reason the provider records rather than enforces (both now annotated with `E8-F007`) |
| `E8-F003` §5 above, and its `scripts/finding-ownership.json` entry | quotes the spec bullet approvingly, and §2's *"option (b) is unavailable"* rests on it |

**The last row is the consequence, and it is why this is filed at HIGH rather than as a docs fix.**
`E8-F003` is a HIGH finding about a `Critical` control (`DE-08`) that is enforced at no layer. Its
own reasoning concludes that constraining egress **at the provider** — the one enforcement point
outside the guest — is *unavailable*, leaving the in-guest point as the only layer. And every
in-guest mechanism is agent-writable by construction: `buildE2bLoginShellScript`
(`sandbox-provider-runtime.ts:647-655`) sources `/etc/profile`, `$HOME/.profile` and
`$HOME/.bashrc` from an agent-writable home before `exec env … claude`. So the false premise did
not merely sit in a document — **it wrote off the only layer the agent cannot edit.**

### 3. What `E8-F007` claims, and three things it explicitly does NOT claim

**Claims:** the capability EXISTS IN THE INSTALLED ARTIFACT, and the "not lockable" premise is
unsupported by anything in the record. No measurement was ever written down behind it; it
propagated by citation.

**Does NOT claim:**

1. **That the control works.** Nobody has run it. No AoA code path passes `network` to
   `Sandbox.create` today — the allowlist crosses as `metadata`, which `E8-F003` measured inert.
   Reading this finding as *"we can lock egress"* would be the same error in the opposite
   direction, and would be worse, because it would be a false claim of enforcement.
2. **That the operator's tier honours it.** UNMEASURED, and it is the open question. Two facts make
   a read-back mandatory rather than optional: `buildNetworkEgress` (`dist/index.js:4214-4219`) is a
   pure passthrough — nothing is validated client-side, and the only error path is HTTP status — and
   the API target is per-company configurable (`resolveE2bDomain = config.domain ?? env.E2B_DOMAIN`,
   `sandbox-provider-runtime.ts:577-578`, with a self-hosted branch at `:545`). **A tolerant or
   self-hosted server that ignores an unknown field returns 200 and yields an UNPOLICED sandbox with
   identical code and identical logs.** A probe unit is being built separately; its result belongs
   here when it lands.
3. **That `E8-F003` is closed, downgraded, or wrong in its conclusion.** It is none of those. Its
   conclusion — enforcement exists at no layer — is untouched, and was measured independently at
   each of the three candidate points. `E8-F003` §0 records the correction and says exactly this.

### 4. Why HIGH

Two reasons, neither of which is "a document was wrong".

**(a) It is a false NEGATIVE capability claim, and those suppress work rather than merely
misinform.** This programme's stated calibration is that a false claim of enforcement is the
intolerable direction and a pessimistic error is the tolerable one. That calibration does not cover
this case. A false claim that something is IMPOSSIBLE is pessimistic about capability and
*permissive* about consequence: it closes the remedy rather than over-promising a protection. Here
it closed the only out-of-guest remedy for a `Critical` control whose owner column is already
exhausted. The under-claim was load-bearing.

**(b) Nothing could have caught it, and that is the reusable half.** Every guard in this repository
checks a claim about THIS repository — a clause against its symbol's caller count, a `reason`
against the source file it cites. A sentence about what a THIRD-PARTY ARTIFACT cannot do had no
checker of any kind, and it is exactly the sentence that rots on its own: the artifact ships a new
version, nobody re-reads its types, and the claim keeps being cited forward. Six files, one year,
zero red.

**The argument for MEDIUM, recorded rather than settled.** No live system is less safe because of
this: the `metadata` string is inert either way, distributed execution is default-off, and `DE-08`
was already open at `Critical` with `E8-F003` filed at HIGH. On that reading this is a
documentation defect whose only cost is a foreclosed design option. A reviewer could reasonably
land there. I do not, for reason (a) — a foreclosed design option on a Critical control with no
owner is one of the things keeping it un-owned — but the next reader should see both.

### 5. What was done here, and what was deliberately not

**Done (record + guard only; NO enforcement behaviour changed):**

- The code comment at `sandbox-provider-runtime.ts` no longer asserts the premise. It states that
  the capability exists in the installed SDK, that whether the operator's tier honours it is
  unmeasured, and why the call still passes `metadata` — citing this finding. **No predicate, no
  call, no argument changed.**
- Every other site in §2 carries a dated correction adjacent to the claim. The historical documents
  keep their original sentences: a record that silently rewrites what it used to believe is worse
  than one that shows the correction next to it.
- `E8-F003` gained §0 — a dated note that one of its stated reasons is unsupported, with its status,
  severity, ownership and conclusion untouched.
- `scripts/check-w10a-sdk-capability-premise.mjs` + `scripts/w10a-sdk-capability-premise.json`: the
  premise cannot be reintroduced silently while the SDK exposes the surface. It pins the measured
  version against the lockfile (a bump forces re-measurement), checks the declared surface markers
  against the resolved package in the lane that installs dependencies, requires a correction marker
  beside any quotation of the refuted sentence, and fails if its own ban pattern ever stops matching
  anything — a ban that matches nothing is a check that nothing runs.

**Deliberately not done:** passing `network` to `Sandbox.create`. That is an enforcement change; it
needs the tier measurement, a mandatory `getInfo()` read-back (§3.2), a decision about what a failed
read-back should do to a run, and an owner. Shipping it on the strength of a type declaration would
be the false-enforcement error this finding exists to avoid.

**Known limit of the guard, stated rather than implied.** It bans the sentence family that actually
occurred, not the idea. A rewording evades it. Pretending otherwise would be a false claim of
enforcement in a new place; the guard's own header says so.

### 6. Disposition — why `unowned`

No ticket in the roster is chartered to measure whether the E2B tier honours a `network` body, or to
adopt the surface with a read-back. `E8-F003` remains the right home for the *enforcement gap*; this
finding owns the *premise*, and its remaining half is a measurement nobody is assigned. Repoint it
when a ticket takes provider-level egress adoption for the sandbox path — the same bar `E8-F003`
sets, and for the same reason.

**Do not close this by citing the type declarations.** A type is not a measurement, and this finding
is the record of what happens when a capability claim is taken on citation. Close it when a probe
records what the operator's tier does with a `network` body — in both directions, honoured and
ignored — or when the surface is adopted with a read-back that fails closed.
