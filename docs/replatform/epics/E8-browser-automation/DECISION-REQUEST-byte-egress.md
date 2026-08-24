# RESOLVED — OPTION D: the PROVIDER exports to object storage, the port carries a REFERENCE

**Decided by the programme.** This document is kept as the record of how the question was framed,
including where the framing was WRONG. BRW-003 is unblocked and designs against this.

## The decision

Bytes go **provider → S3-compatible object storage** via a short-lived prefix-scoped presigned
grant. The port carries only a reference — exactly what `stdoutRef`/`stderrRef` already do. Bytes
never touch the worker daemon or the provider port.

The obligation lives in `packages/sandbox-provider-contract` as a **capability** — "given a grant
and a path, export and return a reference" — implemented per provider. A desktop provider
implements it against local storage. One path, one set of guarantees, both deployment shapes.

## ★ Why this escalation was wrong, and it is worth being precise about it

**Option B was rejected**, correctly, and on the reasoning this document itself gave: bypassing the
cleanup-authority guarantee leaves it *stated and no longer true*.

**But the option set was missing the option the programme had already committed to.** Verified
directly rather than taken on trust — `docs/architecture/distributed-execution-authority.md:11`,
echoed at `E0-foundation/implementation-plan.md:378`:

> Snapshots, logs, traces, **downloads**, checkpoints, **artifacts** | S3-compatible object storage
> | Transfer through short-lived prefix-scoped grants

That row names **downloads** and **traces** — BRW-003's exact artifact kinds. The four walls in §2
below are all real, and every one of them was derived from the worker/port side. **None of them was
ever checked against the architecture authority.** The mechanism analysis was exhaustive and the
authority went unread; this is the same failure this programme keeps recording, in a new place.

Against those four walls Option D costs nothing: (a) the port needs no file operation, it carries a
reference; (b) the command channel's byte exclusion is **honoured, not amended**; (c)
`denyControlPlane` is irrelevant — object storage is not the control plane, and the uploader is the
provider, not the guest; (d) `E2bTransport.readFile` stays unsurfaced, used INSIDE the provider
implementation. Both §3 constraints dissolve: the cleanup-authority no-customer-bytes proof is
untouched because no bytes traverse `inspect`, and bounded memory stops being a port problem.

The grant machinery is real and frozen: `artifactUploadGrantV1Schema` and
`quarantineUploadGrantV1Schema` (`packages/worker-protocol/src/artifacts.ts:411,544`), with routes
`ARTIFACT_TRANSFER_GRANT_PATH` / `ARTIFACT_COMMIT_PATH`.

## ★ CORRECTION to the costing constraint — the out-of-process boundary is NOT in code

The decision as first relayed said the real E2B provider *must* run out-of-process behind an
`adapter-manager` service, which would have made Option A mean streaming up to 5 GiB across a
network hop into a service with no Dockerfile, source, wire protocol or client.

**That boundary does not exist in code yet.** Verified:

- `adapter-manager` appears ONLY as a string constant in a compose-topology validator
  (`scripts/lib/staging-manifest-invariants.mjs:29`). There is no service directory, no Dockerfile,
  no source.
- `E2bSandboxProvider` is a plain in-process class over an **injected transport**
  (`packages/sandbox-e2b-provider/src/e2b-provider.ts:132`), and the supervisor holds
  `readonly provider: SandboxProvider` (`worker-daemon/src/supervisor/supervisor.ts:88`) — an
  in-process interface, no network hop. It has **zero production construction sites** today.
- The networked driver is explicitly out of core.

The staging-manifest ban itself is real — it forbids the provider-control credential across
`environment` / `env_file` / `secrets` / `configs` / `volumes` on every non-adapter surface
(`:448-462`) — but it constrains a **compose topology whose adapter-manager service does not
exist**. It is a forward-looking constraint, not a current runtime boundary.

**So Option A's original costing was not wrong for today's code.** Option D is chosen on its
merits — it honours the byte exclusion rather than amending it, and keeps one path for cloud and
desktop — not because Option A was disqualified by an out-of-process hop that has not been built.

## Open question owned by Lane A (not a blocker on designing)

Can a presigned grant be minted for, and reached from, the **provider** side, and does the
fence/scope survive that hop? If it fails, Option A returns, costed against out-of-process.

**One thing this lane could not verify, flagged rather than asserted:** the live
grant → PUT → commit round-trip is described at
`packages/worker-daemon/src/transport/client.ts:54` as **DAT-002 slice 7**, "a documented CLI-003
non-goal", with the route "provided for completeness so the commit path has its paired grant op on
the client." No slice-7 evidence was found in `DAT-002-result.md`. The grant *schemas* and *routes*
are real and frozen; whether the round-trip is *built* could not be confirmed here. That may widen
the gate question from "does the fence survive the hop" to "can the round-trip complete at all".

---

# DECISION REQUEST — how does a byte leave a sandbox?

**Raised by:** Lane B (E8), during BRW-003 terrain · **Raised at:** `9c61f8fad`
**Blocks:** BRW-003, and therefore BRW-005 (golden journey) and BRW-006 (evidence UI).
**Crosses:** E4 (owns the provider port), E5 (owns the artifact pipeline), E8 (needs the bytes).
**Budgeted in:** none of them.

**The ask.** Choose one of §4's options. This is escalated rather than decided in-lane because
it changes a contract two other epics depend on, and because picking an architecture for three
epics from inside one of them is the wrong call even if the pick is good.

---

## 1. The problem in one paragraph

A browser session produces its evidence as **files on a disk inside a sealed sandbox** —
screenshots, DOM snapshots, a Playwright trace, a video, and anything it downloaded. For any
of that to become an AoA artifact, the bytes must travel from inside the sandbox to the object
store. **There is no path today, and the absence is deliberate rather than an oversight.**
BRW-003's outcome ("store screenshots … trace, video, and downloads as sensitive artifacts")
cannot be built until one exists.

## 2. Why there is no path — four independent walls

**(a) The provider port has no file operation.** `SandboxProvider` — the only thing the
supervisor holds (`packages/worker-daemon/src/supervisor/supervisor.ts:88`) — has eleven
methods: create, execute, cancel, kill, destroy, list, inspect, reconcileCleanup, plus optional
checkpoint/restore/health. **Not one moves a file.**

**(b) The command channel excludes it in words.** `provider.ts:165-168`:

> `stdoutRef`/`stderrRef` are OPAQUE references — never inline customer bytes (object-byte
> capture/upload is E5). No stdout/stderr content crosses this boundary.

So BRW-002's runner, whose only output channel is NDJSON on stdout (`runner.ts:40`), is **not
merely unwired — it is excluded by contract.** This is the wall that matters most: it is a
decision, not a gap.

**(c) The guest cannot upload for itself.** `networkPolicyV1Schema` pins
`denyControlPlane: z.literal(true)` (`packages/worker-protocol/src/policy.ts:90`) — a **frozen
literal, unsettable** — restated as invariant H-06 in `test-gates.md:25`. A browser sandbox
cannot POST to the control plane by design.

**(d) The one working seam is deliberately not surfaced.**
`E2bTransport.writeFiles` / `readFile` / `listDir`
(`packages/sandbox-e2b-provider/src/transport.ts:151-157`) are real and bound to the SDK
(`real-transport.ts:192,199`). But `E2bSandboxProvider implements SandboxProvider`
(`e2b-provider.ts:132`) surfaces **none** of them, because the port is provider-agnostic by
design (`provider.ts:288`).

## 3. Two further constraints any option must satisfy

**The cleanup-authority guarantee.** After fence loss a session may be destroyed and described
but **not read** — `cleanup-authority.ts:207-208` states that inspection returns "never the
command, env, logs, secrets, workspace/customer bytes, or object grants." Any file operation
added to the port must be provably unavailable under cleanup authority, or that guarantee
becomes false. **This is the security proof that makes option A expensive.**

**"Large download" needs bounded memory.** `readFile(sandboxId, path): Promise<Uint8Array>`
is fully buffered — no range, no stream — against a 5 GiB commit ceiling
(`server/src/services/artifact-commit.ts:71`). BRW-003's own Test clause names a large-download
case, so whichever option is chosen needs a streaming or chunked shape; the existing seam as
written cannot carry it.

**What already works, so it is not in scope here.** The commit half is sound and
server-authoritative: `artifact-commit.ts` heads the uploaded object, requires a
store-computed `checksumSha256`, rejects `event_hash_mismatch` when the store cannot supply
one, and persists the **observed** size and digest rather than the declared ones. The problem
is strictly getting bytes *to* the store, not trusting them once there.

## 4. The options, costed

### Option A — extend the provider port

Add file-movement operations to `SandboxProvider` so bytes leave through the same governed
interface as every other sandbox action.

- **For the product:** browser evidence works identically on a cloud sandbox today and on a
  teammate's desktop worker later. One path, one set of guarantees.
- **Cost:** every implementer changes (`E2bSandboxProvider`, the fake provider, the contract
  package's conformance suite). The cleanup-authority no-customer-bytes proof must be
  re-established with an explicit carve-out (§3). Needs a bounded-memory shape (§3).
- **Owner:** E4 owns the port; this is not Lane B's to change unilaterally.

### Option B — use the E2B transport seam directly, bypassing the port

- **For the product:** fastest route to visible browser evidence.
- **Cost:** works for E2B only. Desktop workers could never carry browser evidence without a
  second implementation, and it abandons the provider-agnostic design the port exists for.
  The cleanup-authority guarantee is bypassed rather than amended, which is worse than
  amending it — the guarantee would remain stated and no longer be true.

### Option C — a separate egress channel that is not the port

E.g. the sandbox writes to a location the worker can reach by another agreed mechanism.

- **Cost:** a third transport concept to secure, fence and reason about. Not recommended
  without a specific reason the port cannot serve, but recorded so the option set is complete.

## 5. Recommendation

**Option A**, on the understanding that it is most of BRW-003's budget and needs E4's owner
rather than Lane B alone. Option B is the only one that ships quickly, and its cost is
permanent and structural: it makes desktop browser evidence a second project and leaves a
security guarantee stated-but-false.

## 6. What Lane B does until this is decided

BRW-003 is **not designed**. Its terrain is complete and committed
([`BRW-003-terrain.md`](./tickets/BRW-003-terrain.md)); designing an artifact pipeline whose
first dependency is undecided would produce a plan that has to be thrown away.

**Already settled and not blocked by this:** the capture-policy question
(BRW-003's "DOM snapshots where allowed") is resolved as a **storage-time decision, not a
capture-time one** — the guest always attempts capture and the control plane decides which
kinds it accepts at commit. That avoids a frozen wire change entirely; see
[`BRW-003-terrain.md`](./tickets/BRW-003-terrain.md) §2 for why the extension container could
not have carried it safely.
