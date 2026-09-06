# W7U1 — the output probe pack: operator runbook

**Status:** built, CI-green, **never fired**. Firing it is an operator action.
**Written:** 2026-09-06, against `31d33a3b0`.
**Read this instead of the source.** Everything you need to run the pack and read its answer is here.

---

## 1. What this measures, in one paragraph

A 26-agent decision wave concluded: **build no output mechanism, measure first.** The unresolved
question underneath every proposed mechanism is whether a real coding agent, invoked the way AoA's
distributed path actually invokes it, can write a file inside the sandbox **at all**. This pack
answers that with one keyed E2B run, plus two cheaper questions worth answering in the same run. It
**builds nothing**, **changes no gate, counter or register**, and touches no database. It creates
short-TTL sandboxes, writes and reads files inside them, prints a verdict, and tears them down.

---

## 2. The trigger command

```bash
gh workflow run keyed-e2b-w7u1-output-probe.yml --ref docs/replatform-program
```

If that answers `HTTP 404: workflow ... not found on the default branch` — which happens to a lane
GitHub has not yet indexed, measured on `keyed-e2b-egress-constraint-probe.yml` on 2026-09-04 — use
the push route instead. It always works:

```bash
git switch docs/replatform-program && git pull
echo "W7U1 probe pack run #1 (2026-09-XX): why you are firing it" >> .github/keyed-e2b-w7u1-output-probe-trigger
git add .github/keyed-e2b-w7u1-output-probe-trigger
git commit -m "chore(w7u1): fire the output probe pack"
git push
```

`.github/keyed-e2b-w7u1-output-probe-trigger` is the **only** path in the workflow's `push` filter,
and the pack's PR deliberately does **not** create it. So merging the pack fires nothing, and editing
the pack's own source later fires nothing either.

> ★ **Why this lane does not re-fire on a source change, when its siblings do.**
> `keyed-e2b-unit-d.yml` lists the module under test in `paths` on purpose, so an edit to the emitted
> shape cannot quietly return it to argued-not-observed. That is right for a lane that costs only
> sandbox seconds. This one spends **model tokens against an authorisation a person gave**, so an
> automatic re-fire would consume an authorisation nobody granted.

**Optional input.** `e2b_template` selects a different E2B template alias; empty means bare `base`.
Use it if the run reports `template-has-no-node-runtime` (§6).

---

## 3. The secrets it needs

| Secret | Status today | What it gates |
|---|---|---|
| `E2B_API_KEY` | **exists** as a repo secret | everything. Without it the whole pack **skips** and the workflow's positive-control step fails the job with a message saying so. |
| `OPENAI_API_KEY` | **exists** as a repo secret | probe A's **codex** arm. Runs with no operator action. |
| `ANTHROPIC_API_KEY` | **does NOT exist** (`gh secret list`, 2026-09-06) | probe A's **claude** arm. Without it that arm reports `inconclusive-because-no-model-provider-key` and, because an inconclusive probe reds the lane, **the job will fail** — see §5. |

**Decide before you fire:** if you want the claude arm (and you probably do — `claude_local` is the
adapter the distributed path is being built for), add `ANTHROPIC_API_KEY` as a repository secret
first. Otherwise expect a red job whose summary reads `A/claude_local: INCONCLUSIVE —
no-model-provider-key`, which is an honest report of a question not reached, not a bug.

No key is written into the repository, printed, or embedded in a fixture. The keys reach the sandbox
as **per-command environment variables** (never as argv elements, never staged into a file), and
every string the pack prints is passed through its own redactor first
(`redactSecrets`, unit-tested in the required `policy` job).

---

## 4. What it costs

| | |
|---|---|
| Sandboxes created | **4** — one for probe B, one for probe C, one per probe-A adapter arm |
| Sandbox TTL (hard ceiling per sandbox) | 300 s for probes B and C; **1,800 s** for each probe-A sandbox. Sized per sandbox on purpose: probe A must outlive `install (420 s) + 3 agent arms (180 s each)` = 960 s of in-sandbox work, and a shared 900 s TTL would have expired the sandbox mid-run and reported the expiry as the agent's answer. |
| Expected sandbox wall time | **~7–23 minutes total** (~400–1,400 sandbox-seconds). Most of it is `npm install -g` of the agent CLI, twice. |
| Absolute worst case if everything stalls | 2 × 300 s + 2 × 1,800 s = 4,200 sandbox-seconds, and only if every teardown also fails — every sandbox is torn down in a `finally`. |
| Model tokens | **6 agent invocations** (3 arms × 2 adapters), each a ~60-word prompt asking for a one-line file. Well under a dollar. |
| Job timeout | 60 minutes (the in-test budget is 50, so a kill names this job rather than an innocent step) |
| Per-agent-arm timeout | **180 s.** A permission-gate stall must time out and be *recorded as a stall*, not run to the job cap. |

---

## 5. How to read the result

Open the run and read the **job summary** — the pack appends its whole report there. The same text
is in the "Run the W7U1 output probe pack" step's log.

Every probe reports one of three states. **`no` is a result and the lane stays GREEN for it.**
`inconclusive` is the only state that reds, because it is the only one that means *run me again*.

> ★★★ **Why that asymmetry is the point of the unit.** If the only green outcome were "the agent
> wrote a file", then "the agent cannot write" would arrive as a red build — indistinguishable from a
> bad key, a template change or an outage — and the one authorised run would have bought an ambiguity
> instead of an answer. A probe that can only pass is worthless.

> ### ⚠ ILLUSTRATIVE FORMAT ONLY — the pack has never been fired and these verdicts are invented
>
> **No W7U1 run exists.** The block below shows the SHAPE of the report and nothing else: every
> verdict, reason and disposition is a `<placeholder>`, not a measurement, and none of them should be
> read as a prediction of what the run will say. (An earlier draft of this section printed specific
> values here — including a decisive `NO` for probe A — which an operator could have mistaken for a
> result, and which also contradicted §3's own statement that the claude arm cannot answer until
> `ANTHROPIC_API_KEY` exists.) **When a run happens, replace this block with its real summary and
> name the run id it came from.**

```
================ W7U1 OUTPUT PROBE PACK — RESULT ================
run nonce: W7U1-<...>   template: <template>

Probe A arms:
  A0  HARNESS CONTROL — plain shell writes the file; we read it back
  A1  THE QUESTION — the exact production argv, no permission posture
  A2  THE DIFFERENTIAL — permission posture ADDED inside the probe. The same prompt TEMPLATE as
      A1, differing only in the two lines naming this arm's own target path and nonce
  A3  NEGATIVE CONTROL — a prompt that forbids writing; a file here kills attribution

PROBE B: <STATE> — <reason>
    <detail>
PROBE C: <STATE> — <reason>
    <detail>
PROBE A/claude_local: <STATE> — <reason>
    <detail>
PROBE A/codex_local: <STATE> — <reason>
    <detail>

DISPOSITION: <measured|inconclusive> — <probe>=<state> ...
```

### Probe A — can it write? (the decisive one)

| Verdict | What it means | What to do |
|---|---|---|
| `YES — a1-wrote-under-production-argv` | The **exact production argv, with no permission flag**, produced the requested file. Reading a convention path out of a sandbox is already solved (`transport.readFile`), so an output mechanism anchored on the agent writing a known path is **feasible today**. | Hand this to whoever owns the output question. |
| `NO — ...-and-the-posture-is-the-cause` | A1 (production argv) did not write; A2 (**the same prompt template**, permission flag added) did. A1's and A2's prompts are **not byte-identical**: each names its own target path and its own nonce, on two lines, for the same reason A0 needs its own path — a file one arm left behind must never read back as another arm's success. That separation is the arms' identity, not a second experimental variable, and the permission flag remains the only difference in **how the agent is invoked**. **This is a product finding**, not merely an input to a later ticket: the four script literals at `task-run-sandbox-invocation.ts:181-206` carry no permission posture, and the shipped product's own code says one is required for an unattended run. | File it against the invocation module. An output mechanism is feasible *once the posture is fixed*. |
| `NO — ...-and-the-posture-is-not-the-cause` | Neither A1 nor A2 wrote. The permission flag is **exonerated**; something else prevents the agent writing. A posture-only fix would not have helped. | Do not schedule a posture fix off this. The blocker is elsewhere and unidentified. |
| `NO — ...-cause-unattributed` | A1 did not write and A2 could not be read. The NO is sound; the **cause is not established**. | Fix whatever made A2 unreadable (see its `cause`) and re-run. |
| `INCONCLUSIVE — harness-control-failed` | **A0 failed**: plain shell wrote a file and we could not read it back. The write/read path itself is broken, so A1's empty result attributes to nothing. | The probe is broken, not the product. Nothing may be concluded. |
| `INCONCLUSIVE — negative-control-violated` | **A3 was violated**: we told the agent *not* to write, named the path, and a file carrying A3's nonce appeared anyway. Something other than the agent is writing at the watched path. | Nothing in probe A may be attributed to the agent. This is E7-F020's class one layer down and is itself worth filing. |
| `INCONCLUSIVE — a1-read-faulted` | **The readback itself failed**, for a reason that was *not* a genuine "no such file". The transport raises `E2bTransportNotFoundError` for a missing sandbox-or-path and rethrows everything else, so the probe can tell the two apart — and a fault establishes nothing about whether the agent wrote. A0 does **not** cover this: A0's success is *earlier* than A1's readback, not concurrent with it. | Re-run. Nothing about A1 may be concluded, and in particular the posture is neither convicted nor exonerated. |
| `INCONCLUSIVE — a1-binary-not-runnable` / `cli-install-failed` / `cli-binary-not-on-path` / `template-has-no-node-runtime` | The agent CLI never ran. The experiment **did not happen**. | See §6. |
| `INCONCLUSIVE — no-model-provider-key` | The adapter's key is not a repo secret. | Add it (§3) and re-run. |

★ **`no file`, `hung`, and `exited 127` are three different answers and the pack keeps them apart.**
The `cause` field on each arm says which: `stalled` (no terminal inside 180 s — the shape a
permission gate takes in `--print` mode), `exited-<n>` (a clean terminal and still no file), or
`binary-not-runnable` (the experiment never happened). **And the READ is a fourth channel:**
`read-faulted` means the target path could not be read at all, which is not the same as reading it and
finding nothing — collapsing those two is how an apparatus failure gets printed as a capability
answer. Exit code, stdout, stderr and the read's `errorKind` for every arm are in the step log,
redacted.

> ★ **A3 runs with the permission posture, mirroring A2 rather than A1.** Under A1's conditions a
> stalled agent writes nothing whatever it was asked, so "A3 wrote nothing" would be satisfied by the
> stall and would prove nothing about attribution. Run under the arm most able to write, "asked not
> to, and did not" is a real statement.

### Probe B — is the template already satisfying the convention?

| Verdict | What it means |
|---|---|
| `YES — template-prefills-a-candidate-output-path` | A candidate output path **already exists in a fresh sandbox, before any exec**. Any location-based output convention anchored there is satisfiable **by the template alone, with no agent and no output** — E7-F020's class, with an input no protocol surface can see. The detail line names the paths and their sizes. |
| `NO — template-prefills-nothing` | None of the candidate paths exist. The detail line still carries the **full directory listing**, because "what IS there" is the useful answer, not "is X there". |
| `INCONCLUSIVE — candidate-read-faulted` | At least one candidate path's **read failed** for a reason other than "no such file". Its absence is therefore not established, so `template-prefills-nothing` may not be claimed. Note this gates the **NO only**: a candidate that was read and *found to exist* is an observed positive that an unread neighbour cannot unmake. |
| `INCONCLUSIVE — enumeration-failed` | The directories could not be listed — including a listing command that **timed out**, which produces no directory contents and is not an empty directory. |

The candidate reads use the E2B **files API and no exec at all**, so "before any exec" is literal.
The directory listing that follows is the sandbox's first command and is reported as context.

### Probe C — does the stream handler deliver from real E2B?

`YES` = both markers arrived through `onStdout`/`onStderr` and the command exited 0.

> ★ **A correction the pack carries, because the brief that commissioned it was out of date.** The
> premise handed to this unit was that the only real-E2B run of this case FAILED (stdout empty) and a
> re-fire was queued. **The re-fire happened — three times.** `keyed-e2b-conformance.yml` runs
> `32211821459` (2026-08-19), `32995765059` (2026-08-26) and `33788025048` (2026-09-03) all completed
> `success`, and the last one's log names the case: *"CLI-003/D4 … success: a real command streams
> stdout/stderr chunks and exits 0 … 495ms"*, inside `Tests 19 passed (19)`. The stale line is the
> **status field of `CLI-realE2B-hardening-result.md`**, which still reads *"keyed re-fire queued"*.
> Probe C is kept — one authorised run should answer all three questions and a re-measurement that
> agrees is cheap — but it is a **confirmation**, not an open question.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Job fails at "Fail if the pack SKIPPED" | `E2B_API_KEY` was empty; the whole pack skipped and measured nothing. | Restore the secret. A skip is never a pass. |
| `A/claude_local: INCONCLUSIVE — no-model-provider-key` | `ANTHROPIC_API_KEY` is not a repo secret. | §3. |
| `INCONCLUSIVE — template-has-no-node-runtime` | The bare `base` template has no `node`/`npm`, so the agent CLI cannot be installed. | Re-run with a template that carries a node runtime — but note **the push route cannot select one.** `E2B_TEMPLATE` comes from `inputs.e2b_template`, and a `push` event supplies no inputs, so the push route always runs bare `base`. Either use `gh workflow run keyed-e2b-w7u1-output-probe.yml --ref docs/replatform-program -f e2b_template=<alias>` (only if dispatch does not 404 — §2), or edit the lane's `E2B_TEMPLATE:` line and append to the trigger file **in the same commit**, which fires the push route with the template you chose. |
| `INCONCLUSIVE — cli-install-failed` | `npm install -g` failed (plain **and** under `sudo`; the log carries the last 20 lines). Usually network or a package-name change. | Read the log, then re-run. |
| `INCONCLUSIVE — probe-threw` | The probe itself raised. The redacted error is in the detail line. | This is an apparatus failure; nothing may be concluded from that probe. |
| An arm's cause is `read-faulted` | The **readback** of the arm's target path faulted (a throw that was not `E2bTransportNotFoundError`). Deliberately **not** read as "the file is absent". | Re-run. |
| A probe-B reason is `candidate-read-faulted` | Same fault, on one of probe B's pre-exec candidate reads. | Re-run. |
| An arm's cause is `arm-faulted` | The sandbox or transport faulted mid-arm (a throw that is not a timeout). Deliberately **not** read as "the agent did not write" — that would manufacture a capability answer out of an infrastructure failure. | Re-run. |
| `gh workflow run` answers 404 | The lane has never run, so GitHub has not indexed it for dispatch. | Use the push route in §2. |

---

## 7. What this pack is NOT

- It **does not build an output mechanism.** It measures whether one is possible.
- It **does not modify the production argv.** Probe A2 varies the argv **inside the probe**, by
  rewriting the emitted script string; `task-run-sandbox-invocation.ts` is untouched.
- It **does not flip `capabilityProven`**, arm any rollout dial, write to any register, or change any
  count. Its only writes are files inside sandboxes it creates and destroys.
- It **does not claim anything about the networked/container lane.** Like every other keyed lane here,
  it is E2B/desktop only (E7-F011).

---

## 8. Where the pieces live

| File | Role |
|---|---|
| `packages/sandbox-e2b-provider/src/__tests__/keyed-w7u1-agent-output-probe.test.ts` | the pack: sandboxes, arms, the report. Skips cleanly without `E2B_API_KEY`. |
| `scripts/lib/w7u1-agent-output-probe.mjs` | the pure core: the A2 transform, arm classification, all three verdicts, the redactor. Zero imports; no network, no filesystem. |
| `scripts/lib/__tests__/w7u1-agent-output-probe.test.mjs` | proves every one of those decisions **without a key**, on every PR, in the required `policy` job — and pins W7U1's premise (no permission posture in any of the four production script literals). |
| `.github/workflows/keyed-e2b-w7u1-output-probe.yml` | the lane, plus the positive-control step that refuses to let a skip read as success. |
| `.github/keyed-e2b-w7u1-output-probe-trigger` | **not created by the pack's PR.** Creating/appending it on `docs/replatform-program` is the push route to fire the lane. |
