# PRT-002 Result — Branded Identities and Lifecycle State Machines

**Status:** `gate_review`
**Date (UTC):** `2026-08-09`
**Epic:** `E1-worker-protocol`
**Plan task:** `Task 2: PRT-002 — Branded Identities and Lifecycle State Machines`
**Implementer:** `PRT-002 implementer subagent (Claude)`
**Start SHA:** 44250fd267a3d28e61506fe048405aebe0582d1c

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the section below and is the only role that may change it to `complete`.

This file is a controlled append-only review ledger until `complete`; do not delete or rewrite prior review attempts. Once `complete`, it is frozen. Ticket commands are focused acceptance evidence, not the immutable epic D0 rollup.

## Delivered scope

- Added `packages/worker-protocol/src/ids.ts` — the branded wire-identity surface:
  - **UUID domain IDs** (`organizationIdSchema`, `companyIdSchema`, `agentIdSchema`, `runIdSchema`, `issueIdSchema`, `internalAgentRunIdSchema`, `conversationIdSchema`, `crewRunIdSchema`, `oneShotOperationIdSchema`, `browserRequestIdSchema`, `reconciliationIdSchema`, `jobIdSchema`, `workerIdSchema`, `targetIdSchema`, `leaseIdSchema`, `eventIdSchema`, `artifactIdSchema`, `secretHandleIdSchema`, `serviceIdSchema`, `serviceInstanceIdSchema`), each a distinct Zod `.brand<…>()` over `z.string().uuid()`.
  - **Opaque `principalIdSchema`** — non-empty text, rejects leading/trailing whitespace, ≤200 **UTF-8 bytes** (counted after `TextEncoder` encoding, not JS code units), and does **not** trim/normalize/rewrite (bytes preserved exactly). A genuinely-UUID domain ID and an opaque principal ID never share one parser (amendment §PRT-002).
  - `sandboxIdSchema` (1–200 chars), `attemptNumberSchema` (int, positive, ≤1,000,000), `eventSequenceSchema` (int, positive, ≤`Number.MAX_SAFE_INTEGER`), `fenceTokenSchema` (base64url `^[A-Za-z0-9_-]+$`, 32–256), `sha256DigestSchema` (lowercase `^[a-f0-9]{64}$`), plus every inferred `type`.
- Added `packages/worker-protocol/src/states.ts` — six **distinct** lifecycle machines with `as const` state arrays, Zod enums, inferred types, embedded literal transition maps, and the six named predicates:
  - `canTransitionJobStatus(from, to, { reason })` — **no default reason**; a target terminal guard (`dead_letter`→`policy_exhausted`, `failed`→`non_retryable_failure`) is keyed by target state, matching the JSON `guards`. `dead_letter` is reachable **only** with `reason:"policy_exhausted"`; aggregate `failed` **only** with `reason:"non_retryable_failure"`.
  - `canTransitionAttemptStatus`, `canTransitionLeaseStatus`, `canTransitionBrowserSessionStatus`, `canTransitionServiceDesiredState`, `canTransitionServiceInstanceStatus` — reasonless.
  - `WORKLOAD_TYPES` / `workloadTypeSchema` / `WorkloadType` (locked V1 set `batch | browser_session | service`).
  - Transition maps are **embedded literals** (runtime source has no filesystem access); every state set, edge, guard, and terminal is a literal copy of `docs/architecture/distributed-execution-lifecycles.json` (Decision #121). All predicates are **fail-closed**: an unknown/foreign `from` yields no outgoing edges rather than throwing.
- Added `packages/worker-protocol/src/ids.test.ts` (identity validation) and `packages/worker-protocol/src/states.test.ts` (exhaustive Cartesian + the E1-D001 JSON parity cross-check + forbidden-cross-lifecycle + foreign-state closure).
- Modified `packages/worker-protocol/src/index.ts` to re-export the full new public surface (`export * from "./ids.js"` + `export * from "./states.js"`). The internal transition-map constants are **not** exported (module-private), so nothing beyond the intended schema/constant/predicate/type surface leaks.

**Non-goals preserved (per plan).** No job/lease/event/artifact/policy/capability/transport/error schemas (PRT-003…PRT-007). No runtime dependency beyond `zod`. Runtime source imports only `zod` + relative modules and no Node API (`states.ts` embeds maps as literals; the JSON is loaded only by the excluded `*.test.ts`). No DB schema, route, scheduler, worker, provider SDK, browser, or UI. `Status` left at `gate_review`; `findings.md`/`decisions.md` untouched.

## Changed files

| File | Responsibility |
|---|---|
| `packages/worker-protocol/src/ids.ts` | Branded UUID domain IDs, opaque byte-preserving `PrincipalId`, sandbox ID, attempt/sequence counters, base64url fence token, lowercase SHA-256 digest, and all inferred types. |
| `packages/worker-protocol/src/ids.test.ts` | Identity validation: UUID accept/reject, opaque-principal whitespace + 200-UTF-8-byte ceiling (byte-, not code-unit-based), sandbox bounds, counter integer/positivity/ceilings, fence base64url alphabet + 32–256 window, lowercase-64-hex digest. |
| `packages/worker-protocol/src/states.ts` | Six distinct lifecycle machines: state arrays, enums, types, embedded literal transition maps + job reason guards, six `canTransition*` predicates. |
| `packages/worker-protocol/src/states.test.ts` | Exhaustive Cartesian assertions for all six machines + terminal immutability + job guard reasons + the E1-D001 byte-for-byte JSON parity cross-check + forbidden-cross-lifecycle-edge rejection + foreign-state closure. |
| `packages/worker-protocol/src/index.ts` | Public surface: adds `export *` of the new `ids`/`states` modules alongside the version constants. |
| `docs/replatform/epics/E1-worker-protocol/tickets/PRT-002-result.md` | This ticket result ledger. |

## Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| Identity + state modules fail RED before they exist | Step 3: `vitest run src/ids.test.ts src/states.test.ts` exit 1 — 2 failed suites, `Cannot find module './ids.js'` and `Cannot find module './states.js'`, no tests collected | `pass` |
| UUID IDs accept UUIDs / reject malformed; counters reject non-positive & non-integer & over-ceiling | `ids.test.ts` "wire identities" + "branded UUID domain identities" + "bounded counters" green | `pass` |
| Opaque principal ID preserves bytes, rejects edge whitespace, bounds at 200 **UTF-8 bytes** (66×`€`=198 ok, 67×`€`=201 fail; 200×`a` ok, 201 fail) | `ids.test.ts` "opaque principal identities" green | `pass` |
| Fence = base64url only, 32–256; digest = lowercase 64-hex only | `ids.test.ts` "fence token and digest boundaries" green (`+`/`/`/`=` rejected; 31/257 fail; 32/256 pass; `F`×64 & `g`-suffix rejected) | `pass` |
| Only `batch | browser_session | service` workload types accepted | `states.test.ts` "accepts only the three locked workload types" green | `pass` |
| Every Cartesian job from/to matches the expected edge set; false exhaustion reasons rejected; terminals immutable | `states.test.ts` job Cartesian (49 pairs) + guard-reason + terminal-immutability tests green | `pass` |
| Every Cartesian attempt/lease/browser/service-desired/service-instance from/to matches expected; non-job terminals immutable | `states.test.ts` per-machine Cartesian (81+25+100+16+81 pairs) + non-job terminal test green | `pass` |
| **E1-D001 JSON parity**: for each of the 6 machines the embedded states/edges/guards/terminal EQUAL the JSON `states`/`allowed`/`guards`/`terminal` exactly | `states.test.ts` "lifecycle parity" suite loads `distributed-execution-lifecycles.json` and asserts exact-order states, sorted edge-set equality, reconstructed guards (`{failed:non_retryable_failure, dead_letter:policy_exhausted}` for job, `{}` elsewhere), and reconstructed terminal sets — all 6 machines green | `pass` |
| Every `forbiddenCrossLifecycleEdges` pair is NOT permitted by the predicates | `states.test.ts` "permits no forbidden cross-lifecycle edge" — all 9 JSON pairs are cross-machine; the from-/to-machine predicate rejects the transition whenever the counterpart state is foreign | `pass` |
| No machine permits a transition into another lifecycle's exclusive state | `states.test.ts` "never permits a transition into another lifecycle's exclusive state" — every (machine × foreign-state) probe returns false | `pass` |
| Public surface exports every new schema/constant/predicate/type; internal maps not leaked | `index.ts` `export *`; `typecheck` + `build` clean; consumers can import `canTransition*`/schemas | `pass` |
| Runtime boundary stays GREEN (only `zod` + relative; no Node API in runtime source) | `pnpm check:worker-protocol-boundary` → `worker protocol boundary: PASS` (exit 0) | `pass` |
| Build ships no test file into `dist` | `dist/` = `ids`/`index`/`states`/`version` `.js/.d.ts/.map` only | `pass` |

## Commands

| Command | Exit code | Result summary |
|---|---:|---|
| `pnpm --filter @armyofagents/worker-protocol exec vitest run src/ids.test.ts src/states.test.ts` (Step 3 — RED) | `1` | 2 failed suites — `Cannot find module './ids.js'` / `Cannot find module './states.js'`; "no tests" collected |
| `pnpm --filter @armyofagents/worker-protocol exec vitest run src/ids.test.ts src/states.test.ts` (Step 6 — GREEN) | `0` | Test Files 2 passed (2); Tests 30 passed (30) — 11 identity + 19 state-machine |
| `pnpm --filter @armyofagents/worker-protocol typecheck` (Step 6) | `0` | `tsc --noEmit` clean |
| `pnpm --filter @armyofagents/worker-protocol build` (Step 6) | `0` | `tsc` emitted `dist/{ids,index,states,version}.{js,d.ts,js.map,d.ts.map}`; no test files in `dist` |
| `pnpm check:worker-protocol-boundary` (Step 6) | `0` | `worker protocol boundary: PASS` |

### Exhaustive transition + parity counts

- **Cartesian from/to assertions (per-machine, exhaustive):** job 7×7=49, attempt 9×9=81, lease 5×5=25, browser_session 10×10=100, service_desired 4×4=16, service_instance 9×9=81 → **352 total** from/to pairs, each compared against the illustrative expected map. The job pairs additionally evaluate all 4 reasons via `.some(...)`.
- **Job guard reasons:** `dead_letter` permitted only by `policy_exhausted` (the other 3 reasons rejected), aggregate `failed` only by `non_retryable_failure`; both guards enforced from `running` and `cancel_requested`; a guard reason cannot conjure a non-existent edge (`queued→failed`/`queued→dead_letter` rejected).
- **Terminal immutability:** job (`succeeded|failed|cancelled|dead_letter`), attempt/browser (`succeeded|failed|cancelled|expired`), lease (`released|expired|revoked`), service_desired (`deleted`), service_instance (`stopped|failed|lost`) — every terminal has zero outgoing edges under every reason.
- **JSON parity (E1-D001):** all 6 machines pass exact-order `states` equality, sorted `allowed`-edge-set equality, guard-map equality, and terminal-set equality against `docs/architecture/distributed-execution-lifecycles.json`.
- **Forbidden cross-lifecycle edges:** all 9 JSON pairs asserted not permitted; plus a foreign-state closure sweep over all 23 union state names.

## Deviations

None from the plan's substance. Two implementation notes for the reviewer:

1. **Extra job-reason exports.** `states.ts` additionally exports `JOB_TRANSITION_REASONS`, `jobTransitionReasonSchema`, and `type JobTransitionReason` beyond the plan's enumerated "Export exactly" list. These are the typed contract of `canTransitionJobStatus`'s `{ reason }` argument (the amendment mandates `reason: normal | cancel | non_retryable_failure | policy_exhausted`); external callers need the type to construct the argument. No transition-map/guard internals are exported — those stay module-private, so the intended schema/constant/predicate/type surface is exactly the plan's list plus this reason contract.
2. **Parity reconstruction is behavior-level.** The E1-D001 parity test reconstructs each machine's edges/guards/terminal **from the exported predicates** (not from a re-exported raw map) and compares to the JSON. This tests the runtime predicate behavior against the authority, not merely a constant, and is strictly stronger than a constant-to-JSON diff. Guards are reconstructed from the job predicate's reason-sensitivity (a guarded target is permitted by exactly one reason).

## Findings

None.

## Follow-up tickets

None. PRT-003 (job/workload/lease envelopes) is the next Epic E1 ticket and is out of scope here.

## Gate recommendation

`ready for independent review` — Step-3 RED is recorded (both identity + state modules missing, exit 1, no tests collected), every Step-6 command exits 0 (30/30 tests, typecheck clean, build with no test file in `dist`, boundary PASS), the E1-D001 JSON-parity cross-check passes for all 6 machines, all 9 forbidden cross-lifecycle edges are rejected, and only the planned PRT-002 files (`ids`/`states`/`.test`/`index` + this ledger) are touched (`dist` is gitignored and excluded from the commit).

## Independent review

**Reviewer:** `<pending until first independent review, then agent or human identity; must differ from implementer>`
**Reviewed revision:** `<pending until first independent review, then 40-character git SHA>`
**Disposition:** `pending`
**Review evidence:** `<pending until first independent review, then review record, exact commands/exit codes, or finding links>`

For `approved`, verify the result describes the reviewed revision, all focused acceptance evidence passes, and every accepted finding is resolved; then change the top-level `Status` to `complete` and commit this disposition separately. Otherwise leave `Status` as `gate_review` or set `blocked`, and link stable findings.

## Review attempt history

The implementation author leaves the table body empty; the explicit pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt for existing gate tooling. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it. Repository history identifies that commit, and handoffs pin the resulting ticket-result blob SHA.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- First independent reviewer appends attempt 1. -->
