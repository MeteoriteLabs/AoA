# CLI-012 — Unit F link 3, the worker-side consumer: capture → export requests → the sequencer

**Status:** `built` — result at `CLI-012-result.md` (`gate_review`). ★ *Superseded: `filed` — not started.*
**Epic:** E7 · **Graph node:** `docs/replatform/program-design.md` `#### CLI-012` ·
**Plan task (the contract):** `../implementation-plan.md` `### CLI-012`
**Depends on:** `CLI-010`; **E5's `DAT-009-3c` and `DAT-009-3d` must be `complete`** at recorded
reviewed revisions. **Blocks:** `CLI-013`, and (with `CLI-017`) the real-run half of `M1b`.
**Owns:** `E7-F039` (the `lstat` TOCTOU residual) and, once this file exists, `E5-F009` (the
whole-file read before any size check).

★ **This file is a pointer, not a second specification.** The executable contract — Outcome, Files,
Interfaces, Failure behavior, RED→GREEN and Evidence — lives in **one** place, the E7 implementation
plan's `### CLI-012` task. Two specifications drift; this epic's register records what that costs.
Read the task.

## Why this file exists

Mechanical, and the same bar that `CLI-017` had to clear:

- **`check-finding-ownership`** tests `tickets.has(entry.ticket)` (`findTicketIds`, deriving ids from
  filenames under `epics/*/tickets/` with `/^([A-Z]+-\d+)/`). `E7-F039` is `owned` by `CLI-012` and
  `E5-F009` names it as its closing ticket, and **without a file on disk either declaration would
  fail `owner_ticket_missing`** — a false ownership claim the guard exists to refuse.
- **`check-ticket-graph-coverage`** reads the same filenames; a node with no file is backlog, and
  `CLI-012` is not.

★ `E5-F009`'s register entry and `findings.md` prose both said this flip happens *"in the commit that
gives `CLI-012` its first ticket file, and not before"*. This is that commit.

## In one paragraph

`CLI-012` enumerates the ruled output root (`E7-D11`: `/home/user/aoa-output`) **metadata-only, never
bytes**, turns each regular file into an `ArtifactExportRequest` with an explicit declared `kind`, and
hands the list to the sequencer through the E5 hook — so one file the sandbox produced becomes a
`committed` `job_artifacts` row under a worker-minted grant. It owns the enumeration **port** and, per
ruling F7, the **per-entry link marker and size** that port must carry.

## The three things ruling F7 added to it, none of which are in the graph node's one-liner

1. **Per-entry metadata, not paths.** `RealE2bTransport.listDir` returns `readonly string[]` —
   `filesOnlyFromListing` uses `type` only to drop directories and discards `symlinkTarget` — so a
   symlink arrives indistinguishable from a file while `files.read` follows it (P-011 probe, arm
   `S-P5`). A paths-only seam makes the `A-O2-4` refusal unimplementable.
2. **Size through the same seam, and a bounded read.** The `SD-6` bounds are enforced from listing
   metadata **before** `digestArtifact`, **and** the read itself is bounded — the listing size is a
   snapshot, and a file can grow between enumeration and digest. That is **`E5-F009`**, and it is
   discharged by the bounded read, not by the pre-digest check.
3. **The symlink race is a bounded residual, not a blocker — `E7-F039`.** See that entry and
   `E7-D11`. What this ticket owes is the **deliberate symlink-swap attempt** in its real-run
   acceptance, whose only acceptable outcomes are refusal by the check or refusal by **SD-5**'s scan.

## Preconditions that are NOT this ticket's to discharge

- **`DAT-009-3c` / `-3d` complete** (they supply `SupervisorDeps.resolveExportArtifacts` and its
  composition). This ticket passes the producer in; it does not build the composition.
- **`CLI-017-A`** — a real run produces a file under the root only once the directive ships, so this
  ticket's real-run acceptance is paired with it and neither may claim the other's evidence.
- **The template preconditions and the `A-neg` re-run** — operator acts owned by the `M1b` gate owner.
