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
