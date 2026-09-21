# E7 Coding/CLI on E2B — decisions

Epic-local decisions. Product-wide decisions are promoted to
`docs/architecture/decisions.md` and linked here.

**Created 2026-09-21 as a shell (M1 Step 0, S0-3).** The M1 execution plan
(`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2, F2) has the planning session record each M1
decision it takes, with its reason, in the E-epic `decisions.md`; this epic had none. No decision is
recorded here yet. ★ *Superseded 2026-09-21 by the first entry, `E7-D09` below; the sentence above is
kept as written when the shell was created.*

**Expected entries, not recorded:** the `CLI-011` output-mechanism ruling (**F7**, still open), and
the `CLI-013` event-contiguity decision. The shared decisions `E7-D01`…`E7-D07` remain where they are,
in the implementation plan's §0. Until an entry lands, nothing in this file binds anything.

★ `E7-D08` is **reserved**, not recorded: the implementation plan's `CLI-012` task assigns that id to
the `kind` decision (`implementation-plan.md`, `### CLI-012`), so the first entry here takes `E7-D09`.

---

## E7-D09 — `E2bTransport.listDir` is FILES ONLY, recursive, absolute and bounded; `CLI-010` is widened to fix the seam

**Date (UTC):** 2026-09-21
**Status:** `locked` — **decided under founder delegation F2** (`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2,
F2: the founder delegates every M1 decision to the planning session, which records each with its reason).
QA independence still holds: this decision's ticket is approved by a distinct reviewer, not by the
session that decided it.
**Owner role:** planning session (decision owner, under F2)
**Affected tickets:** `CLI-010` (widened), `CLI-012` (consumes the seam; owns the live proof)

### Context

`CLI-010`'s task section (E7 `implementation-plan.md`, `### CLI-010`, Outcome 1) and the
`E2bTransport.listDir` interface comment (`packages/sandbox-e2b-provider/src/transport.ts`) both said
the E2B `listDir` returns **absolute file paths, not directories**. Measured at source by the `CLI-010`
build agent, that was true of the mock only:

- `RealE2bTransport.listDir` (`packages/sandbox-e2b-provider/src/real-transport.ts`) called
  `sandbox.files.list(path)` with no options and kept only `e.path ?? e.name`, **discarding each
  entry's `type`**.
- The installed `e2b@2.30.5` `Filesystem.list` (`dist/index.js`, class `Filesystem2`, method `list`)
  defaults `depth` to `1` and returns files **and** directories as `EntryInfo` with a
  `type` of `"file"`/`"dir"` (`mapEntryInfo`, `mapFileType`).
- So the real binding returned the root's immediate children, directories mixed in, and never a nested
  file. `MockE2bTransport.listDir` returned files only, recursively — every existing `listDir` test ran
  against a mock or an in-memory fake, so the divergence was never exercised.

The build agent stopped and reported it rather than pin the mock's behaviour.

### Decision

**Option 1: widen `CLI-010` to fix the seam.** The contract is: `E2bTransport.listDir` returns
**files only, recursively, as absolute paths strictly under the given root**, sorted. It is
**bounded** — `E2B_LIST_DIR_MAX_ENTRIES` and `E2B_LIST_DIR_MAX_DEPTH`, named constants in
`transport.ts` — and a breach throws the named `E2bListDirBoundExceededError`; an entry that cannot be
classified or does not sit under the root throws `E2bListDirMalformedEntryError`. **It never
returns a silently truncated list.** The real binding requests typed entries through the SDK's `depth`
option; the mock and the real binding share one enforcer (`list-dir-contract.ts`,
`filesOnlyFromListing`).

Reasons, as given by the planning session:

1. `CLI-010`'s purpose is to prove this exact seam, and `CLI-012` builds on it.
2. The real `listDir` discards each entry's `type`, so it can never tell a directory from a file,
   whatever the SDK's defaults are.
3. `snapshot/capture-sandbox.ts` is the **only** production caller of `listDir`, and this ticket fences
   it to the local lane. So changing the real-transport contract has no other production consumer.

### Alternatives considered

- **Option 2 — shrink `CLI-010`** to the fence plus a characterisation test of the real behaviour, and
  move typed/recursive enumeration to `CLI-012`. Rejected: it would leave the ticket whose job is to
  prove the seam proving a seam that does not exist, and hand `CLI-012` a known-wrong transport.
- **Pin the mock's behaviour as the contract without touching the real binding.** Rejected: it is
  exactly the silent mis-enumeration (a directory treated as a file, nested files lost) the ticket
  exists to prevent.
- **Truncate at a bound instead of throwing.** Rejected: a silently shortened list is the output-loss
  class this programme is fixing.

### Consequences

- The live-sandbox behaviour is **still unproven**: what a real envd returns for `depth > 1`, and for
  entry kinds the SDK itself skips before they reach the binding (`Filesystem.list` drops any entry
  whose wire type maps to neither `file` nor `dir`), is proven only by a keyed run. That is `CLI-012`'s
  real-run acceptance, and nothing here claims it.
- `server/src/services/sandbox-coding-staging.ts` declares `listDir` on `FileStagingTransport` but has no
  production call site; its only exercise is test code over `MockE2bTransport`, whose recursive
  files-only behaviour is unchanged except that the listed root itself is no longer returned.

---

## Amendment to E7-D06 — `WRK-018`'s stdout/usage stream is instrumentation, not an output-capture path

**Date (UTC):** 2026-09-21
**Status:** `locked` — **decided under founder delegation F2** (`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2,
F2: the founder delegates every M1 decision to the planning session, which records each with its reason).
QA independence still holds: a distinct reviewer approves this, not the session that decided it.
**Owner role:** planning session (decision owner, under F2)
**Amends:** `E7-D06`, which stays where it is (E7 `implementation-plan.md` §0). No new decision id is
minted; this is a dated amendment to an existing one.
**Affected tickets:** `WRK-018` (E4), `CLI-011` (the F7 output-mechanism review)

### Context

`E7-D06` reads, in the implementation plan's §0: *"Grants inbound, references outbound, never
bytes."* The provider reads the file inside its sandbox and PUTs it directly to object storage
under a worker-minted grant (Option D of `DECISION-byte-egress-and-provider-topology.md`). The
plan's runtime rule restates it: *"The control plane carries grants and references. No payload
crosses the dependency-pinned daemon."*

`WRK-018` (E4 `implementation-plan.md`, `### WRK-018`) adds an optional stdout/usage stream channel
on the provider port. It is carried through the E2B provider (`onStdout`) and through
provider-wire/adapter-manager, with *"every chunk redacted by the per-run canaries before it leaves
the worker"*. Read literally, that is stdout bytes crossing the daemon, which the runtime rule's
"no payload" wording does not allow for. `CLI-011-review.md` §3.8 and §13 item 6 record the gap. They
also warn that unless it is closed, option 4's "just persist the stream" reads as licensed by
`WRK-018`, and it is not (review §7.1).

### Decision

1. **`WRK-018`'s stdout/usage stream is instrumentation.** It exists to derive usage (`UsagePayloadV1`
   from the `stream-json` result line) and logs. `WRK-018` requires every chunk to be redacted by the
   per-run canaries before it leaves the worker, fail-closed (its Outcome and acceptance 2; the
   canaries come from `synthesiseRunSecrets` and are held by `createRunCanaryCoordinator`). It is
   **not** an output-capture path, and a run's deliverable is never taken from it. `WRK-018` is not
   yet built; this amendment binds it as specified.
2. **`E7-D06`'s intent stands unchanged.** The daemon never reads, hashes or relays artifact
   **bytes**. Artifact bytes leave the sandbox only by the provider's direct PUT under a
   worker-minted grant. The control plane carries grants and references for artifacts.
3. **Read the runtime rule "No payload crosses the dependency-pinned daemon" as "no artifact
   payload"**. Redacted stdout instrumentation under `WRK-018` is the one named, bounded exception.

### Reasons

- `WRK-018`'s own non-goals already exclude it from output capture: *"shipping transcripts as
  artifacts (the `CLI-011` review prices the channel as an **input**, not this ticket's output)"*
  and *"carrying raw output over the wire unredacted"*.
- Recording the narrowing now stops an output mechanism from being justified by `WRK-018` without
  going through F7. If a transcript is ever adopted as an output (review §9.3, option 4, as a
  supplement only), that is an F7 ruling and it needs its own amendment here.

### Consequences

- Nothing in `WRK-018`'s scope changes, and no code changes.
- Any `CLI-011` option that persists the stdout stream as an artifact must say so explicitly, and it
  cannot cite `WRK-018` or this amendment as its licence.
