# adapter-manager (Tier 0) — scope: the networked provider host

**Status:** scope · **Date:** 2026-08-28 · **Worktree:** `C:\e3` · **Branch:** `docs/replatform-program`
**Purpose:** scope `adapter-manager` — the out-of-process networked host of the real `E2bSandboxProvider`,
the Tier-0 code the E7-1 cloud campaign is blocked on ([[c0-staging-deploy-scope]] v2). Grounded in a
full terrain recon (2026-08-28). Read-only; nothing here builds.

---

## 0. TL;DR

- **adapter-manager is a mini-epic, not a ticket.** It is a new **server** (hosts `E2bSandboxProvider`,
  sole holder of `E2B_API_KEY`) + a new **worker-side networked `SandboxProvider` driver** (DEP-011's
  remit) + a **net-new wire schema** (11 provider ops, a streaming `execute`, a bearer-secret crossing) +
  **mutual-auth transport** + **conformance** + **deploy**. adapter-manager itself has **no owning
  ticket**; DEP-011 owns only the worker-side wire and is a deliberately-deferred stub.
- **The seam is clean and the port needs no change.** `SandboxProvider` (`provider.ts`) is
  transport-agnostic by construction; `EffectAuthority`/`CleanupAuthority`/supervisor are provider-agnostic.
  The frozen `PROVIDER_OPERATIONS` (11) must NOT grow — the wire serves them, it does not extend them.
- **★ The one decision the human owns: where the per-run Company model key is redeemed** (§3.1). It is the
  security crux and it changes the trust model. Everything else is engineering the scope can sequence.
- **Recommended first slice:** the wire + the worker-side driver + adapter-manager's skeleton proven
  against the **fake provider** — no real E2B, no credentials, no streaming — so the transport and per-op
  round-trip are de-risked before the hard parts (credentials, streaming, real E2B) land.

---

## 1. What it is (synthesis, grounded)

In the cloud model the containerized worker runs untrusted tenant code and **must never hold the
provider-control credential** (`checkProviderControlBoundary`: `E2B_API_KEY` only on adapter-manager, the
only service on `provider-ctl-net`). So the real provider must run out-of-process. adapter-manager binds
the **authoritative per-op `SandboxProvider` port** across a network hop on `control-net`: the worker's
`deps.provider` — the same seam the **desktop lane** fills in-process via
`resolveSandboxProvider` (`worker-keystore/src/bin/sandbox-provider.ts`, which constructs
`new E2bSandboxProvider({ transport: createRealE2bTransport(), templateId })` and reads `E2B_API_KEY`
itself) — instead becomes a **networked driver** that RPCs each op to adapter-manager. adapter-manager
receives the op, dispatches to its in-process `E2bSandboxProvider` over `RealE2bTransport` → the `e2b` SDK,
and returns the port's typed result. The worker's `EffectAuthority`/`CleanupAuthority` gating, supervisor
lifecycle, secret redemption, and event outbox are **untouched** (they wrap the port, which is unchanged).
**One line: adapter-manager is the desktop in-process provider construction, moved across a process
boundary so the credential + the E2B egress live on one isolated surface.**

## 2. Components (decomposition)

| # | Component | Where | Exists? |
|---|-----------|-------|---------|
| C-wire | The provider wire schema — 11 ops (`create/execute/cancel/kill/destroy/list/inspect/reconcile_cleanup` + `checkpoint/restore/health`) + the 2 artifact methods + the 4 capability props; per-op request/response, error vocab (`UnsupportedProviderOperation`/`SandboxNotFoundError`/`SandboxEgressDeniedError`), `ProviderOpContext{deadlineMs,idempotencyKey}` | new (non-frozen; NOT in `worker-protocol`) | ✗ |
| C-srv | adapter-manager server — HTTP/RPC listener on `control-net`, hosts `E2bSandboxProvider` over `RealE2bTransport`, holds `E2B_API_KEY`, `/healthz`, mutual-auth + peer-allowlist | new service | ✗ (zero impl) |
| C-drv | The worker-side networked `SandboxProvider` driver — presents the authoritative per-op port, RPCs to adapter-manager; the container `worker-daemon` bin injects it as `deps.provider` | `packages/worker-daemon` (DEP-011) | ✗ (stub) |
| C-stream | Streaming `execute` — today stdout/stderr ride in-process `E2bStreamHandlers` callbacks below the port; over the wire `execute` becomes a long-lived streaming RPC | new | ✗ |
| C-cred | The per-run Company model-key crossing (§3.1 — the decision) | new | ✗ |
| C-conf | Conformance — the networked provider must pass `runSandboxProviderContract` (wrap the per-op driver in `perOpToInvokeDriver`) + `runSandboxIsolationConformance` (DEP-008 hostile) | `sandbox-provider-contract` (exists) | reuse |
| C-deploy | Dockerfile + image build/sign/**admit** + the staging worker's `AOA_WORKER_PROVIDER_URL` (undeclared today) | `docker/`, `docker/images/`, manifest | ✗ |

## 3. The load-bearing decisions the scope surfaces

### 3.1 ★ THE DECISION (human-owned): where is the per-run Company model key redeemed?

Two credentials split the wrong way. `E2B_API_KEY` (provider-CONTROL) stays on adapter-manager — clean.
But the **per-run Company model key** (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) is redeemed **by the worker
today** (`secret-redemption.ts` `synthesiseRunSecrets` → `createRedeemer` → a device-proof-signed request
bound to the run fence; allowlist `PROVIDER_AUTH_ENV_TARGETS`) and folded into `CreateSandboxSpec.env`,
which the provider forwards to the sandbox. With the provider out-of-process, that env is a **bearer
secret that must cross worker→adapter-manager.** Decision #104 says the redeemed value must never be
serialized into protocol/logs — so this crossing is the crux.

- **(i) Send the redeemed env over the wire.** Worker redeems as today, then sends the bearer secret to
  adapter-manager over a **mutually-authenticated, control-net-internal** hop. Smaller change (redemption
  stays put), but the redeemed Company key now transits a wire — a new disclosure surface. Mitigations:
  mTLS, control-net is `internal:true`, per-run redaction, shortest-lived materialization.
- **(ii) Relocate redemption into adapter-manager.** The worker passes its **fence + device-proof
  context**; adapter-manager redeems the Company key itself and injects it straight into the sandbox env,
  so the key never sits on the worker→server payload. More consistent with "the untrusted worker holds no
  secrets" (the boundary's whole thesis — arguably the untrusted worker should not redeem the Company's
  model key at all), but it **relocates the redemption trust model**: the fence/device-proof authority must
  move to adapter-manager, and the resolve route's worker-identity binding changes.

**Lean: (ii)** is more faithful to the provider-control thesis (minimize secrets on the untrusted worker
and the wire), but it is the bigger change and reshapes the secret-broker trust model — so it needs the
design→review pass and a human sign-off, not a unilateral pick here. **This decision gates C-cred and
influences C-wire.**

### 3.2 Which op results cross the wire, and redacted how?

`InspectResult` deliberately carries `command`/`env`/`secrets`/`objectGrants`/`logs` so the cleanup
authority's redaction is a real projection ("`cleanup` NEVER returns this object — only
`RedactedResourceProjection`"). Serializing the full `InspectResult` over the wire **re-introduces exactly
the disclosure the in-process redaction prevents.** The wire must decide, per op, what stays
adapter-manager-local vs crosses as a redacted projection — conformance's `PROVIDER_PROJECTION_KEYS`
(`{providerId,resourceId,state,checkpoint}`) is the ceiling for management-plane rows.

### 3.3 The streaming transport (C-stream)

`execute` returns a single `ExecuteResult`; stdout/stderr stream via in-process `onStdout/onStderr` below
the port. Over the network `execute` becomes a long-lived streaming RPC (SSE / gRPC-stream / websocket) and
the driver reconstitutes the chunk callbacks. The D1 `/invoke` single-round-trip does **not** model this —
so the transport choice is load-bearing (it must carry both unary ops and one streaming op).

### 3.4 The wire must preserve in-process invariants

create-idempotency replay (`ProviderOpContext.idempotencyKey` — a lost/duplicated `create`/`destroy` must
not double-provision or strand a sandbox), the driver-owned zero-deadline verdict, `list` pagination
determinism, and the exception vocabulary mapping across the wire **without becoming existence oracles**.

## 4. Risks

1. **The credential crossing (3.1)** — the security crux; a wrong choice leaks the Company key or over-trusts the worker.
2. **Greenfield on both ends** — no worker-side networked client exists; `AOA_WORKER_PROVIDER_URL` is consumed by nothing; adapter-manager is zero-impl; the wire schema does not exist. This is a build-everything effort.
3. **Redacted-projection leakage over the wire (3.2)** — the in-process redaction guarantee must be re-expressed at the network boundary or it silently regresses.
4. **Streaming faithfulness (3.3)** — a naive request/response transport drops or reorders execution output.
5. **Conformance + isolation (DEP-008 hostile suite)** — the networked provider must still pass the full contract, including the hostile isolation reference; the network hop adds new failure modes (partition, duplicate delivery) the suite may not cover yet.

## 5. Ticket / epic structure (recommendation)

adapter-manager + its wire + the worker driver are **one seam, two ends** — they must be co-designed (you
cannot build one without the other's contract). Recommendation:
- **A new epic or a REL/DEP mini-epic "the networked provider seam"** with: `adapter-manager` (server —
  **needs a new ticket**, currently none), the shared **wire schema**, **DEP-011** (the worker-side driver
  — the existing stub, now buildable because its peer is being designed), C-cred, C-stream, C-conf,
  C-deploy. Whose epic: the manifest/DEP-006 lineage is E6, but a net-new service + credential trust model
  is closer to E7 (coding-e2b, which owns the E2B provider) or a fresh epic. **Decide at scoping.**
- adapter-manager's server ticket needs a numeric id (→ a `#### ID` program-design node + `Depends on:`
  edges, or `check-ticket-graph-coverage` reds `policy`) — unlike the recent graph-inert guard slugs, this
  is real product work that belongs in the graph.

## 6. Sequencing — the recommended first slice

Build inside-out, de-risking the wire before the hard parts:
1. **Slice 1 (the wire + round-trip, no secrets/streaming/real-E2B):** define C-wire for the **unary**
   ops (`create/cancel/kill/destroy/list/inspect/reconcile_cleanup`); build C-srv skeleton hosting the
   **fake provider** (`createFakeSandboxProvider`) and C-drv (the worker-side per-op driver) against it;
   prove the per-op round-trip + idempotency + error-vocab + redacted `inspect` over the wire. Reuse the D1
   fake-provider's **container/health/net-seg/peer-allowlist scaffolding** as the transport reference
   (§7). No credentials, no streaming, no E2B key. This is the cheap, high-value de-risk.
2. **Slice 2:** streaming `execute` (C-stream) — the one op the D1 pattern can't model.
3. **Slice 3:** host the **real** `E2bSandboxProvider` + `RealE2bTransport` in C-srv (the E2B key lands on
   adapter-manager); conformance (C-conf) + the DEP-008 isolation suite.
4. **Slice 4:** the credential crossing (C-cred) per the §3.1 decision.
5. **Slice 5:** C-deploy (Dockerfile + build/sign/admit + the staging worker `AOA_WORKER_PROVIDER_URL`).
Then Tier 1 (C0 deploy) → the E7-1 campaign → evidence-verifier A.

## 7. Open questions for adversarial review

1. **The credential decision (3.1)** — is (ii) actually feasible without breaking the device-proof/fence
   binding the resolve route enforces? Trace `resolveExecutionSecret`'s worker-identity check and whether
   adapter-manager could present it.
2. **Is the fake-provider transport truly reusable as Slice-1 scaffolding**, or does presenting the per-op
   port (vs the fake's `invoke(op,args)` shape) mean the wire shares nothing with D1 but the container
   hardening? (Recon says the latter — confirm.)
3. **Does hosting `E2bSandboxProvider` out-of-process break any assumption it makes about being in the
   worker's process** (the idempotency ledger is an in-memory `#idempotency` map — does it need to survive
   an adapter-manager restart, i.e. become durable)?
4. **Streaming transport choice** — is there an existing streaming RPC pattern in the repo (the event
   outbox? SSE from Commander?) to reuse, or is it net-new?
5. **Scale/isolation** — one adapter-manager (replicas 1-3) brokers all workers' provider ops; is that a
   bottleneck or a blast-radius concern for a multi-tenant cloud, and does the per-run credential model
   keep tenants isolated across a shared broker?

## 8. Review round

*(pending — adversarial pass on the credential decision, the wire/redaction boundary, and the first-slice de-risk)*
