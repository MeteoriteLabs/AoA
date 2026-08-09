# E1 Findings

New findings use IDs `E1-F001`, `E1-F002`, and so on.

## E1-F001 — PRT-002 Step-2 illustrative transition maps diverge from the E0 lifecycle JSON authority

- **Severity:** Medium (would produce an incorrect state machine if transcribed literally).
- **Blocks gate:** No.
- **Blocks execution until amended:** Yes (execution paused for a plan amendment per operator directive; PRT-002 must not be implemented from the divergent examples).
- **Discovered during:** E1 controller read-back / pre-implementation cross-check (before PRT-001).
- **Evidence:** The canonical lifecycle authority is `docs/architecture/distributed-execution-lifecycles.json` (Decision #121; frozen E0/FND-001 output). The E1 `implementation-plan.md` PRT-002 Step 2 (Task 2) embeds *illustrative* expected transition maps that omit real edges present in that JSON and, in one case, assert a phantom edge the JSON does not contain:
  - **attempt:** plan omits `pending→expired`, `leased→cancelled`, `cancel_requested→succeeded`; plan asserts `offered→cancel_requested`, which the JSON does **not** have (JSON has `offered→cancelled`).
  - **browser_session:** plan omits `queued→expired`, `leased→cancelled`, `starting→cancelled`, `active→cancelled`, `waiting_approval→cancelled`, `cancel_requested→succeeded`.
  - **service_instance:** plan asserts `pending→stopped` (a phantom; JSON has `pending→lost`) and omits `leased→failed`.
  - `job`, `lease`, and `service_desired` illustrative maps already match the JSON.
- **Affected tickets:** PRT-002 (result ledger + tests + `states.ts`).
- **Root cause / resolution:** The plan's own **normative** hardening amendment ("PRT-002 — separate lifecycle machines") already states the E0 JSON is authoritative — "Generate transition constants/predicates from the E0 JSON authority **or** validate byte-for-byte semantic parity with it," and "The E0 JSON owns these edge conditions." The Step-2 examples are non-normative and stale. Proposed disposition: amend PRT-002 Step 2 to (a) correct the attempt/browser/service-instance illustrative maps to the exact JSON edges and (b) require a parity test that loads `distributed-execution-lifecycles.json` and asserts the embedded `states.ts` maps/guards/terminals equal the JSON's `allowed`/`guards`/`terminal` sets exactly (the same authority-cross-check pattern PRT-004 uses for the shared canonicalizer). Runtime `states.ts` embeds literal maps (no `fs`); the `.test.ts` performs the parity load. **Resolved: decision [E1-D001](decisions.md) locked and PRT-002 Step 2 amended (2026-08-09) by the operator acting as custodian / Integration Gate Owner.**

## E1-F002 — PRT-006 golden-journey parity is vocabulary/enum membership, not full-object schema parse; `emits` vocabulary is broader than the worker-event union

- **Severity:** Medium (literal implementation of two Step-6 bullets would fail against the frozen fixtures).
- **Blocks gate:** No.
- **Blocks execution until amended:** Yes (PRT-006 `golden-journeys.test.ts` design).
- **Discovered during:** E1 controller read-back / pre-implementation cross-check (before PRT-001).
- **Evidence:** The frozen FND-004 golden-journey fixtures (`tests/fixtures/distributed-execution/*.json`, immutable E0 output validated by `schema-v1.json`) use identity encodings and an emission vocabulary that differ from the E1 wire schemas:
  1. **`emits` vocabulary:** `steps[].emits` in the fixtures contains 4 names outside PRT-004's worker-event union — `artifact_transfer_rejected`, `quarantine_grant_issued`, `quarantine_receipt_finalized`, `replacement_lease_activated` (artifact/quarantine/lease **operation** concepts owned by PRT-003/005/007, not worker events). `expectedEvents[].eventType` additionally uses `budget_exhausted`, `lease_lost`, `cancel_requested`, `producer_safety_rejected`, `provider_pause_observed` — control-plane journey events, not worker→control-plane wire events. The plan's Step-7 note ("golden journeys pass once event-name mapping includes `network_denied`") understates this.
  2. **`source` shape/encoding:** the fixture `Source` is `{ kind, runId?, issueId? }` with ULID-style IDs (`run_…`, `issue_…`) and no `requestedBy`/`executionPrincipal`; it therefore **cannot** parse through the full `executionSourceV1Schema` (UUID-branded IDs + mandatory typed principals). Likewise fixture events use `^[0-9A-HJKMNP-TV-Z]{26}$` IDs and an integer `fenceToken`, versus the E1 UUID/base64url wire encoding.
- **Affected tickets:** PRT-006 (`golden-journeys.test.ts`). (PRT-004's digest cross-check is unaffected: it canonicalizes the raw fixture event objects and reproduces the committed `eventDigest` regardless of E1 wire schema.)
- **Root cause / resolution:** The fixtures are immutable frozen E0 authority, so the PRT-006 test must conform to them. The two Step-6 bullets ("source parses through `executionSourceV1Schema`…" and "every `emits` value parses as a known worker event type") should be reframed as **vocabulary/enum-membership parity**, not full-object schema parse: assert fixture `source.kind` ∈ the `ExecutionSourceV1` discriminant set, and assert each `emits` value ∈ a reviewed "known distributed-execution emission vocabulary" = the worker-event type union ∪ the frozen non-event operation/receipt names above. **Resolved: decision [E1-D002](decisions.md) locked and PRT-006 Step 6 amended (2026-08-09) by the operator acting as custodian / Integration Gate Owner.**
