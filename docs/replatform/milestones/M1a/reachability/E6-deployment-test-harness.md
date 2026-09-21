# E6 — Deployment and test harness: M1a candidate reachability ledger (SKELETON)

**Measured at:** program tip `b71f0dd539fe713c776f3935932be33af1a24fae` (not a candidate)
**Candidate:** `TO MEASURE AT CANDIDATE FREEZE`
**Exit gate** (`epics/E6-deployment-test-harness/README.md`): full D1 isolated topology,
fake/reference provider isolation suite, MinIO, Toxiproxy, CI evidence, staging manifests,
two-replica HA, and distributed telemetry pass. Real E2B conformance is the CLI-001/D2 gate, not an
E6 prerequisite.
**Columns:** see [README](./README.md). `Certified only by M1-D1-SPINE` is `TO MEASURE AT
CANDIDATE FREEZE` on every row, and it is not repeated in the table.

★ **E6 has no `gate-clause-wiring` entries.** Its mechanisms are harness and deployment, not
production symbols. For E6, **"production-reachable" means exercised by a CI lane on the program
branch without an operator dispatch.** An operator-dispatched workflow is recorded as such, and
ruling F3 excludes it from "shipped CI boot".

★ **The last D1 lane run at the tip is not tip evidence.** The last `d1-merge-train` success on
`docs/replatform-program` is run `35504786263`, job `d1-merge-train`, at `52626d80e9fc`. That SHA
is an ancestor of the tip, but **19 non-doc files differ** between the two
(`git diff --stat 52626d80e9f <tip> -- ':!docs'`). The lane is path-triggered (`on.push.paths`),
so it did not re-run. The runs before it, `35238458091` (2026-09-17) and `35017820850`
(2026-09-15), **failed**.

| # | Mechanism | Symbol / artefact | Present @tip | Exercised by a non-dispatch CI lane @tip | Tenant isolation (F10) @tip | M1 tickets that change this row | At candidate |
|---|---|---|---|---|---|---|---|
| E6-1 | full D1 isolated topology | `docker-compose.d1.yml`, services `postgres`, `minio`, `toxiproxy`, `migrate`, `control-plane`, `control-plane-b`, `worker-a`, `worker-b`, `fake-provider`, `test-runner` | yes | `d1-merge-train.yml` (push to `main` / `docs/replatform-program`, **path-filtered**). The last success is at `52626d80e9fc` (see above). | ★ **Single-Organization at the tip.** `AOA_DISTRIBUTED_EXECUTION_ROLLOUT` is not set in `docker-compose.d1.yml`. `worker-a.profile.json` is platform-scoped (`organizationId: null`), and `worker-b.profile.json` is bound to one Organization. **The F10 topology (≥2 enabled Organizations plus 1 control) does not exist in D1.** | **`DEP-016`** (the `m1-spine` one-worker profile, evidence retained on pass), **`DEP-018`** (F10 tenant matrix) | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-2 | fake/reference provider isolation suite | `docker/d1/fake-provider-entry.mjs`, `fake-provider.Dockerfile`; `packages/sandbox-fake-provider` | yes | through E6-1 | `TO MEASURE AT CANDIDATE FREEZE` (cross-resource denial, DEP-008) | — | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-3 | MinIO | compose service `minio` (`docker/d1/minio-init.sh`) | yes | through E6-1 | Object keys and prefixes per Organization: `TO MEASURE AT CANDIDATE FREEZE` | — | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-4 | Toxiproxy | compose service `toxiproxy` (`docker/d1/toxiproxy.json`) | yes | through E6-1 | n/a | **`DEP-018`** (a fault matrix per profile, with each injection shown to fire) | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-5 | CI evidence | `ci-required` aggregator (`.github/workflows/pr.yml`); the DEP-013 verdict consumer; D1 evidence retention | yes | `pr.yml` on every PR. The M1 plan §1.3 states that D1 keeps evidence **only on failure** (not re-measured here). | n/a | **`DEP-016`** (retain on pass) | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-6 | staging manifests | `scripts/check-staging-manifest.mjs` (the `policy` job in `pr.yml`) | yes | `policy` job on every PR | `checkDispatchDefaultOff` (`staging-manifest-invariants.mjs`) rejects the worker's `AOA_WORKER_PROVIDER_URL` (M1 plan §1.1, not re-measured here) | **`DEP-015`** (an amendment scoped to the CI-boot overlay only) | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-7 | two-replica control-plane HA | compose service `control-plane-b` (DEP-009) | yes | through E6-1 | n/a | — (the M1 spine is one control plane) | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-8 | distributed telemetry | DEP-007 baseline | `TO MEASURE AT CANDIDATE FREEZE` | `TO MEASURE AT CANDIDATE FREEZE` | per-Organization attribution: `TO MEASURE AT CANDIDATE FREEZE` | — | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-9 | adapter-manager image and boot | `packages/adapter-manager`; `docker/adapter-manager/` | source yes | ★ **No.** `docker-compose.d1.yml` and `docker/images/build.sh` contain **zero** occurrences of `adapter-manager` (measured with `grep -c`). Only the operator-dispatched `deploy-replatform-campaign.yml` deploys it (M1 plan §1.1). | Worker→adapter-manager mTLS is not built (M1 plan §1.1, not re-measured here) | **`DEP-014`** (image built and pushed by CI; the D1 train builds it) | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-10 | shipped CI boot (ruling F3) | — | **no** | **no.** No workflow builds the control-plane, worker and adapter-manager images together and runs the journey in the boot they form. | must boot the F10 three-Organization topology | **`DEP-015`** | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-11 | live env-absence probe (criterion 5, F9) | — | **no** | **no** | a planted canary must turn the probe red for **each** tenant | **`DEP-017`** | `TO MEASURE AT CANDIDATE FREEZE` |
| E6-12 | real E2B lane | `.github/workflows/keyed-e2b-*.yml` | yes | **no, not as a CI boot.** All seven `keyed-e2b-*.yml` workflows have `workflow_dispatch` plus a `push` trigger that is path-filtered to a dedicated trigger file (for example `.github/keyed-e2b-trigger`) or to the workflow file itself. Some are also filtered to specific branches. None runs on an ordinary program commit. Each run is a deliberate, spend-bearing action that requires an F8 named-list authorization. None boots the control plane, worker and adapter-manager together (E6-10). | `TO MEASURE AT CANDIDATE FREEZE` | `DEP-015`, `E7-1-JOURNEY-ARM` (F8 list) | `TO MEASURE AT CANDIDATE FREEZE` |
