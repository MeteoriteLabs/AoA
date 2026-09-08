# DE-AUDIT — the experiments that need live access

**What this is.** W20 audited twelve of the thirty trust crossings in
[`docs/architecture/distributed-execution-threat-controls.json`](../architecture/distributed-execution-threat-controls.json)
and recorded every verdict against source, at file:line, in each row's `deliveryEvidence`.
Some questions could not be settled from a repository checkout. This document turns each of
those into a **work item somebody can actually run**: the access required, the exact steps,
and — stated in advance, so the result cannot be reinterpreted afterwards — what outcome
would mean *delivered* and what would mean *not delivered*.

**Read the scope honestly before using it.** A precise "cannot be settled here, here is the
experiment" is a valuable answer. It is not a delivery claim, and nothing in this document
upgrades any register row. Rows move only on a recorded measurement.

**The one rule these experiments are written to satisfy.** A control is `delivered` only if
you can exhibit it **denying** something. A configuration field is not enforcement. A type is
not enforcement. A doc saying it is enforced is not enforcement. **A read-back that returns
your own declared value is not enforcement** — it verifies what was *declared*, never what is
*enforced*. That is not a theoretical caution: DE-08's egress `denyOut` was accepted by the
API, validated server-side, stored, and echoed back byte-exactly by `getInfo()` — and traffic
flowed anyway. Every experiment below therefore ends in an **independent** observation, never
in the system's own echo of the thing you asked for.

---

## Index

| Crossing | Question live access would settle | Can the answer change the verdict? |
|---|---|---|
| [DE-01](#de-01) | Does the live serving credential resolve to the non-owner `aoa_app` role in a real container? Is the audit gap total end-to-end? | Cannot raise it. B could lower it. |
| [DE-03](#de-03) | Does a captured worker request replay 401 in a real deployment? Is the denial logged? | Cannot raise it. B could correct the audit sub-verdict. |
| [DE-04](#de-04) | Does a released lease still yield a download grant over HTTP? | No — it confirms a scope limit already recorded. |
| [DE-05](#de-05) | Does any shipped path ever write a quarantined artifact row? | Yes — a non-zero count would refute the caller census. |
| [DE-06](#de-06) | Is the deployed S3 credential bucket-wide? Does the cross-tenant key rejection hold on the live MinIO lane? | (a) no; (b) yes — confirms the "scoped service identity" clause is false in deployment. |
| [DE-07](#de-07) | Does the resolve path deny four ways live? Is there any surface that can revoke a handle? | Yes — an operator-facing revoke would refute the dead-lever finding. |
| [DE-09](#de-09) | **Is a capability restriction expressible on e2b create at all?** Which template does a live create receive? What can a tenant reach from inside the guest? | Yes, in both directions — and it may show the clause is unbuildable as written. |
| [DE-10](#de-10) | With the reaper armed, is an orphan sandbox actually destroyed — as seen by the provider, not by our own code? | Yes — this is the only route to `delivered` for the destroy half. |
| [DE-11](#de-11) | Does the artifact bucket carry default encryption or a lifecycle rule out of band? | Yes for the encryption clause only. |
| [DE-12](#de-12) | **Nothing.** | No — see the entry for why this is a finding, not a gap in this document. |
| [DE-13](#de-13) | Does one noisy Organization starve another? | Yes — this is REL-002's acceptance and it has never been run. |
| [DE-14](#de-14) | **Nothing.** Settled by executing the assertion. | No. |

---

## DE-01 — Control-plane PostgreSQL ↔ tenant query path (Critical)

The DB-layer controls were **settled by measurement** (4,460 adversarial operations against
real embedded PostgreSQL, deny lines observed in the server log). Neither experiment can
raise the verdict; only B can lower it.

### Experiment A — the live serving credential really is the non-owner role

**Access:** a Linux host able to run `docker compose -f docker-compose.d1.yml up` with the
DEP-001 admitted image digests from `docker/d1/.env.example`.

1. Bring the stack up with `AOA_DISTRIBUTED_EXECUTION_ENABLED=true`.
2. Look for the control-plane log line *"Verified aoa_app and aoa_operator bounded database
   pools"* (`server/src/index.ts:614`). **Its absence is itself the fail-closed result** — the
   app-authority phase threw and the process refused to serve.
3. From inside the postgres container:
   `psql "$AOA_APP_DATABASE_URL" -c "select session_user, current_user, rolsuper, rolbypassrls from pg_roles where rolname=current_user"`
   → **require** `aoa_app | aoa_app | f | f`.
4. Same session, **no GUC set**: `select count(*) from jobs;` → **must be 0** even with rows
   present. Then `select set_config('aoa.organization_id','<ORG_B_UUID>',true); select count(*) from jobs where organization_id='<ORG_A_UUID>';` → **must be 0**.
5. Under the ORG_B GUC: `insert into jobs (organization_id, company_id) values ('<ORG_A>','<COMPANY_A>');`
   → **must fail with 42501, "new row violates row-level security policy"**.

**PASS** = the live serving credential is the same non-owner role the tests proved.
**FAIL** (any of 3–5) = the deployed path is not the one that was measured; DE-01 drops.

### Experiment B — is the audit gap total in a real deployment?

Same stack. Provoke the step-5 denial through a **real HTTP request** (a worker session
bearing ORG_B's claim submitting against an ORG_A job id), then search for a record:

- `docker compose logs postgres | grep "row-level security"` → expect a hit (ephemeral
  container stderr only, not a control-plane audit record).
- `psql "$DATABASE_URL" -c "select count(*) from activity_log where created_at > now() - interval '5 minutes'"`,
  and the same on `hub_audit` and `job_projection_receipts` → **expect ZERO rows attributable
  to the denial.**

**Expected (confirms `E0-F010`)** = zero durable rows. **If a durable row DOES appear**, the
audit sub-verdict is wrong and must be corrected in the register.

---

## DE-03 — Enrolled worker ↔ control-plane job/lease APIs (High)

### Experiment A — the replay denial in a real deployment

**Access:** a deployed control plane with `AOA_DISTRIBUTED_EXECUTION_ENABLED=1`, one enrolled
worker with a live device key, org-admin credentials for step 5, and read access to the
control-plane Postgres for step 3.

1. Capture one complete successful `POST /api/worker-control/poll`: the `Authorization: Bearer`
   header, all five `aoa-device-proof-*` headers, the `aoa-request-id`, and the exact body bytes.
2. Re-send it verbatim. **Expect HTTP 401** with a frozen `ProtocolErrorV1` body carrying
   `code: "unauthorized"`. **A 200 with an offer would refute delivery outright.**
3. Verify no side effect: `SELECT status FROM job_attempts WHERE id = <attempt>` unchanged, and
   `SELECT count(*) FROM worker_proof_replays WHERE proof_id = <captured proofId>` = **1, not 2**.
4. Wait past the session's `exp`, mint a fresh proof id, re-send. **Expect 401** (expiry, not replay).
5. `POST /api/organizations/:orgId/execution-targets/:targetId/revoke`, then poll with the
   still-unexpired session and a fresh proof id. **Expect 409 `target_revoked`.**

### Experiment B — the cheapest experiment that could overturn the audit sub-verdict

Run step 2 above, then tail the control-plane log for that request. **Expected**: exactly one
pino-http warn line reading `POST /api/worker-control/poll 401`, with **no** `workerId`, **no**
`organizationId` and **no** `reasonCode`, and **no** line with `action: "worker.*.denied"`.
If such a line *does* appear, `E0-F010`'s DE-03 row is wrong. Needs only a log tail.

---

## DE-04 — Worker ↔ attempt/lease fence (Critical)

Confirms a **named scope limit already recorded** in the row; it cannot change the verdict.

**Access:** an instance with `AOA_DISTRIBUTED_EXECUTION_ENABLED=1` and embedded or real PG.

1. Stage an input via `stageJobInputFiles` for job J attempt 1.
2. Poll + ACK to a live lease L.
3. `UPDATE leases SET status='released' WHERE id = L` — leave `execution_targets.device_generation` untouched.
4. `POST /api/worker-control/artifacts/transfer-grant` with the same session JWT and device
   proof, `operation:"download"`, the same leaseId/jobId/attempt/fenceToken, and the staged key.

**Predicted from source** (`server/src/services/artifact-transfer-grant.ts:184-185`, whose
comment says the download branch is *fence-independent*): **HTTP 200 `download_granted`** with a
working presigned GET. The contrast that makes it a proof rather than an anecdote:

- the same request with `operation:"upload"` **must** return `rejected:"stale_fence"`;
- with `UPDATE execution_targets SET device_generation = device_generation + 1` first, it
  **must** return `target_revoked`.

That triple is the precise reachability proof that reads survive fence loss while writes do not.

---

## DE-05 — Replaced/expired attempt ↔ authoritative result state (Critical)

**This one can refute the audit.** The register records that no shipped path can write a
quarantined artifact row (`E0-F011`). A non-zero count refutes the caller census.

**Access:** a control plane with `AOA_DISTRIBUTED_EXECUTION_ENABLED=1`, verified
`aoa_app`/`aoa_operator` pools, one enrolled worker daemon, and `psql` as `aoa_operator`.

1. Submit a distributed job; once the lease is active and the run is producing output, force
   fence loss **without a clean terminal**:
   `UPDATE leases SET expires_at = clock_timestamp() - interval '1 second', ack_deadline = clock_timestamp() - interval '2 seconds' WHERE id = '<leaseId>'`.
2. Let the 15s convergence sweeper (`server/src/index.ts:1349`) reap it, and let the worker run
   to completion so it produces output **after** the fence is gone.
3. `SELECT id, status, quarantine_reason, observed_lease_id FROM job_artifacts WHERE job_id = '<jobId>' AND status = 'quarantined';`

**Predicted: ZERO rows, on every run**, because no shipped code path calls
`runOrphanQuarantine`. Also expect `job_attempts.status = 'expired'` and any late worker write
refused — the immutability half holds while the quarantine half produces nothing.
**A non-zero row count refutes this audit** and must be reported: it would mean a producer
exists that the caller census missed.

---

## DE-06 — Control plane ↔ S3-compatible object store (Critical)

### Experiment (a) — extend the existing live-MinIO lane (no new access)

The D1 lane already runs MinIO-over-TLS with toxiproxy (`docker-compose.d1.yml`,
`tests/d1/e6f-05-live-minio.test.mjs`). Add a third assertion:

- after `ack`, `POST /api/worker-control/artifact-transfer-grants` with `operation:"upload"` and
  `expectedObjectKey = organizations/<A-DIFFERENT-ORG-UUID>/jobs/<jobId>/attempts/1/evil.bin`;
  assert **HTTP 200, `outcome:"rejected"`, `reason:"malformed"`, no `grant` key**, and then
  assert with the MinIO admin client that **no object exists** under that foreign prefix;
- repeat for `artifact_commit` with a manifest whose `organizationId` is the foreign org;
  assert rejected/malformed and **zero `job_artifacts` rows**.

### Experiment (b) — is the signing credential bucket-wide?

**Access:** the deployed control plane's S3 credentials and bucket name (an operator with
production/staging secret access).

Take the credential the control plane presigns with (`server/src/storage/s3-provider.ts:86-102`
— the `AOA_STORAGE_S3_*` / AWS env chain) and issue, **directly with that credential**,
`GetObject` on `organizations/<some-other-org>/jobs/<any>/attempts/1/<any>`.

**Expected, given no STS code path exists anywhere:** it succeeds, or returns `NoSuchKey`
rather than `AccessDenied` — either of which confirms the credential is bucket-wide and the
`authentication` clause ("scoped service identity") is **false in the deployed environment**,
not merely absent from source. `AccessDenied` on a foreign prefix would mean an out-of-band
IAM policy supplies the scoping, and that should be recorded.

---

## DE-07 — Control plane ↔ secret and MCP OAuth broker (Critical)

### Experiment A — has this crossing ever denied in a real deployment?

**Access:** the D1 harness or a staging control plane (`docker-compose.d1.yml` /
`docker-compose.staging.yml`, both `AOA_DISTRIBUTED_EXECUTION_ENABLED=true`), an enrolled worker
with a live device key, an Organization set to `mode:"canary"` in
`AOA_DISTRIBUTED_EXECUTION_ROLLOUT`, and a cloud-mode Company with a provider key so the mint
fires. **Blocker first:** staging currently fails closed at boot because it mints neither
`AOA_APP_DB_PASSWORD` nor `AOA_OPERATOR_DB_PASSWORD` (recorded in `scripts/finding-ownership.json`).

Place one job so a handle is minted, then, holding the live fence, `POST
/api/worker-control/execution-secrets/resolve` four times:

1. correct fence → **200 `outcome:"resolved"`**, `envTarget ANTHROPIC_API_KEY`;
2. after `execution_targets.device_generation` is bumped → **200 `outcome:"denied"`, `reason:"target_revoked"`**;
3. with a fence token from a different lease → **denied `stale_fence`**;
4. with a `handleId` belonging to another Organization → **denied `malformed`**, and critically
   **an identical response shape and timing to (3)** — no existence oracle.

Then `SELECT last_resolved_at, resolve_count FROM job_secret_handles` and
`SELECT * FROM secret_access_events WHERE consumer_id = <handleId>` to confirm the audit rows exist.

### Experiment B — is the revocation lever really dead?

Same environment. Attempt to revoke a live handle through **every** operator-facing surface —
UI, CLI, MCP, any admin route — **without writing SQL by hand**.

**Predicted:** no such surface exists, and no code path sets `status='revoked'` or `revoked_at`
(the single write chokepoint, `job-control.ts:3139`, cannot). **If an operator finds one, the
`E0-F011` DE-07 item is wrong and must be corrected.** If they cannot, the remediation is
either to ship a revoke mutator or to delete the dead clause — *a guard that nothing can arm is
the failure class this programme has already shipped three times.*

Neither experiment needs a paid model run; both need a container boot and an enrolled worker.

---

## DE-09 — Worker host ↔ provider sandbox (Critical)

**All three need a paid `E2B_API_KEY` and the keyed `workflow_dispatch` lane.** Experiment 3 is
the one that matters most, because it may show the clause is **unbuildable as written**.

**Boot:** `packages/adapter-manager/src/bin/adapter-manager.ts` with `E2B_API_KEY` set, the
template env set to `aoa-base`, `PORT=8090`, and `CONTROL_PLANE_PUBLIC_KEY_FILE` pointing at a
real ed25519 SPKI PEM.

### 1 — does the sandbox actually contain a host command?

`POST /op/create`, then `/op/execute` a probe and record:

- `id -u` and `capsh --print` — is the tenant root, and with which capabilities;
- `ls -la /`, `cat /proc/1/root/etc/hostname`, and an attempt to read any file under the
  adapter-manager host's working directory;
- `mount`;
- an HTTP POST **from inside the sandbox** to the adapter-manager's own `:8090/op/execute`
  carrying a forged or absent `OwnedLabelsCapability`.

**PASS** = no host path is readable, and the last probe returns the uniform
`ResourceNotAvailableError` rather than executing. This is the only way to turn the
`confidentiality` and `authorization` clauses from *structurally plausible* into *measured*.

### 2 — which template is actually created from?

The library default is `"base"` (`e2b-provider.ts:266`); the matrix pins `"aoa-base"`
(`capability-matrix.ts:63`). Assert on a **live** create that `sdk.create` received `aoa-base` —
via the E2B dashboard's sandbox metadata, or a template-only marker file baked into `aoa-base`
and `stat`'d from inside. **If it receives `base`, the pin is decorative on the keyed lane too**,
not only in the fixture.

### 3 — ★ can ANY capability restriction be expressed on e2b create?

`real-transport.ts:98-103` passes only `{apiKey, timeoutMs, metadata, envs}`. **Before anyone
writes an enforcement point for DE-09's `integrity` clause**, determine from the e2b SDK pinned
in `packages/sandbox-e2b-provider/package.json` and the template definition under `e2b/` whether
a user / capability / seccomp knob exists at all.

**If it does not, DE-09's `integrity` clause is not implementable as written and the register
row must be AMENDED — not marked delivered.** That is a founder decision. Recording "we cannot
enforce this at any available layer" is a legitimate and valuable outcome; quietly leaving the
clause asserted is not.

---

## DE-10 — Crashed worker ↔ provider resources (High)

**This is the only route to `delivered` for the destroy half.** The lease-fencing half is
already measured. The worker-side WRK-007 gap is a **code** gap (E4-D12 composition-root wiring)
and **no live access can settle it** — do not expect this experiment to touch it.

**Access:** the staging stack from `docker-compose.staging.yml` (control plane + adapter manager
on `control-net`), a real **billable** `E2B_API_KEY` and template, and the matched CP/AM ed25519
keypair.

### Setup — the four settings that exist in no manifest today

```
adapter-manager: AOA_ADAPTER_MANAGER_REAPER_ENABLED=1      # exactly "1" — "true" is OFF
                 AOA_ADAPTER_MANAGER_CONTROL_PLANE_URL=http://control-plane:3100
                 AOA_ADAPTER_MANAGER_REAPER_INTERVAL_MS=30000
control-plane (BOTH replicas): AOA_ADAPTER_MANAGER_TRUTH_ROUTE_ENABLED=1
```

`AOA_ADAPTER_MANAGER_TRUTH_SHARED_SECRET` must already match on both, and does in the manifest.

### Positive control FIRST — prove the oracle hop is live, not 404

From the AM container:

```
curl -s -o /dev/null -w '%{http_code}' -X POST \
  http://control-plane:3100/api/adapter-manager-control/lease-truth \
  -H 'content-type: application/json' \
  -H "x-aoa-adapter-manager-truth: $AOA_ADAPTER_MANAGER_TRUTH_SHARED_SECRET" \
  -d '{"orgs":[{"organizationId":"<real-org-uuid>","leases":[{"leaseId":"<real-lease-uuid>"}]}]}'
```

**Must be 200 with a `verdicts` body. A 404 means an arm is still off and every subsequent
observation is vacuous.**

### The measurement

1. Run one real distributed attempt to completion of `create`, so a real E2B sandbox exists
   carrying a parsed 7-tuple `ResourceLabels` and a non-zero generation. (A sandbox failing
   `isStructurallyInterpretable`, `reconcile-reaper.ts:119-125`, is skipped by design and proves
   nothing.)
2. `SIGKILL` the worker container mid-`execute` — do not let it tear down.
3. Back-date the lease row and fire the reap (`POST /api/worker-control/_test/reap` with
   `AOA_D1_TEST_REAP_ENABLED=1`, or wait for the live MIG-002 loop) so `leases.status` becomes
   `expired` → `classifyLeaseTruthRow` returns `terminal`.
4. Wait 2 reaper intervals. **All three must hold:**
   - (a) the AM log line `reaper: orphan reclaim` with `cleanupStatus: "success"` for that
     sandboxId, and a sweep tally with `reaped >= 1`;
   - (b) the sandbox is **GONE from E2B by an INDEPENDENT read** — `e2b sandbox list` against
     the real API, **not** the AM's own `provider.list`, and **not** its `getInfo()` echo.
     ★ This is the DE-08 lesson: a read-back that returns your own value verifies what was
     declared, never what is enforced.
   - (c) the E2B billing/usage record for that sandbox stops accruing.
5. **NEGATIVE CONTROL** (proves the oracle, not the TTL, did the killing): repeat with a sandbox
   whose lease is still `active`, and assert it is **NOT** destroyed (`skipped` bucket). Without
   this, the 60s `DEFAULT_TTL_MS` (`e2b-provider.ts:78`) could be what actually reclaimed the
   sandbox in step 4, and the reaper would be credited for the provider's own timeout.
6. Re-run convergence: fire a second sweep and assert no double-kill and a stable tally.

Only (a)+(b)+(c)+(5) **together** upgrade the second conjunct of DE-10's `revocation` clause.

---

## DE-11 — Browser-session workload ↔ sensitive artifacts (High)

Both checks are **read-only, cost nothing, and need only read access to the deployed bucket.**
Neither can change the audit or revocation verdicts, which are settled by WHERE clauses in
source. Only (a) could change the encryption verdict.

- **(a) Encryption at rest.** `aws s3api get-bucket-encryption --bucket <artifact-bucket>`.
  A `ServerSideEncryptionConfiguration` means the bytes are encrypted by bucket policy even
  though the application code never asks — the **only** way this clause could turn out
  delivered, since `PutObjectCommand` provably never sets it. `NoSuchEncryptionConfiguration`
  confirms plaintext at rest.
- **(b) Lifecycle purge.** `aws s3api get-bucket-lifecycle-configuration --bucket <artifact-bucket>`.
  A `NoSuchLifecycleConfiguration` error confirms the `revocation` clause has no out-of-band
  implementation either.

---

## DE-12 — Service desired-state ↔ reconciled instances (Critical)

**No live access can settle anything here, and that is not a hedge.** You cannot measure a
reconciler that has no file, and `services.generation` has **no writer** to trigger a rollover
with. The five absences are settled statically. Two things a live run would add, neither
load-bearing, recorded so nobody re-derives them:

- **(a)** To confirm production-unreachability empirically rather than by grep: on a
  `distributedExecutionEnabled` instance, POST the job-control submission route with
  `source: {kind:"service_reconcile", serviceId:<any>, generation:1, reconciliationId:<uuid>}`
  as each of the four authenticable actor types (board user, agent key, MCP key, Commander run
  JWT). **Expect 403 from the requester-kind gate (`job-submission.ts:164-166`), never from the
  generation gate**, and `SELECT count(*) FROM jobs WHERE source_kind='service_reconcile'` = 0.
- **(b)** The experiment that would actually settle DE-12 **does not exist yet and cannot be run
  until SVC-002/003/005 are written**: a D4 canary that (1) runs a service at generation N,
  (2) bumps `services.generation` to N+1, and (3) shows the N-generation instance's next
  governed write is refused and its lease revoked. Today step (2) has no code path and step (3)
  has no fence to test. **That is DE-12's exit criterion, not an access request.**

---

## DE-13 — Shared scheduler ↔ per-Organization workloads (High)

The quota half is settled. Live access is needed only to close **REL-002's acceptance** — *"One
noisy Organization cannot starve another"* — which no amount of source reading can settle,
because the scheduler's ordering has no tenant dimension and the outcome depends on fleet size
versus aggregate org caps. **REL-002 has zero files on disk**; this experiment is what it would
have to contain.

**Access:** a two-replica control plane on the D1 compose topology (`tests/d1`,
`docker-compose.d1.yml`).

1. Provision N worker targets and two organizations A and B. Set
   `UPDATE organizations SET concurrency_cap = <k> WHERE id = ...` **by raw SQL** for each —
   there is no API, UI or CLI for this; `organizations.concurrency_cap` has exactly one reader
   and **no writer anywhere**. Choose k_A + k_B > N so the fleet is genuinely oversubscribed.
2. Submit a deep backlog for A first (say 5 × k_A jobs, so 4/5 are rejected 429 and k_A queue),
   let A's attempts take the head of the queue, then submit a **single** job for B.
3. Measure B's time-to-first-offer, and instrument the candidate claim
   (`packages/db/src/repositories/tenant/job-control.ts:1981`) to record the organization of each
   offered attempt.
   **Prediction:** because the ORDER BY is `availableAt, priority DESC, createdAt, id` with no
   org term, B waits behind every one of A's k_A in-flight attempts, bounded only by k_A and by
   attempt duration. **That window IS the starvation the clause asserts cannot happen.**
   **PASS criterion REL-002 needs:** a bounded B latency *independent of A's backlog depth*.
4. Separately, to test whether the shipped throttle can ever bind: set
   `AOA_WORKER_POLL_RATE_LIMIT_MAX` to a realistic value (the default 100,000/60s cannot fire)
   and confirm the `throttled` 429 (`worker-control.ts:414`) appears in A's poll stream while B
   still progresses.
5. For the audit gap **no live access is needed** — the absence is settled in source. But note
   for whoever runs this: step 2's 429s produce only `reasonCode: "job_submission_rejected"` log
   lines with no cap and no usage, and step 4's throttles produce **no log line at all**, so this
   experiment currently **cannot be reconstructed from the deployment's own records**.

---

## DE-14 — Hosted startup ↔ process-wide unsafe override (Critical)

**Nothing is owed.** The deny path was taken at tip by calling the real exported
`assertHostedExecutionStartupSafe` directly: `cloud_auth` + `"1"`, `"on"` and `"banana"` all
threw (the last on the boolean parse — it fails closed on garbage), while the positive controls
held: `cloud_auth` + `"0"`, `cloud_auth` unset, `local_trusted` + `"1"` and `authenticated` +
`"1"` all passed, the last three by design. It has exactly one production caller
(`server/src/config.ts:198`) reached at module top level of the entrypoint
(`server/src/index.ts:164`) with no `try/catch`.

The only absent clause is `audit` ("the startup safety-assertion outcome is logged"), and that
is settled in source: the module imports no logger and contains no logging call at all.

---

## What this document does NOT cover

**Sixteen of the thirty crossings — DE-15 through DE-30 — were not audited at all**, and none of
them appears above. They remain `deliveryStatus: "unaudited"`, which means *unknown*, never
*holds*. Twelve of the sixteen are Critical. Their pinned count is the ceiling in
[`distributed-execution-audit-debt.json`](../architecture/distributed-execution-audit-debt.json),
and `scripts/check-threat-control-audit-debt.mjs` will red if it grows. **The ratchet stops the
debt increasing; it does not imply the remaining sixteen are healthy, and it must not be read
that way.** Each still needs the same treatment the twelve got: find the enforcement point,
count its callers, and exhibit it denying.
