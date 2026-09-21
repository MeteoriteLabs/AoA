# WRK-017-B1 Result - the D1 worker enrolment wiring is intact, and the lane it repaired is green

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E4-worker-daemon`
**Plan task:** `E4 implementation-plan WRK-017-B1 - current enrolment evidence on the milestone candidate (M0)`
**Implementer:** `M0 unit 6 (Claude Opus 5) - re-measure only; none of the underlying work is this record's`
**Start SHA:** `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ This is an EVIDENCE-CURRENCY record, not a rebuild and not a re-approval of the original
ticket. `qa-handoff-recovery.md` section 2 forbids treating a prose `BUILT` header as canonical
ticket approval, so `M0` exit requires a result measured on **this** candidate. The original
[`WRK-017-result.md`](./WRK-017-result.md) is not edited: where a measurement disagrees with it, the
disagreement is recorded here as a **delta**, never repaired in place.

---
## 1. What was measured - statically

| Clause | OBSERVED at `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf` |
|---|---|
| `worker-b` exists in the D1 harness | `docker-compose.d1.yml:370`, with `AOA_WORKER_TARGET_PROFILE_ID: "d1-worker-b"` at `:375` |
| it reads a POSIX enrolment ticket read-only | `:145-146` - `worker-b.profile.json` and `worker-b.enrollment-ticket`, both `:ro` |
| the seeding job mounts the same two committed files | `:142-146` - one artifact read twice |
| the network invariant survives | `:19`, `:25` - `worker-a` / `worker-b` are NOT attached to `data-net` |

## 2. The lane

`WRK-017-result.md` records that the ticket found `d1-merge-train` **red for five days and three
merges** - the control-plane image could not build. At this candidate that lane is **green**
(`52626d80e`, 2026-09-20) and the DEP-013 consumer reports coverage satisfied for
`d1-merge-train.yml@docs/replatform-program` ("nothing owed"). * Recorded here because a currency
record for this ticket that ignored the lane would omit the reason it matters to `M0` criterion 1.

## 3. Deltas against the original result

**None in the static clauses.**

## 4. What was NOT verified, and this boundary is the point

★★★ The enrolment itself was not exercised. The result's strongest claim is that a first-boot enrol
failure is `proc.exit(1)` with no `restart:` policy, so it fails `up --wait` outright - which makes
the enrol **load-bearing for bring-up** rather than merely asserted by a test. Proving that needs a
Docker compose bring-up: Linux-CI-only, no Windows-local substitute. This record verifies the
**wiring that makes it load-bearing** - the mounts, the `command:` override, the absence of a
`restart:` policy - and records the live enrolment as `not re-run`.

A static read must not present itself as a live enrolment, and this section exists so it cannot.

## Independent review

**Reviewer:** `pending`
**Reviewed revision:** `pending`
**Disposition:** `pending`
**Attempt:** none recorded

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It is left at
`gate_review` because its author may not approve it.
