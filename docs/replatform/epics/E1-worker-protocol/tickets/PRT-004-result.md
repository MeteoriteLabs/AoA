# PRT-004 Result — Sequenced Worker Events, Cumulative ACK, and the Shared Canonicalizer

**Status:** `gate_review`
**Date (UTC):** `2026-08-09`
**Epic:** `E1-worker-protocol`
**Plan task:** `Task 4: PRT-004 — Sequenced Worker Events and Cumulative ACK`
**Implementer:** `PRT-004 implementer subagent (Claude)`
**Start SHA:** cc9bce140d21b80a772a906d481c79f09829ad41

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the section below and is the only role that may change it to `complete`.

This file is a controlled append-only review ledger until `complete`; do not delete or rewrite prior review attempts. Once `complete`, it is frozen. Ticket commands are focused acceptance evidence, not the immutable epic D0 rollup.

## Delivered scope

Two commits: **A** (plan core — the shared canonicalizer + event/batch/ACK schemas) and **B** (the E1-F004 unification refactor of `job.ts`).

- **`packages/worker-protocol/src/canonical-json.ts`** — the SINGLE canonicalizer for the package. Dependency-free (no `zod`, no `node:*`, no forbidden global — `TextEncoder` only, NEVER `Buffer`). Byte-for-byte reproduction of the frozen E0 authority `scripts/check-distributed-execution-foundation.mjs` (`canonicalizeJson`/`computeEventDigest`, `(c1)` RFC 8785 subset):
  - `canonicalizeJsonV1(value)` — RFC 8785 subset canonical string. Integer-only subset: THROWS `CanonicalJsonError` on non-integer numbers, non-safe integers (2⁵³ boundary), non-finite numbers, lone/broken UTF-16 surrogates, and unsupported types (`undefined`/bigint/function/symbol). `-0`→`"0"`; keys sorted by UTF-16 code units (default `.sort()`); exact ECMAScript/RFC 8785 string escapes; no added Unicode normalization; forward slash NOT escaped.
  - `canonicalEventDigestInputV1(event)` — requires a plain object; removes ONLY `eventDigest`; canonicalizes the rest; returns `new TextEncoder().encode(canonical)` (`Uint8Array`). Rejects an already-stringified / non-object / array input.
  - `verifyWorkerEventDigestV1(event, sha256Fn)` — injects a sync-or-async SHA-256 (lowercase hex); recomputes over `canonicalEventDigestInputV1`; returns `false` on any supplied/recomputed mismatch, a missing/non-string `eventDigest`, or a non-canonicalizable event (never throws). Hash-provider neutral — no `node:crypto` in runtime source.
- **`packages/worker-protocol/src/events.ts`** — sequenced worker events, batch, and cumulative ACK:
  - Strict base identity `{ protocolVersion:1, eventId, organizationId, companyId, workerId, jobId, attempt, leaseId, fenceToken, seq (positive), eventDigest, occurredAt, extensions }` extended by `z.discriminatedUnion("eventType", …)` over the **19** payload pairs: `attempt_started, log, progress, usage, artifact_prepared, browser_observation, browser_approval_requested, runtime_decision_requested, service_instance_started, service_health, service_checkpoint_prepared, service_checkpoint_restored, service_graceful_stop_observed, service_instance_stopped, service_instance_lost, service_provider_interrupted, service_provider_resumed, network_denied, terminal`.
  - `progress.percent` is an INTEGER 0–100 (nullable), never a float (the FND-004-locked digest subset rejects floats). `usage` is evidentiary — `.strict()` rejects `costMicros`/`provider`/`model`/`biller`/`billingType`/`rate`/`rounding` and every other pricing/charge field (non-negative integer tokens/runtime only). `terminal.status` stays `succeeded|failed|cancelled|expired`; service `healthy|stopped|lost` are distinct service-instance events, never `terminal`.
  - `runtime_decision_requested` = strict `z.discriminatedUnion("decisionKind", [permission, work_question])` over the shared common shape `{ requestId, nonce (≤200 UTF-8 bytes), requestDigest, schemaVersion (positive), sourceRevision (non-negative safe int), expiresAt, title, summary nullable }`. **permission**: `defaultDecision ∈ allow_once|allow_run|deny|null` (`allow_always` is never a timeout default — omitted from the enum); `continue_with_default` requires non-null `defaultDecision`, every other timeout policy requires null; `toolName/command/cwd/path/networkTarget/riskClass` nullable + individually bounded. **work_question**: `promptText` ≤8000; `options` ≤32 strict `{ optionId (≤200 UTF-8 bytes), label (≤1000 UTF-8 bytes), value (bounded JSON: canonical ≤16 KiB + depth ≤8, fail-closed on out-of-subset), isDefault }`; `continue_with_default` requires exactly one `isDefault` option, every other policy requires zero. Cross-kind fields rejected by `.strict()`.
  - `addForbiddenWireKeyIssues` (recursive wire-safety) applied to every event, batch, and ACK; a bounded-extension refiner (≤16, unique namespace, unknown-critical fails closed, per-value canonical ≤16,384 bytes / fail-closed canonicalization) applied to every event's `extensions`.
  - `workerEventBatchV1Schema` (1–500 events; every event repeats the batch org/company/worker/job/attempt/lease/fence; unique event IDs; contiguous sequences) and `workerEventAckV1Schema` (cumulative: `expectedNextSeq === acceptedThroughSeq + 1`; status `accepted|gap|hash_mismatch|stale_fence|target_revoked|terminal`; `hash_mismatch` requires `rejectedEventId`, every non-conflict status forbids it; negatives rejected).
  - Exports all payload/decision/event/batch/ACK schemas, the `WORKER_EVENT_TYPES`/`WORKER_EVENT_ACK_STATUSES`/enum vocabularies, and inferred types.
- **`packages/worker-protocol/src/job.ts` (Deliverable B — E1-F004 unification)** — the local private canonicalizer (`canonicalString`/`canonicalJson`/`canonicalByteLength`) is REMOVED; `job.ts` now sizes extension values via `new TextEncoder().encode(canonicalizeJsonV1(value)).byteLength` from `./canonical-json.js`, so the package carries ONE canonicalizer. The existing extension try/catch still converts a canonicalizer throw into a fail-closed "not canonicalizable" issue.
- **`packages/worker-protocol/src/index.ts`** — explicit named re-exports (`export { … }` values, `export type { … }` types; no `export *`) of the canonical-json + events surface.

**Non-goals preserved (per plan).** No policy/artifact/capability/transport/error schemas (PRT-005…PRT-007). No `runtime_decision_result` / product-approval *result* schema (PRT-007). No conformance corpus / Ajv golden-journey pass (PRT-006). No DB schema, route, scheduler, worker, provider SDK, or UI. The fixtures under `tests/fixtures/distributed-execution/` are frozen E0 authority and were NOT modified. Runtime source imports only `zod` + relative modules and uses `TextEncoder`, never `Buffer` or any `node:*`.

## Changed files

| File | Responsibility |
|---|---|
| `packages/worker-protocol/src/canonical-json.ts` | Dependency-free RFC 8785 subset canonicalizer (E0-byte-exact) + `canonicalEventDigestInputV1` + injectable-hash `verifyWorkerEventDigestV1`. |
| `packages/worker-protocol/src/canonical-json.test.ts` | RFC 8785 conformance vectors (order independence, integer/`-0`, escapes, non-ASCII/astral, rejection set) + digest-input/verify round-trip + mutation coverage (Node crypto injected). |
| `packages/worker-protocol/src/events.ts` | Strict event base + 19-variant discriminated union, `runtime_decision_requested` permission/work_question union, batch + cumulative ACK schemas, recursive wire-safety + bounded extensions. |
| `packages/worker-protocol/src/events.test.ts` | Per-type parse, unknown-type/log-bound/nested-credential, additive-survives, usage-pricing, runtime-decision default rules, batch identity/uniqueness/contiguity, ACK invariants, and the 9-fixture/50-event cross-implementation digest equivalence. |
| `packages/worker-protocol/src/job.ts` | (Deliverable B) local canonicalizer removed; extension byte-sizing now uses the shared `canonicalizeJsonV1` — single canonicalizer. |
| `packages/worker-protocol/src/index.ts` | Explicit named re-exports of the new canonical-json + events wire surface. |
| `docs/replatform/epics/E1-worker-protocol/tickets/PRT-004-result.md` | This ticket result ledger. |

## Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| `canonical-json.ts` + `events.ts` fail RED before they exist | Step 2: `vitest run src/canonical-json.test.ts src/events.test.ts` exit 1 — 2 failed suites, `Cannot find module './canonical-json.js'`, "no tests" collected | `pass` |
| RFC 8785 vectors: property-order independence; UTF-16 key sort; integer no-exponent/no-leading-zero; `-0`→`0`; exact string escapes; non-ASCII/astral passthrough (no NFC/NFD) | `canonical-json.test.ts` "RFC 8785 subset conformance" (8 cases) green | `pass` |
| RFC 8785 rejection set: floats, non-finite, unsafe int (2⁵³ + negative), lone/stray surrogate + high-not-followed-by-low, unsupported types (undefined/bigint/symbol/function); largest SAFE int accepted | `canonical-json.test.ts` (5 rejection cases + boundary) green | `pass` |
| `canonicalEventDigestInputV1` removes only `eventDigest`, returns UTF-8 bytes, rejects non-object / stringified input | `canonical-json.test.ts` "canonicalEventDigestInputV1" (4 cases) green | `pass` |
| `verifyWorkerEventDigestV1` verifies a correct digest (sync + async injected SHA-256); returns false when identity/timestamp/type/payload/seq changes without recompute, on wrong digest, and on a non-object / missing / non-string digest | `canonical-json.test.ts` "verifyWorkerEventDigestV1" (5 cases) green | `pass` |
| **Cross-implementation digest equivalence (closes the two-canonicalizer seam):** every committed `eventDigest` across ALL 9 `tests/fixtures/distributed-execution/*.json` reproduced byte-for-byte by `sha256hex(canonicalEventDigestInputV1(fixtureEvent))` (Node crypto) — **9 fixtures, 50 events, ZERO mismatches** | `events.test.ts` "cross-implementation eventDigest equivalence" green — asserts `mismatches === []`, `fixturesWithEvents === 9`, `totalEvents === 50` | `pass` |
| Every one of the 19 event types parses with its payload; unknown type fails; wrong/extra-key payload fails (strict); malformed base identity (seq 0 / bad fence / protocolVersion 2 / extra key) fails | `events.test.ts` "every event type parses" + "malformed base identity" green; `WORKER_EVENT_TYPES.length === 19` locked | `pass` |
| log message >65,536 chars fails (65,536 ok); progress percent integer 0–100 nullable, float/101/-1 fail; usage rejects costMicros/provider/model/biller/billingType/rate/rounding + negative tokens; terminal rejects stopped/lost/healthy/done | `events.test.ts` "payload bounds and metering rules" green | `pass` |
| Safe non-critical extension preserved (value deep-equals); nested credential key inside an extension value AND inside a payload fails; unknown critical fails closed; >16 extensions fails | `events.test.ts` "wire safety and safe additive extensions" green | `pass` |
| runtime_decision permission: `continue_with_default` requires non-null default, other policies require null, `allow_always` never a default, cross-kind field rejected | `events.test.ts` "permission timeout/default rules" (5 cases) green | `pass` |
| runtime_decision work_question: exactly one default for `continue_with_default`, zero for others, `deny` policy rejected (permission-only), ≤32 options, permission field rejected, option value >16 KiB canonical rejected | `events.test.ts` "work-question default rules" (6 cases) green | `pass` |
| Batch: contiguous 1,2 ok; gap 1→3 fails; duplicate seq fails; duplicate eventId fails; identity-mismatch event fails; empty fails; >500 fails | `events.test.ts` "batch identity, uniqueness, contiguous sequence" (6 cases) green | `pass` |
| ACK: `expectedNextSeq === acceptedThroughSeq+1` required (incl. 0→1); mismatch fails; negatives fail; `hash_mismatch` requires `rejectedEventId` and non-conflict statuses forbid it; unknown status fails | `events.test.ts` "cumulative ACK invariants" (5 cases) green | `pass` |
| Public surface exported via explicit named re-exports (no `export *`); typecheck + build clean; no test file in `dist` | `index.ts` explicit exports; `typecheck`/`build` exit 0; `dist/` has `canonical-json.*`/`events.*`, no `*.test.*` | `pass` |
| Runtime boundary stays GREEN (only `zod` + relative; `TextEncoder` not `Buffer`; no `node:*`) | `pnpm check:worker-protocol-boundary` → `worker protocol boundary: PASS` exit 0 | `pass` |
| **Deliverable B:** `job.ts` now single-canonicalizer; all job tests still green; out-of-subset still fail-closed; in-subset boundary 16,384/16,385 unchanged | see "Deliverable B — E1-F004 unification" below | `pass` |

## Commands

| Command | Exit code | Result summary |
|---|---:|---|
| `pnpm --filter @armyofagents/worker-protocol exec vitest run src/canonical-json.test.ts src/events.test.ts` (Step 2 — RED) | `1` | 2 failed suites — `Cannot find module './canonical-json.js'`; "no tests" collected |
| `pnpm --filter @armyofagents/worker-protocol exec vitest run src/canonical-json.test.ts src/events.test.ts` (Step 5 — GREEN) | `0` | Test Files 2 passed (2); Tests **77 passed** (23 canonical-json + 54 events) |
| `pnpm --filter @armyofagents/worker-protocol typecheck` | `0` | `tsc --noEmit` clean |
| `pnpm --filter @armyofagents/worker-protocol build` | `0` | `tsc` emitted `dist/{canonical-json,events}.{js,d.ts,*.map}`; no `*.test.*` in `dist/` |
| `pnpm check:worker-protocol-boundary` | `0` | `worker protocol boundary: PASS` |
| `pnpm --filter @armyofagents/worker-protocol test:run` (full-package sanity, after Deliverable A) | `0` | Test Files 8 passed (8); Tests **201 passed** — existing ids/states/source/job/index/wire-safety unaffected |

### Cross-implementation digest reproduction detail

- Fixtures scanned: all 10 `*.json` under `tests/fixtures/distributed-execution/`. `schema-v1.json` carries no `expectedEvents` and contributes 0 events (naturally excluded by iterating `expectedEvents[]`).
- **Fixtures with events: 9** (`batch-cancel-during-execution`, `batch-success`, `browser-approval-download`, `browser-denied-egress`, `late-output-quarantine`, `plaintext-secret-in-argv-rejected`, `service-budget-stop`, `service-provider-pause-resume`, `service-restart-checkpoint`).
- **Events with a committed `eventDigest`: 50.** Every one reproduced byte-for-byte via `sha256hex(canonicalEventDigestInputV1(rawFixtureEvent))` with Node `crypto.createHash("sha256")`. **Mismatches: 0.** A single mismatch would fail the suite (`expect(mismatches).toEqual([])`).
- The fixture events use ULID-style IDs and integer `fenceToken` (E0 encoding). They are NOT parsed through `workerEventV1Schema`; the digest check is pure canonicalization of the raw fixture object minus `eventDigest`, which is the intended cross-check (E0 checker `.mjs` owns the bytes; this package's `.ts` proves agreement).

### Digest recompute / mutation coverage

- Round-trip: `sha256hex(canonicalEventDigestInputV1(event))` → set as `eventDigest` → `verifyWorkerEventDigestV1` returns `true` (sync and async injected SHA-256).
- Mutation (no recompute) → `false` for each of: `organizationId`, `occurredAt`, `eventType`, `seq`, `payload`. Wrong supplied digest → `false`. Non-object / missing / non-string `eventDigest` → `false`.

## Deviations

1. **Event extension bounds (scoping).** The plan requires events carry "the explicit bounded extension field" + recursive wire-safety. The rich per-value micro-limits (depth/array-items/object-keys/key-bytes) are a PRT-003 job-envelope concern and `job.ts`'s `addExtensionArrayIssues` is not exported (job.ts is only a Deliverable-B target, not to be widened in Deliverable A). Event extensions are therefore bounded by: count ≤16, unique namespace, unknown-critical-fails-closed, recursive forbidden-credential-key rejection, and a per-value canonical byte budget (≤16,384) with fail-closed canonicalization via the shared `canonicalizeJsonV1`. This reuses the single canonicalizer and keeps events light while still preventing arbitrarily large/non-canonicalizable event extension values.
2. **`eventDigest` is a structural field only in the schema.** `workerEventV1Schema` requires `eventDigest` to be a valid lowercase SHA-256 hex string but does NOT verify it matches the event content — digest verification is the separate injectable `verifyWorkerEventDigestV1` receiver step (the schema is context-free; PRT-007/JOB-005 own recompute-before-ACK in-transaction).
3. **`canonicalizeJsonV1` reproduces E0's object branch for ANY object (`typeof === "object"`), not only `isPlainObject`.** This is required for byte-for-byte E0 parity (the digest cross-check depends on it). For Deliverable B this is byte-identical for every tested `job.ts` input; see the Deliverable-B note.

## Deliverable B — E1-F004 unification (second commit)

`job.ts`'s local private canonicalizer (`canonicalString`/`canonicalJson`/`canonicalByteLength`, PRT-003 Deviation 1) is removed and replaced by `canonicalByteLength(value) = new TextEncoder().encode(canonicalizeJsonV1(value)).byteLength` importing the shared `./canonical-json.js`. The package now carries exactly ONE canonicalizer (E1-F004 non-blocking follow-up satisfied).

- **Behavior byte-identical for every tested input.** The shared `canonicalizeJsonV1` reproduces E0's `canonicalizeJson` byte-for-byte; for the extension-sizing path it rejects the same out-of-subset values (float/unsafe int/lone surrogate) via the same throw, which the existing `addExtensionArrayIssues` try/catch converts into the same fail-closed "not canonicalizable" issue at the extension value path. The one representational difference — a NON-plain object (Date/Map/class instance) is serialized as an object by the shared canonicalizer whereas the old local `isPlainObject`-gated `canonicalJson` threw — cannot change any validation outcome here: `addExtensionValueStructureIssues` independently rejects a non-plain-object extension value with a "must be JSON" issue, so the envelope still fails closed, and no `job.test.ts` case exercises a non-plain-object extension value (the E1-F004 battery is float/unsafe-int/lone-surrogate, all of which both implementations throw on identically).
- **Verification:** `job.test.ts` re-run GREEN incl. the 13 E1-F004 out-of-subset assertions; out-of-subset extension values (`1.5`, `9007199254740992`, `"\uD800"`, `"\uDC00"`, `{rate:0.25}`, `[9007199254740992]`) still fail closed on BOTH `jobEnvelopeV1Schema` and `leaseOfferV1Schema`; in-subset value-budget boundary unchanged at 16,384 pass / 16,385 fail. `grep` confirms the only `canonicalize*`/`canonical*` function definitions in runtime source are `canonical-json.ts`'s `canonicalizeString`/`canonicalizeNumber` (private internals) + `canonicalizeJsonV1` (public), plus `job.ts`'s thin `canonicalByteLength` sizing wrapper that delegates to `canonicalizeJsonV1` — one canonicalizer.

| Command (Deliverable B) | Exit code | Result summary |
|---|---:|---|
| `pnpm --filter @armyofagents/worker-protocol exec vitest run src/job.test.ts` | `0` | Test Files 1 passed (1); Tests **60 passed** (incl. the 13 E1-F004 out-of-subset assertions) |
| `pnpm --filter @armyofagents/worker-protocol test:run` (full package) | `0` | Test Files 8 passed (8); Tests **201 passed** — no regression |
| `pnpm --filter @armyofagents/worker-protocol typecheck` | `0` | `tsc --noEmit` clean (no unused-symbol error from the removed local canonicalizer) |
| `pnpm --filter @armyofagents/worker-protocol build` | `0` | `tsc` clean; no `*.test.*` in `dist/` |
| `pnpm check:worker-protocol-boundary` | `0` | `worker protocol boundary: PASS` (still no `Buffer`/`node:*` in runtime source) |

## Findings

None newly raised. E1-F004's non-blocking PRT-004 follow-up (unify `job.ts` onto the shared canonicalizer) is satisfied by Deliverable B.

## Follow-up tickets

None. PRT-005 (workspace/artifact/secret/resource/network contracts) is the next Epic E1 ticket and is out of scope here; it introduces `policy.ts`/`artifacts.ts` and the `secretHandleIds`→`secretHandles` job refinement.

## Gate recommendation

`ready for independent review` — RED captured at Step 2 (exit 1, 2 suites, no tests collected); the four Step-5 focused commands at exit 0 (tests 77/77, typecheck clean, build with no test file in `dist`, boundary PASS); full package 201/201. The required PRT-004 acceptance item — cross-implementation digest equivalence against the frozen E0 golden fixtures — reproduces all **50** committed `eventDigest`s across **9** fixtures with **zero** mismatches, closing the two-canonicalizer seam. Deliverable B unifies `job.ts` onto the shared canonicalizer (single canonicalizer) with all job tests still green and out-of-subset values still fail-closed. Scope is the two new PRT-004 modules + their tests, the `job.ts` unification, and explicit `index.ts` re-exports; no policy/artifact/capability/transport schema, no DB/route/worker/UI, no hosted-API/`node:*`/`Buffer` in runtime source, and the frozen E0 fixtures untouched.

## Independent review

**Reviewer:** PRT-004 independent reviewer subagent (Claude)
**Reviewed revision:** `590f8162f1234beffd83a759c03bc743357181d1`
**Disposition:** `changes_requested`
**Review evidence:**

Re-run on the reviewed revision (all green): focused `vitest run src/canonical-json.test.ts src/events.test.ts` → exit 0, **77 passed** (23 + 54); full `test:run` → exit 0, **201 passed** (8 files); `typecheck` → exit 0; `build` → exit 0 (`dist/` carries `canonical-json.*`/`events.*`, **no** `*.test.*`); `pnpm check:worker-protocol-boundary` → exit 0 (`worker protocol boundary: PASS`); `git diff --check` → exit 0; `git status --porcelain` → clean.

**Independent digest cross-check (not the implementer's test).** A standalone probe imported the frozen E0 authority `scripts/check-distributed-execution-foundation.mjs` (`canonicalizeJson`/`computeEventDigest`) AND the built `canonicalEventDigestInputV1`; for every event with a committed `eventDigest` across all fixtures it asserted `sha256hex(canonicalEventDigestInputV1(ev)) === ev.eventDigest === computeEventDigest(ev)`. Result: **10 files, 9 with events, 50 events, three-way agreement, 0 mismatches.** RFC-8785 fidelity vs E0: accept battery (key order, multibyte/astral keys, control escapes, `-0`, max-safe-int) → 0 diffs; reject battery → all 12 out-of-subset inputs (float, unsafe int ±, NaN, Infinity, lone high/low surrogate, high-not-followed-by-low, undefined, bigint, symbol, function) THROW on BOTH `canonicalizeJsonV1` and E0. The two-canonicalizer seam is closed.

**Unification (E1-F004).** `grep` confirms the only canonicalizer function definitions in runtime source are `canonical-json.ts`'s private `canonicalizeString`/`canonicalizeNumber` + public `canonicalizeJsonV1`, plus `job.ts`'s thin `canonicalByteLength` that delegates to `canonicalizeJsonV1`; the pre-B local `canonicalString`/`canonicalJson` are gone — **exactly ONE canonicalizer**. Out-of-subset extension values (`1.5`, `9007199254740992`, `"\uD800"`, `"\uDC00"`, `{rate:0.25}`, `[9007199254740992]`) still fail-closed on both `jobEnvelopeV1Schema` and `leaseOfferV1Schema`; in-subset value budget boundary unchanged (16,384 pass / 16,385 fail); 60 job tests green. E1-F004's non-blocking PRT-004 follow-up (single canonicalizer) IS satisfied by Deliverable B.

**Union / batch / ACK (independent probe against built schemas): all correct.** All 19 event types parse with valid payloads; unknown type fails; `log` message 65,536 ok / 65,537 fails; `progress.percent` integer-only (50.5 and 101 fail); `usage` rejects `costMicros`/`provider`/negative tokens; `terminal.status` rejects `healthy`/`stopped`/`lost`; recursive credential key in payload/extension fails; permission `continue_with_default` requires non-null `defaultDecision` (null fails), every other policy requires null, `allow_always` is not a valid default; work_question `continue_with_default` requires exactly one `isDefault` (zero/two fail), other policies require zero, `deny` policy is permission-only; batch identity echo / unique eventId / contiguous seq / 1–500 boundary (1 ok, 500 ok, 501 fails) / gap / duplicate all correct; ACK `expectedNextSeq === acceptedThroughSeq+1` (incl. 0→1), negatives fail, `hash_mismatch` requires `rejectedEventId` and every non-conflict status forbids it, unknown status fails.

**Blocking defect — [E1-F005](../findings.md): worker-event extensions under-enforce the ONE bounded-extension container.** `events.ts` applies a bespoke `refineEventExtensions` rather than the job/lease `addExtensionArrayIssues`, dropping the value structural walk and the combined budget. Empirically, on identical extension arrays `workerEventV1Schema` **accepts** where `jobEnvelopeV1Schema` **rejects**: container depth 9, 129 array items, 65 object keys, a 101-UTF-8-byte key, and combined >65,536 canonical bytes (5 × 13,200). The per-value 16,384-byte, namespace, schemaVersion, count-≤16, unknown-critical, and credential-key limits DO agree. The plan (line 962) requires the event base to carry "the explicit bounded extension field" = the line-71 container with those EXACT limits ("this is the ONE contract"); no E1 decision sanctions a lighter event variant. This is a fail-open on the batched (≤500/batch, no batch-level budget) inbound worker→control-plane surface — one event may carry 262,144 bytes of extensions (4× the intended combined budget), a batch ~131 MB, and ~8,000-level nesting is admitted within the 16 KB per-value budget (unbounded-by-contract recursion in the recursive `canonicalizeJsonV1` validation itself and JOB-005 recompute). Required: make event `extensions` enforce the full container identically to job/lease — preferably via a SINGLE shared refiner used by job + lease + events (same lesson as the single canonicalizer), with the same depth/array/keys/key-bytes/combined boundary battery `job.test.ts` carries. **Deviation #3 rationale is factually wrong but inert** (`Date`/`Map`/class-instance extension values are accepted, not rejected, on BOTH surfaces; identical on both, unchanged from commit A, and unreachable via JSON wire input) — see E1-F005 note; not a defect.

For `approved`, verify the result describes the reviewed revision, all focused acceptance evidence passes (including the 9-fixture/50-event zero-mismatch digest cross-check and Deliverable B's job-test parity), and every accepted finding is resolved; then change the top-level `Status` to `complete` and commit this disposition separately. Otherwise leave `Status` as `gate_review` or set `blocked`, and link stable findings.

## Review attempt history

The implementation author leaves the table body empty; the explicit pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it. Repository history identifies that commit, and handoffs pin the resulting ticket-result blob SHA.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- The first independent reviewer appends attempt 1 here. -->
| 1 | PRT-004 independent reviewer subagent (Claude) | `590f8162f1234beffd83a759c03bc743357181d1` | `changes_requested` | Re-run all green (focused 77/77, full 201/201, typecheck/build/boundary exit 0, `git diff --check`/`status` clean). Independent digest cross-check 50/50 events across 9 fixtures, three-way agreement (committed === built `canonicalEventDigestInputV1`+sha256 === E0 `computeEventDigest`), 0 mismatches; RFC-8785 accept battery 0 diffs, reject battery 12/12 throw on both. Unification confirmed: exactly ONE canonicalizer, out-of-subset still fail-closed on job+lease. Union/batch/ACK spot-checks all correct. **Blocking defect [E1-F005]:** `workerEventV1Schema` extensions under-enforce the ONE bounded container — depth 9 / 129 array items / 65 object keys / 101-byte key / combined >65,536 are ACCEPTED on events but REJECTED on `jobEnvelopeV1Schema` (bespoke `refineEventExtensions` drops the value structural walk + combined budget). Fix: enforce the full amendment container on event extensions, ideally via a single shared refiner used by job + lease + events. Deviation #3 rationale factually wrong but inert (Date/Map accepted on both surfaces, unchanged from commit A, unreachable via JSON). No implementation code modified. |
