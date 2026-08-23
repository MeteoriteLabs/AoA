# DAT-008 — wire the provider-credential path · terrain

**Status: TERRAIN ONLY. No design, no code.** DAT-008 is the new ticket that owns inherited
deferral #1 (`HANDOFF-wave-3-4.md` §6 row 1), assigned in the Wave-4 session per
[`HANDOFF-wave-4.md`](../../../HANDOFF-wave-4.md) §3.1. It is the hard blocker for MIG-005 /
MIG-006 / MIG-007 going **ACTIVE**.

Line references are to `docs/replatform-program` at **`02fdfb313`**.

Supersedes [`DEFERRAL-1-credential-terrain.md`](./DEFERRAL-1-credential-terrain.md) for scope.
That document's §1–§3 (the broker is built, DAT-004/005 shipped, nothing owns the seam) stand and
are not repeated. **Its §4b does not stand**, and §4b is the part the Wave-4 handoff leaned on.

---

## ★ 0. Headline — §4b reasoned from the WRONG SANDBOX PATH, and the answer changes

`DEFERRAL-1-credential-terrain.md` §4b concluded: *"the whole shape is available with no new
mechanism and no protocol change … So there is no remaining architectural question. What is left
is wiring."* Its evidence was `PROVIDER_AUTH_KEYS` allowlisting `ANTHROPIC_BASE_URL` /
`OPENAI_BASE_URL` and `ALWAYS_ALLOWED` carrying `AOA_API_URL` + the run-JWT.

**Every one of those facts is true, and none of them is about the distributed path.**
`buildSandboxEnvAllowlist` lives in `packages/adapter-utils/src/sandbox-env-allowlist.ts` and is
reached from the **host-side legacy/#320 executor**. The distributed path builds its sandbox in
`packages/worker-daemon`, which by the E4-D01 boundary may import **only**
`@armyofagents/worker-protocol` and `pino` (`packages/worker-daemon/package.json:27-30`,
enforced by `scripts/lib/worker-daemon-boundary.mjs`). It contains **zero** references to
adapter-utils. The allowlist is not on this path and cannot be.

What the distributed path actually does:

```
packages/worker-daemon/src/supervisor/supervisor.ts:199
  return { resourceLabels: labels, command, args, env: {}, workloadType: … };
```

**`env: {}` — a literal.** The sandbox receives *no environment at all*: no base URL, no run-JWT,
no `AOA_API_URL`. `spec.env` is passed straight through to the provider
(`packages/sandbox-e2b-provider/src/e2b-provider.ts:193` `envVars: spec.env`), so this is the end
of the line, not an intermediate stub.

**And `env: {}` is not an oversight — it is the wire policy made concrete.** `"env"` is a
FORBIDDEN wire key (`packages/worker-protocol/src/wire-safety.ts:19`, alongside `token`,
`apikey`, `credential`, `authorization`), and `jobEnvelopeV1Schema` applies
`addForbiddenWireKeyIssues(job, ctx)` to the **whole envelope including `workload`**
(`packages/worker-protocol/src/job.ts:362-367`). `batchWorkloadV1Schema` is
`{command, args, stdinArtifactId, maxRuntimeSeconds}`, `.strict()`, with no env field
(`job.ts:289-296`).

> **The frozen wire is structurally incapable of delivering an environment or a credential into
> the sandbox. The only credential-shaped thing it can carry is `secretHandles[]` — opaque
> references.** Both materializations are therefore blocked at the *same* point, and it is not
> the point §4b identified:
>
> * `env`/`file` needs the **worker** to redeem a handle to a value — no wire verb exists
>   (`WORKER_PROTOCOL_OPERATIONS` is a closed list of ten, `transport.ts:757-768`).
> * `proxy` needs the **sandbox** to reach a proxy — but nothing can tell the sandbox a base URL
>   or hand it a bearer, because `env: {}`.

So the ticket is not "wiring". There is a real design decision, and §4b closed it prematurely.

---

## ★ 1. Attacking that conclusion improved it — the path IS available, via a mechanism nobody named

First conclusion: "the sandbox cannot be reached at all." Attacked, and it is too strong.

The worker does not need the *wire* to carry the env. At `createSpecFor` it already holds
`jobId`, `attempt`, `leaseId`, `fenceToken`, `organizationId`, `companyId`, the envelope's
`secretHandles[]`, and its own control-plane base URL from local config. `CreateSandboxSpec.env`
is a plain `Readonly<Record<string,string>>` (`supervisor/provider.ts:149`), and the
`SandboxProvider` port being FROZEN constrains its *shape*, not its *values* — filling the record
is within the port.

**The missing mechanism is a worker-side env synthesizer plus a sandbox-facing control-plane
route.** Neither exists. Neither is named in `DEFERRAL-1-credential-terrain.md`, in DAT-004's or
DAT-005's result docs, or in `program-design.md`.

This is the shape the design has to choose and specify. It is not blocked; it is unowned and
unspecified.

---

## 2. Six things missing, not three — enumerated, each with its own evidence

`DEFERRAL-1-credential-terrain.md` §2 named three (envelope, worker side, dispatcher). Revision 2
raised it to five. The real count at `02fdfb313` is six, and two of them are load-bearing
architecture rather than wiring.

| # | Missing | Evidence |
|---|---|---|
| **M1** | **Nothing populates the envelope.** | `server/src/services/job-leasing.ts:362` — `secretHandles: []`, a literal. |
| **M2** | **The worker gives the sandbox no environment.** | `supervisor.ts:199` — `env: {}`, a literal, passed through at `e2b-provider.ts:193`. The wire cannot supply one (§0). **Not named by any prior doc.** |
| **M3** | **The whole broker chain is unreachable from boot.** | `createFenceAwareEgressProxy` (`egress-proxy.ts:146`) has zero non-test callers; it is the broker's only constructor. (Confirms revision-2 C2 at the current tip.) |
| **M4** | **The built proxy cannot carry an LLM API call.** | `egress-proxy.ts:161-267`: the signature is `egress({auth: VerifiedWorkerOperation, request:{…fence tuple…, handleId, requestedUrl}})`; it hardcodes `method:"GET"` with no request body (`:253-256`), injects `Authorization: Bearer ${material.value}` (`:255`), and returns `{status}` only — `EgressDispatchResult` has no body (`:81-83`). The underlying executor buffers to a 1 MiB cap and does not stream (`outbound-url-guard.ts:370, 385-405`). **Not named by any prior doc.** |
| **M5** | **No network-policy store exists.** | `resolveNetworkPolicy` (`egress-proxy.ts:99`) is an injected seam with **zero production implementations**. The envelope carries only a *reference* — `{policyId:"job-default-deny", version:1, digest}` (`job-leasing.ts:364-368`) — while the proxy needs a `NetworkPolicyV1` with an `allow` array (`policy.ts:81-93`). With no allow rule for `api.anthropic.com`, every egress denies `not_allowlisted` (`egress-proxy.ts:231-234`). **Not named by any prior doc.** |
| **M6** | **The value stores are still fail-closed.** | `failClosedSecretBrokers` (`secret-broker.ts:138-145`) is the default and its own comment says "until DAT-005 wires the real chokepoints". DAT-005 did not. Plus the inert dispatcher (`egress-proxy.ts:89-91`). |

---

## ★ 3. The programme's own documents point in two different directions

This is the architectural fork §4b declared closed. Both statements are in-tree and they are not
the same system.

**Direction A — key in the sandbox, proxy polices the network.** `program-design.md:765`
(CLI-001's outcome sentence): *"coding jobs authenticate with the company's own provider API key
(CM-013) resolved on the host and **materialized in-sandbox via the U5 allowlist**, reaching the
provider API through the DAT-005 fence-aware egress proxy."*

**Direction B — key never in the sandbox, proxy injects it.** DAT-004/DAT-005 as built, and
`DEFERRAL-1-credential-terrain.md` §4b: *"The tenant's provider key never enters the sandbox at
all."*

The frozen vocabulary refuses to let one handle be both: `secretHandleRefSchema` rejects
`env`/`file` paired with `fence_proxy`, and rejects `proxy` paired with anything else
(`policy.ts:178-195`). So a design must pick, and the pick has consequences the other direction
does not carry:

- **A** reproduces today's legacy exposure (plaintext key inside a tenant VM) and needs a worker
  redemption verb the frozen list does not have. Its saving grace: it is what the CLIs already
  work with, so M4 (streaming, methods, provider auth headers) evaporates.
- **B** is strictly better on exposure and is what the shipped code implements — but it needs a
  real reverse proxy (M4), a policy store (M5), and an authentication story for a sandbox that
  currently holds no credential at all (§4).

---

## ★ 4. The sandbox has no identity — and the resolver that would give it one is a DEFERRED DECISION

Direction B needs the sandbox to authenticate to the control plane. Two facts collide:

1. `egress()` takes `auth: VerifiedWorkerOperation` — a **device proof** (workerId, targetId,
   deviceThumbprint, proofId) plus the fence tuple. A tenant sandbox has none of it, and handing
   it the worker's fence token would let tenant code impersonate the worker on every fence op
   (artifact commit, quarantine grant/finalize, control acks).
2. The only run-scoped credential in the system is the run-JWT (`agentId/companyId/runId`), and
   **DAT-007 already looked at exactly this problem and deferred it**:
   [`DAT-007-result.md`](./DAT-007-result.md) §2 item #1 and §4 residual #1 — *"a correct
   fence-binding is a **net-new `runId → job → active-lease/fence` resolver** … a
   security-critical auth surface the design under-specified → spawned design-decision task."*

The data exists (`job.sourceIntent.runId` reaches the envelope's `source` for `task_run`,
`job-leasing.ts:116-124`), so the resolver is constructible. But DAT-007's judgement — that this
is an architectural decision, not a wiring task — is the more careful of the two documents, and
it directly contradicts `DEFERRAL-1-credential-terrain.md` §4b's "no remaining architectural
question." **DAT-008 inherits DAT-007's deferred decision.**

---

## 5. What is genuinely already built — do not rebuild it

Unchanged from `DEFERRAL-1-credential-terrain.md` §1, re-verified at `02fdfb313`:

- **Wire contract** — `secretHandleRefSchema` complete, strict, with recursive wire-safety.
- **Authorization** — `resolveExecutionSecret` is fence-first, re-derives the owner from the
  LOCKED job row, re-checks membership in-tx, audits as columns, and returns a **non-secret
  binding** (`packages/db/src/repositories/tenant/job-control.ts:2686`; registered in
  `GUARDED_JOB_MUTATORS` and `GOVERNED_FENCE_SURFACE`).
- **Materialization discipline** — value into request headers at delivery, IP-pinned socket,
  server-side only.

Rebuilding any of this would duplicate a security-critical authority. The gap is around it, not
inside it.

## 6. Traps

- **Do not cite `buildSandboxEnvAllowlist` as distributed-path evidence.** §0. It is the legacy
  host executor and is structurally unreachable from the worker.
- **Do not read `env: {}` as a stub to fill from the envelope.** §0 — the wire forbids the key.
  Any sandbox env must be **synthesized worker-side**.
- **`job_secret_handles.handle` is `text`** (`packages/db/src/schema/job_secret_handles.ts:26`)
  while `secretHandleIdSchema` is a branded **uuid** (`packages/worker-protocol/src/ids.ts:44`).
  A minter that writes a slug produces an envelope that fails validation.
- **`Authorization: Bearer` is not Anthropic's scheme.** `egress-proxy.ts:255` hardcodes it;
  Anthropic's API authenticates with `x-api-key`. Any header-injection design is per-provider.
- **Do not add a value field to the wire.** `packages/worker-protocol/` is FROZEN.
- **A caller is not a caller until it traces to a boot root.** M3 exists because that rule was
  broken once already, inside the document that stated it.
