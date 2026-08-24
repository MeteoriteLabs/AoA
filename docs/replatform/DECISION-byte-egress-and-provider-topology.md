# DECISION — byte egress, and the provider topology it is coupled to

**Answers:** [`DECISION-REQUEST-byte-egress.md`](./epics/E8-browser-automation/DECISION-REQUEST-byte-egress.md) (Lane B, BRW-003)
and the provider-topology fork in [`WAVE-4-RESEQUENCE.md`](./WAVE-4-RESEQUENCE.md) §3.7 (Lane A).
**Status:** gate CLOSED — the verification this turned on is answered. **Crosses:** E4 (port), E5
(artifact pipeline), E8 (needs the bytes). **Budgeted in:** none of them, still.

---

## 0. The two escalations are ONE decision

Lane B asked "how does a byte leave a sandbox?" and costed three options. Lane A asked "how does a
real provider reach the daemon at all?". **The byte-egress document mentions `adapter-manager`,
out-of-process and the credential ban exactly zero times** — not Lane B's error, since that
constraint lives in a file E8 does not own. But it means Option A was costed against a provider
topology that may not hold.

Decided together, in dependency order, below.

## 1. DECISION

**Option D — the provider uploads directly to object storage under a worker-minted, short-lived,
prefix-scoped presigned grant; the port carries a grant INBOUND and a reference OUTBOUND, never
bytes.**

Concretely: **worker mints → hands the opaque grant into the provider → provider reads the
in-sandbox file and PUTs it → worker commits.**

**Option B is rejected** (founder decision): desktop browser evidence must not become a second
project, and Lane B's own reasoning is decisive — bypassing the cleanup-authority guarantee leaves
it *stated and no longer true*.

**Option A is not chosen**, but is the fallback if §4's residuals prove unworkable.

## 2. Why D is not a compromise — it is the declared architecture

`docs/architecture/distributed-execution-authority.md:11` (echoed at
`E0-foundation/implementation-plan.md:378`):

> Snapshots, logs, traces, downloads, checkpoints, artifacts | S3-compatible object storage |
> **Transfer through short-lived prefix-scoped grants**

Moving bytes through the provider port would be the **deviation**. The option set omitted the
design the programme had already committed to.

Against Lane B's four walls, all of which stay standing:

| Wall | Under Option D |
|---|---|
| (a) the port has no file operation | it needs none — it carries a grant + a reference |
| (b) the command channel excludes bytes | **honoured**, not amended |
| (c) `denyControlPlane` is a frozen literal | irrelevant — object storage is not the control plane, and the uploader is the provider, not the guest |
| (d) the E2B seam is not surfaced | it stays unsurfaced; `readFile` is used *inside* the provider implementation |

Both §3 constraints of the request resolve for free: the **cleanup-authority no-customer-bytes proof
is untouched** (no bytes traverse `inspect`), and **bounded memory stops being a port problem**.

## ★ 3. The verification this turned on — ANSWERED, twice

**Can a grant be redeemed by a party other than the worker that requested it?** **Yes.**

- The issued grant carries **no principal, no `workerId`, no `leaseId`, no fence token** — verified
  by reading the frozen schema (`packages/worker-protocol/src/artifacts.ts:411-428`). The fence
  tuple exists only on the *request* (`:365-393`) and is consumed at mint.
- Redemption needs no additional auth: `server/src/storage/s3-provider.ts:142` returns
  `headers: {}`.
- **Live proof:** `tests/d1/lib/e6f-harness.mjs:1503-1521` redeems a presigned PUT **from a
  different container than the one that minted it**, sending only two checksum headers and no
  credential.

**What is NOT possible:** the provider minting its own grant. Both mint paths authenticate a worker
device identity and hard-check `body.workerId !== auth.workerId`
(`artifact-transfer-grant.ts:61`). That is *correct* and the design keeps it: authority stays with
the worker; the provider receives a capability, never a principal.

## ★ 4. Four residuals the design MUST answer — three of which correct Lane A's own framing

**4.1 — The port DOES change. "Only a reference" was wrong.** For the provider to upload, a grant
must travel **inbound**, and `ProviderOpContext` is `{deadlineMs, idempotencyKey}`
(`provider.ts:139-142`) with no field for it. The change is **additive and byte-free** (grant in,
reference out) and lands in `packages/worker-daemon`'s port — **not** in the frozen
`packages/worker-protocol`, so it is not an E4-D02 STOP. But "no port change" would have been a
false claim.

**4.2 — There is no process boundary today.** Lane A described the provider as running
"out-of-process behind `adapter-manager`". In this tree the provider is an **in-process injected
object** (`supervisor.ts:88`), and `provider.ts:16-21` says the port is transport-agnostic
precisely so a networked driver can bind it **later**, that driver being "explicitly out of CORE".
`adapter-manager` appears **only** in `docker-compose.staging.yml` and
`staging-manifest-invariants.mjs` — declared and enforced-against, with zero implementation in
`packages/` or `server/src`. Both facts hold: the manifest *forbids the credential on worker
surfaces*, and the code has *no boundary yet*. Design against what exists; if a boundary is
introduced, the grant crosses it **as a bearer secret**.

**4.3 ★ A PRESIGNED PUT OUTLIVES THE FENCE THAT AUTHORISED IT.** The fence is checked **only at
mint** (`artifact-transfer-grant.ts:83-90` — `lockActiveFence`), and the signed URL then stands for
up to 300s carrying no fence material. If the lease is lost or the attempt superseded mid-flight,
**the PUT still succeeds** — S3 knows nothing about fences — landing bytes in the *ordinary*
`organizations/<org>/jobs/<job>/attempts/<n>/` prefix, after which commit refuses `stale_fence`.
DAT-006 quarantine does **not** cover this: it writes to a distinct `quarantine/` root
(`artifacts.ts:81-83`). No sweeper for uncommitted ordinary-prefix objects was found.

This window exists today. Handing the grant to a longer-lived process **widens** it, so the design
owns it: shortest viable TTL, and either a sweeper or an explicit accepted-orphan policy.

**4.4 — This is the FIRST production consumer, not an extension of a working pipeline.**
`artifactTransferGrant(...)` (`transport/client.ts:168`) has **zero callers** outside its own
declaration and one client test; `result-commit.ts:25-26` records the live grant→PUT→commit
round-trip as a documented CLI-003 non-goal (DAT-002 slice 7). The only real presigned PUT ever
performed is the D1 harness. **A complete, tested server half says nothing about the caller half
existing** — the failure shape this programme keeps re-learning.

## ★ 4b. REVISION 1 — this IS an E4-D02 STOP. §4.1 said it was not, and that was wrong.

Found while writing DAT-009 slice 1's design, by reading the contract package rather than
reasoning about it.

§4.1 concluded "not an E4-D02 STOP" from the fact that `ProviderOpContext` lives in
`packages/worker-daemon`. That is true and it is not the binding constraint. **The provider
OPERATION VOCABULARY is frozen:**

- `PROVIDER_OPERATIONS`, `CORE_PROVIDER_OPERATIONS` and
  `OPTIONAL_PROVIDER_OPERATIONS = ["checkpoint","restore","health"]` are all defined in
  `packages/worker-protocol/src/capabilities.ts:125-153` — the FROZEN package.
- The contract package states it plainly: it is defined "OVER the frozen E1 `PROVIDER_OPERATIONS`
  vocabulary; **it invents no operation**" (`sandbox-provider-contract/src/port.ts:4-9`).
- Advertisement is doubly pinned: `supportedOperations` is
  `z.array(providerOperationSchema).min(CORE.length).max(PROVIDER_OPERATIONS.length)`
  (`capabilities.ts:178`) — an unknown value fails the enum, and the array length ceiling is
  fixed at the current vocabulary size.

**So a provider capability that can be ADVERTISED cannot be added without changing the frozen
protocol.**

### The fork — for the Protocol/Schema Custodian, not for this lane

**(i) Add `digest` + `export` to `OPTIONAL_PROVIDER_OPERATIONS`.** An E4-D02 STOP: custodian
sign-off plus D0-T04 evidence. Gives real negotiation — a target profile advertises support, and
placement can route a browser job only to a target that can return its evidence.

**(ii) Add methods to worker-daemon's `SandboxProvider` only**, declining via the existing
`UnsupportedProviderOperation`. No frozen change. But the capability is **unadvertisable**, so
placement cannot route on it: a browser job lands on a non-exporting target, does all its work,
and fails at the end with no evidence.

**Recommendation: (i).** `OPTIONAL_PROVIDER_OPERATIONS` exists for exactly this shape —
checkpoint/restore/health are the same thing: real capabilities that some providers have and
others do not. And the `.max(PROVIDER_OPERATIONS.length)` ceiling shows the schema was written
expecting that list to be authoritative. Option (ii) buys speed by making a capability invisible
to the component whose job is to match work to capability, which is the same class of mistake as
`buildDesktopHello` emitting a worker that can never be matched.

**Rejected without further consideration:** carrying the export as an opaque `params` payload on
an existing operation such as `execute`. It would hide a byte-moving capability inside a black-box
map and make the port's "no bytes" property stated-but-false — the failure mode this whole decision
exists to avoid.

### Consequence for sequencing

DAT-009 slice 1 (contract capability + fake provider + conformance) **cannot be built as specified
until this fork is resolved**, because the operation it would conform is not expressible. Slices 2
(fence-window policy) and 3 (the worker-side consumer) are unaffected in their server-side halves
and remain available.

## 5. Deployment prerequisite

`presignPut`/`presignGet` are **optional** on the storage port (`server/src/storage/types.ts:62-67`)
and both grant services throw when absent. On `local_disk` deployments there is **no egress path at
all**. That is a deployment prerequisite to state in the runbook, not a design flaw — but the
current fallback is "throw", and browser evidence would simply not work there.

## 6. Where the obligation lives

A capability — *given an upload grant and an in-sandbox path, export the file and return a
reference* — belongs in `packages/sandbox-provider-contract`, implemented per provider, **not** as a
byte-moving method on `SandboxProvider`. That is what keeps Lane B's "E2B only" objection from
applying: a desktop provider implements the same capability against its own storage.

## 7. What each lane does now

- **Lane B:** BRW-003 is unblocked to design against this record. Bytes are the provider's problem;
  BRW-003 owns metadata, ordering, retention/redaction, and the reference→artifact commit.
- **Lane A:** owns the port's additive grant-in/reference-out change (4.1), the fence-window policy
  (4.3), and the first production grant consumer (4.4).
