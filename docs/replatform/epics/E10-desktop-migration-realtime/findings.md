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

**Per-sink gaps.** ★ Readiness order superseded 2026-08-28: **CREW is the cleanest first sink** (it
rides the mint for a v1-provider company — see the crew bullet), then extraction (mint-runner change but
a result-return blocker that drops every item — not recommended), then Commander (largest). The
"extraction smallest" framing below understated extraction's sync→async result-return blocker.
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
- **Crew (`crew_run`, MIG-006) — ★ CORRECTED 2026-08-28: crew RIDES the mint (it does NOT refuse at
  guard 3), and is the CLEANEST first sink.** Its principal is stamped `{kind:"worker", id: agentId}`
  (`job-shadow-admissibility.ts:136` → `internalRunSourceIsAdmitted`, `job-control.ts:1529`), so guard 2
  admits `worker` and — **iff the company's crew provider is a v1 coding adapter** — guard 3 admits and
  the mint issues a Company `provider_key` (`execution-secret-handle-mint{,-runner}.ts`). The v1 axis is
  a whole-company setting, not an edge: `resolve-crew-adapter.ts` maps `anthropic→claude_local` /
  `openai→codex_local` (RIDE) but `google→gemini_local` / `opencode→opencode_local` (REFUSE
  `adapter_not_v1_scope`). The shadow `source_not_admitted` was a **fixture artifact** — no crew runs
  were seeded (`MIG-005-006-007-shadow-result.md:107,110-112`) — NOT an admission-authority gap. So
  crew's ONLY blockers are the routing seam + the zero-caller projection bridges (`jobOutputBridge` et
  al., E3-17) + E7-1 — **none of them the mint.** Already pinned by shipped tests (no new test needed):
  `job-submission.integration.test.ts:77-99,307` (the `{worker, agentId}` stamp), `mint.test.ts:128-133`
  (worker→`provider_key`), `mint.test.ts:138` (non-v1→refuse).
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

## E10-F002 — MIG-008's reconciler and its store have ZERO production callers, so the crosswalk is never written

**Status:** open · **Owner:** MIG-010 (`epics/E10-desktop-migration-realtime/tickets/MIG-010-design.md`, no result doc)
**Severity:** HIGH
**Filed:** 2026-09-01, by Blocker E-2 terrain verification at `c7ead3a73` (Units 1.6+1.7 / PR #333).

**What.** Both halves of MIG-008's writing path are orphaned:

| Symbol | Definition | Non-test callers |
|---|---|---|
| `reconcileCompanyLegacyResources` | `server/src/services/legacy-resource-reconciliation.ts:324` | **0** |
| `createDrizzleReconciliationStore` | `server/src/services/legacy-resource-reconciliation-store.ts:23` | **0** |

So `legacy_resource_reconciliation` is **never written in production**. CLI-006's canary preflight
reads it (`canary-preflight-store.ts:63`), `assertClosure` finds every inventory key unmapped, and
the gate answers `reconciliation_incomplete` for every organization, forever.

**★ Wiring a caller does not fix it.** The pass must first read `environment_leases`,
`environments`, and the `runtime_provider_keys`→`company_secret_versions` chain — four tables
**neither serving role holds any grant on**, which is exactly why E-1 needed owner-owned
`SECURITY DEFINER` functions. Binding the pass to `operatorDb` as it stands fails with 42501 on its
first read. It also *writes*: `casClaimPaused` → `expireLeaseIfPaused` (`environments.ts:310-327`)
flips `paused → expired`, so running the pass destroys warm snapshots as a side effect.

**Why nothing caught it.** MIG-008's tests assert the pass against injected stores. Nothing asserted
that anything drives it — the failure class in
[`checks-that-nothing-runs`](../../qa/2026-08-31-campaign-blockers-and-fleet-terrain.md): a check
that nothing runs is not a check, and here there was not even a check.

**Blocks.** E7-1. The canary cannot flip to distributed on a correctly-booted flag-on deployment.
