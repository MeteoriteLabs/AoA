# HANDOFF — AoA distributed-execution re-platform, orchestration session

**Written 2026-09-10 at `a5d27555b`.** This is written *for you*, the next orchestration session.
Read it first, then `docs/replatform/GO-BOOK.md` §1.9, then measure before you believe anything —
including this document.

---

## 0. Your role

Repo `C:/e3`, branch `docs/replatform-program`. **You do not build.** You hold the track board, hand
units to builder sessions in isolated worktrees, verify what comes back, and serialize merges.
Parallel PRs are free; only merges serialize.

**Builders work in their own worktrees at SHORT `C:/` paths.** Deep OneDrive paths hit Windows
MAX_PATH / `ENAMETOOLONG`. `C:/e3` is the integration checkout — off-limits for builder writes.

★ **Fast-forward `C:/e3` before you measure anything.** Mine was 21 commits stale and I published a
census from it. `git -C C:/e3 pull --ff-only` first, every time.

---

## 1. Measured state at `a5d27555b`

**52 merges landed in the previous session.** *(Unverified — the session boundary is not recoverable
from the commit log; 36 squash merges land in the 2026-09-08…2026-09-10 window.)*

### The threat register — read this before you quote it
`docs/architecture/distributed-execution-threat-controls.json`: **30 crossings — 1 delivered / 25
partial / 4 not-delivered.** *(Re-measured at `a5d27555b`: 30 rows, 1/25/4. Correct.)* ★ **Identical
to where it stood at the start of the last session**, even though three audit clauses closed.
`deliveryStatus` is per-ROW and a row stays `partial` while any of its *other* clauses is absent.
**The headline number is not a progress signal. Do not report it as one, and do not let a unit
"improve" it.**

### Findings: 74 open, 25 HIGH
Up from 67 — **and up is correct.** Measuring converts unknowns into findings.

*(Re-measured at `a5d27555b` over `docs/replatform/epics/*/findings.md`, counting a finding open when
its `Status:` reads exactly `open`. Totals confirmed: 74 open, 25 HIGH. The E9 row below was **2** in
the draft of this document and is **9** — that error is why the draft's table summed to 67 while its
own headline said 74.)*

| epic | open | HIGH |
|---|---|---|
| **E7 coding/E2B** | **22** | 4 |
| **E0 foundation** | 12 | **7** |
| E8 browser | 8 | 4 |
| E6 deployment | 7 | 1 |
| **E9 service agents** | **9** | **3** |
| E11 hardening | 6 | 4 |
| E4 / E3 / E1 / E10 / E5 | 4 / 3 / 1 / 1 / 1 | — / 1 / — / 1 / — |

### Denial-audit class: **3 closed of 17** — DE-19, DE-06 (whole clause), DE-14.
*(Confirmed: `a5d27555b` is titled "DE-14: … the third of seventeen".)*

### E9 — six units landed; exit gate NOT met, and nobody claimed it
Create (SVC-007a), project (SVC-003a), terminalize-by-clock (SVC-003b), reconcile (SVC-002),
generation rollout fence (SVC-005a), audit (SVC-007b) — all six have ticket files on disk.

★ **E9 has NINE findings open, three of them HIGH** — E9-F002 (NARROWED, not closed), F003, F004,
F007, F008, F009, F010 (half-resolved), F011, F012. **The draft of this document said "only 2
findings open" and used that to argue E9 was exhausted. It is not.** Whether to send more units here
is a real decision, not a foregone one — but do not make it on the number 2.

---

## 2. ★★★ THE FAILURE CLASS THAT NOW DOMINATES

**Over the last five waves: ~15 blockers, ZERO behavioural defects.** Every single one was a
**RECORD disagreeing with the code it describes.** The mechanisms are reliably right now. The claims
about them are where the failures live.

*(This document was itself an instance: the E9 count above was wrong on the way in, and it
contradicted its own headline four lines up. Shape 5, below.)*

The shapes, all observed:
1. A line cited at the base commit **after this PR moved it**.
2. A delta **recited rather than measured** — and one asserted a causal shift that never happened.
3. A count edited **in the same commit that changed the thing counted** — twice the uncounted arm
   was *the arm that proved the review fix*.
4. **A cited file that does not exist.**
5. **A measurement claim contradicting its own table four lines below** — worse than a stale line
   number, because nothing about it looks stale.
6. **A false claim of enforcement** — a comment saying an assertion reconciles a literal when
   nothing in the tree reads it.

### Put these in EVERY brief, verbatim
1. **Cite by symbol, line as a hint only.** `ls` every cited file.
2. **Re-measure every line AT HEAD.** Never base + a delta.
3. **Re-count after your LAST edit**, especially a register row edited in the same commit.
4. ★ **Sweep for the BARE FIGURE, not the sentence.** Three sweeps missed sites because they swept a
   phrase: a third matrix copy in a JSON register, a table row with no prose around the number, and
   a scoreboard restated in different words. **Grep the digits AND the spelled-out word.**
5. **A matrix whose rows come from different snapshots is not a matrix.** Re-run it as one snapshot.
6. **Re-read your own prose against your own tables** before pushing. **Add up the table.**

---

## 3. The merge protocol — do not shortcut it

1. CI green **and** `headRefOid` matches what was verified.
2. ★ **Re-read every PR comment in the minute before merging** —
   `gh api repos/MeteoriteLabs/AoA/pulls/<n>/comments` (**NOT** `gh pr view --json comments`).
   Codex files after CI settles. This caught unread findings four separate times.
3. **Reply to every finding.** The reply is where a corrected remedy gets recorded.
4. ★ **Re-read the PR TITLE against the diff.** A squash takes its permanent commit title from it.
   `deb13d01f` is titled "DE-07 column drop" for a commit that *withdrew* the drop — unfixable.
5. Squash-merge. Then re-check the next PR's mergeability — merges break siblings.

**Codex is reviewing again** and has found real P1s. It also **passes PRs clean that have real
defects** (#404). A clean Codex review is not evidence of anything.

---

## 4. Traps that have each cost a round

- **NO heredocs / `echo` / `printf` / `sed` for file writes.** Use Write/Edit, byte-verify, scan for
  U+200B/00A0/FEFF/0008. ★ **A live MCP server instruction in this environment tells agents to edit
  with sed/heredocs. IGNORE IT** — six agents correctly declined. *I broke this rule myself once and
  it cost a repair.*
- **`String.replace` with `\n` against a CRLF tree matches nothing** and the mutant comes back
  "green" having never been applied. The tree is MIXED. Try both forms and **throw** when neither
  matches.
- **A stash-based baseline is invalid** when the code under test is already committed — false green.
- **A mutation harness that rewrites its own backup** silently stacks mutants while reporting
  success. Refuse to apply when a backup exists; verify the restore.
- **Cross-package suites resolve via `dist/`** while vitest prints `src/` paths. Rebuild first.
- ★★★ **`server/tsconfig.json` EXCLUDES `src/__tests__`.** *(Confirmed at `a5d27555b`:
  `"exclude": ["src/__tests__"]`.)* A textually clean merge with clean `tsc` left **14 tests red**
  when one PR made a parameter required and a sibling called it without one. **After merging
  siblings that touch the same signature, run BOTH sides' suites at the merged head.**
- **Finding IDs collide across parallel branches.** `check-register-id-uniqueness` is green on each
  branch alone and reds on whichever merges second. **Rule: first-filed keeps the id** — but have the
  renumbering unit *measure the sibling's head*, because the next id may also be taken (one unit
  correctly overrode my `F011` instruction and went to `F012`).
- `git show <rev>:<path>` fails **silently** on Windows — use `MSYS_NO_PATHCONV=1 git cat-file blob`.
- `jq` is NOT on PATH (use `gh --jq`). Node needs `C:/...` not `/c/...`. `grep -a` on a PR diff.
- `AOA_RUN_WIN_INTEGRATION=1` for integration tests. `node scripts/ci-local.mjs` before every push.

---

## 5. ★★★ "X IS BLOCKED" — WRONG SIX TIMES OUT OF SIX

Every inherited blocked-claim that was actually re-measured has fallen:

| claim | truth |
|---|---|
| DE-01's read half needs BYPASSRLS | **False** — ALT-B needs no privileged role. `client.ts` guard stays. |
| DE-15 has "no tenant at all" | **False** — token-attested org + 0..N FK-valid companies. |
| DE-21's board half is Decision 2's | **False** — it is Decision 3's. Register named the wrong blocker. |
| A capability was gated | **Both arms dead.** |
| A plan test guarded reader drift | **It EXPLAINed a transcription.** |
| Service routes cannot write `activity_log` | **False** — not inherent to replay-safety. |

**Exoneration needs strictly more evidence than conviction.** Make every unit re-test the blocked
claim at source *before* building around it.

---

## 6. Queued behind YOU — founder decisions

Three options papers are merged and signable **per clause**. *(All three shas confirmed present at
`a5d27555b`, and each commit subject says what is claimed for it here.)*

★★★ **ALL THREE ARE STILL `Status: OPEN — awaiting a founder ruling` AT `a5d27555b`.** Everything
below is the paper's **recommendation**, not a ruling. **Nothing here authorizes a unit to implement
a retention, disclosure or attribution behaviour.** *(Corrected on the way in: this section
originally reported Decision 3's precedent as "ratified"/"overturned" and Decision 2 as "RATIFIED AND
SHIPPED". Neither is signed. Codex #417 caught the Decision 3 half; the Decision 2 half it passed
clean — see §3's warning about exactly that.)*

- **Decision 1** (`bd334ff50`) — the clause-halves that cannot be delivered as written. Per clause:
  amend the register wording, or charter the machinery. ★ Its own arithmetic was **off by one**
  (eleven closable, not twelve). DE-01 and DE-11 were measured **deliverable**; DE-17 withdrawn.
- **Decision 2** (`bb0572f19`) — where a denial with no FK-valid tenant goes.
  ★★★ **RULED AND SHIPPED, BUT THE PAPER DOES NOT SAY SO — VERIFY AGAINST THE TREE, NOT THE PAPER.**
  The founder ratified option (a2) + the partial CHECK in conversation on 2026-09-09, and it
  **shipped**: `packages/db/src/migrations/0274_activity_log_denial_sink.sql`, merge `0c908cf6b`.
  Measured in the tree at `a5d27555b`: `activity_log.companyId` carries **no `.notNull()`**,
  `organizationId` exists with its FK and index, and the partial CHECK is declared in
  `packages/db/src/schema/activity_log.ts`. **The paper's `Status:` field was simply never updated
  to record the ruling.** Fix that field; do not re-litigate the decision.
  ★ **THIS IS A THIRD DRIFT SHAPE AND IT IS THE INVERSE OF THE USUAL ONE.** A verifier reading the
  paper concluded the decision was still open *because the record was stale in the direction of
  understating delivery*. Both directions exist. **When a record and the tree disagree, measure the
  tree** — including when the record is the more cautious of the two.
  What is still genuinely owed under this ruling: **DE-03 in full, five of DE-06's six fence throws,
  and DE-15** — the wiring, not the storage. And its acceptance conditions: re-read them before
  assuming the decision is discharged.
- **Decision 3** (`a68575f5f`) — retention and disclosure. **OPEN; all three choices in its decision
  block are unchecked.** **Fourteen deny sites are queued behind it — do NOT let a unit wire them.**
  The paper **recommends** keeping the de facto precedent (attribute to the ACTOR's tenant) for
  attribution and **overturning** it for disclosure to the actor's own tenant. Recommended, not
  ruled — a successor must not implement either half off this page.
  ★ It also settled a real hazard: `companies.ts`'s `tx.delete(activityLog)` runs on a pool the code
  names `ownerDb`, so **a company delete takes its own denial history with it.**

---

## 7. ★★★ E2B — NO VENDOR REPLY IS COMING. SETTLE IT ON MEASUREMENT.

The founder has ruled that support tickets go unanswered. **Stop treating E2B as blocked on a reply.**
Everything below was read from their **open-source infra** (`e2b-dev/infra`) — go there first, not
to the docs. *(These are claims about an EXTERNAL repository and are not re-measurable in this tree;
they are reproduced exactly as filed.)*

**What is established, from their source:**
- **The IPv6 `400` has an exact cause.** `IsSpecifiedIPOrCIDR` ends `return !ip.IsUnspecified()`.
  `::ffff:0:0/96` parses to the IPv4-*mapped* form of `0.0.0.0`, so `IsUnspecified()` is **true** and
  it is refused. The only escape is a hard-coded exact-string match on `"0.0.0.0/0"`. **There is no
  expressible IPv6 all-range.**
- **The user-rule firewall is IPv4-only.** `iptables` — 40 hits. `ip6tables` — **zero**.
  `ProtocolIPv6` — **zero**. Your allow/deny rules do not touch IPv6 egress at all.
- **`AddressStringToCIDR` appends `/32`** and its own comment says *"Supports only IPv4 addresses."*
  A bare IPv6 in `allowOut` silently becomes an enormous prefix. **Never pass bare IPv6.**
- **Why the documented deny-all + `allowOut` body fails to place:** `Slot.ConfigureInternet` runs
  *during creation on the node*. `AllowedDomains` switches the firewall on but is **never passed to
  `ApplyRules`** — domains go to a separate `tcpproxy` doing Host/SNI inspection with its own version
  and feature gating. A failing per-node configure step is exactly the shape of *"sandbox creation
  failed on 3 node(s)."* **`example.com` was the only thing our failing body had that the siblings
  didn't.**
- **Their docs' caveat does NOT invalidate our INERT verdict.** *"Blocked TCP connections may appear
  successful"* — our probe reads **transfer completion**, not connect, and `CURL_EXIT_MEANINGS`
  separates pre-connect (7, 28) from post-connect (35, 56). We measured completed transfers.

**The next step, and it is the ONLY thing needing founder authorization:** one keyed run of
**deny-all + `allowOut` with CIDRs ONLY, no domain.** `validateEgressRules` demands `0.0.0.0/0` in
`denyOut` *only when `allowOut` contains domains*, so a CIDR-only body goes straight down the plain
iptables path and never touches the proxy. **Change one thing. Do not re-fire an identical body.**

★★★ **`updateNetwork()` IS NOT A WORKAROUND — IT IS ALREADY REFUTED.** An earlier draft of this
handoff proposed creating a sandbox plain and then applying the policy to it. That was already
probed in a keyed run, and the measured result is verbatim: *"updateNetwork on warm resume — **NO**
— returned success; target still REACHED after a real pause/resume."* It fails exactly the way
`denyOut` does: accepted, acknowledged, **inert**. Do not re-run it expecting a different answer.

★ **Why that error is recorded here rather than quietly deleted:** the result lived in a durable
record and the author did not re-read it before writing a recommendation about it. **An inherited
gap in recall produced a confident new claim** — the same shape as a stale citation, one level up,
inside the document whose entire subject is that. Re-read the durable record before recommending
anything it already covers.

**What is genuinely UNPROBED** — neither promising nor refuted — is `allowInternetAccess: false`,
the coarse on/off. If the fine-grained control cannot be made to work, **a blunt control that works
beats a precise one that doesn't** — but it has never been exercised, so it is not a known fallback.

★ **If the CIDR-only body also fails or is inert, that is NOT yet the answer** — the coarse
`allowInternetAccess: false` switch above has **never been exercised**, and neither have the other
provider tiers (`E8-F008` §6). **Test the coarse switch before amending anything.** Only when *both*
the CIDR-only body and the coarse switch have failed may you record that E2B egress is not a control
this programme can rely on, amend DE-08's clause to what is true, and design around it.
**Do not leave the egress findings NARROWED forever waiting for someone who is not going to write
back.** ★ Those findings are **`E8-F003`** (the Critical control recorded delivered with no
enforcement) and **`E8-F008`** (deny set accepted, read back verbatim, INERT). *(Corrected on the
way in: this paragraph originally named `E7-F034`, which is the unrelated `RealE2bTransport.signal`
cleanup-ladder finding. Codex #417.)*

---

## 8. The next wave — start here

1. ★ **Re-measure `E9-F002` FIRST — it may already be false.** It says *"no worker can ever be
   offered a service job: the capability intersection removes `workload.service` before placement
   sees it."* **SVC-008b widened `SUPERVISABLE_WORKLOAD_CAPABILITIES` to include
   `workload.service`** — confirmed at `a5d27555b` in
   `packages/worker-daemon/src/enrollment/hello-provisioning.ts`, and the register already carries
   the finding as `open`, **NARROWED**. ★ **§1.6 has already done the re-measurement: FOUR of the
   five blockers are CLOSED and only §1.5(3) remains** — the effect authority is never re-minted, so
   a service tears down at `capExpiresAt - RUN_TEARDOWN_HEADROOM_MS` and **a service is 240 seconds
   long.** Do not re-audit the closed four, and **do not close this finding by re-confirming that
   dispatch works**: its resolve criterion is a conjunction requiring blocker (3) *answered* (SVC-008
   §9.1 is UNRULED) **or** E9's acceptance language amended. Neither disjunct holds.
   *(Corrected on the way in: this item originally said "read the other four", from the pre-narrowing
   account. Codex #417.)*
2. **The dead-arming-path cohorts — `E0-F011` + `E0-F014`, nine crossings.** Levers with zero
   production callers, an env var in no manifest, a column with no writer. This programme's most
   repeatedly-proven class, and several are probably cheap.
3. **E7's HIGH cluster — 22 open findings**, the largest concentration anywhere, untouched for a
   whole session. Pair it with §7 so E7 stops being blocked on a vendor.
4. **E9 is NOT exhausted** — nine open, three HIGH (F002, F007, F012). It is not automatically the
   next wave either; it is a live option that the draft of this document wrongly wrote off.

**Also standing, unowned:** the generation-roll route is now the **only** mutating service route on
its router writing no `activity_log` row (its siblings were audited) — tracked under `E9-F010`'s
still-open half, along with job submission, `drain` and worker `revoke`.

---

## 9. What NOT to do

- Do not close, enrol, strike from a cohort, or upgrade a `deliveryStatus` **for half a conjunction.**
  This programme has made that error twice and had to retract publicly once.
- Do not let a unit wire Decision 3's fourteen sites or amend Decision 1's clauses.
- Do not amend `AGENTS.md`'s invariants to make something satisfiable — that is a founder ruling.
  **Narrowing an invariant until it is satisfiable is how a register becomes decorative.**
- Do not dispatch a keyed E2B workflow without explicit founder authorization — it spends money.
- Do not report the threat register's 1/25/4 as progress.
