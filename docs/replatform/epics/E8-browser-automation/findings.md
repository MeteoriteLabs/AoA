# E8 — Browser automation — findings

## E8-F001 — A frozen fixture and shipped code name DIFFERENT approval authorities for `browser_request`, and nothing can see the disagreement

**Status:** open · **Owner:** BRW-004 (`epics/E8-browser-automation/tickets/BRW-004-design.md` §2 D2, slice (b))
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

**Disposition.** BRW-004 takes the code's side (design §2 D2) and closes the invisibility rather than
the fixture: slice (b) extends the foundation checker to bind each fixture's `control.productApproval`
/ `control.runtimeDecision` to the shipped `describeSourceGovernance` profile for its source kind.
**The fixture bytes are NOT edited** — `tests/fixtures/distributed-execution/README.md` declares them
immutable behavioural inputs. The new guard must be demonstrated RED against the fixture as it stands
before the mapping is expressed, or it is a check that nothing runs.

---

## E8-F002 — `agent_runtime_decisions` is the designated aggregate for `browser_request` and cannot hold a row for one

**Status:** open · **Owner:** BRW-004 (`epics/E8-browser-automation/tickets/BRW-004-design.md` §2 D2, slice (d))
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
