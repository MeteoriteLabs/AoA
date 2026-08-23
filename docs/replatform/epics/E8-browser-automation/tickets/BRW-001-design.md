# BRW-001 — Browser-session job and policy extensions — DESIGN

**Epic:** E8 — Browser automation · **Lane:** B (`C:\e8`, local branch `lane-b`)
**Start SHA:** this commit (recorded in `BRW-001-result.md`)
**Terrain mapped at:** `1334c8a90`
**Depends on:** CLI-006 ✅, PRT-006 ✅, PRT-007 ✅

**Outcome (program-design.md):** Add browser engine/template, viewport, locale, download,
trace, session TTL, and interaction-approval capabilities as additive protocol fields.
**Acceptance:** Old workers reject browser jobs by capability without seeing sensitive
inputs; bounded TTL and artifact retention are mandatory.
**Test:** N-1 compatibility plus validator fixtures.

---

## 1. Terrain — what already exists

Read before designing, then re-verified against the code a second time (§1.6 records the
claim that re-verification refuted).

### 1.1 The frozen protocol already ships the browser workload

`packages/worker-protocol/` is FROZEN (v1, source SHA `b7a842870ce7509d8baa75409e0ab19da375c88a`).
It is not a gap to be filled — it already contains almost the entire outcome:

| BRW-001 outcome element | Where it already lives | State |
|---|---|---|
| engine | `browserWorkloadV1Schema.engine` (`z.literal("chromium")`) | frozen |
| viewport | `browserWorkloadV1Schema.viewport` (1..16384 each axis) | frozen |
| locale | `browserWorkloadV1Schema.locale` | frozen |
| (timezone) | `browserWorkloadV1Schema.timezone` — not even in the outcome list | frozen |
| trace | `browserWorkloadV1Schema.recordTrace` / `recordVideo` | frozen |
| session TTL | `browserWorkloadV1Schema.maxSessionSeconds` (1..43 200) | frozen |
| download | `ARTIFACT_KINDS` includes `download` | frozen |
| interaction-approval | PRT-007 `product_approval_result` **and** the strict `runtime_decision` `permission \| work_question` union, separate and non-conflatable | frozen |
| artifact retention | `ARTIFACT_RETENTION_CLASSES` = `ephemeral \| run \| audit \| checkpoint`, and `artifactManifestV1Schema.retention` is a **required** field | frozen |
| template | **Deliberately absent from the wire.** `capabilities.ts`: "provider-native regions/templates never enter the wire." Template is registry-side, control-plane-owned. | locked decision |

`ARTIFACT_KINDS` further already contains every browser evidence kind BRW-003 will need:
`screenshot`, `dom_snapshot`, `browser_cookie_state`, `browser_storage_state`,
`playwright_trace`, `browser_video`, `download`. Every kind is `restricted`
(`RESTRICTED_ARTIFACT_KINDS = ARTIFACT_KINDS`; `artifactSensitivitySchema = z.literal("restricted")`).

### 1.2 The frozen-protocol STOP does not fire — resolved before designing

`HANDOFF-lane-b-browser-service.md` §7 required this be settled first: E4-D02 makes an
unavoidable wire change a STOP needing the Protocol/Schema Custodian plus D0-T04 evidence.

**No wire change is required, so the STOP does not fire.** Three independent reasons:

1. Every field the outcome names is already frozen (§1.1) — there is nothing to add.
2. Where a genuinely additive field is ever needed, PRT-006's frozen acceptance already
   grants the mechanism: *"Unknown critical extensions and policy versions fail closed;
   **safe optional extensions may be ignored and preserved**."* The bounded namespaced
   container in `extensions.ts` (`{namespace, schemaVersion, critical, value}`, ≤16 entries,
   ≤16 KiB per value, ≤64 KiB combined) is present on the job envelope as `extensions`.
3. `template` is excluded from the wire by an existing locked decision, not by an oversight.

**Constraint this places on all of E8:** `KNOWN_CRITICAL_EXTENSION_NAMESPACES` is
`new Set<string>()` — **empty by construction**. Every `critical: true` extension therefore
fails closed for *new* workers exactly as it does for old ones. Adding a namespace to that
set would be an edit to the frozen package. **Consequence: every browser field carried by
extension must be safe-to-ignore.** Anything a worker MUST understand has to be expressed
as a capability token instead, and `KNOWN_WORKER_CAPABILITIES` is likewise closed.

### 1.3 Acceptance clause 1 is already implemented — in the frozen matcher

"Old workers reject browser jobs by capability without seeing sensitive inputs."

`KNOWN_WORKER_CAPABILITIES` already contains `workload.browser_session`;
`workerCapacitySchema` already carries `browserSessionSlots`; `WORKLOAD_TYPES` already
contains `browser_session`. `workerSatisfiesRequirements` (`capabilities.ts`) computes

```
effective = server capabilityCeiling  ∩  worker reportedCapabilities
if (!effective.has(`workload.${requirements.workloadType}`)) return false
```

and separately requires a free `browserSessionSlots` slot. A worker that does not report
`workload.browser_session` is therefore **already rejected**, and the decision is taken
**control-plane-side, before any envelope is handed to a worker** — which is precisely the
"without seeing sensitive inputs" half of the clause.

BRW-001 does not implement this clause. BRW-001 must **prove it is reachable and correctly
ordered** on the real submission path, and pin that with a test — because an unreachable
correct mechanism is this programme's signature defect (`checks-that-nothing-runs`).

### 1.4 The control-plane pipeline exists end to end, and is mounted

Corrected from a wrong first read — see §1.6.

- `packages/shared/src/validators/job-control.ts` → `browserRequest` is a real member of
  `submitJobSourceSchema`: `{kind:"browser_request", browserRequestId, parentJobId}`.
- `packages/shared/src/job-control-source.ts:52` → `browser_request` ⇒ workload
  `browser_session`.
- `job-submission.ts:91` → requester allow-list `founder | team_lead | team_member | agent`.
- `job-submission.ts:130` → `requiredCapabilities: ["browser.chromium"]` is injected for a
  browser request.
- `job-placement.ts:179` → maps capability `browser.chromium` ⇒ `workload.browser_session`.
- `job-leasing.ts:485` → offers `browser_session` when `browserSessionSlots` are free.
- `job-admission-bridge.ts`, `job-approval-bridge.ts`, `job-authoritative-rate.ts`,
  `job-shadow-admissibility.ts` all carry real `browser_request` arms.
- **Boot root:** `server/src/app.ts:447` mounts `jobControlRoutes`, which exposes
  `POST /organizations/:organizationId/companies/:companyId/jobs` behind
  `validate(submitJobCommandSchema)`. A `browser_request` **can be submitted today.**

### 1.5 The actual gap — measured, not reasoned

`buildJobEnvelope` (`job-leasing.ts:341`) is the single envelope constructor. Its last two
fields are:

```js
workloadType: input.job.workloadType,
workload: input.job.input,        // the raw, untyped submission blob, passed straight through
```

and the only gate is `jobEnvelopeV1Schema.safeParse(candidate)` — returning `null` (⇒ **no
lease**) on failure. Meanwhile the submission surface types `input` as
`z.record(z.unknown())` bounded only at 64 KiB.

So the browser configuration has **no typed path at all**. Measured against the frozen
schema (probe over `dist/index.js`):

```
REJECT  empty input (typical submit blob)   -> engine, viewport, locale, timezone,
                                               recordTrace, recordVideo, maxSessionSeconds
REJECT  plausible caller guess              -> locale, timezone, recordTrace,
                                               recordVideo, maxSessionSeconds
REJECT  batch-shaped input                  -> all 7 + (root)
ACCEPT  exact frozen shape
REJECT  TTL above frozen ceiling (43201)    -> maxSessionSeconds
REJECT  TTL omitted                         -> maxSessionSeconds
```

**Therefore, today: a browser job is accepted at submit (job row persisted, HTTP success),
and then silently never leases** — unless the caller hand-crafts a blob that exactly matches
a frozen schema the API never told them about. The failure is invisible at the point of
error and surfaces later as an absence.

That silent-non-lease is the defect BRW-001 closes.

Two facts inherited from this measurement, both load-bearing:

- **TTL is already mandatory and already bounded on the wire** (`TTL omitted` → REJECT,
  `43201` → REJECT). Acceptance clause 2's TTL half is satisfied by frozen v1 *at lease
  time*; BRW-001's job is to move that rejection **forward to submit time** and to add a
  server-owned ceiling beneath the frozen one.
- **Retention cannot live in `job.input`.** `browserWorkloadV1Schema` is `.strict()` — any
  extra key makes the whole envelope fail to parse. Retention needs a different home (§3.2).

### 1.6 What re-verification refuted (process step 2)

My first read concluded "the browser pipeline exists but has **no producer** — every
reference is a `case` arm waiting for input that never arrives." That was **wrong**, and
grep alone would have shipped it. Tracing to a boot root found
`server/src/app.ts:447` mounting `jobControlRoutes`, whose `POST …/jobs` accepts
`browser_request` through the shared validator.

The correction matters: it moves BRW-001 from "build a submission path" to "**type and
validate the submission path that already exists**", which is a materially smaller and
differently-shaped ticket. Recorded because the handoff's rule is that a first read is
wrong often enough to be worth checking every time — this is the instance for this ticket.

---

## 2. Deconfliction — why this design avoids Lane A entirely

`HANDOFF-lane-b-browser-service.md` §5.5 forbids touching `job-leasing.ts`,
`job-placement*.ts`, `execution-secret-*.ts`, `secret-broker.ts`, `worker-control.ts`, and
`job_secret_handles.ts` without coordination. Lane A is actively editing them for DAT-008
slices 5–7 — visibly so: `buildJobEnvelope`'s `secretHandles` parameter carries a DAT-008
comment.

**The natural-looking implementation site — `buildJobEnvelope` — is exactly one of those
files.** This design does not touch it.

Instead BRW-001 does its work at **submission** time, normalising the browser configuration
into `job.input` so that the blob already satisfies `browserWorkloadV1Schema` by the time
`buildJobEnvelope` reads it. The existing `workload: input.job.input` pass-through then
works **unchanged**.

Consequences, all deliberate:

- **Zero edits to any §5.5 file.**
- **Zero edits to the frozen protocol package.**
- **No migration** — so no collision with Lane A's migration numbering (§5.4). Highest
  existing migration is `0263` (Lane A's); BRW-001 generates none.
- Files touched: `server/src/services/job-submission.ts` (small, **not** on the §5.5 list)
  plus new modules owned solely by this lane.

---

## 3. Design

### 3.1 `server/src/services/browser-job-config.ts` — new, lane-owned

A pure decision function, no I/O:

```ts
normalizeBrowserJobInput(raw: unknown, ceilings: BrowserSessionCeilings):
  | { ok: true;  value: BrowserWorkloadV1 }
  | { ok: false; reason: BrowserConfigRejection }
```

- **Total and fail-closed.** Every rejection carries a typed machine-readable reason; there
  is no path that returns a partially-valid workload.
- **Defaults** for the ergonomic fields the caller may omit — `viewport` (1280×720),
  `locale` (`en-US`), `timezone` (`UTC`), `recordTrace`, `recordVideo`. Defaulting is
  applied *before* validation so the output is always exactly the frozen shape.
- **TTL is mandatory in the output and bounded by a server ceiling that is ≤ the frozen
  ceiling.** A caller may omit `maxSessionSeconds` (a bounded default applies) but may
  never exceed `ceilings.maxSessionSeconds`, which is itself asserted ≤ 43 200 by a
  compile-time-and-runtime guard. This makes the platform ceiling authoritative and keeps
  the frozen ceiling as a backstop rather than the only bound.
- **Output is validated against the frozen `browserWorkloadV1Schema` before returning**, so
  the module cannot drift from the wire contract: the frozen schema, not this module, is
  the final authority.

### 3.2 `server/src/services/browser-artifact-retention.ts` — new, lane-owned

Acceptance requires artifact retention be **mandatory**. Design decision: retention is a
**total function of artifact kind**, control-plane-owned, and **never caller- or
worker-supplied**.

```ts
browserArtifactRetention(kind: ArtifactKind): ArtifactRetentionClass
```

Rationale, in preference order:

1. **Mandatory means no absent path.** A total function over a closed enum cannot yield
   "unset". A per-job caller-chosen retention has a null/missing path by construction.
2. **Security.** Letting a caller (or a worker) choose the retention of a
   `browser_cookie_state` or `browser_storage_state` artifact is a privilege the threat
   model should not grant. Platform policy decides.
3. **It needs no storage**, so it needs no migration and no schema coupling (§2).

An **exhaustiveness guard** makes an unhandled future artifact kind a compile error *and* a
test failure, so a new kind can never silently acquire no retention. BRW-003 consumes this
map when it stamps manifests; BRW-001 establishes and proves it.

### 3.3 Wiring into `submitJobWithinTenant`

In `job-submission.ts`, for `source.kind === "browser_request"` only:

1. Run `normalizeBrowserJobInput` on `command.input`.
2. On rejection → deny the submission with a typed reason. **The error is raised at submit**,
   where the caller can act on it, instead of becoming a silent non-lease later.
3. On success → persist the normalized workload as `job.input`.

`inputHash` is computed from the **normalized** input (it must describe what actually
becomes the workload). `commandDigest` keeps hashing the **raw** command, so idempotent
replay detection (`findIdempotentReplay`) stays keyed on what the caller actually sent —
normalisation must not make two different requests collide, nor one request look new.

### 3.4 Rejected alternatives, with reasons

- **Put browser policy in `policySnapshot`.** Rejected. `policyHash = digest(policySnapshot)`
  participates in a **three-way equality** in `workerSatisfiesRequirements` step 4 (job
  policy == target committed policy == worker synced policy). Widening the snapshot shifts
  that hash and risks breaking policy coherence for every workload, not just browser.
- **Put retention/config in the bounded `extensions` array.** Rejected for BRW-001.
  `buildJobEnvelope` hardcodes `extensions: []`, so using it means editing a §5.5 file for
  no gain — retention does not need to reach the worker at all (§3.2), and the config
  already has a home in `job.input`.
- **Add a `browser_session_policy` column.** Rejected. A migration for data that a total
  function already determines, and it would bid for a migration number against Lane A.
- **Extend the `browserRequest` *source* schema with config.** Rejected. The source shape is
  mirrored in the **frozen** `packages/worker-protocol/src/source.ts`; widening it is a wire
  change and fires the E4-D02 STOP for no benefit.

---

## 4. Acceptance clause → named executable artifact

Definition of done requires every clause map to a named artifact or an explicit deferral.
Prose is not evidence.

| # | Acceptance clause | Named executable artifact |
|---|---|---|
| 1 | Old workers reject browser jobs by capability | `browser-capability-rejection.test.ts` — a worker hello without `workload.browser_session`, and one with the capability but zero `browserSessionSlots`, both rejected by `workerSatisfiesRequirements` |
| 1b | …without seeing sensitive inputs | same file — asserts the rejection is reached with **no envelope constructed**, pinning that the decision precedes payload delivery |
| 2a | Bounded TTL is mandatory | `browser-job-config.test.ts` — omitted TTL ⇒ bounded default; over-ceiling ⇒ typed rejection; server ceiling ≤ frozen 43 200 asserted |
| 2b | Artifact retention is mandatory | `browser-artifact-retention.test.ts` — total over every browser `ArtifactKind`, exhaustiveness guard fails on an unmapped kind |
| Test | N-1 compatibility | `browser-n1-compatibility.test.ts` — an N-1 worker (no browser capability, older protocol range) rejects; a current worker accepts; same envelope |
| Test | Validator fixtures | `browser-job-config.test.ts` fixture table — accept/reject vectors incl. the five measured in §1.5, asserted against the **frozen** schema |
| — | Submission no longer silently non-leases | `job-submission-browser.integration.test.ts` — invalid config rejected **at submit**; valid config produces a blob that `browserWorkloadV1Schema` accepts |

**Guards to mutation-test** (a guard whose removal leaves the suite green is not a guard):
the TTL ceiling comparison, the server-ceiling ≤ frozen-ceiling assertion, the retention
exhaustiveness guard, the browser-only branch predicate in `submitJobWithinTenant`, and the
final frozen-schema validation in `normalizeBrowserJobInput`.

## 5. Test plan (fail-first)

Every test is written and watched to fail **for the right reason** before implementation.
Unit tests are Linux+Windows; the submission integration test is
`skipIf(win32 && !AOA_RUN_WIN_INTEGRATION)` per house pattern and runs on Linux CI.

## 6. Deferrals declared up front

- **Downloads** are established here only as a retention class over the frozen `download`
  artifact kind. Download/upload *policy enforcement* is BRW-004's acceptance
  ("download/upload policy are enforced") and needs the egress proxy; not claimed here.
- **Interaction-approval** is established here as the frozen PRT-007 approval/decision
  surface being available and correctly separated. Actually *pausing a browser action* for
  approval is BRW-004; the operator experience is BRW-006.
- **Template** is registry-side by §1.1's locked decision. BRW-002 owns selecting a
  browser-capable sandbox template; `e2b/e2b.Dockerfile` has not yet been checked for a
  Chromium layer.
- No D1/D3 lane work here — BRW-005 owns both, and the D3 lane does not yet exist.
