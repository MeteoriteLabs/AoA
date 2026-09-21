# Decision — the `CLI-008` successor id scheme

**Status:** RULED and ENACTED. **Date:** 2026-09-21. **Milestone:** `M0`, unit 4.
**Founder decisions:** D1 (numeric successors, filed + re-pointed, with the enumeration sweep) and
D5 (file `M1b`'s ids; re-point only what genuinely maps).
**Enacted by:** the M0 unit-4 commit. There is deliberately **no `-LEDGER-result.md`** — see §3.

---

## 1. The problem, measured at source

`scope-triage.md`'s `M1b` required-result set named its members `CLI-008-F1a`, `CLI-008-F1b`,
`CLI-008-F3`, `CLI-008-F4`, `CLI-008-F5`, `CLI-008-F6` and `CLI-008-C5`. Those ids **cannot be
expressed to the guards**:

- `scripts/lib/finding-ownership.mjs:423` accepts an owner only if `tickets.has(entry.ticket)` — an
  exact string match.
- `findTicketIds` (`:50`) derives the id set from **filenames** with `/^([A-Z]+-\d+)/`.

So `CLI-008-F1a` resolves to nothing (`owner_ticket_missing`), and a file named
`CLI-008-F1a-result.md` resolves to **`CLI-008`** — putting the parent in `completedTicketIds`
(`:56-70`) and turning every finding it owns into `owner_ticket_already_complete`, "owned by
nothing".

★★★ **Nothing was orphaned before this decision, and that matters for how urgent it was.** `CLI-008`
has no `-result.md` at `169be1f2c`, so all ten declarations validated. The hazard was **prospective**
— it would have fired the moment anyone wrote the parent's result or a link-scoped one.

## 2. The scheme

Numeric ids in the existing `CLI-` namespace. The mapping is authoritative in `program-design.md`,
immediately before the `CLI-010` node:

| Old | New | Subject |
|---|---|---|
| `CLI-008-F1a` | `CLI-010` | link 1, the CAPTURE side — the metadata-only enumeration seam; fences `captureSandboxEntries` ★ *(label corrected 2026-09-21: this row read “the EMIT half”. `F1a` was always the capture/enumeration side and `F1b` the emit side — see `F1b`'s row. The id mapping is unchanged; only the description was wrong, and it had propagated into the `CLI-010` graph node.)* |
| `CLI-008-F1b` | `CLI-011` | link 1, the output-mechanism design review |
| `CLI-008-F3` | `CLI-012` | link 3, the worker-side consumer |
| `CLI-008-F4` | `CLI-013` | link 4, the announcement |
| `CLI-008-F5` | `CLI-014` | link 5, the projector |
| `CLI-008-F6` | `CLI-015` | link 6, the judge |
| `CLI-008-C5` | `CLI-016` | Unit C slice 5, arms the tool surface |

Link 2 has no successor because it is **built** (PR #353); Unit F §1.6 strikes it through. Seven
successors for six links is not an arithmetic error: link 1 splits into `F1a`/`F1b`, and `C5` rides
alongside them in the `M1b` set.

## 3. Why there is no ledger result file

A `CLI-008-LEDGER-result.md` would resolve to `CLI-008` under the same regex and **be the orphaning
act it exists to prevent**. Rather than mint a ticket to hold a decision, the decision lives here,
which is the pattern the programme already uses (`DECISION-byte-egress-and-provider-topology.md`).

## 4. Which findings moved, and which did not

★★★ **The ten findings do NOT correspond to the six links, so "re-point the ten" was not
achievable as stated (D5).** `CLI-008-unit-f-design.md` §1.6 defines the links as the **output
return path**; the ten findings span a different subject set. Re-pointed on subject, each verified
at source:

| Finding | Moved to | Why |
|---|---|---|
| `E7-F026` | `CLI-011` | it is a claim about one of the output-mechanism **options** under review |
| `E7-F016` | `CLI-015` | clause 6 **is** `countProducedOutputs` (`e7-distributed-run-verifier-store.ts:124`), which is link 6 |

**Eight remain on `CLI-008`:** `E7-F003` (argv-only capability — the umbrella gap the parent exists
to close), `E7-F015` (forgeable task-outputs endpoint), `E7-F017` (grant-pairing refusal bug),
`E7-F023`, `E7-F032`, `E7-F033` (all **clause 4**, the secret scanner — a different clause from
clause 6, confirmed at `:122` and `:305`), `E7-F024` (frozen-log truncation) and `E7-F027` (codex's
trusted-directory refusal).

★ **Leaving them is the correct outcome, not an unfinished one.** They are not orphaned, and moving
them into a link successor would be a false claim of ownership — the failure the guard's own header
calls out: inference-based ownership "was WRONG FIVE TIMES IN BOTH DIRECTIONS".

## 5. Consequences

- `M1b`'s required-result set is now expressible; its seven ids exist as graph nodes.
- **Only `CLI-011` and `CLI-015` carry ticket files.** The other five are nodes only, which
  `ticket-graph-coverage` treats as backlog by design: *"the authority names a ticket that has no
  file yet → that is the BACKLOG … NOT a failure"*. Minting five design docs with no design behind
  them would be inventing evidence.
- **The bar on a `CLI-008` parent result has NOT lifted.** Eight findings still name it, so a result
  written today still orphans eight at once. `scope-triage.md`'s "after the ledger re-points the ten
  findings the bar lifts" is corrected in place.

## 6. What would reopen this

A link successor acquiring a `-result.md` while findings still name `CLI-008`; a new finding
declared against a link-scoped id rather than a numeric one; or `check-finding-ownership` gaining
an id grammar that can express `CLI-008-F1a`, at which point the renumbering becomes optional rather
than required.
