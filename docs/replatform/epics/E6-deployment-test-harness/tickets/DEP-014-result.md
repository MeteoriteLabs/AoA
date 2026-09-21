# DEP-014 Result — the adapter-manager image in the signed split-image build

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E6-deployment-test-harness`
**Plan task:** `E6 implementation-plan §4c DEP-014 — the adapter-manager image in the signed image build, admitted in CI; NOT pushed (M1a)` (title amended 2026-09-21; was `…pushed by CI (M1a)`)
**Implementer:** `M1 build agent (Claude Opus 5)`
**Start SHA:** `e5bc0bc81` (program tip `docs/replatform-program` after rebase)
**Reviewed revision (code):** `ebf2c6e6e646cfc56f95cf0f0c7f0a93eb5aa06e`
**PR:** #543 (base `docs/replatform-program`)

The implementer leaves `Status` at `gate_review`. Only a DISTINCT reviewer may set `complete`.

**Keyless.** Nothing in this ticket boots the adapter-manager (AM) or reads a provider key, and no
`keyed-*` workflow was dispatched. `docker-compose.d1.yml` is unchanged and has no AM service.
Booting the AM is `DEP-015`.

---

## 1. What shipped

| Acceptance clause (E6 plan §4c) | Where | State |
|---|---|---|
| 1. `build.sh` emits an AM digest, metadata, SBOM and admission entry beside the other two | `docker/images/build.sh` (`build_one "adapter-manager" …`), `sbom.sh` and `sign.sh` (the three-image loops) | **met.** `digests.env` gains `ADAPTER-MANAGER_{IMAGE,DIGEST,REVISION}` in the existing `${name^^}` form (plan "Interfaces") |
| 2. Admission rejects a tampered or unsigned AM digest (the **positive control**) | new `docker/images/admit.sh`, which delegates the verdict to the unchanged `scripts/verify-image-admission.mjs` / `evaluateAdmission` | **met.** See §3 |
| 3. Image content: no baked `E2B_API_KEY`, no server/UI/DB tooling, non-root, provider SDK present | `docker/images/__tests__/image-contents.test.mjs` (four new AM tests plus one worker test) | **met, with one delta.** The clause "provider SDK *only* in the AM" is false at HEAD (§5.2) and is **not** asserted |
| 4. `d1-merge-train.yml` builds the image on every run | step *"Build split D1 images"* runs `build.sh`; new step *"Sign, SBOM and admit the split images (DEP-014)"* is unconditional | **met** |
| "pushed by CI" | — | **DESCOPED** by ruling (§5.1) |

Other changes:

- The D1 lane uploads the chain record as artifact `d1-image-chain-<run_id>`, `if: always()`. It contains the digests, the buildx metadata, the SBOMs, the provenance, the allowlist and the TEST public key. The TEST private key is excluded with `!docker/images/trust-root.key`, and the static test enforces that exclusion.
- `docker/adapter-manager/Dockerfile`: a header comment only. The old comments said "nothing here is built" and "build/sbom/sign.sh deliberately NOT wired"; they are now marked "★ Superseded by DEP-014". The old wording is quoted, not rewritten.
- The comment on the D1 `env:` block, which said "This lane does NOT verify admission", is corrected in the same way.
- `.gitignore` gains the chain's per-run outputs, including `trust-root.key`.
- Registration:
  - `scripts/test-execution-census.json`: the new `image-pipeline.test.mjs` runs in `pr.yml` `policy`, in the step *"Split-image Dockerfile static checks (DEP-001)"*.
  - `scripts/test-inventory.json`: the `docker` pin moves from 5 to 6. Only that tree was changed.
  - `.github/workflows/pr.yml`: a 2-line addition, placed so that no register citation moves.
  - The D1 `paths:` list gains `scripts/verify-image-admission.mjs`.
- `check-release-admission.mjs` and `RELEASE_ARTIFACT_CLASSES` are **untouched** (§5.3).

## 2. A defect that predates this ticket, found and fixed

**`sbom.sh` and `sign.sh` had never run.** Both did `source "${DIGESTS}"`. `build.sh` writes the keys
as `${name^^}_…`, and bash's `^^` keeps the hyphen, so the line `CONTROL-PLANE_IMAGE=…` is a
command rather than an assignment. Measured on this host before the fix, against a one-line `digests.env`
in `build.sh`'s own format:

```
digests.env: line 1: CONTROL-PLANE_IMAGE=localhost/aoa/control-plane:abc1234: No such file or directory
sbom exit=127
digests.env: line 1: CONTROL-PLANE_IMAGE=localhost/aoa/control-plane:abc1234: No such file or directory
sign exit=127
```

There was a second latent failure. `sign.sh` exec'd `"${IMAGES_DIR}/provenance.sh"` directly, but that file is git mode
`100644`, so a CI checkout would have failed with "Permission denied". Both scripts now parse `digests.env`
with a `digest_value` helper, assign each value before using it (under `set -e` a failed substitution
inside an argument list does not abort), and run `bash provenance.sh`. The hyphenated key form is kept
on purpose, because `d1-merge-train.yml` greps `^CONTROL-PLANE_IMAGE=` (see the comment in `image-contents.test.mjs`).

## 3. RED → GREEN, positive controls and mutations

### RED (local, before the implementation)

`node --test docker/images/__tests__/image-pipeline.test.mjs`: **12 tests, 1 pass, 11 fail**. The one
pass was the "boots nothing" fence. The failures:

- `build.sh must build adapter-manager from docker/adapter-manager/Dockerfile`;
- `d1-merge-train.yml must run: bash docker/images/sbom.sh`;
- the behavioural cases, because `admit.sh` did not exist and the scripts had no out-dir seam;
- the exit-127 evidence in §2.

### GREEN (local, Windows, Git Bash with real openssl)

`image-pipeline.test.mjs`: **12/12 pass**. The focused verify gives
`node --test scripts/lib/__tests__/image-admission.test.mjs` **22/22**. The adjacent suites:

| Suite | Result |
|---|---|
| `dockerfile-static` | 28/28 |
| `ci-lanes` | 20/20 |
| `d1-compose-invariants` | 61/61 |
| `check-staging-manifest.test` | 33/33 |
| `staging-manifest` | 22/22 |

`node scripts/check-staging-manifest.mjs` is green; the staging invariants were not touched or loosened.
The full `pr.yml` guard set plus `check-evidence-immutability --base origin/docs/replatform-program`
ran with **0 failures**.

### Positive controls: six on every PR, docker-free

Each control mutates one input for the adapter-manager, and `admit.sh` must refuse it for the stated reason.

| Control | Refused with |
|---|---|
| AM allowlist entry removed (the state before DEP-014) | `adapter-manager: REFUSED — no admission entry` |
| live digest ≠ recorded (tampered or retagged image) | `REFUSED — live digest … does not match the recorded` |
| recorded digest forged (live digest agrees with it) | `REFUSED — no admission entry` |
| AM signature replaced by the worker's real signature | verifier `REJECTED — signature verification failed` |
| AM signature empty | verifier `REJECTED — unsigned digest` |
| AM source revision changed | verifier `REJECTED — provenance mismatch` |

### Mutation sweep: 9 mutants, 9 killed, tree restored byte-identical

| # | Mutation | Killed by |
|---|---|---|
| M1 | `build.sh` drops the AM `build_one` | the static build test |
| M2 | `sign.sh` signs only CP+worker | 5 tests (sign, admit, three verifier controls) |
| M3 | `admit.sh` skips the live-digest check | the tampered/retagged control |
| M4 | `admit.sh` lets a missing entry through | the no-entry and forged-digest controls |
| M5 | `admit.sh` ignores the verifier's verdict | the corrupted, unsigned and wrong-revision controls |
| M6 | `sbom.sh` `source`s `digests.env` again | the sbom and admit tests |
| M7 | the D1 lane drops `bash docker/images/admit.sh` but keeps the controls | the static D1 test |
| M8 | the D1 lane drops `sign.sh` | the static D1 test |
| M9 | the D1 upload stops excluding `trust-root.key` | the static D1 test |

★ M7 **survived the first draft.** That draft matched the needle as a substring, and the in-run
controls also contain `bash docker/images/admit.sh > …`, so the check was vacuous. It now requires a whole
command line, and M7 is killed.

## 4. CI evidence (cited by job)

`d1-merge-train` fires only on push to `main` or `docs/replatform-program`, so it cannot run on the PR.
The PR tree plus **one** trigger line was pushed to a throwaway branch, `claude/m1-dep-014-d1-probe`,
which is never merged and has no PR. For probe run 2, `git diff ebf2c6e6e b514027a3` = 1 line of
`d1-merge-train.yml`.

| Run / job | Tree | Result |
|---|---|---|
| **35584027694** / job `d1-merge-train` (106283086997) | `b514027a3` = PR head `ebf2c6e6e` + trigger line | **success**. Every step passed, including bring-up and the E6F campaign |
| 35583366997 / job `d1-merge-train` (106281019011) | PR head `3a3d32456` + trigger line | **failure**, in *"Least-privilege assertions"* only. That is the worker-`e2b` assertion in §5.2, which was mine and wrong |

Details of run 35584027694:

- *"Sign, SBOM and admit the split images (DEP-014)"* passed:
  - 3 SBOMs, 3 signatures;
  - `ADMITTED — admitted control-plane sha256:010cdeef…`, `… worker sha256:aaecbf95…`, `… adapter-manager sha256:f3d6212f…`;
  - `all three split images admitted`;
  - then the three in-run controls against the real images, each `adapter-manager: REFUSED`: no admission entry, live digest `aaecbf95…` of the worker tag ≠ recorded `f3d6212f…`, and the verifier rejecting it;
  - `DEP-014: 3/3 in-run positive controls refused`.
- *"Least-privilege assertions on the BUILT images"*: `image-contents.test.mjs` **9 tests, 9 pass, 0 skipped**.
- *"Run the E6F campaign (live)"*: **47 pass / 0 fail**. The AM image was built but never booted.
- Artifact: `d1-image-chain-35584027694` (7166 bytes).

**Still owed after merge:** the first `d1-merge-train` run on `docs/replatform-program` that contains
this change. The probe is its equivalent, not a substitute for it.

PR #543 `pr.yml`: `policy` passed on `3a3d32456`. `ci-required` and Codex on the final head are
recorded in the PR.

## 5. Where the task section and the code disagree (stopped, not improvised)

1. **"pushed by CI … the same mechanism as the others": there is no such mechanism. RESOLVED by ruling.**
   No workflow pushes the control-plane or worker `:staging` image. The only push in the repo is `docker.yml`'s
   `build-and-push`, and it pushes the **combined** `./Dockerfile` image. `build.sh` loads images locally
   (`--load`, registry `localhost/aoa`). So no push was added. Codex raised the same gap (P2, `build.sh`),
   and it was escalated rather than improvised.
   **Ruling (2026-09-21, M1 planning session, decided under founder delegation F2): the push is DESCOPED from
   DEP-014.** Founder ruling F3 has the shipped CI boot (DEP-015) *build* all three images from source, so nothing
   in M1 consumes a pushed tag. Pre-checkpoint publication must be a deliberate, authorized act, never a lane
   side effect. Publishing the adapter-manager image, together with the control-plane and worker images,
   belongs to the **M5 release lane** at the integration checkpoint. The graph node (`program-design.md`) and the
   E6 task section are amended in this PR, with the superseded text quoted.
2. **"the provider SDK is present only in the adapter-manager image" is false for both siblings.**
   - The control-plane carries `e2b`: `server/package.json` depends on it, and `sandbox-provider-runtime.ts`
     imports it for cloud_auth extraction (Decision #104).
   - The worker's `/worker-net-app` carries it too, because `provider-wire` value-imports
     `sandbox-e2b-provider/errors.js` (`codec.ts`, `driver.ts`). This was measured red on run 35583366997,
     and it was already recorded as "structurally safe (no key, never imported)" in
     `qa/2026-08-31-blocker-ab-fix-design.md`.

   `checkProviderControlBoundary` fences the **credential** and the network, not the SDK, so the
   assertion that ships is "no baked `E2B*` env" for both the worker and the AM.
3. **`scripts/check-release-admission.mjs` is listed in "Files" but was not touched.**
   `RELEASE_ARTIFACT_CLASSES` is a frozen five-member set that default-denies unknown classes, and the AM is
   deliberately outside it (DEP-012 design S45 fences; REL-004 is a non-goal). The lane's TEST-root
   admission proves **chain integrity**, not approval.
4. The §3 focused-verify row says *"the `d1-merge-train` job that builds, signs and admits all three"*.
   Before this ticket the lane did **not** sign or admit, and its comment said so. That step is created
   here rather than extended.
5. `program-design.md` says *"no worker or server tooling"*, while the task section says
   *"server/UI/database"*. `worker-daemon` is in the AM's intended seven-package closure, so the task section's
   wording is the one asserted.

## 6. Reviewer section

*(To be completed by a distinct reviewer.)*
