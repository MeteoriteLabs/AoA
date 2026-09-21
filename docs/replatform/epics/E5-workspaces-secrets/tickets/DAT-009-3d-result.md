# DAT-009-3d Result — the export sequencer composed at the dispatch runtime

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan DAT-009-3d — compose the sequencer (S, M1b)`, as amended by E5-D07 ruling 4
**Decision:** [`decisions.md`](../decisions.md) **E5-D07**, `accepted`, rulings 1–8
**Implementer:** `DAT-009-3d build session (Claude Opus 5)`
**Start SHA:** `cec1b48a7` (`docs/replatform-program` tip, the #549 merge)
**Reviewed revision (the code commit):** `c69a8b44f7d153f9a3ec2310754acae1216543e9`

The implementer leaves `Status` at `gate_review`. Only a distinct reviewer may change it to
`complete`.

## 1. What was built

- **`composeDispatchRuntime`** (`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts`) builds
  `createArtifactExportSequencer({client: deps.client, key: deps.key, session: () => session.get()})`
  and passes it to the supervisor as **`exportArtifacts`**. This copies the `createStagedInputResolver`
  → `resolveStagedFiles` pattern in the same function.
- **Both lanes get it.** A single `makeSupervisor` call serves both the desktop `provider` lane and
  the container `makeRunProvider` lane, so the sequencer reaches whichever lane is injected.
- **No producer is composed.** `resolveExportArtifacts` belongs to `CLI-012`. `runExportWindow`
  opens only when both deps are present (E5-D07 (a) 1). So the sequencer is **built at boot and run
  by nothing**, and no run invokes it. The tests below pin that on a real run of each lane.
- **`E5-2` stays `unwired`** (E5-D07 ruling 4). The composition is the symbol's first non-test
  reference, so `scripts/gate-clause-wiring.json` raises the entry's `expectedReferences` to `1`. It
  also appends an amendment to the entry's `reason` saying why. The older text is kept as written.
- **The composition adds no new failure path at boot.** `createArtifactExportSequencer` only closes
  over its deps and throws nothing at construction. So the plan's "a composition that throws at boot
  is a boot failure" has nothing to act on here. The sequencer is built with no guard around it, so
  if it ever did throw, `composeDispatchRuntime` would reject.
- **Not changed:** `supervisor.ts`, the flag default, and any producer.

## 2. RED → GREEN

**RED.** `dispatch-runtime-export-composition.test.ts` was written first, against the unmodified
`dispatch-runtime.ts`. Run with
`npx vitest run src/__tests__/dispatch-runtime-export-composition.test.ts`: **8 failed (8)**. The
failures had these causes, and each one comes from the missing composition:
- `expected 'undefined' to be 'function'`: 4 cases. These are the two lane cases and the two inert
  cases, whose non-vacuity precondition checks that the sequencer is composed.
- `composed.exportArtifacts is not a function`: 2 cases. These call the composed sequencer directly
  (bound-to-runtime, and nothing-to-export).
- `createSupervisor: resolveExportArtifacts requires exportArtifacts`: 2 cases. These are the F10
  cases. Their test producer, with no composed sequencer, hits 3c's construction rule.

No case was green at RED.

**GREEN** at `c69a8b44f`:
- The task's verify command was run as its bash equivalent: the protocol build, then
  `vitest run src/__tests__/dispatch-runtime.test.ts src/__tests__/dispatch-runtime-export-composition.test.ts`.
  Result: **2 files, 35 passed** (27 existing and 8 new).
- `node scripts/check-gate-clause-wiring.mjs` reports **OK**. `E5-2` is listed under `DORMANT, on the
  record`.
- The full worker-daemon suite gives **160 files, 1078 passed, 1 skipped**. The worker-daemon
  `typecheck` and `build` both exit 0.
- **The test file is typechecked.** The package `tsconfig.json` excludes `src/__tests__`, so a
  standalone `tsc` was run over the new file. It reported no errors in it. The pre-existing errors in
  `support/*.ts` are not from this ticket.
- The full `pr.yml` guard set plus `check-evidence-immutability --base origin/docs/replatform-program`
  gives **0 failures**. `check-test-inventory` needed the `packages/worker-daemon` pin raised from
  166 to 167, for the one new file. Only that pin was changed.

## 3. Positive controls and mutation table

The source was restored after each row, and the test file was rerun each time.

| # | Mutant (in `dispatch-runtime.ts`) | Result | Killed by |
|---|---|---|---|
| P1 | **the positive control for the register:** composition present, `expectedReferences` not yet raised | `check-gate-clause-wiring` exit 1: `E5-2 … createArtifactExportSequencer has 1 reference(s), expected 0` | the wiring checker reads the register |
| M1 | **the composition removed** (`exportArtifacts` not passed) | **8 red** | every case |
| M2 | a `[]` stub producer composed (`resolveExportArtifacts: async () => []`, the thing E5-D03 forbids) | 4 red | both lane cases, both inert cases |
| M3 | the sequencer bound to a runtime-scoped "first handoff" instead of each run's own | 2 red | **both F10 cases** |
| M4 | the sequencer signs with a different device key | 1 red | bound-to-runtime |
| M5 | the sequencer composed for the desktop lane only | 3 red | the three container-lane cases |

**5 of 5 killed, and P1 observed.** M1 is the control the brief asks for: removing the composition
turns the new tests red. M2 shows that the inert cases are not vacuous. Their non-vacuity
precondition (the sequencer is composed) plus the zero-call assertion goes red as soon as anything
would drive the sequencer.

## 4. Multi-tenant (F10)

Two runs, from Organizations A and B, go through **one** composed runtime and its supervisor at the
same time. The case runs on both lanes. The only thing added to the composition is a test producer.
It enters through the `makeSupervisor` seam, because production has no producer yet. The sequencer
that runs is the composed one, wrapped only to count its calls. On the container lane,
`materializeRunSecrets` is also the composed one, and each run redeems its own capability through
it. Both windows are held until both runs arrive, so any runtime-scoped binding would cross the two
Organizations.
- **Sandbox binding.** Each run's `digestArtifact` and `exportArtifact` reach only its own sandbox.
- **Object keys.** Each grant's `expectedObjectKey` starts with its own
  `expectedAttemptObjectPrefix({organizationId, jobId, attempt})`. The same-tenant positive control
  is A's key under A's prefix. The cross-tenant check is that neither key starts with the other
  Organization's prefix.
- **Commits.** Each commit's manifest carries its own `organizationId` and its own key, matched by
  `leaseId`.
- **Container lane.** Each per-run driver is built over a capability whose `ownedLabels.leaseId` is
  that run's own lease.
- **Terminals.** Both terminals are `succeeded` with exit 0. Export is evidence, not the verdict
  (E5-D07 (b)).
- **Mutant.** M3, which binds to the first handoff, turns both lanes red.

## 5. What this ticket does NOT claim (E5-D03)

- **No byte moves because of this ticket.** Nothing in production produces `ArtifactExportRequest[]`,
  and no run opens an export window. Composing the sequencer is necessary for link 3, but it is not
  enough.
- **`capabilityProven` does not move.**
- **`E5-2` is not promoted.** This is weaker than `E7-1-staged-input-write`: that resolver runs on
  every run and returns `[]`, while this sequencer runs on none.

## 6. Findings and plan deltas

1. **The wiring guard will not force `CLI-012`'s promotion.** The plan's original Outcome relied on
   the checker ("it fires `unwired_but_now_has_caller` the moment a caller appears"). That is
   measured true for **this** composition (P1). It will **not** be true for `CLI-012`. Composing a
   producer adds no reference to `createArtifactExportSequencer`, so the count stays at 1 and the
   guard stays green while `E5-2` stays `unwired`. `CLI-012` has to flip the entry deliberately. The
   register's new amendment says so, so that `CLI-012`'s author sees it next to the entry.
2. **The dependency gate.** The plan's 3d task says "Depends on: `DAT-009-3c` `complete` at a
   recorded reviewed revision". At the start SHA, `tickets/DAT-009-3c-result.md` is at `gate_review`,
   and its reviewer section is empty. 3c's code is merged (#549), and the planning session assigned
   3d on that basis. This result records the gap and does not act on it.

## 7. CI

*(Filled in after the PR's CI run; see the PR.)*

## 8. Reviewer section

*(Distinct reviewer only.)*
