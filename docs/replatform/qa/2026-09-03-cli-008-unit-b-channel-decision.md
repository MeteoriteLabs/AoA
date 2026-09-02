# CLI-008 Unit B — the inbound channel: DECISION

> **Status: DECIDED, 2026-09-03.** Evidence: a 40-agent sweep, five lenses, every candidate attacked
> refute-by-default. **Both load-bearing claims in `CLI-008-design.md` §3 are false**, and §3 is
> corrected by this document.

**Decision: `stageFiles`, a method on the NON-FROZEN `SandboxProvider` port, paired with a local
`fileStagingMode` field — the exact shape DAT-009 already used to grow that port. The frozen wire
vocabulary is not touched.**

---

## 1. §3's first claim is false: the thing that must not grow is not the thing that would grow

§3 says *"The FROZEN `SandboxProvider` port has no file-staging operation… The port must not grow"*
and cites `worker-protocol/src/capabilities.ts:125-153`.

**That file does not define the port.** It defines `PROVIDER_OPERATIONS` — a wire/registry
**vocabulary**. The `SandboxProvider` port is `packages/worker-daemon/src/supervisor/provider.ts:339`,
in a package that is **not frozen**.

★ **And the port has already grown past eleven.** It declares **thirteen** methods plus a mode field:
the eight core ops, `checkpoint`/`restore`/`health`, and then `digestArtifact`, `exportArtifact` and
`readonly artifactExportMode` (`provider.ts:346-387`). *"The port must not grow"* is false at HEAD.

That growth was deliberate, reviewed and shipped — `d5885053f`, DAT-009 slice 1 — on exactly these
grounds, in its own commit message: *"all in packages/worker-daemon, which is NOT frozen.
`git diff packages/worker-protocol/src` is EMPTY… there is no frozen change, no custodian STOP."*

**The two-layer rule is stated in the port's own header.** `advertisedOperations` is typed
`ReadonlySet<ProviderOperation>`, so a non-frozen capability **cannot** appear there — and does not
need to, because support is declared by a separate **local** mode field (`provider.ts:341, :362-365,
:387`). That is not a workaround; it is the designed seam, and `artifactExportMode` is it working.

---

## 2. §3's second claim is false too: the argv bound is per-element, not per-job

§3 says *"argv is bounded… a task whose description exceeds ~7.4 KB cannot run distributed at all,"*
and concludes the channel *"must not be argv-shaped."* The premise is roughly right and **the
conclusion does not follow.**

Measured at HEAD:

- The cliff is **8,192 CHARACTERS**, not ~7.4 KB, and it is a **refusal, not a truncation** —
  `prompt_too_large` (`task-run-batch-workload.ts:80, :237-241`). `FROZEN_MAX_ARG_CHARS = 8192`
  mirrors the frozen schema `args: z.array(z.string().max(8192)).max(256)`.
- The ~7.4 KB is the *description budget after framing*: minimal framing accepts **7,736** chars and
  refuses 7,737; realistic framing plus one wake-comment section accepts **7,437**.
- ★ **The protocol bound is 8 KiB PER ELEMENT and ~64 KiB PER JOB.** A chunked shape
  (`sh -c '<script>' _ c1..c10`) carries **65,306 prompt characters across 11 args** at exactly the
  65,536-byte submission bound — **8.0× today's usable capacity** — and the `shellJoin`'d string is
  then 65,464 bytes, still **half** of Linux `MAX_ARG_STRLEN` (131,072).

**So the 8 KiB ceiling is a property of `buildArgsFor`'s one-positional shape, not of the protocol.**
Argv chunking is a legitimate 8× headroom available today. It is *not* the channel — it cannot carry
a repository — but §3's reasoning for excluding it was wrong and is withdrawn.

---

## 3. The decision, and why this shape

**`stageFiles(sandboxId, files)` on the non-frozen port, plus a local `fileStagingMode`.**

Three independent lenses converged on it from different starting points. It is the only candidate
that is *both* viable and free of frozen-surface change:

- **The transport already implements it.** `E2bStagedFile`, `writeFiles`, `readFile` and a directory
  enumerator are declared at `sandbox-e2b-provider/src/transport.ts:128-155` and implemented in
  **both** `mock-transport.ts:191` and `real-transport.ts:187` — added for CLI-002/D1 and with **no
  production caller on the distributed path**. The capability exists; what is missing is a port
  method asking for it, and a caller.
- **The precedent is exact.** `exportArtifact` + `artifactExportMode` is the same shape, shipped, with
  the frozen package untouched.
- **The programme has already tried the alternative and withdrawn it.** The byte-egress escalation's
  revision 1 declared an E4-D02 STOP citing `OPTIONAL_PROVIDER_OPERATIONS`; revision 2 withdrew it and
  the capability shipped as non-frozen port methods instead
  (`HANDOFF-lane-b-browser-service.md:294-299`, `DECISION-byte-egress-and-provider-topology.md:12-30`).
  **That is the programme's only data point on this question, and it says: do not grow the vocabulary;
  grow the port.**

### Rejected: growing the frozen vocabulary with a 12th operation

Measured, so the cost is on the record rather than asserted: adding `stage_files` to
`OPTIONAL_PROVIDER_OPERATIONS` reds **exactly 1 of 289** tests in `worker-protocol`; adding it to
`CORE_PROVIDER_OPERATIONS` reds **27**, because every constraint-profile fixture and digest changes.

★ **The cheap number is the misleading one.** The real cost is downstream: the conformance suite
iterates `OPTIONAL_PROVIDER_OPERATIONS` exhaustively and the fake driver **defaults its advertised
optional set to all of them** (`sandbox-provider-contract/src/contract.ts:146`,
`sandbox-fake-provider/src/fake-driver.ts:187-191`), so a fourth optional op is auto-advertised by a
driver that cannot serve it. One green test is not the price.

### Also rejected

- **`env` as a content channel.** Measured: env values can **never** be authored on the wire — the
  recursive key scan rejects `workload.env` and `extensions[].value.env` alike. Worse, every redeemed
  value joins the run's **redaction canary list**, so a prompt delivered through env would be redacted
  out of the very logs meant to show it. Secret-safe, and actively wrong for content.
- **Inline payload in `extensions[]`**, and **raising the argv ceiling** — both rejected across lenses.

---

## 4. Two hopes this sweep killed, both by measurement

**Unit F does NOT fall out of this decision.** `readFile` has the same orphaned shape as `writeFiles`,
which made "one seam, both directions" look free. It is not: `buildWorkspaceManifest` imports
`node:fs` **at module scope** and `assertCaptureRoot` hits disk before anything injectable runs; its
input accepts only `sha256` + `runGit`. Measured — running it with `root="/sbx/workspace"` and a
transport injected raises `WorkspaceSnapshotError: capture root is not readable (ENOENT)`. Making the
return path work needs that function refactored to accept an injected filesystem. **That is Unit F
work and it is not free.**

**The frozen envelope's `file` secret-materialization slot is not merely unused — it is actively
refused.** Measured: `admitSandboxLocalResolution` on `{kind:"file"}` returns
`{outcome:"denied", reason:"malformed"}`, while the same handle with `materialization:"env"` resolves.
"Unskip it" is not a small change.

---

## 5. What this unblocks, and what it does not

Units **C** (MCP config), **D** (instructions bundle) and **E** (workspace) all become "write the
files, then exec" once `stageFiles` exists. **F is untouched** by this decision.

★ **Nothing here makes an agent capable.** `capabilityProven` stays false on every run until F ships,
and this decision does not change that.

## 6. Follow-ups filed

- **The 8,192-character prompt cliff** deserves its own finding: it is a live refusal today, the code
  constant is 8192 rather than the doc's ~7.4 KB, and chunking gives 8× without any new channel.
- `CLI-008-design.md` §3 is corrected by this document; the ticket should cite it rather than restate
  the withdrawn bounds.
