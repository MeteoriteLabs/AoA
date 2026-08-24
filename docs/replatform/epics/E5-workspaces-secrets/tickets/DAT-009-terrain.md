# DAT-009 — provider-side artifact export · TERRAIN

**Status: TERRAIN ONLY. No design, no code.**
**Implements:** [`DECISION-byte-egress-and-provider-topology.md`](../../../DECISION-byte-egress-and-provider-topology.md) (Option D).
**Unblocks:** BRW-003 (Lane B), and therefore BRW-005/006.
**Crosses:** E4 (owns the `SandboxProvider` port), E5 (owns the artifact pipeline), E8 (needs the bytes).

Line references are to `docs/replatform-program` at `1c47e41d0`.
⚠ Many tracked files carry raw NUL bytes — plain `grep` reports "Binary file … matches" and
**suppresses the match**. Use `grep -a` throughout.

---

## ★ 1. The finding that shapes the whole design: the digest must exist BEFORE the grant

`artifactTransferGrantRequestV1Schema` (`packages/worker-protocol/src/artifacts.ts:365-393`,
`.strict()`, **FROZEN**) requires **both**:

```
expectedSha256: sha256DigestSchema,   // NOT optional
maxBytes:       nonNegativeIntSchema, // NOT optional
```

So the **worker must know the file's digest and size before it can even ask for a grant** — and the
file is inside the sandbox, where only the provider can see it.

**Therefore the port needs TWO inbound operations, not one.** The flow is necessarily:

| # | Who | What |
|---|---|---|
| 1 | worker → provider | *digest and size the file at path P in sandbox S* |
| 2 | provider → worker | `{ sha256, bytes }` — **metadata only, never content** |
| 3 | worker → control plane | request grant carrying that digest + size (device-proof authed) |
| 4 | worker → provider | *PUT path P using this grant* |
| 5 | provider → S3 | the only hop that moves bytes |
| 6 | worker → control plane | commit the reference |

This is materially larger than "add a grant field to `ProviderOpContext`", and the earlier framing
of Option D as a one-operation change was wrong. Recording it here rather than discovering it in
design.

**TOCTOU is already handled and fails closed.** If the file changes between (1) and (4), commit
compares the store-**observed** hash against `expectedSha256`
(`artifacts.ts:623-627`) and refuses. So the two-step shape is safe; it is not a race we must
invent protection for.

## 2. What exists, and what has never run

| Piece | State |
|---|---|
| Grant mint (ordinary) | `server/src/services/artifact-transfer-grant.ts:41-190`, route `worker-control.ts:452` — **built, fenced, org-prefix-guarded** |
| Grant mint (quarantine) | `quarantine-grant.ts:92-117`, route `worker-control.ts:622` — built |
| Commit half | `server/src/services/artifact-commit.ts` — **built and sound**: heads the object, requires a store-computed `checksumSha256`, persists **observed** size/digest |
| Worker client op | `transport/client.ts:168` `artifactTransferGrant(...)` — **ZERO production callers** |
| Live grant → PUT → commit | **never performed in production.** `result-commit.ts:25-26` records it as a documented CLI-003 non-goal (DAT-002 slice 7) |
| Only real presigned PUT anywhere | the D1 harness, `tests/d1/lib/e6f-harness.mjs:1503-1521` |

**DAT-009 builds the FIRST production consumer of this pipeline.** A complete, tested server half
says nothing about the caller half existing — the failure shape this programme keeps re-learning,
and the reason this row is in the table rather than assumed.

## 3. The port today

- `SandboxProvider` is an **in-process injected object**: `supervisor.ts:88`
  `readonly provider: SandboxProvider`. There is no process boundary.
- `provider.ts:16-21` states the port is transport-agnostic precisely so "a networked worker→provider
  driver can bind it LATER", and that such a driver is "explicitly out of CORE".
- `ProviderOpContext` is `{deadlineMs, idempotencyKey}` (`provider.ts:139-142`) — no field for a
  grant, no field for a reference.
- `adapter-manager` appears **only** in `docker-compose.staging.yml` and
  `scripts/lib/staging-manifest-invariants.mjs` — declared, enforced-against, and **not
  implemented**. Design against what exists; if a boundary is introduced later, the grant crosses it
  **as a bearer secret** and must be classified as one.

## ★ 4. The fence window — a real hazard the design must own

The fence is checked **only at mint** (`artifact-transfer-grant.ts:83-90`, `lockActiveFence`), and
the issued grant carries **no fence material at all** (`artifacts.ts:411-428`). The signed URL then
stands for its TTL regardless of what happens to the lease.

**Consequence:** lose the lease mid-flight and the PUT still succeeds — S3 knows nothing about
fences — landing bytes in the *ordinary* `organizations/<org>/jobs/<job>/attempts/<n>/` prefix.
Commit then refuses `stale_fence`, leaving an **uncommitted object in the ordinary namespace**.

- DAT-006 quarantine does **not** cover this: it writes to a distinct `quarantine/` root
  (`artifacts.ts:81-83`).
- No sweeper for uncommitted ordinary-prefix objects was found.
- The window **exists today**; it is simply never exercised because nothing redeems a grant.
  Handing the grant to the provider does not create it — but it does widen it and make it live.

**Open question for design:** shortest viable TTL, plus either a sweeper or an explicitly accepted
orphan policy. Not both by default — pick one and say why.

## 5. Deployment prerequisite

`presignPut`/`presignGet` are **optional** on the storage port (`server/src/storage/types.ts:62-67`)
and both grant services **throw** when absent. On `local_disk` deployments there is no egress path
at all, so browser evidence would not work there. That belongs in an operator runbook, and there is
no runbook — the operability gap named in earlier tickets, showing up again.

## 6. Where the obligation belongs

A capability — *given a path, return its digest and size*, and *given a path and a grant, export it
and return a reference* — belongs in `packages/sandbox-provider-contract`, implemented per provider,
**not** as byte-moving methods on `SandboxProvider`. That is what stops Lane B's "E2B only"
objection from applying: a desktop provider implements the same capability against its own storage.

`E2bTransport.readFile`/`listDir` (`sandbox-e2b-provider/src/transport.ts:151-157`) already exist and
stay **unsurfaced** — used inside the implementation, never through the port.

## 7. Proposed slicing (for the design to confirm or reject)

| Slice | Scope | Why separable |
|---|---|---|
| **1** | The contract capability + fake-provider implementation + conformance suite | Pure; provable without any live sandbox |
| **2** | Fence-window policy (§4) — TTL + sweeper-or-accepted-orphan | A correctness decision that stands alone and is testable server-side |
| **3** | The first production consumer: worker digest → grant → export → commit | Where the real risk is; depends on 1 and 2 |

## 8. Traps

- **Do not add byte-moving methods to `SandboxProvider`.** The decision is explicit: a grant in, a
  reference out. Bytes go provider → S3.
- **Do not assume one provider operation.** §1 — the frozen request schema forces digest-then-upload.
- **Do not assume the frozen protocol must change.** The port lives in `packages/worker-daemon`;
  `artifact_transfer_grant` already exists in the frozen protocol. Check before invoking E4-D02.
- **Do not treat the server half's tests as evidence the path works.** §2 — zero production callers.
- **`grep` lies here.** Use `grep -a`; NUL bytes silently suppress matches.
