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
