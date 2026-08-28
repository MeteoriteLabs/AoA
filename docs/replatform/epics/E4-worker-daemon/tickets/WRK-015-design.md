# WRK-015 — POSIX enrolment-code input for a Linux container worker

**Epic:** E4 · **Plan node:** `docs/replatform/program-design.md`, `#### WRK-015`
**Depends on:** WRK-014 · **Size:** (scope only) · **Status:** scoping
**Terrain of record:** [`WAVE-4-RESEQUENCE.md`](../../../WAVE-4-RESEQUENCE.md) §3.2 · [`SPIKE-worker-walking-skeleton.md`](../../../SPIKE-worker-walking-skeleton.md) F5
**Reconciliation:** [`qa/2026-08-28-worker-dispatch-chain-reconciled.md`](../../../qa/2026-08-28-worker-dispatch-chain-reconciled.md) (link 3.2 — confirmed STILL unowned at tip)

---

## Why this ticket exists

The enrolment-code input reader is Windows-only, and the fleet is Linux. Re-verified from source at tip:
`readEnrollmentInput`'s `{kind:"path"}` arm calls `assertLocalAbsolutePath`
(`packages/worker-daemon/src/enrollment/enrollment-input.ts`), which normalizes `/`→`\` and then
requires `/^[A-Za-z]:\\/`. A POSIX absolute path — `/worker/state/ticket`, `/run/secrets/enrolment` —
normalizes to `\worker\state\ticket`, fails the drive-letter test, and throws `EnrollmentInputError
("path is not an absolute local path")`. The reader is a DSK-001 (desktop/Windows) deliverable; the
`{kind:"env"}` arm is platform-neutral, but the `{kind:"path"}` arm rejects every POSIX absolute path.

The rejection is an **allowlist of one Windows shape** by deliberate design (a denylist over
`\\?\UNC\`/`\\.\`/mapped-drive syntax is a losing game). The Linux equivalent is not "loosen the
denylist" — it is "state the accepted POSIX shape positively" (a plain absolute path, no `..`, and the
same locality intent the Windows arm enforces against UNC/device namespaces). SPIKE F5: "whoever owns it
should state the accepted shape per platform." No ticket owns that today, and one deliberately
disclaimed it: `WRK-009-design.md:104` — "F5, the POSIX enrolment-path rejection. Real and verified, but
a different defect with a different fix. Its own ticket."

**This is required, not theoretical — the shipped compose files use the `{kind:"path"}` arm with a
POSIX path.** Every worker in `docker-compose.staging.yml` sets `AOA_WORKER_ENROLLMENT_CODE_FILE:
"/run/secrets/worker-enrollment-code"` (`:167,205,244,282`, all under `AOA_WORKER_KEY_STORE_MODE:
"mounted_secret"`), and `docker-compose.d1.yml` sets `"/enrollment-code"` (`:311,347`). So the instant
WRK-014 makes the enrolment block reachable on a container, `readEnrollmentInput` is called with
`{kind:"path", path:"/run/secrets/worker-enrollment-code"}` and throws at `assertLocalAbsolutePath`. The
`{kind:"env"}` arm is platform-neutral, but the deployment does NOT use it — so it is not an escape
hatch that moots this ticket.

## What it must build (design written at sprint start, against the tree as it exists then)

A platform-aware `assertLocalAbsolutePath` (or a POSIX arm) that accepts a plain local POSIX absolute
path on Linux with the SAME three security properties the file's header documents intact: (1) the
locality check runs BEFORE the read (a rejection after the round trip has already leaked the attempt);
(2) no failure echoes what was read; (3) the returned field stays `enrollmentCode` (the logger-redaction
name, `logging/logger.ts:37-49`). The POSIX analogue of the Windows ambiguity (symlink escape, `..`
traversal, a device/proc path) must be stated and refused. `readEnrollmentInput` injects `readFileText`,
so the "read NEVER HAPPENED for a rejected path" property stays provable without a filesystem.

## Precondition — when this becomes REQUIRED, not before

It sits BEHIND WRK-014: the enrolment block never executes on a container until container identity
exists (WAVE-4-RESEQUENCE §3.2: "unreachable until 3.1 — sequencing it first would produce a fix nothing
can exercise"; SPIKE F5: "sits BEHIND F1 and would have been the next wall"). Sequence it in the same
container-enablement step as WRK-014, after identity. Blocks nothing shipped today.

## Status

Scoping stub. No design steps and no result doc yet — deliberately. Filed so the graph sees the second
container-enablement link (WAVE-4-RESEQUENCE §4 tracking gap). Full design at sprint start per the
go-book rule.
