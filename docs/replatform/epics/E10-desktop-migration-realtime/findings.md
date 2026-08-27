# E10 — Desktop migration / realtime — findings

## E10-F001 — No Sprint 6 sink is buildable today; they are all blocked on shared, unbuilt prerequisites

**Status:** open · Severity: HIGH · Source: MIG-005 + MIG-007 cutover designs and their reviews,
2026-08-27 (verified against source). **★ This entry was revised after the MIG-007 design corrected an
overstatement in its first version** (which claimed extraction "rides the mint" and was "buildable
today" — both false; see below).

The go-book scoped Sprint 6 as "cut the sinks over, one at a time." Making the first two designs
(MIG-005 Commander, MIG-007 extraction) and reviewing them established that **none of the three sinks
can cut over today** — they share unbuilt prerequisites, and each adds a per-sink gap.

**Shared prerequisites, missing for all three sinks:**
1. **Distributed transfer routing exists only for `task_run`.** Convert/placement/ownership + legacy
   suppression live only in `heartbeat.ts` (`run-execution-owner.ts` is `task_run`-shaped). A cutover
   for any other source must build the routing seam for it.
2. **The mint refuses every non-agent-coding run at guard 3.** `isAgentBackedExecutorKind` admits
   `worker`/`sandbox` at guard 2, but the mint-runner loads an agent binding keyed on
   `executorPrincipalId`; a run with no v1-coding agent binding gets `adapterType = ""` and refuses at
   `adapter_not_v1_scope` (`execution-secret-handle-mint.ts` guard 3, ~:167; the runner binding at
   `execution-secret-handle-mint-runner.ts:104-116`). This is the SAME refusal gate for `commander_turn`,
   `one_shot`, `service`, `browser`, and `system` — the clean "extraction rides the mint, Commander
   doesn't" distinction the first draft of this finding drew is **false**; both refuse at guard 3.

**Per-sink gaps, smallest first (this is the corrected readiness order):**
- **Extraction (`one_shot`, MIG-007):** credential fix is the SMALLEST in class — it needs the **Company**
  key, which the mint already knows how to produce; the gap is that extraction's principal is an agentless
  `operationId`, so the mint-runner needs to mint a Company key for an agentless one_shot run (a
  mint-runner change, not a new credential class). **BUT extraction adds a blocker the first draft
  missed: no synchronous result-return path.** Extraction is a blocking request/response that awaits and
  parses the sandbox stdout (`extraction-cli.ts` ~:362-375); the distributed substrate is async
  fire-and-forget and its only projection surface (`jobOutputBridge`, E3-17) is zero-caller and carries
  artifacts, not a stdout string. Suppressing the direct call with no result path yields **zero extracted
  items** — a data-loss bug, not honest dormancy. And Q2: extraction ALREADY runs in an isolated E2B
  sandbox with the Company key, so the cutover's value is thin-to-negative (fleet placement for a
  latency-sensitive, system-initiated path).
- **Crew (`crew_run`, MIG-006):** agent-backed (its principal is an agent id, so it MAY pass the mint's
  guard 3 if the agent uses a v1 coding adapter), but it was refused `source_not_admitted` in shadow — an
  admission-authority gap — plus the routing. Not yet fully traced; likely a middle case.
- **Commander (`commander_turn`, MIG-005):** the LARGEST gap — a net-new per-user `provider_connection`
  credential class (Decision #117 territory), not the Company key; plus routing; plus it is
  interactive/sync.

**Disposition.**
- **"Cut over a sink" is premature. The real Sprint 6 work is the SHARED PREREQUISITES** — the
  distributed routing seam for non-`task_run` sources, and the mint-runner generalization to mint a
  Company key for an agentless/non-coding run — and, for extraction, a result-return path. Those are the
  tickets to scope before any sink flips.
- **The drain fix is the one genuinely unblocked, landable Sprint 6 item** (sink-agnostic; the MIG-005
  design's drain analysis is reviewer-verified and carries to its own ticket). Ship it independently.
  **★ SHIPPED 2026-08-27 (MIG-009):** the per-Company rollback grain + the real `listActiveAttempts`
  SQL landed and are proven at embedded-PG; the drain is correct when wired, and `E10-1-drain` stays
  `unwired` (its `drainAll` trigger is REL-005 scope). This does **not** change the finding: the drain
  is sink-agnostic and no sink cutover is unblocked by it — every point below still holds.
- **Extraction's cutover is NOT recommended even once unblocked** (thin value; already sandboxed with the
  Company key). Crew and Commander cutovers wait on their credential + routing work.

**Owner:** none yet. When Sprint 6 is next, scope the shared-prerequisite tickets (routing seam +
mint-runner generalization) and the drain first; the per-sink flips follow. Commander's per-user credential
shares E5's `DEFERRAL-1-credential` wiring. Filed `unowned` because no ticket in the graph fixes these and
force-fitting them onto one sink would be false ownership.

**Blocks:** every Sprint 6 sink cutover. Does NOT block the drain fix.
