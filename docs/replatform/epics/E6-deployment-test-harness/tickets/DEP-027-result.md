# DEP-027 — D1 clause-5 nonce attribution and case-scoped withheld-plant control — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `M1a` critical path (E5 exit-gate clause 5) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-26`
**Start SHA:** `d337fe3745ad650952aa45e3bda1093f7e920ab8` (`origin/docs/replatform-program`)
**PR:** base `docs/replatform-program`

> `Status` is `gate_review` and may be set to `complete` only by a distinct reviewer.

## Result

The D1 redaction case now runs two case-local arms in one invocation. The withheld arm has no
Company secret and no `job_secret_handles` row; it emits an inert control canary beside a per-arm nonce. The graded
arm uses a different nonce and the existing freshly generated inert canary. Both event and worker-log
evidence are scoped to the exact nonce before grading, and both attempts must reach `succeeded`.

The withheld arm also emits its own fresh inert control canary verbatim. That literal is not a
credential and is not registered with the redactor; the retained evidence must prove its exact
presence on both declared streams. This preserves clause 5's frozen unseeded-control polarity: the
planted canary is scrubbed while the credential-free twin demonstrably leaks its inert value.

The retained row now includes per-stream withheld-arm evidence. The standalone fault-matrix grader
requires every declared stream to have been observed and to be marker-free, so a scalar positive
control cannot conceal missing or contaminated stream evidence. The D1 declaration is consequently
`{"scope":"in_run"}` and its superseded DEP-026 exemption text remains preserved as history.

This closes E6-F033 and E6-F034 at source. Their original finding text remains unchanged; only their
status and owner were updated, and their ownership-manifest entries were removed in the same change.

## RED / GREEN evidence

The pure evidence judge was introduced test-first. On the pre-fix tree its six controls were all RED
because the module/export did not exist. The controls cover stale evidence from another nonce,
missing withheld evidence on either declared stream, a failed withheld terminal, and a scrubber
marker on either events or logs.

After implementation:

- D1 evidence judge: **6 / 6 pass**.
- Campaign fault-matrix suite: **43 / 43 pass**, including artifact-only missing-stream,
  failed-setup, and per-stream marker mutations.
- Fake provider suite: **110 / 110 pass** across 11 files, including nonce validation and planted /
  truly unseeded probe lines.
- Focused D1 render/parse and campaign coverage: **48 / 48 pass**.

Each required mutation independently reds the grader, and restoring the production behavior returns
the focused suites to green.

## Review corrections

Codex review found two valid retained-evidence gaps. First, the D1 live assertion checked the foreign
Company stream after writing the row, so that row could remain pass-shaped when the canary crossed a
Company boundary. The foreign-stream result is now a required row field, is folded into
`redactedOnAllStreams`, and is independently required by the standalone grader. A mutation with
`crossTenantCanaryAbsent: false` reds artifact-only grading.

Second, the shipped-boot compatibility row initially inferred withheld-stream observation from total
lifecycle byte counts. Its withheld command now emits a tagged nonce-bearing inert control line, and
each stream is considered observed only when that exact tagged nonce is present. Ordinary lifecycle
output, the former untagged line, and another arm's nonce all fail the pure control.

A subsequent independent review found that the D1 `record` helper's fixed destructuring still omitted
`crossTenantCanaryAbsent`, despite the pure judge producing it. The live recorder now delegates to the
same exported serializer exercised by the regression, which serializes a foreign-stream leak and then
proves the standalone grader refuses that serialized row. The same review enforced the frozen
unseeded-control requirement above with per-stream exact-literal mutations.

## Repository verification

- `pnpm -r typecheck` — PASS.
- `pnpm test:run` — PASS: **2,444 files passed, 23,498 tests passed**; 221 files / 1,825 tests skipped
  by their existing environment gates.
- `pnpm build` — PASS, using the repository's network-free authoritative build.
- Campaign declaration, finding ownership, citation integrity, and ticket graph guards — PASS.

## Remaining campaign requirement

No keyed or paid run was dispatched. Before M1a candidate promotion, the merge-train must still run
the free D1 campaign on the reviewed PR/current SHA and retain its evidence. Keyed d2m acceptance is
a separate planning-session gate and is outside this ticket.
