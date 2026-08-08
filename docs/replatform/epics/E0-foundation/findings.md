# E0 Findings

New findings use IDs `E0-F001`, `E0-F002`, and so on, and retain their resolution history. A finding records severity, evidence, affected tickets, disposition, and whether it blocks the gate. Findings are never silently deleted; resolved findings retain the resolution link.

## E0-F001 — Ticket-result template vs Task-9 gate-regex format conflict (Start SHA / Disposition)

- **Severity:** Minor
- **Blocks gate:** No (resolved inline by conforming the ledger to the gate format; template fix tracked below).
- **Discovered during:** FND-001 independent review / controller gate-format pre-check.
- **Evidence:** The Task-9 integration-gate parser in [`../implementation-plan.md`](../implementation-plan.md) Step 1 requires (a) FND-001's Start SHA as a **bare** 40-hex — `^\*\*Start SHA:\*\*\s*([0-9a-f]{40})\s*$` (no surrounding backticks), and (b) each ticket's Disposition as **backtick-wrapped** — `^\*\*Disposition:\*\*\s*` + `` `approved` ``. But [`../../../templates/ticket-result-template.md`](../../../templates/ticket-result-template.md) line 8 renders the Start SHA example **backtick-wrapped** (`**Start SHA:** \`<...>\``). The FND-001 implementer faithfully followed the template (backtick-wrapped Start SHA), and the FND-001 reviewer wrote a bare `approved` Disposition — both would fail the Task-9 regex.
- **Affected tickets:** FND-001 (result ledger), FND-005 (owns `docs/replatform/templates`), all FND-00x result ledgers (format convention).
- **Disposition:** Resolved for FND-001 by editing `tickets/FND-001-result.md` to the gate-conformant format — **bare** Start SHA, **backtick-wrapped** `` `approved` `` Disposition, `` `complete` `` Status — with the review substance (reviewer identity, reviewed revision, approved disposition, attempt-1 row) unchanged. **Convention for all remaining tickets:** implementers write `**Start SHA:** <bare-40-hex>`; reviewers write `**Status:** ` + `` `complete` `` and `**Disposition:** ` + `` `approved` ``; Reviewed revision may be bare or backticked (the gate regex allows optional backticks). **Carry-forward:** FND-005 should correct `ticket-result-template.md` line 8 so its Start SHA example is bare, matching the gate parser. Until then, this convention is authoritative over the template's example.

## E0-F002 — FND-001 shared-checker code-hygiene carry-forward (fold into FND-002)

- **Severity:** Minor
- **Blocks gate:** No.
- **Discovered during:** FND-001 code-quality review (disposition `approved`; items explicitly deferred to a later-ticket extension).
- **Evidence / items:** In `scripts/check-distributed-execution-foundation.mjs` at the FND-001 revision `490049551`:
  1. **Dead code on the spine** — the `__test` export (`.mjs:517-523`) is unused; its only purpose is to hold `fileURLToPath` (imported at `.mjs:40`), which nothing consumes. Prune both.
  2. **Defensive gap in forbidden-edge validation** (`.mjs:341`) — a present-but-malformed lifecycle (key exists, `states` missing) referenced by a forbidden edge throws a `TypeError` instead of pushing a clean error; still fails closed (exit 1 via `main`'s catch), but `runCheck(root)` throws for the `node:test` harness rather than returning a structured error. Guard it so it returns a clean error.
  3. **Unpinned mutation branches** in `scripts/check-distributed-execution-foundation.test.mjs` — reachability (unreachable state), non-terminal dead-end, forbidden self-lifecycle edge (`is not cross-lifecycle`), forbidden unknown-lifecycle/state, and reason-only guard drift have working checker logic but no mutation asserting them. Pin these as the corpus grows.
  4. **Prose not parity-checked** (optional future hardening) — the Markdown `Statuses:` enumerations and terminal-immutability prose are not cross-checked against JSON `states`/`terminal` (only the From/To transition tables are). Within the amendment's documented parity scope (edges + guard reasons), so not a defect; candidate hardening as later tickets grow the contract.
- **Affected tickets:** FND-002 (extends the same checker + `.test.mjs`).
- **Disposition:** **Resolved (items 1–3) in FND-002** commit `f5e45cf2b2a3ddf588307e2cba12ec2d183925f6` — dead `__test`/`fileURLToPath` pruned; the forbidden-edge validation now pushes a clean error (no `TypeError`) for a present-but-malformed lifecycle referenced by a forbidden edge; and the five previously-unpinned branches (unreachable state, non-terminal dead-end, forbidden self-lifecycle edge, forbidden unknown-lifecycle/state, reason-only guard drift) are pinned by mutations. Verified by FND-002 spec + code-quality review. **Item 4** (prose/`Statuses:` list not parity-checked) remains **open/optional** — candidate hardening for a later FND ticket as the contract grows.

## E0-F003 — Structural-checker negation/row-pinning hardening (carry into FND-003/FND-007)

- **Severity:** Minor
- **Blocks gate:** No.
- **Discovered during:** FND-002 code-quality review (disposition `approved`; both notes make the checker stronger than the plan's substring-only requirement, so neither violates the stated acceptance).
- **Evidence / items** (in `scripts/check-distributed-execution-foundation.mjs` at FND-002 revision `f5e45cf2b`):
  1. **Same-sentence negation smuggle** — `requireNegatedMention` (~`.mjs:521`) tests each sentence for *any* negation word, so an affirmative clause appended to a sentence that already carries a negation is missed (probe: `"No AoA database is a peer replica except the worker SQLite which is a peer replica."` passes). The *separate-sentence* affirmation the FND-002 mutation targets IS caught; this is only the same-sentence variant.
  2. **Added contradictory matrix row not rejected** — `validateAuthorityMatrix` (~`.mjs:559`) pins the 7 required rows but does not assert row *count*, so an *added* contradictory authority row passes (removed/drifted required rows ARE caught).
- **Affected tickets:** FND-003 (threat-controls JSON + Markdown parity — reuses negation/row-pinning-style validation), FND-007 (crosswalk CM-*/CP-* row pinning), and any later ticket extending the negation/matrix scans.
- **Disposition:** Open — non-blocking hardening. When FND-003/FND-007 add their own row/ID pinning and invariant scans, tighten these two patterns (per-clause negation scoping; assert exact row/ID set incl. count / reject unknown rows). Not required for E0 gate pass. FND-003 applied item-2 exact-set parity for its threat register.

## E0-F004 — Threat-controls parity fields not in required-field set (carry into FND-004)

- **Severity:** Minor
- **Blocks gate:** No.
- **Discovered during:** FND-003 code-quality review (disposition `approved`).
- **Evidence:** In `scripts/check-distributed-execution-foundation.mjs` at FND-003 revision `09651fb63`, the JSON crossing fields `threat`/`control`/`verification` are rendered into the Markdown register and value-compared in per-ID parity, but are NOT in `THREAT_CROSSING_REQUIRED_FIELDS`. Because each parity comparison is guarded by `typeof c.<field> === "string"`, **deleting** one of those fields from a JSON crossing yields zero errors (value-drift IS caught; only field-deletion escapes). All 30 crossings already carry these fields, so requiring them keeps the corpus green.
- **Affected tickets:** FND-004 (next to extend the checker), FND-007 (extends fixtures/parity).
- **Disposition:** Open — non-blocking. When FND-004 extends the checker, add `threat`/`control`/`verification` to the threat-crossing required-field set (and add a field-deletion mutation) so the parity claim is fully robust. Two smaller notes from the same review (a few mutations cascade rather than isolate; the trust-boundaries table is not parity-checked) are acceptable as-is and need no action.
