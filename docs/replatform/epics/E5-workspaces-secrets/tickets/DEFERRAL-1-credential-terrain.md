# Inherited deferral #1 — "a worker receives NO provider credential" · terrain

**Status: TERRAIN ONLY. No design, no code.** Deferral #1
([HANDOFF-wave-3-4.md](../../../HANDOFF-wave-3-4.md) §6) is the hard blocker for MIG-005 /
MIG-006 / MIG-007 going **ACTIVE** — the actual Wave-4 sink cutovers. Wave 3's shadow pass did
not need it; a real Commander turn, crew dispatch or extraction does.

Line references are to `docs/replatform-program` at `323eeee3c`.

---

## 1. The deferral's framing is out of date, and in the useful direction

It reads: *"A worker receives NO provider credential … the seam transfers ownership, but a task
cannot yet authenticate a CLI inside the sandbox."* True at the seam, but it implies the broker
is missing. **It is not. Most of this is built.**

| Layer | State |
|---|---|
| **Wire contract** (FROZEN) | **COMPLETE.** `secretHandleRefSchema` = `{handleId, materialization, usePolicy}`, `.strict()`, with recursive wire-safety that *"rejects any connector OAuth access/refresh token or broker token bundle nested anywhere"* (`policy.ts:157-187`). `materialization` is a discriminated union `proxy \| env{target} \| file{target}`, each strict, so **"the wire has no field for a raw secret value."** Cross-field fail-closed rules bind `proxy⇄fence_proxy` and keep `sandbox_local_only` off the network mechanism. **No protocol change is needed, and the package is FROZEN anyway.** |
| **Authorization** (DAT-004, SHIPPED) | **BUILT and hardened.** `resolveExecutionSecret` is a guarded mutator: `guardActiveFence` FIRST, handle loaded by `(org, job, handle)`, dispatching owner re-derived from the LOCKED `jobs` row, `company_memberships` re-checked in-tx, then `authorizeSecretResolve`, audit-as-columns — *"returns the AUTHORIZED non-secret binding, **never a value**."* Registered in `GUARDED_JOB_MUTATORS` + `GOVERNED_FENCE_SURFACE`. **It has a production caller** (`secret-broker.ts:234`). Its own review fixed two HIGH findings, including a `ref_kind`→policy binding gap that would have handed a real OAuth token to a sandbox env. |
| **Materialization** (DAT-005, SHIPPED) | **BUILT for the PROXY path.** `createFenceAwareEgressProxy` does policy-load (fail-closed) → per-request fence reauth → destination binding → classify → materialize the value into request **HEADERS** at delivery through an **IP-pinned** socket. The value only ever exists server-side. |

So the hard part — the security model, the authorization gate, the fence reauthorization, the
redaction — is done, and done carefully.

## 2. What is actually missing — three things, precisely

**2.1 Nothing populates the envelope.** `job-leasing.ts:362` is still `secretHandles: []`, a
literal. So a worker is never told a handle exists, regardless of what the broker could do.

**2.2 The worker side is empty.** `grep secretHandle` across `packages/worker-daemon/src`
returns **zero** non-test hits. Nothing would resolve a handle if one arrived.

**2.3 The proxy's outbound channel is inert.** DAT-005's own result: *"the live outbound channel
is the inert E4-D12 seam (`failClosedEgressDispatcher`)."*

And the one credential-adjacent thing the deferral names is an explicit placeholder, not a
partial build: `resolveCanaryCredentialBinding` returns a **frozen all-null constant** and says
so — *"Deliberately ignores its inputs … the constant IS the contract, never a fallback that
masks a failed lookup"* (`canary-credential-binding.ts:66-75`). That honesty is worth noting: it
is the opposite of the failure class this programme keeps finding.

## 3. Ownership — settled, and it is NOT in the Wave-4 plan

**DAT-004 owns this**, by its outcome sentence (`program-design.md:648`):

> *"Extend the existing secret and MCP OAuth broker paths with **opaque execution handles
> resolved only for an active compatible lease and per-request fence authorization**…"*

That is deferral #1 verbatim. DAT-005 owns materialization and redaction; DAT-007 owns the tool
surface; DEP-006/CLI-001 own the *provider-management* credential, explicitly not this one.

**Both DAT-004 and DAT-005 have shipped.** So the remaining work in §2 is not "start DAT-004" —
it is the **envelope-population and worker-resolution seam between them**, which neither result
doc claims.

> ★ **A programme-sequencing gap follows, and it is the same shape as the per-sink rollout axis
> finding.** The Wave-4 plan (§5) lists MIG-002, MIG-005, MIG-006, MIG-007, MIG-001 — and
> sequences the three sink cutovers as the wave's core. Every one of them is blocked by §2, and
> **no ticket in that list owns §2.** The plan schedules work whose blocker it does not schedule.

## 4. The question a design must answer first

> **For a CLI running inside a sandbox, which materialization is intended — `env`/`file`, or
> pointing the CLI at the fence proxy?**

The two are very different systems and the frozen vocabulary supports both:

- **`env`/`file` + `sandbox_local_only`** puts the real key inside the sandbox. It reproduces
  today's legacy behaviour (`buildSandboxEnvAllowlist` stages `ANTHROPIC_API_KEY`), needs the
  worker to resolve a handle to a value, and means the plaintext exists in the tenant sandbox.
- **`proxy` + `fence_proxy`** keeps the value server-side forever — DAT-005 already materializes
  it into headers at an IP-pinned socket — but requires the CLI's API base URL to be redirected
  at the proxy, and the outbound dispatcher is still inert.

The frozen invariants clearly *prefer* the second (`sandbox_local_only` is structurally barred
from authorizing a network destination), and DAT-004's review already fixed a HIGH where an
OAuth handle could be coerced into the sandbox env. **UNVERIFIED and decisive: whether the
supported CLIs can be pointed at a proxy base URL for every provider in the v1 adapter matrix.**
That is the first thing to establish; everything else follows from it.

## 5. Traps

- **Do not read deferral #1 as "the broker is missing".** §1 — it is built, shipped, and
  hardened. Re-building it would duplicate a security-critical authority.
- **Do not add a value field to the wire.** `packages/worker-protocol` is FROZEN, and its
  strictness here is deliberate: *"the wire has no field for a raw secret value."*
- **Do not assume `env` materialization is the answer** because it matches today's legacy path.
  §4 — the frozen invariants lean the other way, and DAT-004's review already caught a coercion
  in that direction.
- **Do not schedule the sink cutovers before §2 has an owner.** §3.
