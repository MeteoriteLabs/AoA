# HANDOFF — Session 1: E9 service-lifecycle enactment (code-heavy track)

**Base:** branch a fresh git worktree off the `docs/replatform-program` tip that contains this file (the kickoff PR). Confirm `git log -1` shows the kickoff commit before you start.
**Track class:** ruling-unblocked, **no migration** (this repo has no local `node_modules`; drizzle-kit cannot run here). Everything below is TDD-via-CI.
**Companion session:** Session 2 (guard-sink + register custodian) runs in parallel. It is the **sole owner of the shared registers** — you hand your finding-close deltas to it (see §Serialization).

---

## Founder rulings this session enacts (ruled 2026-09-20)

- **E9-F003 → rename `service_instance`→`service`.** The `service_reconcile` executor principal deliberately names the SERVICE, not the instance. Do NOT add `serviceInstanceId` to the frozen `serviceReconcileSourceSchema` (that was the rejected Protocol-Custodian amend). Rename the `kind` at `serviceSourceIsAdmitted` (server/src/services/service-reconciler-source.ts / wherever it returns `{kind:'service_instance', id: services.id}`) and its consumers. **The `jobs.executor_principal_kind` CHECK tightening is db:generate-gated → DEFER it; ship only the code rename.**
- **E9-F004 → SVC-005 writes `stopping` from the request side.** A control-plane write is a legitimate fact; keep the frozen `SERVICE_INSTANCE_TRANSITIONS` table (`packages/worker-protocol/src/states.ts`) intact. `service_instances_status_check` already permits `stopping` (no migration). Then the SVC-003 projection's `predecessorsOf` can narrow back toward the frozen direct edges.
- **E9-F007 / E9-F012 → documented overlap allowance.** Issue the overlap allowance as the finding's route (c) (a recorded architecture allowance defining the fencing + idempotency policy), paired with the graceful_stop fence as the durable half.

## Owned findings + scope

| Finding | What | Gate |
|---|---|---|
| E9-F004 | SVC-005 writes `stopping`; narrow `predecessorsOf` back to direct edges | ruled — buildable now |
| E9-F007 / E9-F012 | documented overlap allowance + the graceful_stop fence | ruled — buildable now |
| E9-F008 (graceful_stop half) | the `graceful_stop` control-command **producer** (`graceful_stop` is already in `job_control_commands_kind_check` — **no migration**); widen `GovernedControlCommandInput.commandKind` (today admits only `product_approval_result`\|`runtime_decision_result`) | buildable now |
| E9-F009 | deadline-kill writes only `service_instances.status` with no receipt → a deadline-kill and a worker self-report are DB-indistinguishable; add the durable receipt | buildable now |
| E9-F002 slice b2 | worker consumption of the re-minted capability + teardown-window recompute (`packages/worker-daemon/.../run-op-deadline.ts`, today reads only constants). **INERT.** | buildable now — **DO NOT CLOSE E9-F002** (§Do-not-close) |
| E9-F003 (code half) | rename `service_instance`→`service` (the CHECK migration DEFERRED) | ruled — buildable now |
| E9-F010 residual / E9-F011 | audit/attribution quality findings — **RE-VERIFY each at HEAD first** (their finding text may lag; my prior E9-F010 work (#504/#505/#506) closed the JOB operator-mutation audits and left revoke org-scope-blocked — confirm what actually remains before scoping) | re-verify |

## DEFERRED — do NOT attempt this session

- **`checkpoint` producer + any CHECK/column migration** (E9-F008 checkpoint half, E9-F003's CHECK, E0-F018) — need `db:generate`/drizzle-kit, which cannot run in a `node_modules`-less checkout. Founder deferred migration items. If a migration-capable checkout appears later, these batch into ONE migration held by ONE session.
- **`SVC-004` (checkpoint policy/consumer)** — the stub exists (`.../tickets/SVC-004-design.md`) so E9-F008 can name an owner without tripping the ownership guard, but the checkpoint build is migration-gated → not this session.

---

## Serialization rules (obey exactly)

1. **NO migration.** You emit zero `packages/db/src/migrations/NNNN_*.sql`. If a change seems to need one, it is a DEFERRED item — stop and note it.
2. **Do NOT touch `server/src/services/job-leasing.ts` / `job-leasing-contract.test.ts`.** That file is the most-pinned in the tree and is Session 2's if any (guard-sink R1=B is register-only, so nobody edits it this round — keep it that way).
3. **Register custodian = Session 2.** Every `scripts/finding-ownership.json` key-delete + `docs/replatform/epics/*/findings.md` status-flip + `docs/architecture/distributed-execution-threat-controls.json` edit your finding-closes require: write them as your PR's **final trailing commit**, and coordinate with Session 2 to land them **last, one at a time** (or hand the delta to Session 2). This is what stops the two sessions colliding on the four shared registers (`finding-ownership.json`, `threat-controls.json`, `gate-clause-wiring.json`, `GO-BOOK.md`).
4. **Frozen — do NOT touch:** the worker-protocol v1 wire (`packages/worker-protocol/src/states.ts` `SERVICE_INSTANCE_TRANSITIONS`, `transport.ts` `CONTROL_COMMAND_KINDS`), the `SandboxProvider` port, and any `threat-controls.json` `DE-*` row owned by Session 2's guard-sink work (DE-18/DE-04).

## ★ Do-NOT-close guardrail (the sharpest trap)

**E9-F002, E7-F003, and every Unit F finding have a keyed-real-E2B conjunct in their close criterion** (a service run *observed past 240s*; `mcp__aoa__*` reaching a live sandbox; codex write *measured*). Building the inert code (b2, etc.) does **not** satisfy that conjunct. **Do NOT flip `findings.md` status or delete the `finding-ownership.json` key for E9-F002 on buildable code alone** — `SVC-009-design.md:52` spells this out. Half a conjunctive clause is not the clause. Ship b2 as INERT and leave the finding open.

---

## Per-finding sub-agent orchestration recipe (the wave's proven loop — GREEN-first-cycle on #509)

1. **Terrain-map workflow** (fan-out sub-agents) → exact signatures/imports/surface at SOURCE + a synthesized plan + a ranked list of CI-red risks.
2. **Re-verify every load-bearing signature yourself at HEAD** — never trust a sub-agent's read or a finding/paper heading (three papers lagged their rulings this wave; two finding texts may lag their code).
3. **RED-first, pushed:** watch the 4-way-sharded `verify` go red *for the right reason*. **`node scripts/ci-local.mjs` green ≠ CI green** — it skips the sharded `verify`; only CI is authoritative for TS/vitest.
4. **GREEN** implementation.
5. **Blind adversarial-review Workflow** (refute-by-default, 3–4 lenses + a skeptic per finding + an adjudicator). Codex is quota-exhausted account-wide → use the blind panel. The skeptic's blind spot is diff→world; you own world→diff.
6. **Register delivery-evidence cite-by-SYMBOL**; every new guard gets a **positive control**; **audit a durable mutation atomically with it** (best-effort + idempotent-skip = permanently lost).
7. **CI-green + rigorous self-review merge** (founder-authorized while Codex is walled). Confirm a CI run EXISTS for the pushed sha (`gh pr checks N --json ... --jq ...`; `jq` is not on PATH → use `gh`'s `--jq`). `gh pr checks --watch | tail` masks the exit code — use a retry-poll asserting fail=0 + zero pending.

## Environment gotchas

- **No local `node_modules`** (deep-OneDrive `ENAMETOOLONG`) → cannot run vitest/tsc/drizzle-kit. TDD-via-CI only.
- **EOL:** keep every edited/new file `w/lf` (`git ls-files --eol` → `w/lf`). Many files are `i/lf w/crlf` (stale); the Edit tool flips LF→CRLF on those — fix via a python read/`.replace("\r\n","\n")`/write-`newline='\n'` pass, verify `w/lf`.
- **Set `AOA_DISTRIBUTED_EXECUTION_ENABLED='true'` in `beforeEach`, delete in `afterEach`** for any integration test that reaches `admitAttemptCapacity` (the reconcile/submit path); use distinct proof ids + `DELETE FROM worker_proof_replays` on reset.
- Parallel PRs are free; **merges into `docs/replatform-program` serialize** (~20 min apart) — coordinate with Session 2 before merging a finding-close.
