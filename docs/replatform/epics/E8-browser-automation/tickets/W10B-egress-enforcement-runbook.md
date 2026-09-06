# W10B — the DE-08 egress-enforcement probe: operator runbook

**Status:** built, CI-green, **never fired**. Firing it is an operator action.
**Written:** 2026-09-07, against `73f3b00fd`.
**Read this instead of the source.** Everything you need to run the probe and read its answer is here.

---

## 1. What this measures, in one paragraph

DE-08 — *"Sandbox ↔ network egress"*, severity **Critical** — has enforcement at **no layer**. Finding
**E8-F003** (HIGH, open) measured that against real E2B in workflow run `33857218680`, with a positive
control and an apparatus control both holding, and traced the absence to all three candidate points:
the provider seam is inert, the in-sandbox point was never attempted, and the proxy classifier's only
route into production is a module nothing imports. This probe decides whether the **one candidate
layer outside the guest** is real, by measuring the E2B network seam AoA has **never called**. It
**builds nothing**, applies **no policy to any production code path**, changes no gate, counter or
register, spends **no model tokens**, and touches no database. It creates four short-TTL sandboxes,
runs read-only reachability probes inside them, records a verdict **durably** (§6), and tears them
down.

---

## 2. ★ THE STOP CONDITION — read this before you fire

**If question (c) comes back `YES`, the provider-network option is ABANDONED, and that is a
successful measurement.**

Question (c) asks whether the guest's **DNS resolver** is inside the deny set. If a nameserver's
address falls in a denied range, denying that range breaks **all** name resolution in the guest — and
**this API has no repair**:

* `denyOut` carries **no exclude list**. There is no way to say "deny 10.0.0.0/8 except 10.0.0.2".
* Adding an `allowOut` entry to carve the resolver out does not carve anything out: the SDK's own
  documentation says *"If `allowOut` is not specified, all outbound traffic is allowed"*, so
  specifying it flips the **whole** policy to default-deny — the opposite of a carve-out.

So a `yes` on (c) closes the option outright, and the pack **says so itself**: `decideOption` computes
the consequence and prints it as `DECISION: abandon (resolver-or-resolution-is-inside-the-deny-set)`
at the bottom of the report and in the durable record. It does not leave five three-state lines for a
reader to synthesise.

**That outcome keeps the lane GREEN.** It is a complete and valuable result: it retires the last
candidate enforcement layer outside the guest, and DE-08 must then be recorded as having *no available
provider-level control* rather than an unbuilt one. Write that into E8-F003's successor and stop
costing the programme design time on an option that cannot exist.

> ★ **Why (c) is answerable even when (a) says the policy is inert.** The structural half is pure
> arithmetic — is the nameserver's address inside a declared CIDR — and needs no enforcement to be
> true. So the abandon question is answered even by a tier that ignores `denyOut` completely.

---

## 3. The premise this probe retires, and what is still open

Three records in this repository book the provider layer as unavailable on the strength of one
sentence — *"managed-E2B egress is not fully lockable"*:

| Where | What it says |
|---|---|
| `server/src/services/sandbox-provider-runtime.ts`, the `acquireLease` metadata comment | **corrected by this unit's PR**, with the correction pinned by a test in the required `policy` job |
| the 2026-08-05 cloud-execution-isolation spec, §12 | still stands as written; it is a spec about the *deployed* system and is corrected here by reference |
| finding **E8-F003**'s own *"option (b) is unavailable"* | a clause was **added**, not removed — see §9 |

Against the installed, **lockfile-pinned** `e2b@2.30.5` that sentence is **false as a statement about
the seam**:

* `SandboxOpts.network?: SandboxNetworkOpts` with `allowOut` / `denyOut` (`dist/index.d.ts`);
* `buildNetworkBody` → the `POST /sandboxes` request body (`dist/index.js`, `createSandbox`) — it
  reaches the wire;
* `Sandbox.updateNetwork` → `PUT /sandboxes/{sandboxID}/network`;
* `getInfo()` mapping the server's answer back to `SandboxInfo.network`.

**AoA has never called any of it.** What is *still unmeasured* is whether the operator's tier
**enforces** what the seam declares — and that is precisely what this run answers. The honest
correction is therefore *"the seam exists and was never called"*, **not** *"the boundary works"*.

> ★★★ **And that is why the read-back, question (b), is a first-class question rather than a
> footnote.** `buildNetworkEgress` is a **pure passthrough** — the SDK validates nothing client-side,
> and the only error path is the HTTP status. The API target is per-company configurable
> (`resolveE2bDomain` = `config.domain ?? env.E2B_DOMAIN`, with a self-hosted branch). A **tolerant or
> self-hosted server that ignores an unknown field returns 200** and hands back an **unpoliced sandbox
> with identical code and identical logs**. Without a read-back there is no way to tell that sandbox
> from a policed one, so a `no` on (b) makes the approach unshippable **even if (a) is yes here**.

---

## 4. The trigger command

```bash
gh workflow run keyed-e2b-w10b-egress-enforcement-probe.yml --ref docs/replatform-program -f e2b_template=aoa-base
```

If that answers `HTTP 404: workflow ... not found on the default branch` — which happens to a lane
GitHub has not yet indexed, measured on `keyed-e2b-egress-constraint-probe.yml` on 2026-09-04 — use the
push route instead. It always works:

```bash
git switch docs/replatform-program && git pull
echo "W10B probe run #1 (2026-09-XX): why you are firing it" >> .github/keyed-e2b-w10b-egress-enforcement-trigger
git add .github/keyed-e2b-w10b-egress-enforcement-trigger
git commit -m "chore(w10b): fire the egress-enforcement probe"
git push
```

`.github/keyed-e2b-w10b-egress-enforcement-trigger` is the **only** path in the workflow's `push`
filter, and this probe's PR deliberately does **not** create it. So merging the probe fires nothing,
and editing the probe's own source later fires nothing either.

> ★ **Why this lane does not re-fire on a source change, when some of its siblings do.**
> `keyed-e2b-unit-d.yml` lists the module under test in `paths` on purpose. That is right for a lane
> that costs only sandbox seconds. **The founder authorises keyed E2B runs individually**, so an
> automatic re-fire would consume an authorisation nobody gave.

### 4a. Inputs

| Input | Default | What it does |
|---|---|---|
| `e2b_template` | empty → resolves to **`aoa-base`** | The image to measure in. **Empty does NOT mean bare `base` on this lane.** |
| `aoa_api_url` | `https://testing.armyofagents.org/` | The AoA control-plane **product-regression** row. Set it to your own control plane, or **empty** to skip that row — in which case the regression verdict reports itself **PARTIAL** and names the row it did not exercise. |

**Pass `aoa-base`.** It is the image AoA production runs (`e2b/README.md` threads it end to end as
`E2B_TEMPLATE=aoa-base`), so a reachability result about it is a result about the product; and
`e2b/e2b.Dockerfile` builds it `FROM node:22` with **`curl` and `python3`** installed, which question
(e) needs. The bare `base` template is recorded as *"coreutils only"*
(`.github/keyed-e2b-trigger` entry #4); on it, (e) reports `no-raw-socket-tool` and the lane reds as
inconclusive — a wasted authorisation. `resolveTemplate` therefore corrects **omission** and only
omission; an explicitly typed alias is honoured verbatim, and the resolved id is printed at the top of
the report and stored in the durable record.

The **push route is safe too**: a `push` event carries no inputs, so `E2B_TEMPLATE` arrives empty and
the same resolution applies. There is no way to fire a bare-`base` run by omission from either route.
(Note that the push route also leaves `aoa_api_url` empty, so that one product-regression row is
skipped and the verdict says so.)

---

## 5. What it costs, and what it needs

| | |
|---|---|
| Secrets | **`E2B_API_KEY` only** — it already exists as a repo secret. **No model-provider key**, and no model tokens are spent. |
| Sandboxes created | **4** — the policy arm, the anti-vacuity arm, the reuse arm, the IPv6-deny arm |
| Sandbox TTL (hard ceiling per sandbox) | 420 s for the two differential arms; 300 s for the reuse and IPv6 arms |
| Expected wall time | **~6–12 minutes**. Each HTTP target is one `curl --max-time 12`; each raw socket is one 8-second connect. |
| Absolute worst case if everything stalls | 2 × 420 s + 2 × 300 s = 1,440 sandbox-seconds, and only if every teardown also fails — every sandbox is killed in a `finally`. |
| Job timeout | 45 minutes (the in-test budget is 38, so a kill names the job rather than an innocent step) |

Without `E2B_API_KEY` the pack **skips** and the workflow's own positive-control step fails the job
with a message saying so. A skip is never a pass. No key is written into the repository, printed, or
embedded in a fixture; every string the pack emits passes through its own redactor
(`redactSecrets`, unit-tested in the required `policy` job).

### 5a. The experiment, in one table

| Arm | `network` at create | What it is for |
|---|---|---|
| **P** policy | `denyOut: [169.254.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]` | the measurement: (a), (b), (c), (e), and the product-regression rows |
| **N** anti-vacuity | `denyOut: [198.51.100.0/24]` (RFC 5737 TEST-NET-2) | **the control that makes a deny result attributable.** It differs from P in exactly one thing — *which* addresses are denied — not in whether a network config exists at all |
| **U** reuse | none at create, then `updateNetwork(denyOut: …)` | (d) |
| **P6** IPv6 | the P set **plus** `fe80::/10, fd00::/8, ::ffff:0:0/96` | an **observation**, not a verdict: does the API even accept IPv6 deny entries? |

> ★★ **Loopback (`127.0.0.0/8`) and CGNAT (`100.64.0.0/10`) are deliberately NOT in the deny set.**
> A `systemd-resolved` stub listens on `127.0.0.53`, and cloud fabrics use CGNAT for infrastructure the
> sandbox may need to stay alive. Denying either could brick the command channel and report the
> bricking as the measurement — spending your authorised run on an apparatus failure. The deny set is
> the ranges a real DE-08 control must cover, **minus the two that could take the apparatus down with
> them**, and the durable record carries the set so no later reader mistakes it for the whole control.

### 5b. The mandatory control rows

No answer is admissible without all four, and none substitutes for another:

| Control | Must show | Without it |
|---|---|---|
| **POSITIVE** — an allowed public host, in the policy arm | **REACHED** | a total outage reads as "enforced" |
| **APPARATUS** — an RFC-2606 `.invalid` host, in **both** arms | **FAILS** | the probe might not be reading the network at all |
| **ANTI-VACUITY** — the question target in the arm whose deny set does *not* name it | **REACHED** | a deny result is unattributable: E2B might block that destination anyway |
| **COMPLETENESS** — every row parsed | no missing rows | a dropped row is invisible; it cost the sibling probe two runs |
| **PRODUCT-REGRESSION** — DNS, the package registry, the model API and the AoA control plane, under the deny set | **REACHED** | (separate verdict, §7) a control that breaks the product is unshippable whatever (a) says |

---

## 6. Where the answer goes

The verdict is written to **three** places, on a red run as well as a green one:

| Where | What is there |
|---|---|
| **Job summary** (the run page, nothing to download) | the whole human report, as a fenced block — the fastest read |
| **`w10b-egress-enforcement-record` artefact** (90-day retention) | `w10b-egress-enforcement-record.json`, schema `aoa.w10b.egress-enforcement-record/1`: the disposition, the **computed decision**, **every question's state AND reason**, the **resolved template**, the **declared deny set**, the observations (both arms' `/etc/resolv.conf`, the `getInfo()` network object, the reuse shape, the IPv6 arm) and the commit sha |
| **Step log** | the same report plus every per-row line, parsed or not |

> ★★★ **Why the pack is not allowed to answer only into a log.** E7-F025 measured this repo's own
> instance: a sibling keyed lane **already fired twice** and **no document records either outcome**, so
> the honest state of that measurement is *fired and unrecorded* and the next session re-asks the
> question. Both the fallback writer and the artefact upload are `if: always()` for the same reason:
> the **inconclusive** run is exactly the run whose detail somebody needs, and exactly the run a
> success-gated step throws away. `evaluateDurableRecord`
> (`scripts/lib/w10b-egress-enforcement-probe.mjs`) asserts both guards — plus the keyless
> positive-control step — against the real YAML in the required `policy` job, so removing any of them
> reds CI.

**After the run: copy the record into `W10B-egress-enforcement-result.md` next to this file, naming
the run id.** The artefact is retained for 90 days; the ticket record is not.

---

## 7. How to read each answer

Every question reports one of three states. **`no` is a result and the lane stays GREEN for it — and
so does (c)'s ABANDON `yes`.** `inconclusive` is the only state that reds, because it is the only one
that means *run me again*.

> ★★★ **Why that asymmetry is the point.** If the only green outcome were "the boundary works", then
> "the boundary does not work" would arrive as a red build — indistinguishable from a bad key, a
> template change or an outage — and your one authorised run would have bought an ambiguity instead of
> an answer. A probe that can only pass is worthless.

> ### ⚠ ILLUSTRATIVE FORMAT ONLY — the probe has never been fired
>
> **No W10B run exists.** The block below shows the SHAPE of the report and nothing else: every state
> is a `<placeholder>`, not a measurement, and none should be read as a prediction. **When a run
> happens, replace this block with its real summary and name the run id it came from.**

```
========== W10B DE-08 EGRESS-ENFORCEMENT PROBE — RESULT ==========
TEMPLATE: <resolved template id>   (<explicit|default-product-image>)
DENY SET (policy arm): 169.254.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
ANTI-VACUITY SET     : 198.51.100.0/24
commit: <sha>   run nonce: W10B-<...>

PROBE a: <STATE> — <reason>
PROBE b: <STATE> — <reason>
PROBE c: <STATE> — <reason>
PROBE d: <STATE> — <reason>
PROBE e: <STATE> — <reason>
PROBE regression: <STATE> — <reason>

DISPOSITION: <measured|inconclusive> — <probe>=<state> ...
DECISION   : <abandon|viable|blocked-on-regression|undecided> (<because>)
```

### (a) HONOURED? — is a denied target actually unreachable?

| Verdict | What it means | What to do |
|---|---|---|
| `YES — denied-target-unreachable-under-policy` | The target was blocked in the arm that denied it and **reached in the anti-vacuity arm**. The tier honours `denyOut` at `Sandbox.create`. | Read (b) next; enforcement you cannot verify is not shippable. |
| `NO — denied-target-still-reachable` | The target was reached **under the policy**, exactly as without it. The declared deny set is **inert at this tier** — the same result the `metadata.egressAllowlist` seam produced (E8-F003), one API surface over. | **The option closes.** Record it against DE-08 and E8-F003; the in-guest point is then the only candidate, with the agent-writability problem in §8 unresolved. |
| `INCONCLUSIVE — controls-failed` | One of §5b's control rows did not hold; the detail names which. | Fix the apparatus and re-run. Nothing may be read. |
| `INCONCLUSIVE — question-row-missing` | The question target produced no result line. | Re-run; the log carries the raw channel for every row, parsed or not. |

★ **The IPv6 spellings are reported beside the verdict, never folded into it.** A deny set that closes
`169.254.169.254` and leaves `[::ffff:169.254.169.254]` open **is** enforced *and* is useless as a
control. Both are true, and collapsing them into one boolean loses whichever one you needed. The
SDK's only sentinel is `ALL_TRAFFIC = "0.0.0.0/0"` — there is **no `::/0`** and no IPv6 in its docs —
so an open IPv6 flank is the expected shape, not an anomaly.

### (b) VERIFIABLE? — does `getInfo()` materialize the policy back?

| Verdict | What it means |
|---|---|
| `YES — policy-materialized-exactly` | `getInfo().network.denyOut` came back as exactly the declared set (order does not matter; the **set** does). A run can verify what it got. |
| `NO — network-not-materialized` | `getInfo()` succeeded and carries no `denyOut`. A run would have to **assume**, and a tolerant or self-hosted API that ignores the field returns 200 with an unpoliced sandbox. **Unshippable even if (a) is yes.** |
| `NO — policy-materialized-but-differs` | The server accepted the request and stored **something else**. That is *worse* than storing nothing: a naive read-back check would pass on it. The detail names what is missing and what is unexpected. |
| `INCONCLUSIVE — getinfo-failed` | The call itself failed. |

### (c) ★ ABANDON? — is the resolver inside the deny set?

| Verdict | What it means | What to do |
|---|---|---|
| `YES — resolver-inside-the-deny-set` | A nameserver's address falls in a denied range. | **§2. Abandon the option.** A complete result. |
| `YES — resolution-broke-under-policy` / `…-despite-resolver-outside` | Name resolution measurably failed under the policy (curl exit 6) while the same name resolved in the anti-vacuity arm. The second spelling means no nameserver address was inside the set and it broke anyway — **something else in the resolution path is denied**, which is worth its own finding. | §2, and file the surprise. |
| `NO — resolver-outside-the-deny-set` | Every nameserver is decided and safe, and resolution worked under the policy. **The approach survives this question.** | Continue to (a)/(b)/(e). |
| `INCONCLUSIVE — resolv-conf-unreadable` | `/etc/resolv.conf` could not be read **and** resolution did not measurably fail, so neither trigger fired. | Re-run. **Do not read this as `safe`.** |
| `INCONCLUSIVE — resolver-unclassifiable` | A nameserver's containment could not be decided (an unparseable address, or an IPv6 nameserver against a deny set that also declares IPv6). | Re-run or extend the classifier. An undecided resolver may not be counted as outside. |
| `INCONCLUSIVE — no-nameserver-lines` | `/etc/resolv.conf` has no `nameserver` line: the guest resolves names some other way. | Investigate before designing anything. |

A DNS failure in **both** arms is **not** attributed to the policy — the verdict comes back `no`.

### (d) RE-ASSERT? — does `updateNetwork` re-police a reused sandbox?

`YES` = the target was **reached before** the update and blocked after it, on the same sandbox. The
**before** row is this arm's own positive control: without it, "unreachable after" would be satisfied
by a sandbox that could never reach the target at all, and the arm would confirm the update on the
strength of nothing.

★ **The reuse SHAPE is reported, not assumed.** `betaPause` is plan-dependent. When it works the
verdict says *"paused and resumed"*; when it does not, the update is applied to a still-**running**
reused sandbox and the verdict says so explicitly — that is AoA's `reuseLease` question but **not** the
resume half, and it must not be read as one.

### (e) WHERE? — packet path, or an L7 proxy?

| Verdict | What it means |
|---|---|
| `YES — enforcement-is-in-the-packet-path` | Every raw target that connected in the anti-vacuity arm was closed under the policy — on a **non-HTTP port**, and with **hand-written request bytes** that no HTTP client and no proxy variable touches. Enforcement is below L7. |
| `NO — enforcement-is-not-in-the-packet-path` | HTTP through curl was blocked, but a raw socket still connected. Enforcement is at L7 — **and an L7 layer is not a boundary against this workload** (§8). |
| `NO — nothing-was-blocked-so-there-is-no-layer-to-locate` | (a) measured the policy inert, so the question **dissolves**. This is deliberately not `inconclusive`: it would otherwise ask you to re-spend an authorised run on a question the run already answered. |
| `INCONCLUSIVE — raw-socket-rows-unusable` | Usually a template with no `python3`. Re-dispatch with `-f e2b_template=aoa-base`. |
| `INCONCLUSIVE — raw-targets-unreachable-in-the-control-arm` | No raw target connected even without a matching deny set, so their closure under the policy is unattributable. |

### PRODUCT REGRESSION — would the control break the product?

`NO` is the good answer: every exercised row was reached under the deny set. `YES` means the deny set
broke DNS, the package registry, the model API or the AoA control plane, and the control is
unshippable whatever (a) says. A row that was **not exercised** (typically `aoa_api_url` on the push
route) is **named** and the check reports itself **PARTIAL** — never a silent pass.

It is a **separate verdict, not a control gate**, and deliberately so: a regression does not make the
measurement unsound — (a), (b), (c) and (e) are all still readable — it makes the *control*
unshippable. Folding it into the gate would turn "this policy would break npm" into "this run measured
nothing", throwing away four answers to report one.

---

## 8. Why the provider layer is the only candidate outside the guest

Every in-guest mechanism is **agent-writable by construction**: `buildE2bLoginShellScript`
(`server/src/services/sandbox-provider-runtime.ts`) sources `/etc/profile`, `$HOME/.profile` and
`$HOME/.bashrc` from an **agent-writable home** before `exec env … claude`. An in-guest **proxy** is no
better: Node's global `fetch` **ignores every proxy environment variable** — measured, with the proxy
port never contacted and the request returning 200 — and the image is `node:22`, so the agent's own
WebFetch walks straight past it. `isPrivateIP('::169.254.169.254')` returns `false`. And
`one-shot-sandbox-cli.ts` composes its own env and calls `runtime.execute` directly, bypassing
`execution-target.ts` entirely.

That is the whole reason (e) exists as a question rather than an assumption: an L7 filter the guest can
route around is not a boundary against the very workload it is meant to contain.

---

## 9. What this probe is NOT

- It **does not build an enforcement layer.** It measures whether one is possible.
- It **applies no deny policy to any production code path.** Every `network` option it passes goes to
  a sandbox it created for the measurement and destroys afterwards.
- It **does not flip any capability, arm any rollout dial, write to any register, or change any count.**
- It **does not close DE-08 or E8-F003**, and its PR does not change either one's status or severity.
  The PR **adds** a clause to E8-F003 recording that the SDK seam exists and was never called, and
  **removes nothing** — a machine-readable entry must never become weaker than the prose beside it,
  and E8-F003's own record says so.
- It **claims nothing about the networked/container lane.** Like every other keyed lane here, it is
  E2B only (E7-F011).

---

## 10. Where the pieces live

| File | Role |
|---|---|
| `packages/sandbox-e2b-provider/src/__tests__/keyed-w10b-egress-enforcement-probe.test.ts` | the probe: the four arms, the raw-socket helper, the report. Skips cleanly without `E2B_API_KEY`. Its no-key blocks PIN the `e2b` SDK seam (`ALL_TRAFFIC`, `network`, `updateNetwork`, `getInfo`) so the premise cannot rot in the other direction either. |
| `scripts/lib/w10b-egress-enforcement-probe.mjs` | the pure core: template resolution, the deny sets, the CIDR engine behind the ABANDON question, the command builder and line parser, the four control rows, all five verdicts plus the regression verdict, the computed decision, the redactor, the durable-record builder, and `evaluateDurableRecord`. Zero imports; no network, no filesystem. |
| `scripts/lib/__tests__/w10b-egress-enforcement-probe.test.mjs` | proves every one of those decisions **without a key**, on every PR, in the required `policy` job — and pins the stale-premise correction in `sandbox-provider-runtime.ts`. |
| `.github/workflows/keyed-e2b-w10b-egress-enforcement-probe.yml` | the lane: the probe step, the `always()` fallback record writer, the `always()` artefact upload, and the positive-control step that refuses to let a skip read as success. |
| `.github/keyed-e2b-w10b-egress-enforcement-trigger` | **not created by this PR.** Creating/appending it on `docs/replatform-program` is the push route to fire the lane. |

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Job fails at "Fail if the pack SKIPPED" | `E2B_API_KEY` was empty; the pack skipped and measured nothing. | Restore the secret. A skip is never a pass. |
| `INCONCLUSIVE — controls-failed: anti-vacuity-control-failed` | The question target was not reachable even from the arm that does not deny it. Whatever blocks it is not this policy. | Pick a reachable internal target and re-run. **Do not read this as enforcement.** |
| `INCONCLUSIVE — controls-failed: apparatus-control-violated` | The RFC-2606 `.invalid` host was **reached**. The probe is not reading the network. | Something is intercepting DNS or HTTP. Investigate before trusting any row. |
| `INCONCLUSIVE — raw-socket-rows-unusable` | The template has no `python3`, so (e) had no tool. The report's `TEMPLATE:` line says which image ran. | Re-dispatch with `-f e2b_template=aoa-base`. If `aoa-base` is not registered on the account behind `E2B_API_KEY`, build it: `cd e2b && e2b template create aoa-base -d e2b.Dockerfile` (the `e2b template build` form in older docs is a gutted no-op). |
| An arm reports `ARM FAILED` with an HTTP status | `Sandbox.create` rejected the `network` body. The SDK validates nothing client-side, so an unknown or unsupported field surfaces only here. | Read the status. For the **IPv6 arm** this is a *result*, recorded in `observations.ipv6DenyArm` — the API refuses IPv6 deny entries. |
| The run failed and there is **no** `w10b-egress-enforcement-record` artefact | Should be impossible: both the fallback writer and the upload are `if: always()`. | Treat the run as **unmeasured**, not as a result, and say so wherever you report it — that is the E7-F025 failure returning. |
| `gh workflow run` answers 404 | The lane has never run, so GitHub has not indexed it for dispatch. | Use the push route in §4. |
