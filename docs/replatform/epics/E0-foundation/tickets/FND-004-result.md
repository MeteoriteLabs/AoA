# FND-004 Result — Golden Journey and Failure Corpus

**Status:** `gate_review`
**Date (UTC):** `2026-08-08`
**Epic:** `E0-foundation`
**Plan task:** `Task 4: FND-004 — Golden Journey and Failure Corpus`
**Implementer:** `FND-004 implementer subagent (Claude)`
**Start SHA:** d6db0f2493d2282ba1ceddef27aab4735cbb0049

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the section below and is the only role that may change it to `complete`.

This file is a controlled append-only review ledger until `complete`; do not delete or rewrite prior review attempts. Once `complete`, it is frozen. Ticket commands are focused acceptance evidence, not the immutable epic D0 rollup.

## Delivered scope

- Locked the distributed-execution golden-journey + failure fixture corpus as a strict, schema-validated, digest-anchored contract that E1/PRT-004 reproduce byte-for-byte.
- Authored `tests/fixtures/distributed-execution/schema-v1.json` as a strict JSON Schema **draft 2020-12** document: exact `$schema` dialect and stable `$id`, `type: "object"`, a complete `required` array, 20 reusable `$defs`. Every object schema sets `additionalProperties: false`; the one composing object schema (`Source`, whose `allOf`/`if`/`then`/`else` enforces the `task_run` run/issue discriminant) also sets `unevaluatedProperties: false`. Arrays carry numeric `minItems`/`maxItems` and `uniqueItems` where identities must be unique; strings use standard `format`/`pattern`; UTF-8 byte limits use only the standard `$comment` convention `aoa:utf8-max-bytes=<positive integer>`. Only standard 2020-12 keywords are used (no custom keywords), so E1 compiles the same bytes in Ajv 2020-12 strict mode with no dialect translation.
- Authored the nine deterministic fixtures with real, computed `eventDigest` values: `batch-success`, `batch-cancel-during-execution`, `browser-approval-download`, `browser-denied-egress`, `service-restart-checkpoint`, `service-budget-stop`, `service-provider-pause-resume`, `late-output-quarantine`, `plaintext-secret-in-argv-rejected`. Each carries Organization/Company; typed requester/executor; one strict `task_run | commander_turn | crew_run | one_shot | browser_request | service_reconcile` source (only `task_run` carries required `runId`/`issueId`); placement/target policy; immutable input/workspace base; job/attempt/lease/fence identity (per-attempt worker/lease/fence, so service restart, provider pause-resume, and late-output quarantine legitimately span replacement instances); ordered expected events with computed digests; artifacts; cost/usage bounds; timing; cancellation/product-approval/runtime-decision points; ownership-scoped deadline-bounded cleanup that cannot restore effect authority; audit actions; and forbidden effects. The three hardening fixtures encode their exact behavioral sequences (pause-resume spans replacement instances via resource-bound cleanup with no old-instance resume/overlap; late-output quarantine finalizes an orphan receipt under a control-plane/device authority that cannot update the old fenced attempt; the argv-secret rejection registers five canaries — argv/URL/header/nested-array/additive-extension — each rejected by producer-safety validation before persistence/placement/lease/provider, with no artifact/event containing the value).
- Extended `scripts/check-distributed-execution-foundation.mjs` with three interlocking layers, all dependency-free (Node stdlib + `node:crypto`): (1) a **JSON Schema meta-validator** for `schema-v1.json` (exact dialect/`$id`/`type`/`required`, a 2020-12 keyword allowlist where any unknown/custom keyword fails E0, the `$comment` syntax, required `$def` names, the closed-object rules, and resolvable `$ref`s); (2) a **dependency-free interpreter** for the JSON Schema subset the schema uses, validating each fixture (types, `format`/`pattern`, `enum`, `uniqueItems`, numeric + `aoa:utf8-max-bytes` bounds, closed objects, and the `task_run` discriminant); and (3) the **locked RFC 8785 canonical-JSON subset + SHA-256 `eventDigest`** recompute plus semantic cross-references JSON Schema cannot express (event tenant/identity consistency, digest recompute, cross-tenant consistency, canary non-leakage, terminalState ∈ FND-001 lifecycle states).
- Exported `canonicalizeJson`, `computeEventDigest`, and `parseJsonStrict` so PRT-004 imports the identical algorithm and the test corpus exercises them directly.
- Extended `scripts/check-distributed-execution-foundation.test.mjs` with 58 FND-004 cases on top of the retained FND-001/FND-002/FND-003 corpus (55 → 113): the 14 immutable-event field mutations (each breaks the digest), digest reuse, bad formats, duplicate ids, foreign/dangling references, unsafe-integer/float/lone-surrogate rejection, duplicate semantic keys, cross-tenant references, the six plan Step-1 semantic checks, cost/timing bounds, identity lease-uniqueness/fence-monotonicity, the source discriminant in both directions, canary leakage, closed-object/unknown-keyword/`$comment`/missing-`$def` schema mutations, and direct canonicalizer/digest/strict-parse unit contracts. `makeFixture` now copies the fixture corpus into the isolated root.
- Applied the E0-F004 carry-forward: added `threat`/`control`/`verification` to `THREAT_CROSSING_REQUIRED_FIELDS` and to the test's field-deletion loop, so deleting any of those rendered register fields from a JSON crossing now fails (all 30 crossings already carry them, so the corpus stays green).

**Non-goals preserved:** no FND-005-owned files touched (`package.json`, `scripts/fetch-bundled-*`, `scripts/check-bundled-snapshot-*`, `AGENTS.md`, `docs/replatform/artifact-policy.md`, `docs/replatform/templates/*`); no new dependency (`pnpm-lock.yaml` byte-unchanged); no FND-001/FND-002/FND-003 checks or mutation cases removed; ticket left at `gate_review`; `findings.md` untouched (controller updates it).

## Changed files

| File | Responsibility |
|---|---|
| `tests/fixtures/distributed-execution/schema-v1.json` | New strict JSON Schema draft 2020-12 contract for a golden-journey/failure fixture (closed objects, bounded arrays, identity patterns, `task_run` discriminant, `aoa:utf8-max-bytes` convention). |
| `tests/fixtures/distributed-execution/batch-success.json` … `plaintext-secret-in-argv-rejected.json` | The nine deterministic fixtures with real computed `eventDigest` values, encoding the six original journeys and three hardening sequences. |
| `tests/fixtures/distributed-execution/README.md` | Documents fixtures as immutable, credential-free, deterministic behavioral inputs; additive-only within `schemaVersion: 1`; breaking changes require a new versioned directory. |
| `scripts/check-distributed-execution-foundation.mjs` | Added the RFC 8785 canonicalizer + SHA-256 `eventDigest` (exported), strict duplicate-key JSON parse (exported), the JSON Schema meta-validator, the subset instance validator, and the fixture semantic validator; wired into `runCheck`. Applied the E0-F004 required-field fix. |
| `scripts/check-distributed-execution-foundation.test.mjs` | `makeFixture` copies the fixture corpus; added 58 FND-004 mutation + canonicalizer/digest/strict-parse unit cases; added `threat`/`control`/`verification` to the threat field-deletion loop (E0-F004). |
| `docs/replatform/epics/E0-foundation/tickets/FND-004-result.md` | This ticket result ledger. |

## Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| `schema-v1.json` is a strict draft-2020-12 document (dialect/`$id`/`type`/complete `required`/`$defs`, closed objects, `unevaluatedProperties:false` on composition) | Meta-validator enforces it; "unknown keyword", "non-closed object", "bad `$comment`", "missing required `$def`" mutations each fail | `pass` |
| Unknown/custom schema keyword fails E0 | `walkSchema` allowlist; "bogusKeyword" mutation fails with the exact cause | `pass` |
| Each fixture validates against the schema (types/format/pattern/enum/uniqueItems/bounds/closed objects) | Subset instance validator; extra-property, bad-eventId-pattern, discriminant mutations fail | `pass` |
| Only `task_run` carries required `runId`/`issueId` | `Source` `allOf`/`if`/`then`/`else`; "task_run missing runId" and "non-task_run carrying runId" mutations both fail | `pass` |
| Each event has exactly the 14 fields; `eventDigest` is SHA-256 over the RFC 8785 canonical bytes with `eventDigest` omitted | 50 events across 9 fixtures recompute clean; all 14 field mutations break the digest; digest-reuse fails | `pass` |
| RFC 8785 subset rejects floats, unsafe integers, lone surrogates, duplicate keys, unsupported values; keys sort by UTF-16 code units; order-independent | Direct canonicalizer/`parseJsonStrict` unit tests + fixture mutations (unsafe int / float / lone surrogate / duplicate key) all fail | `pass` |
| Referential + cross-tenant consistency (event tuples ∈ identity attempts; org/company shared; terminalState ∈ FND-001 states) | Foreign-leaseId, cross-tenant-org, duplicate-lease, non-monotonic-fence, terminalState mutations fail | `pass` |
| Cost/usage and timing bounds enforced | `observedTotalCents > maxTotalCents` and `startedAt > finishedAt` mutations fail | `pass` |
| Plaintext-secret canaries never leak; rejection precedes persistence | Canary appears exactly once (own declaration); leakage mutation fails; no event/artifact carries the value | `pass` |
| E0-F004 resolved | `threat`/`control`/`verification` now required; their field-deletion mutations fail; all 30 crossings stay green | `pass` |
| FND-001/002/003 contracts still enforced | Full retained corpus passes; no prior case removed | `pass` |
| No new dependency | `git diff -- pnpm-lock.yaml` empty | `pass` |

## Commands

| Command | Exit code | Result summary |
|---|---:|---|
| `pnpm check:distributed-foundation` (RED, before `schema-v1.json` + fixtures existed) | `1` | Printed `tests/fixtures/distributed-execution/schema-v1.json: missing` plus all nine `…/<fixture>.json: missing` lines |
| `pnpm check:distributed-foundation` (GREEN, full structured checker) | `0` | `distributed execution foundation: PASS` |
| `node --test scripts/check-distributed-execution-foundation.test.mjs` | `0` | `tests 113 / pass 113 / fail 0` (55 retained FND-001/002/003 cases + 58 new FND-004 cases) |
| `git diff -- pnpm-lock.yaml` | `0` | No output — lockfile byte-unchanged (no dependency change) |

## Deviations

None. The illustrative `DistributedGoldenJourneyV1` seed shape in the plan was extended (not narrowed) to the strict `schema-v1.json` contract per the approved amendment; the six original scenarios keep their exact terminalState/artifacts/auditActions/forbiddenEffects values and the three hardening fixtures encode their exact behavioral sequences.

## Findings

`E0-F004` — resolved in this ticket. `threat`/`control`/`verification` were rendered into the Markdown threat register and value-compared in per-ID parity but were absent from `THREAT_CROSSING_REQUIRED_FIELDS`, so a JSON field-deletion escaped detection. They are now in the required-field set (checker) and in the test's field-deletion loop; all 30 crossings already carry them, so the corpus stays green. `findings.md` disposition is left for the controller.

Self-review note (RFC 8785 fidelity): the canonicalizer implements only the locked v1 value subset (null, boolean, string, array, plain object, finite safe integer). It is faithful to RFC 8785 for that subset — string escaping matches ECMAScript JSON string serialization, integer serialization has no exponent/leading-zeros and normalizes `-0`→`0`, keys sort by UTF-16 code units, and it rejects floats/unsafe integers/lone surrogates/duplicate keys/unsupported values. It deliberately does **not** implement the RFC 8785 non-integer number algorithm because the v1 contract forbids non-integers; if a future schema version admits non-integer numbers, that path must be added and PRT-004 kept in lock-step. No doubt about correctness for the v1 golden vectors: order-independence, byte-sensitivity, and the rejection set are proven by direct unit tests and fixture mutations.

## Follow-up tickets

None.

## Gate recommendation

`ready for independent review` — the RED→GREEN sequence is recorded, the checker is GREEN, all nine fixtures conform to `schema-v1.json` and carry real recomputed `eventDigest` values (50 events), the 58 FND-004 mutations and the retained FND-001/002/003 corpus all pass (113/113), the canonicalizer's RFC 8785 subset is proven by direct unit tests, E0-F004 is resolved, `pnpm-lock.yaml` is byte-unchanged, and only the planned FND-004 files are touched.

## Independent review

**Reviewer:** `<pending until first independent review, then agent or human identity; must differ from implementer>`
**Reviewed revision:** `<pending until first independent review, then 40-character git SHA>`
**Disposition:** `pending`
**Review evidence:** `<pending until first independent review, then review record, exact commands/exit codes, or finding links>`

For `approved`, verify the result describes the reviewed revision, all focused acceptance evidence passes, and every accepted finding is resolved; then change the top-level `Status` to `complete` and commit this disposition separately. Otherwise leave `Status` as `gate_review` or set `blocked`, and link stable findings.

## Review attempt history

The implementation author leaves the table body empty; the explicit pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt for existing gate tooling. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it. Repository history identifies that commit, and handoffs pin the resulting ticket-result blob SHA.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- First independent reviewer appends attempt 1. -->
