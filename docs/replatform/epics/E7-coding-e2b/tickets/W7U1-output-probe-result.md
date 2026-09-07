# W7U1 — the output probe pack: RESULT

**Run:** [`34087197668`](https://github.com/MeteoriteLabs/AoA/actions/runs/34087197668)
(`.github/workflows/keyed-e2b-w7u1-output-probe.yml`) · **conclusion `success`** ·
started 2026-09-07T05:32:21Z · commit `1c447fa8a` · template **`aoa-base`** (`default-cli-bearing`)
· run nonce `W7U1-MTQT1763-OJ2WYK7K` · artefact **`w7u1-output-probe-record`**
(schema `aoa.w7u1.output-probe-record/1`, 90-day retention).

**Disposition: `measured`, exit 0.** `B=no  C=yes  A/claude_local=no  A/codex_local=no`.

> This document exists because the artefact does not outlive the record. E7-F025 measured what a
> job-log-only verdict costs — the sibling keyed lane fired twice and no document records either
> outcome — and the runbook's own instruction is *"After the run: copy the record into a `-result.md`
> next to this file, naming the run id."* Everything below was read from that run's own step log and
> durable record, not from the pack's summary line.

---

## 1. The headline, in one line each

| probe | verdict | what it establishes |
|---|---|---|
| **A / `claude_local`** | `no` — `a1-did-not-write-and-the-posture-is-the-cause` | **A sandboxed `claude` CAN write a file. The absent permission posture is why the production argv does not.** A single-variable differential. → **E7-F021** upgraded from missing-measurement to measured product defect. |
| **A / `codex_local`** | `no` — `a1-did-not-write-and-the-posture-is-not-the-cause` | Neither arm wrote, **but the reason string is not supported by the run's own stderr** — see §4 and §5. Two distinct blockers were captured, and neither is the claude posture. → **E7-F027**, **E7-F028**. |
| **B** | `no` — `template-prefills-nothing` | None of the 7 candidate output paths exists in a fresh `aoa-base` sandbox. A location-based convention would not be pre-satisfied by the image. |
| **C** | `yes` — `both-streams-delivered` | `onStdout` **and** `onStderr` each received their marker from real E2B and the command exited 0. Confirms, rather than opens, the E7-F025 question. |

---

## 2. Probe A / `claude_local` — the decisive arm, verbatim

Sandbox `ij2e209cz8ijkzgrzxqeb`, template `aoa-base`. Runtime `node=v22.23.2 npm=10.9.8`,
install `INSTALL_PLAIN`, binary `/usr/local/bin/claude`.

| arm | posture | exit | file | the CLI's own `permissionMode` |
|---|---|---|---|---|
| **A0** harness control (plain shell) | — | `0` | **written** | — |
| **A1** the exact production argv (`task-run-sandbox-invocation.ts:184`) | **absent** | **`0`** | **NOT written** (`readErrorKind=not-found`) | `"permissionMode":"default"` |
| **A2** same prompt template, `--dangerously-skip-permissions` added **inside the probe** | added | `0` | **written** | `"permissionMode":"bypassPermissions"` |
| **A3** negative control — a prompt forbidding the write | added | `0` | **NOT written** | `"bypassPermissions"` |

★★★ **Three independent things make this a differential and not a coincidence.**

1. **A0 held.** Plain shell wrote the same shape of file at the same shape of path in the same
   directory and it read back. The write+read path is proven, so A1's empty result attributes to A1.
2. **A3 held, under the posture.** With the flag ON, the agent wrote when asked (A2) and did **not**
   write when told not to (A3). So A2's file is attributable to the agent obeying the prompt, not to
   something else writing at the watched path (E7-F020's class).
3. ★ **The CLI self-reported the variable.** A1's `init` event carries
   `"permissionMode":"default"`; A2's and A3's carry `"permissionMode":"bypassPermissions"`. That is
   the *binary's own* confirmation that the one thing the probe varied actually took effect —
   independent of `withPermissionPosture`'s string rewrite, which is the only thing the probe
   controls. A no-op rewrite (this programme's [[checks-that-nothing-runs]] class) would have shown
   `default` on both arms.

**A1 exited 0.** That is the shape the finding predicted and the shape the shipped product has a
UAT record for: `resolve-crew-adapter.ts:145-153` describes a `--print` crew run without the flag as
one that *"silently no-op[s] on every MCP tool call (permission gate hangs)"*. Here the distributed
argv reproduced the same silence — a green terminal, exit 0, no work — with no MCP config involved
at all.

---

## 3. Probes B and C

**B — `no / template-prefills-nothing`.** The pre-exec candidate reads use the E2B files API with no
exec at all, so "before any exec" is literal. None of the 7 candidate paths existed. The listing the
record carries, verbatim:

```
/home/user/.bash_logout /home/user/.bashrc /home/user/.profile
/home/user/aoa-workspace  -> ls: cannot access '/home/user/aoa-workspace': No such file or directory
/home/user/.aoa           -> ls: cannot access '/home/user/.aoa': No such file or directory
```

Neither `STAGED_INPUT_DIR`'s parent nor `~/.aoa` exists in a fresh `aoa-base` sandbox. A location
convention anchored at either would not have been silently pre-satisfied by the image.

**C — `yes / both-streams-delivered`.** Both markers arrived through the handlers and the command
exited 0.

---

## 4. Probe A / `codex_local` — TWO blockers, both captured, neither the claude posture

Sandbox `i72skshv1vzdyk86rtigx`, template `aoa-base`. Runtime identical, install `INSTALL_PLAIN`,
binary `/usr/local/bin/codex`.

| arm | posture | exit | file | what the run captured |
|---|---|---|---|---|
| **A0** | — | `0` | **written** | harness control held on this sandbox too |
| **A1** production argv (`:204`) | absent | **`1`** | not written | `stdout=""`, `stderr="Not inside a trusted directory and --skip-git-repo-check was not specified."` |
| **A2** `--dangerously-bypass-approvals-and-sandbox` added | added | **`1`** | not written | got PAST the trusted-directory refusal — `{"type":"thread.started"}`, `{"type":"turn.started"}` — then `Reconnecting… 2/5 … 5/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: wss://api.openai.com/v1/responses)`; stderr `ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 401 Unauthorized` |
| **A3** | added | `1` | not written | the same 401 shape |

★★★ **The brief handed to the recording unit said the codex cause was UNKNOWN. It is not.** The run
captured both blockers in its own stderr, and they are at **different layers**:

- **Blocker 1 — a codex startup gate, hit by the PRODUCTION argv.** `codex exec` refuses to run at
  all in a directory it does not consider trusted unless `--skip-git-repo-check` is passed. The
  sandbox's cwd (`/home/user`) is not a git repository. **A1 never reached a model.** This is a
  product-shaped defect in the `:203`/`:204` literals and is filed as **E7-F027**.
- **Blocker 2 — credential delivery, hit only by A2/A3.** With the bypass flag on, codex got past
  blocker 1 and then failed to authenticate: five reconnects, all `401`, with the server saying the
  bearer header was **missing** rather than wrong. The pack delivered `OPENAI_API_KEY` as a
  per-command env var (`envVars: { OPENAI_API_KEY: key }`) and the key was non-empty — an empty one
  returns `inconclusive / no-model-provider-key` before any sandbox is created, which did not
  happen. So **A2 never reached a model either.**

**Consequence, and it is the important one: codex's ability to write under the production argv is
still UNMEASURED.** Both arms failed upstream of the capability question. The pack nevertheless
reported `the-posture-is-not-the-cause`, which is contradicted by its own log — the posture removed
A1's actual blocker. That classifier gap is filed as **E7-F028**.

---

## 5. What this run does NOT establish

Each is a limit of the run, not a hedge on the claude verdict.

1. **Nobody has run the PRODUCT with the posture added.** A2 varied the argv **inside the probe**
   (`withPermissionPosture`, `scripts/lib/w7u1-agent-output-probe.mjs`);
   `task-run-sandbox-invocation.ts` was not touched and is unchanged at this tip. Adding a
   permission flag to a shipped path is a security-posture change to the argv of an agent running
   with a redeemed Company provider key, not a typo fix. **The differential names the cause; it does
   not pre-approve the remedy.**
2. **Only the NO-BUNDLE literals were exercised.** The pack passes `instructions: null`, so it
   measured `:184` (claude) and `:204` (codex). The **instructions-bundle** branches `:183` and
   `:203` were not run. `:203` in particular has a different failure surface — it pipes through
   `cat`, so its exit status is the pipeline's last command's.
3. **One template, one tier, one image.** `aoa-base` at this account. Nothing is claimed about the
   bare `base` image (E7-F022), the networked/container lane (E7-F011), or any other E2B tier.
4. **codex is unmeasured on the capability question** (§4), so "a sandboxed agent can write" is
   established for `claude_local` only.
5. **It flips no gate and no counter.** The pack builds no output mechanism, mutates no register,
   and touches no database; its only writes are files inside sandboxes it creates and destroys.

---

## 6. An apparatus defect the run itself exposed

The pack's **no-key self-test** (`keyed-w7u1-agent-output-probe.test.ts`, the
`"emitDurableRecord writes a retrievable record…"` case) calls the real `emitDurableRecord` with
fixture verdicts whose details are literally `"d1"` and `"d2"`. `emitDurableRecord` renders the full
human report to three channels; the self-test redirects only `W7U1_RECORD_PATH` (to a temp dir), so
the uploaded artefact is correct. **OBSERVED in this run's step log:** two blocks headed
`================ W7U1 OUTPUT PROBE PACK — RESULT ================`, 7 ms apart
(`05:34:20.5464` and `05:34:20.5531`) — the real one, then a synthetic one ending
`DISPOSITION: inconclusive`, sharing the banner, the template note, the commit sha and the **real run
nonce**. **DERIVED, not observed:** the same block is also appended to `$GITHUB_STEP_SUMMARY`, since
the append is unconditional on that variable and Actions sets it for every step — a job summary's
text is not retrievable through the API, so it was not confirmed after the fact. Filed as
**E7-F029**.

**Read the artefact, not the last report block in the log.**

---

## 7. Findings filed or changed by this result

| finding | change |
|---|---|
| **E7-F021** (HIGH, CLI-008) | **upgraded from missing-measurement to MEASURED product defect**; severity re-argued and held at HIGH. |
| **E7-F027** (NEW) | the codex literals hit a trusted-directory startup gate before any model call. |
| **E7-F028** (NEW) | probe A's classifier collapses "the CLI refused at startup" into "the agent did not write", so the codex verdict states an unsupported cause — in the durable record. |
| **E7-F029** (NEW) | the no-key self-test renders a second, synthetic RESULT report into the same log stream (observed) and, by derivation, the same step summary. |
| **E7-F025** (MEDIUM, unowned) | not closed by this run — it is about the *conformance* lane's unrecorded re-fires — but this document is the shape it asks for. |

**Consumed by:** `CLI-008-unit-f-design.md` §12 — probe (a) has returned, and §12.3's stop condition
is replaced rather than deleted.
