# RUNBOOK — E7-1 keyed run: one real distributed job end-to-end

**Status:** operator procedure · **Worktree of record:** `docs/replatform-program`
**Path:** worker (`networked-host`) → adapter-manager → **real E2B**, key operator-only.
**Verifier:** `pnpm verify:e7-1-distributed-run <runId>` (5 `ok` clauses).

This is the current authority for the E7-1 keyed live run. It supersedes the
TIER-0 framing in `docs/replatform/qa/2026-08-28-c0-staging-deploy-scope.md`
(whose "unbuilt substrate above C0" premise is now stale — the substrate is built
and wired) and consolidates the blocker/terrain findings in
`docs/replatform/qa/2026-08-31-campaign-blockers-and-fleet-terrain.md` into an
ordered procedure. Where this runbook and those docs differ, this runbook wins.
GO-BOOK marks E7-1 "OWED — needs a live-infra run"; this is that run.

The distributed-execution substrate is **built and wired but has never run against
a real E2B account**. The founder runs this deploy (operator + money). The goal is a
first-try verifier-PASS.

---

## 0. What you are deploying, and what a green proves

A campaign-minimal fleet, four services, layered over the base staging manifest:

| Service | Role | Holds the E2B key? |
|---|---|---|
| `control-plane` | app + distributed scheduler + worker-control + AM truth route | **no** |
| `adapter-manager` | out-of-process provider host; the `e2b` transport lives here | **YES — only here** |
| `migrate` | one-shot migrations (control-plane image) | no |
| `worker` | one networked-host worker; reaches E2B via the AM wire | **no** |

The E2B key is confined to the adapter-manager. The worker reaches E2B only through
`AOA_WORKER_PROVIDER_URL` → the adapter-manager's gated provider wire. This is the
full / honest posture (the founder's choice over the degraded desktop proof).

**A green E7-1 proves the MECHANISM, not agent capability.** The five verifier
clauses corroborate that a worker leased the attempt, started it, and its terminal
was projected — none of them read `workload`, `args`, `exitCode`, or agent output.
Agent capability is a separate, ungated dimension (`capabilityProven`) by ruling
`E7-D-CAPABILITY-DISCLOSURE`. Two things the verifier does NOT check — confirm both
by hand (§11): that the provider was **real E2B** (not the fake), and read the
`produced:` line yourself.

**Files:** `docker/campaign/docker-compose.campaign.yml` (overlay) and
`docker/campaign/.env.campaign.example` (fill into `.env.campaign`).

---

## 1. Build the `aoa-base` E2B template on the operator's E2B account

A stock `base` template will **not** work: the distributed path performs exactly one
`execute` and has **no install-at-spawn fallback**, so the agent CLI must already be
on PATH inside the sandbox. The template exists in-tree.

```
cd e2b
e2b template create aoa-base -d e2b.Dockerfile --memory-mb 2048 --cpu-count 2
```

★ Use `e2b template create … -d <dockerfile>`. Do **not** use the deprecated
`e2b template build …` form (a gutted no-op stub in recent CLI: it prints a
deprecation banner and exits without building anything). A `buildStatus: ready`
proves the Claude CLI is in the sandbox — `e2b/e2b.Dockerfile`'s final step asserts
`command -v claude && claude --version`.

Note the returned template **ID** (or the name `aoa-base`); it becomes
`AOA_CAMPAIGN_E2B_TEMPLATE`. This is the adapter-manager var
`AOA_ADAPTER_MANAGER_E2B_TEMPLATE` — a DIFFERENT variable from the monolith's
`E2B_TEMPLATE` (which defaults to the stock `base`).

---

## 2. Generate the control-plane ↔ adapter-manager ed25519 keypair; verify it

ONE ed25519 keypair. The PRIVATE half mints owned-labels capabilities on the control
plane; the PUBLIC half verifies them on the adapter-manager. A mismatched or
half-wired pair boots CLEAN on both sides and then collapses every gated create to the
uniform `ResourceNotAvailableError` — byte-indistinguishable from a legitimate
ownership denial. This is the maximally silent failure; the smoke probe is the only
thing that catches it.

```
mkdir -p docker/campaign/secrets
openssl genpkey -algorithm ed25519 -out docker/campaign/secrets/control-plane-signing-key.pem
openssl pkey -in docker/campaign/secrets/control-plane-signing-key.pem \
  -pubout -out docker/campaign/secrets/adapter-manager-cp-pubkey.pem
```

Verify the mounted pair **before** the canary (this gates the run):

```
AOA_CONTROL_PLANE_SIGNING_KEY_FILE=docker/campaign/secrets/control-plane-signing-key.pem \
AOA_ADAPTER_MANAGER_CONTROL_PLANE_PUBLIC_KEY_FILE=docker/campaign/secrets/adapter-manager-cp-pubkey.pem \
  pnpm verify:cp-am-keypair
```

Expect `✓ CP↔AM keypair smoke: PASS`. A `FAIL` exits non-zero and loud — regenerate
and re-mount before proceeding. Keys must be readable by the container runtime uid:
`chown 1000:1000` and keep `0600` (a root-owned `0600` mount is `EACCES` inside the
container, and the adapter-manager then refuses to boot with `EACCES` rather than
degrading — which is the intended loud-fatal behaviour).

---

## 3. Provision Postgres + the four role logins

The four DB URLs are **ONE database + four role-scoped logins**, not four databases.

1. Bring up Postgres (external, or a `pgvector/pgvector:pg18` container — set
   `PGDATA=/var/lib/postgresql/data` on pg18 or it exits when a volume is mounted at
   the legacy path). `POSTGRES_USER`/`PASSWORD`/`DB` define the **owner** login.
2. `DATABASE_URL` and the migration URL are the **owner** (runs DDL + the LOGIN
   grant; **not** `aoa_app`). Migrations create `aoa_app` / `aoa_operator` **NOLOGIN**.
3. Grant LOGIN to the two serving roles — recommended, works anywhere: set
   `AOA_APP_DB_PASSWORD` + `AOA_OPERATOR_DB_PASSWORD` on the **control-plane** (already
   wired in the overlay). At boot, `maybeProvisionDistributedExecutionRoles` runs
   `ALTER ROLE … WITH LOGIN PASSWORD …` on the owner URL, then verifies the bounded
   pools. **The passwords must match** the passwords embedded in the two serving-role
   URLs. This grants LOGIN without weakening FORCE RLS.
4. Set `AOA_CAMPAIGN_APP_DATABASE_URL` / `AOA_CAMPAIGN_OPERATOR_DATABASE_URL` to the
   `aoa_app` / `aoa_operator` logins.

With the distributed flag on, a blank `AOA_APP_DATABASE_URL` /
`AOA_OPERATOR_DATABASE_URL` **throws at boot** (`assertHostedExecutionStartupSafe`) —
the distributed path never falls back to the owner pool.

---

## 4. Fill `.env.campaign`

```
cp docker/campaign/.env.campaign.example docker/campaign/.env.campaign
# edit docker/campaign/.env.campaign
```

Fill: the three image tags, deployment mode + allowed hostnames, the four DB URLs +
the two serving-role passwords, the session signing key, the truth bearer, the
keypair + enrollment-ticket file paths, `E2B_API_KEY` + `AOA_CAMPAIGN_E2B_TEMPLATE`,
and (optionally) the object store. **Leave `AOA_CAMPAIGN_DISTRIBUTED_EXECUTION_ROLLOUT`
EMPTY for now** — you arm it in §6. Never commit the filled file; never put the E2B
key in the control-plane's auth env file.

---

## 5. Bring up the control plane + adapter-manager + migrate

Start ONLY the campaign slice by name — this is why "exactly one worker" holds even
though the base manifest declares six app services (a compose overlay cannot delete
the base's `control-plane-b` / `worker-a1..b2`; naming the slice leaves them
unstarted). **Do not** bring up the `worker` yet — it enrolls with a 10-minute-TTL
ticket you mint in §7.

```
docker compose \
  -f docker-compose.staging.yml \
  -f docker/campaign/docker-compose.campaign.yml \
  --env-file docker/campaign/.env.campaign \
  up --wait migrate control-plane adapter-manager
```

Use `docker compose up`, **NEVER swarm** (swarm ignores `depends_on`, breaking the
migration-first gate). Confirm health:

- control-plane `/api/health` → `{"status":"ok",...}` (via the published port, or
  `docker exec` — `control-net` is internal).
- adapter-manager `/healthz` → healthy. ★ A green `/healthz` does **not** mean E2B is
  reachable (the healthcheck does not probe E2B). Check the reaper log line instead:
  `reaper: sweep complete { reaped: 0, skipped: 0, unknown: 0, failed: 0 }`. If you see
  `getaddrinfo EAI_AGAIN api.e2b.app`, the AM lacks egress — it must be on both
  `control-net` (internal) and `provider-ctl-net` (egress); the base manifest already
  places it on both.

---

## 6. Arm the rollout (SK-2 — the #1 silent kill)

Put the target org in **`canary`** for the `batch` workload. `active`/`shadow` are
NOT enough — `run-execution-owner` returns `rollout_not_canary` for anything but
`canary`. Set the value in `.env.campaign` (single line):

```
AOA_CAMPAIGN_DISTRIBUTED_EXECUTION_ROLLOUT={"organizations":{"<ORG_UUID>":{"mode":"canary","workloads":["batch"],"sources":["task_run"]}}}
```

The JSON shape (from `distributed-execution-rollout-source.ts`): a top-level
`organizations` map keyed by organization id; each org has a `mode`
(`shadow`|`active`|`canary`), a `workloads` string array (`"*"` = all), and an
optional `sources` array (`"*"` = all; here the `task_run` sink). An org absent from
the map is off; a malformed value fails **closed** to legacy (never throws into a run).

Recreate the control-plane so the process re-reads the env:

```
docker compose \
  -f docker-compose.staging.yml \
  -f docker/campaign/docker-compose.campaign.yml \
  --env-file docker/campaign/.env.campaign \
  up -d --wait control-plane
```

★ Pre-verify conjunct 4 (silent otherwise):
`SELECT organization_id FROM companies WHERE id='<COMPANY>'` must equal `<ORG_UUID>`.
A NULL there kills the canary with no log line.

---

## 7. Enroll the one worker (ticket, not raw code), then bring it up

Mint an enrollment on the control plane for the campaign target; you get back a raw
`aoa_enr_…` code with a **10-minute server-side TTL**. The worker's
`AOA_WORKER_ENROLLMENT_CODE_FILE` needs an **enrollment TICKET**, not the raw code:

```
aoa_tkt_<base64url(JSON.stringify({ v: 1, targetId: "<TARGET_ID>", code: "<aoa_enr_...>" }))>
```

The decoder does an **exhaustive** key check — exactly `{v, targetId, code}`, sorted;
`v` must be `1`; an extra key, a wrong prefix, or a raw code is rejected. Write the
ticket to the file `AOA_CAMPAIGN_WORKER_ENROLLMENT_TICKET_FILE` points at, then bring
up the worker **promptly** (the embedded code expires in 10 minutes):

```
docker compose \
  -f docker-compose.staging.yml \
  -f docker/campaign/docker-compose.campaign.yml \
  --env-file docker/campaign/.env.campaign \
  up --wait worker
```

The worker runs `file_record` custody on the durable `worker-state` volume. ★ That
volume must survive recreate: a lost `identity.json` re-mints a workerId the server
denies `worker_transfer_denied` **permanently**, with no container reset route. Use a
**fresh org** — a legacy `environment_leases` row can never satisfy the preflight's
closure clause.

---

## 8. Set a Company E2B provider key; raise the agent concurrency cap

The env-default `E2B_API_KEY` on the adapter-manager does **not** satisfy the canary
preflight (SK-7): without a per-Company default `e2b` provider key the preflight
refuses `credential_authority_not_moved`, and the run stays legacy. Set one:
Settings → Secrets → Sandbox Providers, or the one-step "Add E2B key" endpoint
(secret + default provider key, atomic). If the agent's per-agent
`heartbeat.maxConcurrentRuns` is the default 1 and it would block the canary, raise it
above 1 for this agent.

---

## 9. Dispatch ONE `task_run` — with NO instructions bundle

Create a task in the canary org and **assign it to** the org agent (do not merely
`@`-mention it — a mention wake silently skips the canary block; the wake must be
`issue_assigned`, satisfying `shouldAutoCheckoutForWake`). Assignment fires a wakeup;
the seven-conjunct `[CLI-006]` decision block resolves and the run converts to
distributed, is placed, leased, and executed in E2B.

★ **NO instructions bundle on this first canary.** The networked lane cannot stage
input files — `NetworkedProviderDriver.stageFiles` throws `UnsupportedProviderOperation`
and `fileStagingMode` is `"none"`. With a bundle, the workload carries staged files, so
the supervisor calls `stageFiles` (`supervisor.ts:695-749`, the `staged.length > 0`
arm), the networked driver rejects it, and the supervisor fails the attempt closed
(`stage_input_failed` + cleanup). A bundle-less canary resolves an EMPTY staged set, so
`staged.length > 0` is false and `stageFiles` is never called. Dispatch a bundle-less
task so the batch workload carries a real `command`/`args` but no staged files.

Watch for, in the control-plane logs:

```
[CLI-006] rollout resolved   rolloutHookPresent: true   rolloutState: "canary"
[heartbeat] Harness pre-checked out issue for scoped wake
```

Capture the `runId`.

---

## 10. Verify

```
pnpm verify:e7-1-distributed-run <runId>
```

Expect `PASS (mechanism) — distributed journey corroborated`. The five `ok` clauses:
(1) `execution_owner === "distributed"`; (2) both `distributed_job_id` +
`distributed_attempt_id` set; (3) durably terminal (status in
{succeeded,failed,cancelled,timed_out} + `finished_at`); (4) no leaked secret across
the run's evidence surfaces; (5) journey corroboration — a matching `job_attempts`
row, ≥1 lease, ≥1 `attempt_started`, ≥1 `terminal`, and an applied `attempt_terminal`
projection receipt. Exit 0 = mechanism corroborated; exit 1 = not corroborated;
exit 3 = corroborated but capability unproven **and** `--require-capability` was passed
(off by default).

---

## 11. Manual confirmation the verifier does NOT do — then flip the gate

The verifier reads no provider identity and never fails a run on produced output.
Confirm by hand:

1. **The provider was real E2B, not the fake.** No clause reads provider identity; a
   `fake-provider` run that produced a lease + events + receipt would pass all five.
   Confirm the adapter-manager actually created a sandbox on your E2B account (E2B
   dashboard / AM logs), and that the reaper reclaimed it afterward.
2. **Read `produced:` in the verifier output yourself.** Clause 3 is terminal-agnostic:
   `failed` and `timed_out` PASS. A sandbox where `claude` is missing → exit 127 →
   `failed` → verifier PASS. `capabilityProven` is reported beside the verdict, not
   folded into it, and reads 0 on every real run today (output capture is unbuilt,
   CLI-008 Unit F) — that is expected and does not block the mechanism gate.

Only then flip `E7-1-coding-journey` `unwired → wired` in
`scripts/gate-clause-wiring.json`, **in a SEPARATE prose PR that cites this runId**.
The gate checker validates only that the named symbol's production reference count is
non-zero; it does not validate the run. The honesty of this gate is 100% human — do
not flip it from this prep PR.

---

## Known first-run risks

This is the FIRST time this path runs against a real E2B account. Expect
first-contact friction and budget for a second attempt.

**1. `real-transport.ts` has never run live (version-sensitive SDK).**
`packages/sandbox-e2b-provider/src/real-transport.ts` is the only module that touches
the `e2b` SDK, and its own header states none of it has run against a real E2B account;
the SDK surface is broad and version-pinned (`e2b@^2.30.5`), so it is cast rather than
statically checked. The pure helpers (`real-transport-helpers.ts`: argv single-quoting,
not-found classification) were already hardened against the FIRST keyed run's 8/18
real-E2B failures, and the exit-code mapping was corrected once (E7-F014: a non-zero
exit throws `CommandExitError`, now converted back to a real exit code rather than lost
as `execute_failed`). The remaining first-contact risk is in the SDK method/shape calls
that could not be regression-covered without the key. Watch these specifically on the
first run:

  - **Exit-code / crash mapping** (`runCommand`, `:154-222`): a non-zero command exit
    must surface as `{exitCode: N, crashed: true}` via the `CommandExitError` arm, and
    a genuine sandbox/transport fault (`SandboxError("Process exited without a result")`
    / iteration error) must keep THROWING (mapped to `execute_failed`), never become a
    fabricated "exited 1". If a failing command loses its exit code, or a fault is
    reported as an exit, this arm is the first suspect.
  - **Timeout mapping** (`:216-219`): a real command timeout is expected to surface as
    an SDK error whose `.name` contains "timeout" → `{timedOut: true, signal:"SIGKILL"}`.
    If a timeout is misclassified (re-thrown as `execute_failed` instead), the name
    match is the place to refine against real infra.
  - **Static SDK method shapes** (`create`/`connect`/`getInfo`/`kill`/`list`/`setTimeout`,
    `sandbox.commands.run`/`list`/`kill`, `sandbox.files.*`): these are code-readings of
    the `e2b@2.30.5` type declarations for a package NOT installed in the tree. A wrong
    static-vs-instance shape or a renamed field within the pinned range would surface on
    the first live call. (`enablePauseResume` is OFF by default, so `betaPause`/`connect`
    resume are not on the E7-1 path.)

  These are the "refine against real infra" cases the file's own comments name. If the
  first run breaks in one of them, the fix is a narrow, measured correction against the
  observed SDK behaviour — not a speculative rewrite. Do not pre-emptively "fix" them
  blind; capture the real error first.

**2. The networked `stage_files` gap forces a bundle-less first canary.**
`NetworkedProviderDriver` reports `fileStagingMode: "none"` and its `stageFiles` throws
`UnsupportedProviderOperation` (`driver.ts:214-220`). The containerized lane cannot
stage input files. Giving the AM wire an inbound staging route is separate, unbuilt work
(CLI-008 Phase 3). Dispatch the first canary with **no instructions bundle** (§9): a
configured bundle makes `staged.length > 0`, the supervisor calls the driver's throwing
`stageFiles`, and the attempt fails closed (`stage_input_failed`). A bundle-less canary
resolves an empty staged set, so `stageFiles` is never reached.

**3. Every boot gate is fail-CLOSED — a misconfig is a refuse-to-boot, not a silent
degrade.** The adapter-manager refuses to boot without provider=`e2b` + a non-empty
template + a usable `E2B_API_KEY` + a parseable ed25519 CP **public** key (a private key
mounted there, a non-ed25519 key, or an unreadable file each refuse loudly). The
control-plane throws at boot on a blank serving-role DB URL. The CP↔AM keypair MISMATCH
is the one exception that boots clean on both sides and fails silently at every gated
create — which is why §2's `verify:cp-am-keypair` is mandatory before the canary.

**4. Green E7-1 proves the MECHANISM, not agent capability.** Capability is ungated by
ruling `E7-D-CAPABILITY-DISCLOSURE`; `capabilityProven` reads 0 on every real run today
(output capture is unbuilt, CLI-008 Unit F) and is reported beside the verdict, never
folded into it. A mechanism-green run with `capabilityProven: false` is the expected
first outcome and is a legitimate basis to flip the gate (§11).

---

## Silent-kill quick reference

Full register: `docs/replatform/qa/2026-08-31-campaign-blockers-and-fleet-terrain.md`
§9. The overlay pre-wires the fixes for most of these; the ones that depend on
operator data / dispatch are called out in the steps above.

| # | Silent kill | Where handled |
|---|---|---|
| SK-2 | rollout unset ⇒ every org OFF (needs `canary`, not `active`/`shadow`) | §6 |
| SK-3 | `AOA_WORKER_DISPATCH_ENABLED` not exactly `"1"` | overlay (worker) |
| SK-4 | `AOA_WORKER_EVENT_OUTBOX_PATH` unset | overlay (worker) |
| SK-5/C | `mounted_secret` custody never enrolls (use `file_record`) | overlay (worker) |
| SK-6 | raw `aoa_enr_…` where an `aoa_tkt_…` ticket is required | §7 |
| SK-7 | no per-Company default `e2b` provider key ⇒ `credential_authority_not_moved` | §8 |
| SK-9 | CP/AM keypair mismatch (silent at create) | §2 |
| SK-10 | `AOA_ADAPTER_MANAGER_REAPER_ENABLED` not `"1"` ⇒ orphan sandboxes bill forever | overlay (AM) |
| SK-11 | `AOA_ADAPTER_MANAGER_TRUTH_ROUTE_ENABLED` unset ⇒ reaper reclaims nothing | overlay (CP) |
| SK-12 | `AOA_ALLOWED_HOSTNAMES` missing the CP service name ⇒ worker-control 403 | overlay (CP) |
| SK-15 | mention/`execution_*`/null wake silently skips the canary block | §9 (assign, don't mention) |
| SK-16 | reused org — a legacy `environment_leases` row can't satisfy closure | §7 (fresh org) |
