# DAT-008 — Design: materialize the tenant model-provider credential into a distributed sandbox

**Epic:** `E5-workspaces-secrets`. **Terrain:** [`DAT-008-terrain.md`](./DAT-008-terrain.md)
(read revision 1 first). **Owns:** inherited deferral #1, and inherited deferral #3 (§7).
**Implements:** the CM-013 target state (`current-main-crosswalk.md:29`).
**Blocks:** MIG-005 / MIG-006 / MIG-007 going ACTIVE.

**Start SHA:** the commit that adds this file.
Line references are to `docs/replatform-program` at `373205816`.

---

## 1. The one-sentence goal

A distributed job's sandbox can authenticate its CLI with the Company's model-provider key,
where the key **never crosses the frozen wire** — only an opaque handle does — and every
resolution is authorized per-attempt behind an active fence.

## 2. The architecture is decided; this ticket implements it

Not restated here — see terrain revision 1. In one line: **`materialization: env` +
`usePolicy: sandbox_local_only`**, per CM-013, `program-design.md:35`, `program-design.md:765`
and CLAUDE.md Rule #11. The `proxy` + `fence_proxy` path that DAT-005 built serves the
**connector-OAuth** class and is not on this ticket's path.

### 2.1 The redemption channel — settled by E4's own non-goals, not invented here

The terrain's one genuinely open item was: *how does the worker obtain the value it must
materialize, given the frozen op list has no secret op?* Three pieces of in-tree evidence settle
it, and none of them requires a protocol change:

1. **E4 explicitly assigned this to E5/DAT.** `E4-worker-daemon/implementation-plan.md:830-833`,
   WRK-005's non-goals: *"the **live** artifact-commit / **secret-materialization** / completion /
   governed-egress **transport ops and their server routes** (no … egress-proxy … server route
   exists — **E5/DAT owns them**)."* A secret-materialization route + its worker transport op is
   *planned* work, deferred to this epic. It is not a frozen-protocol violation.
2. **DAT-004 and DAT-005 already declared these shapes non-frozen by design.**
   `SecretResolveRequestV1` — *"Not a frozen wire op — the caller presents the same complete
   active fence as a commit plus the opaque handle id"* (`secret-broker.ts:48-50`);
   `EgressRequestV1` — *"Not a frozen wire op"* (`egress-proxy.ts:49-50`). The request shapes live
   control-plane-side on purpose. `packages/worker-protocol/` is not touched by this ticket.
3. **DAT-005 pre-built the worker-side scrubber for values the worker holds.**
   `packages/worker-daemon/src/supervisor/redaction.ts` is *"the NET-NEW **worker-daemon** in-place
   secret-redaction scrubber"* with **per-run secret canaries**, and `supervisor.ts:283` records
   *"E4-D12 seeds the canaries; `[]` until then."* A per-run canary registry inside the worker
   only exists because the worker was always expected to hold per-run secret values transiently.

> **Therefore: the worker holds the plaintext transiently, between redemption and
> `provider.create`.** That is the decided design, not a compromise. §6 states the mitigations and
> §9 states the residual honestly.

## 3. What exists, what is missing

Built and **not** to be rebuilt: `resolveExecutionSecret` (fence-first, owner re-derived from the
LOCKED job row, membership re-checked in-tx, audit-as-columns, returns a non-secret binding),
`createSecretBrokerService.resolve()`, `dispatchResolvedSecret`, the frozen
`secretHandleRefSchema`, and the worker redaction scrubber.

Missing (terrain §2, plus one more this design surfaces):

| # | Missing | Slice |
|---|---|---|
| M1 | Nothing writes `job_secret_handles`; `job-leasing.ts:362` sends `secretHandles: []` | 1, 2 |
| M2 | `supervisor.ts:199` — `env: {}`; the sandbox gets no environment | 5 |
| M3 | The broker chain has no boot root | 4 |
| M6 | `failClosedSecretBrokers` is still the default value store | 3 |
| **M7** | **Nothing seeds the redaction canaries** — `supervisor.ts:283`, `[]` until wired | 5 |

M4 (the proxy cannot carry an LLM call) and M5 (no network-policy store) belong to the
connector/`fence_proxy` class. **Out of scope here** — see §9 limit 1.

---

## 4. The slices

Each slice is independently testable and lands fail-first. Slices 1–4 are control-plane only and
change no runtime behaviour while `secretHandles` is empty; slice 5 is the first behavioural
change on the worker.

### Slice 1 — mint the handle (control plane)

At job placement, for a job whose workload needs a model-provider key, write one
`job_secret_handles` row inside the existing placement transaction:

| Column | Value | Why |
|---|---|---|
| `handle` | **`crypto.randomUUID()`** | The wire demands a branded uuid (`ids.ts:44`) while the column is `text` (`job_secret_handles.ts:26`). A slug here mints an envelope that fails validation — terrain trap. |
| `refKind` | `"provider_key"` | Selects `resolveProviderOrCompanySecret` in `dispatchResolvedSecret`. |
| `refId` | `resolveProviderKeyTarget(providerId).secretName` (`provider:anthropic`) | The existing non-secret pointer (`provider-key.ts:79`). |
| `materialization` | `"env"` | Decided (§2). |
| `usePolicy` | `"sandbox_local_only"` | The only pairing the frozen schema permits with `env` for a non-network handle. |
| `destination` | `null` | A `sandbox_local_only` handle may never bind a network destination. |
| `boundTargetGeneration` | the placement target generation | D5 pin, defense in depth over the lease-level cutoff. |
| `status` | `"active"` | |

The **env-var name** (`ANTHROPIC_API_KEY`) comes from `resolveProviderKeyTarget(...).envVar` and
travels in the wire ref's `materialization.target`, **not** in the DB row's `materialization`
column (which stores only the kind). Consequence worth stating: **the worker never learns which
provider it is running** — it sets the name it is told. That is a property to preserve, not an
accident.

*Re-resolve on every new lease* (CM-013) falls out for free: the handle is a reference, and
resolution happens per redemption, never at mint.

### Slice 2 — populate the envelope

`buildJobEnvelope` (`job-leasing.ts:362`) reads the job's active handles and emits
`secretHandles: [{handleId, materialization: {kind:"env", target}, usePolicy:"sandbox_local_only"}]`.
The existing `jobEnvelopeV1Schema.safeParse` at `:374` is the gate — a malformed handle yields a
`null` envelope and no lease, which is the correct fail-closed direction.

### Slice 3 — wire the real value store

Replace `failClosedSecretBrokers` for the `provider_key` / `company_secret` arms with the
existing `resolveSecretValue` chokepoint. `connector_oauth` **stays fail-closed** in this ticket —
that arm belongs to the `fence_proxy` class and wiring it here would widen the blast radius past
the acceptance.

### Slice 4 — the redemption route

`POST /api/worker-control/execution-secrets/resolve`, mounted beside the existing ten in
`worker-control.ts`, authenticated by the **same** device proof + worker session as every other
worker route (E4-D03). Body: the complete active fence (`workerId, jobId, attempt, leaseId,
fenceToken`) + `handleId`. It calls `createSecretBrokerService.resolve()` verbatim.

**This route is the boot root that closes M3** for the `sandbox_local_only` class.

Two refusals are load-bearing and both are mutation-tested:

- **A non-`env` / non-`sandbox_local_only` outcome is refused on this route.** A `fence_proxy`
  handle must never yield its value over a channel that hands it to a worker. This is the guard
  that keeps the two credential classes apart at the transport, not merely at mint.
- **A `device_handoff` outcome is refused.** `device_local` returns a descriptor, never a value;
  the route must not silently treat a missing value as an empty one.

Denials keep the broker's coarse, non-disclosing vocabulary (`stale_fence`, `attempt_terminal`,
`target_revoked`, `malformed`) — no new disclosure surface.

### Slice 5 — worker redemption, env synthesis, canary seeding

`createSpecFor` becomes async and, for each `secretHandles[]` entry, redeems and builds
`env[target] = value`. Three guards:

1. **A target-name allowlist.** `envTargetSchema` (`policy.ts:109`) is *any* uppercase POSIX name
   — it would accept `PATH` or `LD_PRELOAD`. The worker admits only the provider-auth names, and
   an unknown target **fails the run** rather than being dropped silently (a dropped credential
   surfaces as an opaque CLI auth error much later).
2. **Every redeemed value is seeded as a redaction canary** before the sandbox is created —
   closing M7. This is ordered *before* create so no lifecycle event can precede the canary.
3. **A redemption failure fails the attempt.** It never proceeds with a partial env — a CLI
   started without its key burns a provider round-trip and reports a misleading error.

### Slice 6 — deferral #3, the tautological owner check

See §7.

---

## 5. Tests — fail-first, per the process

| Area | Test |
|---|---|
| Mint | uuid not slug; correct `refId`/`target` from `resolveProviderKeyTarget`; `destination` null; generation pinned |
| Envelope | handles appear; a malformed handle yields `null` envelope and **no lease** (fail-closed direction asserted, not just parse failure) |
| Route authz | wrong tenant / wrong job / stale fence / terminal attempt / revoked target — each denied with the exact frozen reason and **no disclosure difference** between "foreign handle exists" and "does not exist" |
| **Class separation** | a `fence_proxy` handle presented to the resolve route is refused **even though the broker would resolve it** — the guard is at the route, so the test must prove the broker succeeded and the route still refused |
| **device_local** | a `device_handoff` outcome is refused, not coerced to an empty value |
| Worker | env contains exactly the declared targets; an unknown target fails the run; a redemption failure fails the attempt with no sandbox created |
| **Redaction** | a redeemed value appearing in an emitted event is scrubbed — and the canary is seeded **before** `provider.create`, asserted by call ordering |
| Wire | no `packages/worker-protocol/` edit; `check:frozen-worker-protocol-v1` + boundary checks green |
| Integration | full lease → redeem → create round trip on embedded Postgres (Linux CI; `AOA_RUN_WIN_INTEGRATION=1` locally) |
| Mutation | every guard in slices 4, 5, 6 |

**Anti-vacuity, stated up front** — this programme's recurring defect is a check that cannot
fail. Two specific traps here:

- The class-separation test must present a handle the broker **really would** resolve. Asserting
  refusal of a handle that fails anyway proves nothing.
- The redaction test must assert the value **was** in the pre-scrub event. A test where the value
  never appears passes whether or not the scrubber runs.

---

## 6. Security posture — what this does and does not change

**Unchanged from what already ships.** PR #320's live `cloud_auth` path already resolves the
Company key on the host and materializes it into the tenant E2B VM. This ticket reproduces that
exposure on the new substrate. It is a cutover, and a cutover minimizes behavioural delta.

**Improved.** The value no longer sits in a host process for the run's duration; it is resolved
per-attempt behind a fence, bound to `(org, job, attempt, lease, fence, target generation)`, and
audited as columns on every resolve.

**New surface.** The worker holds the plaintext transiently. Mitigations: values are seeded as
redaction canaries before any event can be emitted; nothing persists them; a new lease re-resolves;
and — structurally — a Company key can never route to a customer-owned machine, because
`owner_desktop` targets resolve `credentialKind: "personal_subscription"`, not `company_api_key`
(`job-leasing.ts:182-196`). §7 stops that from resting on a tautology.

---

## 7. Deferral #3 — the owner check is tautological, and this ticket is where it bites

Inherited deferral #3: *"`credentialOwnerId` and `requiredOwnerPrincipalId` both read from the
routed target's profile. Safety currently rests on the structural exclusion of `owner_desktop`
routing, not on that check."* Its own ledger row says **"re-derive before enriching credential
binding (interacts with #1)"** — that is this ticket.

The design's §6 argument leans on exactly that structural exclusion. Leaning on it without fixing
it would repeat the programme's signature failure: an acceptance clause that is vacuously true.

**Fix:** at mint, assert from a **second, independent** authority — the job row, not the target
profile — that a `provider_key` handle is never minted for a placement whose owner is
`owner_desktop`, and fail closed if the two authorities disagree. Mutation-tested, with a test
that makes the two sources **actually disagree** rather than asserting agreement between a value
and a copy of itself (the MIG-005/006/007 comparator lesson).

---

## 8. Out of scope — named, with owners

- **The `fence_proxy` / connector-OAuth path** (M4, M5): the streaming reverse proxy and the
  network-policy store. Not needed for `sandbox_local_only`.
- **Warm-resume re-resolution and rotation/revocation propagation** (CM-013 names both). Handle
  revocation is *representable* today (`status`/`revokedAt` are read by
  `authorizeSecretResolve`), so a revoked handle already fails its next redemption; what is not
  built is proactive propagation to a running sandbox.
- **`gemini_local` / `opencode_local` / `cursor` / `grok_local` / `pi_local`** — CLI-001's v1
  scope is `claude_local` + `codex_local` only.

## 9. Limits this design does not remove

1. **Egress from the sandbox is not network-policed on this path.** With the key in the sandbox,
   the CLI reaches the provider directly and the DAT-005 proxy is not on the path. DAT-005's
   acceptance clause *"bypassing the proxy is denied"* is therefore **unmet for the distributed
   path**, exactly as it is unmet for #320's live path today. Whatever network confinement exists
   is the E2B sandbox's own. Stated, not papered over; it belongs to the `fence_proxy` class.
2. **The worker holds the plaintext transiently.** §6. Not removable while the worker is the
   party that creates the sandbox.
3. **No live traffic proves this.** Same shortfall as gate clause 2 — the evidence will be
   integration-level until a deployment drives a real Commander turn.

## 10. Rollback

Mint nothing. With slice 1 disabled the job has no handles, slice 2 emits `secretHandles: []`, and
slices 4–5 are unreachable — byte-identical to today's behaviour. The rollback unit is the mint,
which is why it is slice 1 and not slice 5.
