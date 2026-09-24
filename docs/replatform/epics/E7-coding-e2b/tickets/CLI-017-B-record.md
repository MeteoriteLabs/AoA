# CLI-017-B Record — SD-5's sandbox-scoped secret handoff, its full lifecycle, and the export refusal

**Status:** `gate_review`
**Date (UTC):** `2026-09-24`
**Epic:** `E7-coding-e2b`
**Plan task:** `E7 implementation-plan ### CLI-017 — the EMIT build`, slice **`CLI-017-B`**
**Graph node:** `program-design.md #### CLI-017`
**Implementer:** `M1b CLI-017 build agent (Claude Opus 5)`
**Start SHA:** `9ad5666df6` (program tip at start; rebased onto `6b468773f1` when the base moved)
**Reviewed revision (implementation commit):** `91d56619a7392491bf443837dcc126b938c1a03e`
**Ruling:** `decisions.md` `E7-D11` §3 (ruling F7, under founder delegation F2) — SD-5 is **REQUIRED
before `M1b`'s campaign**, not optional and not deferred
**Acceptance rows carried:** **2, 6, 6b, 7, 8** and the **export half of 5**
**Findings touched:** `E7-F039` (SD-5 arm, outcome (ii)), `E7-F040` (**closed by fixing**),
`E7-F038` (**stays open**, and this slice does not close it)

★★★ **A RECORD, NOT A RESULT.** See `CLI-017-A-record.md` §preamble. The aggregate
`tickets/CLI-017-result.md` is written only after **both** slice records are approved by a distinct
reviewer. **This record does not write it.**

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

---

## 1. What was measured before building

- `E2bSandboxProvider.exportArtifact`'s **first act** is `const scan = this.#scanExportBytes;
  if (typeof scan !== "function") throw new SandboxExportScannerUnavailableError();` — keyed on the
  callback's **presence**, never a flag, never defaulted, **before the file is read**. Shipped by
  `CLI-012`. **It is untouched by this slice.** This slice supplies the callback the interface was
  already demanding.
- `create` forwards `spec.env` to the transport as `envVars` and retains only
  `{sandboxId, resourceLabels}` in `#idempotency` — deliberately, per the `[Cred-1]` comment
  (DEP-012 slices 4+5) and Decision #104. `exportArtifact(sandboxId, path, grant, ctx)` takes **no
  env**. Confirms `E7-D11` §3's correction: **a content check on `exportArtifact` alone cannot
  deliver SD-5.**
- `packages/shared`'s `shouldRedactSecretValue` — the repo's existing classifier — **cannot be
  reused**, and this was verified rather than assumed: `packages/shared/package.json` publishes
  `"exports": {".": "./src/index.ts"}`, i.e. TypeScript **source**, while
  `sandbox-e2b-provider` compiles to `dist` and is loaded at runtime by the adapter-manager through
  a bare dynamic import. Depending on it would put an unbuildable specifier in this package's
  emitted JavaScript. So the classification is this package's own, stated in full in
  `export-secret-scan.ts` rather than claimed to mirror anything.
- The production composition root is `packages/adapter-manager/src/bin/adapter-manager.ts`, which
  constructed the provider with **no** `scanExportBytes` — so every export refused today, which is
  the intended pre-`CLI-017-B` state.

**No port, route, schema or wire change was needed.** `E7-D07` is not touched. The handoff lives
entirely inside the provider, between two of its own operations, exactly as the task requires.

## 2. The design, and its full lifecycle

`E2bSandboxProvider.#runSecrets: Map<sandboxId, {values, timer}>`:

- **POPULATED** at `create`, from `spec.env`, via `classifyRunSecrets` — **values only**, the env
  key names are dropped on the way in (row 7 asks for the set to be absent from every log line and
  thrown message, and a set carrying names would name the tenant's variables even in a dump that
  withheld their values). In process memory only.
- **PURGED** on `destroy` **and** `reconcileCleanup`, both of which route through `#reclaim`. The
  purge is **first and unconditional**, before the terminate: a transport failure below returns a
  reported `failed` (never a throw) and the cleanup authority retries, so a purge placed after
  would hold the credentials in memory for every retry cycle.
- **PURGED INDEPENDENTLY** on a provider-local expiry bound to the **same `ttlMs` the sandbox
  itself was given**. This is row 6b's whole point: `create` installs an E2B TTL and the sandbox can
  end on it with neither cleanup method ever called on this provider instance.
- **ABSENT ⇒ REFUSED** (`SandboxExportSecretSetUnavailableError`), looked up **before the read**.

The scan seam's signature is now `ExportScanInput { bytes, sandboxId, secrets, signal }`.

### The classification rule, stated

A run env entry is secret-classified when its **key** looks sensitive **or** its **value** looks
like a credential, **and** the value is at least `MIN_SCANNED_SECRET_LENGTH = 12` characters.

★ **The length floor is the anti-collision arm and it is load-bearing.** Without it a run whose env
held `LANG=C`, `CI=1` or `TERM=xterm` would refuse **every** export, because those strings appear
inside ordinary prose, field names and digit runs — and a scanner that refuses everything is
indistinguishable from a broken export path. **The stated limit:** a genuinely *short* credential
written verbatim is not caught. Every credential this ruling concerns (`sk-ant-…`, a run JWT, a
presigned URL) is far above the floor.

## 3. RED

The suite was written against the pre-change provider. The first run of
`cli-017-b-export-secret-refusal.test.ts` against a provider with no registry could not even reach
its assertions; the recorded RED that matters is the one the fail-closed arm produced across the
**existing** `CLI-012` suite the moment the row-6 refusal landed:

```
 FAIL  src/__tests__/enumerate-and-bounded-read.test.ts (6 failures)
   → expected SandboxExportSecretSetUnavailableError: a… to be an instance of E2bSymlinkRefusedError
   SandboxExportSecretSetUnavailableError: artifact export refused: no secret set is registered
   for this sandbox (SD-5 fail-closed)
 Tests  6 failed | 191 passed (229)

 FAIL  packages/adapter-manager src/__tests__/bin-adapter-manager.test.ts (3 failures)
 Tests  3 failed | 201 passed (204)
```

Both were **the control working, on harnesses that reached past `provider.create` straight to
`transport.create`** — a state production never reaches, because production's only route to a
sandbox is that method. Both harnesses now create through the provider; the boot stubs now supply
`createRunSecretExportScanner`.

And a **RED this slice's own tests found in its own implementation**, recorded because it is the
most valuable failure here:

```
 FAIL  … > classifyRunSecrets returns DISTINCT VALUES only — never the key names
       AssertionError: expected [ …(2) ] to deeply equal [ Array(1) ]
```

`PATH=/usr/local/bin:/usr/bin` was being classified as a secret. See §6.

## 4. GREEN

```
 packages/sandbox-e2b-provider   Test Files 20 passed | 3 skipped (23)   Tests 225 passed | 32 skipped (257)
 packages/adapter-manager        Test Files 21 passed (21)               Tests 214 passed (214)
 packages/provider-wire          Test Files  8 passed (8)                Tests  98 passed | 1 skipped (99)
 packages/worker-daemon          Test Files 166 passed (166)             Tests 1268 passed | 1 skipped (1269)
```

`cli-017-b-export-secret-refusal.test.ts` alone: **28 passed**. `sandbox-e2b-provider` typecheck:
clean.

## 5. Mutation and positive-control table

Every mutant applied to the **real source**, the two SD-5 suites run
(`cli-017-b-export-secret-refusal.test.ts` + `enumerate-and-bounded-read.test.ts`, 53 tests green
unmutated), then reverted.

| id | mutant | row | observed |
|---|---|---|---|
| **M-B1** | The absent secret set falls through to an unchecked export (`?? { values: [] }`) | **6** | **RED** — `3 failed | 50 passed` |
| **M-B2** | Remove the TTL-bound expiry, keeping only cleanup-path purging | **6b** | **RED** — `1 failed | 52 passed` |
| **M-B3** | Purge by KEY instead of by entry identity in the timer | 6b (defence) | ★ **NOT RED — `0 failed | 53 passed`.** See §7. Recorded, not hidden. |
| **M-B4** | The scan stops comparing (the pre-SD-5 path, in situ) | **2, 5** | **RED** — `8 failed | 45 passed` |
| **M-B5** | A GLOBAL secret set instead of a per-sandbox one | **5 (F10)** | **RED** — `4 failed | 49 passed` |
| **M-B6** | Drop the purge on `destroy`/`reconcileCleanup` | **6** | **RED** — `4 failed | 49 passed` |
| **M-B7** | Remove the length floor from the classification | 2 (over-refusal) | **RED** — `1 failed | 52 passed` |
| **M-B8** | Write the run's env into durable E2B `metadata` | **7** | **RED** — `1 failed | 52 passed`; re-proves `[Cred-1]` and Decision #104 |
| **M-B9** | The scan seam loses the signal (pass `undefined`) | `E7-F040` | **RED** — `2 failed | 51 passed` |

**Row 2's own named mutant is a TEST, not a source mutation** — the row asks for *"a provider
without the check exports it"*, so the suite builds one (`scanner: () => undefined`) and asserts the
credential **does** reach the store. That is the hazard, in the suite, permanently.

**Non-vacuity controls** beside every refusal: the same run's clean bytes export; a run with no
secret-classified env exports freely; the row-6 refusal has a positive control that the *same*
sandbox exports once created through this provider; row 6b asserts the entry is present before the
clock moves and gone after; row 7 asserts the values really were registered
(`registeredSecretSetCount() === 1`) before asserting they appear nowhere.

## 6. The class sweep (build-rules §E)

**Class 1 — *"a secret-key fragment short enough to appear inside an unrelated env name"***.
Found by this slice's own test, not by review. A first draft matched `pat` as a bare substring,
which classifies **`PATH`** — present in every sandbox, comfortably over the length floor, and
present in any deliverable that prints a shell line. The scanner would have refused a large share of
perfectly clean exports **while looking like a working control**. Enumerated over the whole fragment
list: `pat`, `dsn`, `jwt` are the three at or below three characters; the other twelve (`key`,
`token`, `secret`, `password`, `passwd`, `auth`, `cookie`, `credential`, `bearer`, `signing`,
`webhook`, `private`, `session`, `connection`) are four or more with no common env-name host.
**Checked 15, found 3, fixed 3** — all token-anchored to `_`/start/end — each with both a
negative arm (`PATH`, `COMPATIBILITY_MODE`, `JWTISON`, `DSNAKE` → not classified) and a positive
arm (`GITHUB_PAT`, `PAT`, `SENTRY_DSN_PROD`, `JWT` → classified), so the fix did not turn the
fragments off. Mutant **M-B7** covers the floor itself.

**Class 2 — *"a bounded operation that returns at its deadline without aborting the underlying
work"*** (`E7-F040`'s class). Search: `grep -n "boundedBySignal(" packages/sandbox-e2b-provider/src/e2b-provider.ts`
→ **5 sites**. `CLI-012` fixed three (`readFile`, `listDir`, `statEntry`); the upload already
threads `signal` into `performUploadGrant(grant, bytes, signal)`; the fifth is the SD-5 scan, fixed
here. **Checked 5, found 1 open, fixed 1, 0 remaining in this provider.**

**Class 3 — *"a test harness that reaches past `provider.create` straight to `transport.create`,
leaving provider-held state unpopulated"***. Search:
`grep -rn "transport.create({" --include=*.ts packages server | grep -v node_modules`
→ **13 sites**. Of those, the ones that go on to call `exportArtifact` are the ones that break:
**2 in `enumerate-and-bounded-read.test.ts`** (both fixed to create through the provider) and **1
deliberate** — this slice's own row-6 arm, which *models* the restart state on purpose and says so.
The rest (`keyed-real-e2b`, `list-dir-files-only`, `staging-fs`, `streaming`,
`svc-008a-t8-process-conformance`) never export, so an unregistered set cannot reach them; verified
by `grep -c "exportArtifact"`. **Checked 13, found 3 affected, fixed 2, 1 deliberate.**

**A fourth site found by the same sweep and fixed:**
`packages/sandbox-e2b-provider/src/__tests__/keyed-dat-009-artifact-export.test.ts` constructed its
provider with **no `scanExportBytes` at all**, so that keyed lane would have refused **every**
export. Nothing caught it because the lane is `describe.skip`ped without a key. It now wires the
real scanner.

## 7. M-B3 — the mutant that does NOT red, and why that is recorded rather than papered over

The timer is identity-guarded: it purges only if the entry it still holds is the one it was created
for. Mutating that to a bare `delete(sandboxId)` leaves **every test green**. The reason is
structural: `#registerRunSecrets`' first statement is `#purgeRunSecrets`, which `clearTimeout`s the
predecessor before the successor is installed, so a stale timer for a live same-key entry **cannot
exist**. The guard is therefore **redundant defence against a future reordering**, not a proven
control, and it is labelled that way in the source. It is kept rather than deleted because if anyone
ever registers before purging, the guard is what stops a late timer deleting a **live** successor's
set — and a live sandbox whose set has silently vanished refuses every export (row 6), which is a
self-inflicted outage that looks exactly like the security control working.

## 8. `E7-F039` — the canary-swap arm, and its result

`E7-F039` names exactly two acceptable outcomes for a symlink swap between the `lstat` check and
the read: **(i)** the `lstat` recheck refuses it, or **(ii)** it exports and **SD-5's scan refuses
the bytes**. Outcome (i) is `CLI-012`'s and is pinned in `enumerate-and-bounded-read.test.ts`.
Outcome (ii) is this slice's.

**Result: the arm holds, and the FAIL condition never fires.**

- `CLI-012`'s own arm — *"a file SWAPPED for a symlink to the canary puts NOTHING in the store"* —
  is **green at the reviewed revision**, with its `store.puts` assertion still **before** the error
  kind, and with its positive control (*"an UNswapped file really does reach the store"*) green
  beside it. This slice's harness change (create through the provider) did not weaken either.
- This slice adds outcome (ii) in `cli-017-b-export-secret-refusal.test.ts`: the **bytes a won race
  would deliver** — `/proc/self/environ` content and the run's own staged prompt, each carrying the
  run's secrets — are refused, with **`expect(store.puts).toEqual([])` asserted BEFORE any
  error-kind check**, exactly as `E7-D11` requires. A positive control asserts a swap to a
  **secret-free** target still exports, so "everything refuses" cannot masquerade as the property.

★ **Stated honestly:** on this fixture the transport refuses a symlink outright, so a swap can never
physically reach the scan — outcome (i) holds absolutely here. What the new arms prove is that
**SD-5 would catch it if outcome (i) ever regressed**, which is the bound the finding's severity
argument rests on. **A swap producing a stored artifact containing the planted canary is a FAIL, and
no arm in this suite produced one.** The **keyed real-run swap attempt is still owed** (§10).

## 9. `E7-F040` — disposition: **FIXED, not deferred**

The finding recorded that the scan seam was the one `boundedBySignal` site whose callback took no
abort signal, that the harm class did not yet apply because the scanner is in-process, and that
*"the signature belongs to the ticket that supplies the implementation"*. That ticket is this one,
and the decision is to **take the signal**:

- `ExportScanInput` carries `signal: AbortSignal`, threaded from the op's own
  `AbortSignal.timeout(ctx.deadlineMs)`.
- Proven with the **abort-fired** shape the three fixed sites use, not a timing-only test: the
  scanner asserts it **received** a non-`undefined` `AbortSignal` **and** that it **fired**
  (`expect(received).toBeInstanceOf(AbortSignal); expect(fired).toBe(true)`), with nothing stored.
- Plus the **in-deadline unaborted twin**: a scan that finishes inside the budget sees
  `signal.aborted === false` and the bytes export. Without it the first arm would pass for a seam
  that handed over an already-aborted signal.
- Mutant **M-B9** (pass `undefined`) reds.

Cost: one field. It removes the class from this surface permanently, so a future scanner doing
remote or streaming work inherits cancellation instead of re-filing the finding.
**Recommendation to the reviewer: `E7-F040` may be closed as `resolved` by `CLI-017-B`.** This
record does not flip it; the finding's status is the reviewer's to move.

## 10. `E7-F038` — NOT closed, and row 8 says so in the suite

SD-5 is a **literal-value** refusal. Acceptance row 8 is carried as **characterisation** tests
asserting the current **pass-through**: a base64-encoded canary exports; a hex-encoded one exports;
a reversed one exports; and a canary **split across two files** exports both, with a closing
assertion that the reassembled store now holds the whole credential while no single PUT ever carried
it. Each arm says in terms that a future boundary design must **flip** it to a refusal, and that a
build which quietly makes it pass as a refusal without a ruling has improvised a boundary.
**`E7-F038` stays MEDIUM, open, `unowned`. It is not closed by this slice shipping.**

## 11. What awaits a keyed run

★★★ **This slice dispatched NO keyed workflow** (ruling F8). Not proven here:

- **The joint real-run case with `CLI-012`** — a distributed run whose agent writes under `R`, one
  `committed` `job_artifacts` row for that file, and **the SD-5 refusal exercised on a planted
  canary in the same lane**. Until it runs, `CLI-017-B` is proven against the mock transport and a
  fixture sandbox, **not** against real E2B.
- **`E7-F039`'s deliberate symlink-swap attempt on a real sandbox.** The finding is explicit that it
  must be *"run and recorded, never reasoned about"*. This record reasons about the byte-level
  property and measures it on a fixture; **it does not claim the real-run attempt**.
- **The `A-neg` + `S-P0` template precondition** — an operator precondition, not code.

## 11a. Codex round 1 (PR #592, P2) — the refusal's CLASSIFICATION was erased on the wire

**The finding, verified at source before fixing.** `E7-D11` §3 requires the SD-5 refusal to be
**classified**, and `E5-D07` makes it per-file and best-effort outward — which is only actionable if
the worker can tell *"this file carried a secret"* from *"the adapter-manager could not reach the
store"*. In production the export runs through the adapter-manager, whose error boundary passes
through only errors `isModelledWireError` (`packages/provider-wire/src/codec.ts`) recognises and
otherwise substitutes a fixed generic `WireProtocolError`. **None of the three export refusals were
in that vocabulary**, and `classifyOpFailure`
(`packages/adapter-manager/src/op-failure-classification.ts`) knew neither `export_artifact` nor any
of the refusal classes — so every secret refusal arrived as `op=other class=other
cause=unclassified`. **A classification that is erased before anyone reads it is not a
classification**, and this record would otherwise have claimed one that production never sees.

**The class:** *a fixed-vocabulary domain refusal modelled in the provider but not in the wire
codec, so it degrades to `WireProtocolError` on the hop.* **Swept, not spot-fixed:** Codex named
`SandboxExportSecretSetUnavailableError` and noted the same erasure for
`SandboxExportScannerRefusedError`; `SandboxExportScannerUnavailableError` is the third member and
was equally erased, so **all three** are modelled, in **both** directions (`serializeError` **and**
`reconstructError` — missing either half re-opens the erasure on one side only). On the classifier
side, `digest_artifact` was equally unknown and reads the sandbox through the same
`#readArtifactBytes`, so **both** artifact ops were added rather than only the one named.

All three messages are fixed by their class and carry no discriminant, so nothing tenant-derived
crosses; the causes are derived from the **class name**, never from message text, because these
messages are vocabulary the wire is free to change.

| id | mutant | observed |
|---|---|---|
| **M-B10** | Drop the three from `isModelledWireError` | **RED** — `3 failed | 95 passed` |
| **M-B11** | Drop the three `reconstructError` cases | **RED** — `3 failed | 95 passed` |
| **M-B12** | Drop the classifier's refusal-cause derivation | **RED** — `4 failed | 210 passed` |

Covered in **three** places, because the codec alone would be the "tested the provider directly"
gap Codex named (★ but see **§11b** — the classifier arms are reachable only by a DIRECT caller, not
on the production path, and that is an OPEN round-2 finding, not a claim this section makes good): `provider-wire`'s `cli-017-b-export-refusal-wire.test.ts` (both directions, plus a
positive control that an **unmodelled** error still degrades, so the predicate is not "always
true"); `op-failure-classification.test.ts` (each cause, the refusal winning over an incidental
code beneath it, a genuine `fetch_failed` on the **same** op still distinguishable, and an unknown
op still `other`); and **`server-artifact-export.test.ts`, which drives the refusal over the real
`NetworkedProviderDriver` → HTTP → adapter-manager → provider path** and asserts the class survives
the hop with nothing uploaded, beside a clean-scanner positive control.

**One further pin moved, caught by CI rather than by review.**
`server/src/__tests__/cli-006-seam-suppression.test.ts` asserts the canary seam's source window
contains `context.currentTaskMarkdown`; SD-1b nests that inside
`applySandboxOutputRootDirective`, pushing it past the pin's 8-line slice. The window is widened to
40 lines; **the pin's claim is unchanged** and the directive itself is pinned exactly and separately
by PC-12. The `heartbeat.ts` source-pin class was then swept:
`grep -rln "readFileSync.*heartbeat\|HEARTBEAT_SRC" server/src/__tests__/` → 4 files, of which one
(`cli-006-seam-suppression`) was affected and is fixed; the other three do not window the
`buildTaskRunBatchWorkload` call and are green unedited.

## 11b. Codex round 2 (PR #592, P2) — OPEN, verified, and NOT fixed: the two-round cap

★★★ **THIS RECORD'S §11a OVERCLAIMED, AND THE CORRECTION IS HERE RATHER THAN QUIETLY IN THE PROSE
ABOVE.** §11a says the classifier covers the refusal causes on the production path. **It does not.**
Codex's round-2 finding is **real in both halves**, verified at source at `e610a5a72` before writing
this:

1. **The round-1 classifier branches are DEAD on the production path — and my own round-1 fix is
   what killed them.** `packages/adapter-manager/src/server.ts` reads
   `if (isModelledWireError(err)) { sendJson(res, 200, encodeErrResponse(err)); return; }` and only
   then calls `classifyOpFailure(op, err)`. Round 1 added all three refusals to
   `isModelledWireError`, so the early return now fires for exactly the errors whose new cause
   branches were added. They are reachable only by a direct caller — which is how the new
   `op-failure-classification.test.ts` arms reach them. **That is this programme's
   `check-that-nothing-runs` class, produced by a fix for a different instance of the same class.**
2. **The surviving class is flattened one layer up.** `packages/worker-daemon/src/lease/artifact-export.ts`
   fails an export with `fail("export", error instanceof Error ? error.name : "export failed",
   "export_failed")` — the class name lands in `detail`, while the per-file **`reason` code** is the
   hard-coded `export_failed` for every export error. So a file refused for carrying a credential and
   a file refused because the store was unreachable still record the **same** reason on the
   sequencer's per-file result, which is the surface `E5-D07`'s per-file policy is read from.

**It is NOT fixed, and that is a rule, not a judgement.** `M1-BUILD-RULES.md` §C caps a PR at **two
Codex rounds**: *"After two rounds on a PR, STOP and report — do not attempt a third fix … A ticket
is not the place to converge on a property that keeps regenerating."* This is round 2. The finding
goes to the planning session to rule on: fix it, file it as a finding, or descope.

**The proposed fix, for whoever rules on it** — recorded so the ruling has something concrete:

- **`artifact-export.ts`:** map the three refusal class names to distinct reason codes
  (`export_secret_refused`, `export_secret_set_unavailable`, `export_scanner_unavailable`) at the
  `fail("export", …)` site, instead of the blanket `export_failed`. The reason vocabulary is already
  closed by `exportReasonCode`, so this is additive inside it and leaks nothing: the names are fixed
  class vocabulary.
- **`server.ts`:** call `onOpFailure(classifyOpFailure(op, err))` **before** the
  `isModelledWireError` early return, so the adapter-manager's own operator log keeps a cause for
  **every** failure including the modelled ones. That makes the round-1 branches genuinely reachable
  and closes the dead-branch half **at its cause** rather than by deleting the branches.
- The alternative — deleting the round-1 classifier branches — is worse: it would leave the AM's
  operator log with no cause at all for the one class of failure an operator most needs to
  distinguish.

**What round 1 DID deliver, and still stands:** the refusal's **class** now survives the
adapter-manager hop intact, proven over the real `NetworkedProviderDriver` → HTTP → adapter-manager →
provider path with nothing uploaded (`server-artifact-export.test.ts`), and both codec directions are
pinned with mutants M-B10/M-B11. A consumer that reads `err.name` — which is the shape the DEP-008
conformance suite and the duck-typed callers use — gets the real classification today. What remains
open is the **sequencer's per-file `reason` code** and the **AM's operator log** for these classes.

## 12. Files

| file | change |
|---|---|
| `packages/sandbox-e2b-provider/src/export-secret-scan.ts` | **new** — classification, `ExportScanInput`, `createRunSecretExportScanner` |
| `packages/sandbox-e2b-provider/src/e2b-provider.ts` | `#runSecrets` + lifecycle; row-6 refusal before the read; the scan input |
| `packages/sandbox-e2b-provider/src/errors.ts` | **new** `SandboxExportSecretSetUnavailableError` |
| `packages/sandbox-e2b-provider/src/index.ts` | barrel exports for the scanner and the error |
| `packages/sandbox-e2b-provider/src/__tests__/cli-017-b-export-secret-refusal.test.ts` | **new** — 28 tests |
| `packages/sandbox-e2b-provider/src/__tests__/enumerate-and-bounded-read.test.ts` | harnesses create through the provider; scanner signature migrated |
| `packages/sandbox-e2b-provider/src/__tests__/keyed-dat-009-artifact-export.test.ts` | the keyed lane now wires the real scanner |
| `packages/adapter-manager/src/bin/adapter-manager.ts` | wires the scanner; **refuses** the boot when the module does not export it |
| `packages/adapter-manager/src/__tests__/bin-adapter-manager.test.ts` | the stubs, plus a new arm proving the boot refusal |
| `packages/provider-wire/src/codec.ts` | the three refusals modelled in `isModelledWireError`, `serializeError`, `reconstructError` (round 1) |
| `packages/provider-wire/src/__tests__/cli-017-b-export-refusal-wire.test.ts` | **new** — the wire round-trip, both directions |
| `packages/adapter-manager/src/op-failure-classification.ts` | `export_artifact` + `digest_artifact` as known ops; the three refusal classes; three new causes derived from the class name |
| `packages/adapter-manager/src/__tests__/op-failure-classification.test.ts` | the classifier arms |
| `packages/adapter-manager/src/__tests__/server-artifact-export.test.ts` | an injectable scanner + the refusal driven over the real transport path |
| `server/src/__tests__/cli-006-seam-suppression.test.ts` | the moved source-pin window widened 8 -> 40 lines; its claim unchanged |
| `scripts/test-inventory.json` | pins bumped for the new test files |
| `docs/architecture/distributed-execution-threat-controls.json` | `e2b-provider.ts` citation re-pointed by symbol; census stays **397** |

## 13. CI

Recorded by the reviewer against the PR head. Local, at the reviewed revision: the four package
suites in §4 (**1805 executed, 0 failed**), and the full pure-node guard set plus
`check-evidence-immutability --base origin/docs/replatform-program` at **0 failures**.

---

## Review

*(to be completed by a distinct reviewer — the implementer may not set `complete`)*

**Reviewer:**
**Date (UTC):**
**Decision:**
