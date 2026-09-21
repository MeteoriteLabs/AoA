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
| it reads a POSIX enrolment ticket read-only | worker-b's OWN mounts: `:391` `AOA_WORKER_ENROLLMENT_CODE_FILE: "/enrollment-code"`, `:417` `worker-b.profile.json:/profile.json:ro`, `:420` `worker-b.enrollment-ticket:/enrollment-code:ro` — ★ *Corrected 2026-09-21 in response to review attempt 1:* this row cited `:145-146`, which are the **`migrate`** service's mounts (the same lines row 3 cites), so it did not verify what it stated |
| the seeding job mounts the same two committed files | `:142-146` - one artifact read twice |
| the network invariant survives | the services' `networks:` blocks — worker-a `:365-368`, worker-b `:428-431`; neither lists `data-net` — ★ *Corrected 2026-09-21 in response to review attempt 1:* this row cited `:19`, `:25`, which are the file's header comment, not the wiring |

## 2. The lane

`WRK-017-result.md` records that the ticket found `d1-merge-train` **red for five days and three
merges** - the control-plane image could not build. At this candidate that lane is **green**
(`52626d80e`, 2026-09-20) and the DEP-013 consumer reports **"nothing owed"** for
`d1-merge-train.yml@docs/replatform-program`. ★ *Corrected 2026-09-21 in response to review attempt 1:* this read "coverage satisfied". The consumer's
"nothing owed" here is a **window-exhausted** result (no paths-matching commit in its last 40), not a
positive green verdict, and the two must not be conflated. * Recorded here because a currency
record for this ticket that ignored the lane would omit the reason it matters to `M0` criterion 1.

## 3. Deltas against the original result

**None in the static clauses.**

## 4. What was NOT verified, and this boundary is the point

★★★ The enrolment itself was not exercised. The result's strongest claim is that a first-boot enrol
failure is `proc.exit(1)` with no `restart:` policy, so it fails `up --wait` outright - which makes
the enrol **load-bearing for bring-up** rather than merely asserted by a test. Proving that needs a
Docker compose bring-up: Linux-CI-only, no Windows-local substitute. This record verifies the
**wiring that makes it load-bearing** - the mounts, the `command:` override, the absence of a
`restart:` policy - and records the live enrolment as `not re-run` **locally**. ★ *Corrected 2026-09-21 in response to review attempt 1:* this
understated the evidence. `d1-merge-train` run `35504786263` (`success`, head `52626d80e`, an ancestor
of the reviewed revision with no D1-relevant change since) executed `tests/d1/container-enrol.test.mjs`
live: worker-b persisted an identity and receipt, worker-a persisted nothing, exactly one enrolled row,
the code consumed once, a restart did not re-enrol — campaign 47/47, 0 skipped.

A static read must not present itself as a live enrolment, and this section exists so it cannot.

## Independent review

**Reviewer:** M0 attempt-2 independent reviewer subagent (Claude) — distinct from the M0 implementation session, from the attempt-1 reviewer, and from the correcting session
**Reviewed revision:** 6f9031220bd2a20a6485b83a5b2b74cf6b5782d0
**Disposition:** `approved`
**Attempt:** 2 (see Review attempt history)
**Review evidence (attempt 2):**
- Revision currency: `git diff --stat 8b629fc25 6f9031220 -- docker-compose.d1.yml tests/d1 docker/d1` is empty, so the static rows (measured at `8b629fc25`) describe the reviewed revision.
- Attempt-1 finding (row 2 cited the `migrate` job's `:145-146`) — FIXED at source: service boundaries (`grep -n '^  [a-z0-9-]*:$'`) are `migrate:` `:110`, `worker-a:` `:328`, `worker-b:` `:370`, `fake-provider:` `:434`, so `:391`, `:417`, `:420` all lie inside `worker-b`. `:391` = `AOA_WORKER_ENROLLMENT_CODE_FILE: "/enrollment-code"`; `:417` = `./docker/d1/worker-b.profile.json:/profile.json:ro`; `:420` = `./docker/d1/worker-b.enrollment-ticket:/enrollment-code:ro`. `:145-146` are confirmed to be `migrate`'s `/seed-*` mounts, now cited only by row 3.
- Attempt-1 finding (row 4 cited header comments `:19`/`:25`) — FIXED at source: `:365-368` is `networks:` + `control-net`/`worker-net`/`provider-ctl-net` inside `worker-a` (`:328-369`); `:428-431` is the same three inside `worker-b`. `grep -n data-net` hits only header comments, other services (`:55`, `:89`, `:105`, `:151`, `:249`, `:322`) and the network definition `:505` — neither worker lists it.
- Attempt-1 finding (§2 "coverage satisfied" overstated) — FIXED: `node scripts/reconcile-workflow-verdicts.mjs --dry-run` at the reviewed revision prints `d1-merge-train.yml@docs/replatform-program: no paths-matching commit in the last 40 (window exhausted) — nothing owed`, which is exactly what the corrected text says.
- Attempt-1 finding (§4 understated the live enrolment) — FIXED and the new claim holds: `gh run view 35504786263 --json` → workflow `D1 Merge Train`, `push` on `docs/replatform-program`, head `52626d80e9fc…`, created 2026-09-20T10:20Z, conclusion `success`; single job `d1-merge-train` `success`, every step success (`Build split D1 images`, `Bring up the D1 stack`, `Run the E6F campaign (live)`), failure-only steps skipped. `--log`: the campaign's `BOUNDED` list includes `tests/d1/container-enrol.test.mjs`, and the log shows ✔ `worker-b persisted a DeviceIdentityRecord + receipt…`, ✔ `worker-a (mounted_secret control) persisted NOTHING`, ✔ `…exactly ONE enrolled worker row…`, ✔ `…consumed exactly once`, ✔ `restarting worker-b does NOT enrol again…`; those test names are defined in `tests/d1/container-enrol.test.mjs` (`:94`, `:182`). Totals `tests 47 / pass 47 / fail 0 / skipped 0`.
- `52626d80e` is an ancestor of `6f9031220`; since then only `packages/worker-daemon/src/snapshot/capture-sandbox.ts` + its test changed in D1-relevant paths, and `capture-sandbox` has no importer outside its own test — "no D1-relevant change since" holds.
- Rest of record re-checked: row 1 (`:370`, `:375`) and row 3 (`:142-146`) hold; §4 wiring holds (`command:` `:409`, `restart` appears only in the `:136` comment, `file_record` `:398`). No new overstatement found.

**Review evidence (attempt 1):**
- Revision currency: the record was measured at `8b629fc25`, an ancestor of the reviewed revision; `git diff 8b629fc25 5f3b47556 -- docker-compose.d1.yml` is empty, so the static rows describe the reviewed revision.
- Row 1 (`worker-b` exists, profile id) HOLDS: `docker-compose.d1.yml:370` is `worker-b:` and `:375` is `AOA_WORKER_TARGET_PROFILE_ID: "d1-worker-b"`.
- Row 3 (seeding job mounts the same two files) HOLDS: `:142-146` is the `migrate` service's `volumes:` — `worker-b.profile.json:/seed-worker.profile.json:ro` and `worker-b.enrollment-ticket:/seed-enrolment-ticket:ro`.
- ★ Row 2 (worker-b reads the ticket read-only) — CLAIM TRUE, CITATION WRONG, blocking: `:145-146` are the `migrate` job's mounts (the same lines row 3 cites), not worker-b's. worker-b's own read-only mounts are `:417` (`worker-b.profile.json:/profile.json:ro`) and `:420` (`worker-b.enrollment-ticket:/enrollment-code:ro`), read via `AOA_WORKER_ENROLLMENT_CODE_FILE: "/enrollment-code"` at `:391`. As written, the OBSERVED value for worker-b is evidenced by another service's lines, so the row does not verify what it states. Fix: re-cite row 2 to `:391`, `:417`, `:420`.
- Row 4 (network invariant) — CLAIM TRUE, CITATION WEAK: `:19` and `:25` are the file's header COMMENT (the segmentation matrix), not wiring. The actual evidence is the `networks:` blocks — worker-a `:365-368` and worker-b `:428-431`, both `control-net`/`worker-net`/`provider-ctl-net` only, no `data-net`. Re-cite to those (and optionally note `scripts/check-d1-compose.mjs` enforces it).
- §4 wiring claims HOLD though not tabulated: `command: ["node", "dist/bin/container-host.js"]` at `:409`; `grep -n restart docker-compose.d1.yml` finds only the comment at `:136` — no `restart:` key on any service; `AOA_WORKER_KEY_STORE_MODE: "file_record"` at `:398`. Suggest adding these as table rows, since §4 says the record verifies them.
- §2 lane claim HOLDS: `gh run list --workflow d1-merge-train.yml` → run `35504786263`, push to `docs/replatform-program`, head `52626d80e` (2026-09-20T10:20Z), conclusion `success`; `--json jobs` → single job `d1-merge-train` `success`, every step success (`Build split D1 images`, `Bring up the D1 stack`, `Run the E6F campaign (live)`), failure-only steps skipped. The workflow has no `continue-on-error` (the E6-F023 trap does not apply). The two prior runs (`d382dea13`, `47d8f98ed`) were `failure`, so "green at this candidate" is specifically the 09-20 run. `52626d80e` is an ancestor of the reviewed revision; between them only `packages/worker-daemon/src/snapshot/capture-sandbox.ts` (+ its test, zero other importers) changed in the D1-relevant paths.
- §2 DEP-013 claim HOLDS WITH A WORDING NOTE: `node scripts/reconcile-workflow-verdicts.mjs --dry-run` (GITHUB_REPOSITORY/GH_TOKEN set, nothing published) prints `d1-merge-train.yml@docs/replatform-program: no paths-matching commit in the last 40 (window exhausted) — nothing owed`; issue #358 (reconciled 2026-09-21T04:42Z) lists no d1-merge-train finding. "Nothing owed" is window-exhaustion, not an affirmative green verdict — "reports coverage satisfied" slightly overstates it; the green run above is the actual evidence.
- §4 "enrolment not re-run" — ACCEPTED as honestly unrun BY THIS RECORD, but UNDERSTATED: the record's own cited run `35504786263` executed `tests/d1/container-enrol.test.mjs` live (campaign scope `foundation`) — `worker-b persisted a DeviceIdentityRecord + receipt`, `worker-a (mounted_secret control) persisted NOTHING`, `exactly ONE enrolled worker row`, `code consumed exactly once`, `restarting worker-b does NOT enrol again` all ✔; totals `tests 47 / pass 47 / fail 0 / skipped 0`; and `Bring up the D1 stack` (`up -d --wait`) succeeded, which is the load-bearing bring-up claim. Recommended (non-blocking): cite this as live evidence at `52626d80e` rather than leaving the live enrolment "not re-run".

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It is left at
`gate_review` because its author may not approve it.

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M0 independent reviewer subagent (Claude) | `5f3b47556d0df152db0d53d76c304861f30ffd37` | `changes_requested` | Rows 1, 3 and all §4 wiring (`command:` `:409`, no `restart:` key, `file_record` `:398`) hold; compose unchanged since `8b629fc25`. BLOCKING: row 2 cites `:145-146` (the `migrate` job's mounts) as worker-b's read-only ticket mount — worker-b's are `:391`/`:417`/`:420`. Row 4 cites header comments `:19`/`:25` rather than the `networks:` blocks `:365-368`/`:428-431` (claim true). d1-merge-train run `35504786263` @ `52626d80e` verified `success` at job+step level (no continue-on-error); DEP-013 dry-run says "window exhausted — nothing owed", not an affirmative green. The same run executed `container-enrol.test.mjs` live (47/47 pass), so the live enrolment is evidenced and the record understates it. |
| 2 | M0 attempt-2 independent reviewer subagent (Claude) | `6f9031220bd2a20a6485b83a5b2b74cf6b5782d0` | `approved` | All four attempt-1 findings fixed at source: row 2 now cites worker-b's own `:391`/`:417`/`:420` (service span `worker-b` `:370-432`); row 4 cites `networks:` `:365-368` (worker-a) / `:428-431` (worker-b), no `data-net`; §2 wording matches the DEP-013 dry-run ("window exhausted — nothing owed"); run `35504786263` re-read: `success` at job+step level, `container-enrol.test.mjs` in the BOUNDED set, its enrolment assertions ✔, 47/47, 0 skipped. Compose unchanged `8b629fc25`→reviewed revision. Nothing new false. |
<!-- Later reviewers append attempt 2+ below without rewriting attempt 1. -->
