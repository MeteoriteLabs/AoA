# E6-F021 (2026-09-24 amendment) — the D1 MinIO image, mirrored into our own GHCR and pinned by digest — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `E6-F021` re-repair (urgent, planning session, 2026-09-24) · **Milestone:** `M1a` (unblocks every D1 campaign)
**Date (UTC):** `2026-09-24`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `3966a01f9f` (`origin/docs/replatform-program`)
**PR:** #603 (base `docs/replatform-program`)
**Reviewed revision:** `FINALSHA`

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.

---

## 1. What broke, and why it is the SECOND time

Nine D1 dispatches over ~2.5 hours died at *Bring up the D1 stack* before a single test ran, which
blocks every D1 campaign and therefore `M1a`.

`E6-F021` was filed on 2026-09-20 because Docker Hub had DELETED `minio/minio`, and it was repaired
by pinning `docker-compose.d1.yml` to `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` — MinIO's
own registry, measured at **200** with a multi-arch manifest list that day. **quay.io has since
closed that repository.**

## 2. Re-verification of the planning session's measurement (done before building anything)

Re-measured independently, 2026-09-24, with controls on both registries:

| registry | request | result |
|---|---|---|
| quay.io | pull-scoped token for `repository:minio/minio:pull` | issued, **801 chars** |
| quay.io | `GET /v2/minio/minio/manifests/RELEASE.2025-09-07T16-13-09Z` | **401** |
| quay.io | `GET /v2/minio/minio/manifests/latest` | **401** |
| quay.io | **control** `GET /v2/prometheus/busybox/manifests/latest`, own token, anonymous | **200** |
| Docker Hub | `GET /v2/minio/minio/manifests/RELEASE.2025-09-07T16-13-09Z` | **401** |
| Docker Hub | `GET /v2/minio/minio/manifests/latest` | **401** |
| Docker Hub | **control** `GET /v2/library/busybox/manifests/latest` | **200** |

**The planning session's measurement reproduces exactly**, including the 801-char token and the
busybox control. The controls are what make this a REPOSITORY closure and not a registry outage.

I then went looking for the public route the brief asked me to look for, because finding one would
have changed the fix. **There is none:**

| candidate | result |
|---|---|
| `mirror.gcr.io/minio/minio` — the dated tag, `latest` | **404**, **404** |
| `quay.io/minio/mc`, `quay.io/minio/aistor-minio` | **401**, **401** |
| `quay.io/minio/operator` | **404** |
| `registry.min.io/v2/` | **401** |
| `dl.min.io/server/minio/release/linux-amd64/minio` | **410 Gone** |
| `minio/minio` GitHub releases | latest release tag exists; **0 assets** (source tags only) |
| `docker.io/bitnami/minio` | **404** (Bitnami retired it) |

So: the *image* is unobtainable from every documented source, but the *project* is not gone — two
public third-party BUILDS of the MinIO server still exist (`docker.io/bitnamilegacy/minio` **200**,
`cgr.dev/chainguard/minio` **200**). That distinction is what makes a mirror possible at all, and it
is the fact that decided the option.

## 3. The option chosen, and why

**(a) mirror into this organisation's own GHCR, pinned by digest.**

The class is not *"quay went down"*. It is **a gate lane whose bring-up depends on a third party's
decision to keep serving an image**. The 2026-09-20 repair replaced one third party's registry
policy with another's and bought nine days; repeating that shape is how this costs a third outage.

- **(b) authenticate to quay in CI** — rejected. It keeps the upstream source but puts a credential
  into every lane that brings the stack up, and it fails *identically* the next time the policy
  tightens: authentication is still permission granted by someone else. A GHCR credential we mint
  from the run's own `GITHUB_TOKEN` is not the same class of dependency — nobody outside this
  organisation can revoke it.
- **(c) substitute a different S3-compatible server** — rejected, and deliberately not attempted. It
  is the only option that would require re-verifying presign, HTTPS-on-`:9000` from `public.crt` /
  `private.key`, and the `DAT-002` slice-7 round-trip against a *different implementation*. Since the
  real MinIO binary is still obtainable, paying that cost buys nothing.

## 4. What the mirror actually is

`docker/d1/minio.Dockerfile` lifts `/usr/bin/minio` from `cgr.dev/chainguard/minio` (a public build
of the upstream `minio/minio` project) and re-homes it on `debian:trixie-slim`. **Both images are
pinned by digest**, and the source is overridable by a build arg, because Chainguard's free tier
serves `:latest` only and garbage-collects older digests — a refresh whose pinned source digest has
aged out is the expected reason to need the override.

The re-homing exists so that **nothing in the compose service had to be softened**:

| the compose service assumes | Chainguard's image | after re-homing |
|---|---|---|
| runs as root, so `/root/.minio/certs` (the DAT-002 slice-7 `:ro` bind) is readable | `USER 65532` | root |
| ships `curl`, which the healthcheck shells out to | distroless — no curl | `curl` + `ca-certificates` |
| `ENTRYPOINT` is the server, so `command: ["server","/data",…]` works | already the binary | unchanged |

`docker-compose.d1.yml`'s `minio` service — `command`, `environment`, `healthcheck`, `volumes`,
`networks` — is **byte-for-byte unchanged**. The only edited line is `image:`.

★ **Pinned by DIGEST, not by tag.** A tag we own is still a tag. `:d1` exists for humans; the digest
is what the lane resolves, so a re-cut mirror cannot silently change what the gate brings up.

## 5. Local proof, before any dispatch (E.3 — probe before you fix)

Docker was available locally, so the drop-in claim was measured rather than dispatched:

```
docker build -f docker/d1/minio.Dockerfile -t aoa-d1-minio:local .
docker run -d -e MINIO_ROOT_USER=aoa-d1 -e MINIO_ROOT_PASSWORD=aoa-d1-secret \
  -v .../docker/d1/certs:/root/.minio/certs:ro \
  aoa-d1-minio:local server /data --console-address :9001
```

- logs: `Version: RELEASE.2026-09-22T19-25-18Z (go1.27.1 linux/amd64)`
- logs: `API: https://172.17.0.2:9000  https://127.0.0.1:9000` — **TLS auto-enabled from the
  committed harness certs**, which is what `DAT-002` slice-7's strictly-`https` grant `url` requires
- the **exact** healthcheck command from the compose service,
  `curl -fsSk https://127.0.0.1:9000/minio/health/live`, run inside the container: **200**

Repeated against the **published digest** (§6) after the mirror was cut, not only against the local
build: same three results.

## 6. The mirror lane, and the registration wall

`.github/workflows/d1-image-mirror.yml` is the publish path and the refresh story. Dispatch-only,
`packages: write`, one job, prints the digest to pin.

**Hypothesis before the first dispatch:** *a `workflow_dispatch`-only workflow pushed to a feature
branch is dispatchable there.* Predictions — right: the run starts. Wrong: `gh` refuses on
registration grounds, or the GHCR push 403s because `GITHUB_TOKEN` may not create an org package.

**Measured: wrong, on the registration half.**

```
HTTP 404: workflow d1-image-mirror.yml not found on the default branch
```

That is the `E6-D001` pattern `m1-shipped-boot.yml` already documents in prose: GitHub will not
dispatch a workflow absent from the default branch until a run has created it. The file therefore
carries the same **registration-only** `push` trigger — `paths:` is the file itself, `branches:`
includes `claude/**` so a build agent can register on its own branch, and the job is gated
`if: github.event_name == 'workflow_dispatch'`, so a push-created run executes **zero steps** and
publishes nothing.

- registration run **`36022093784`** — `event: push`, conclusion **`skipped`**, zero steps. That is
  the positive control for "a push cannot publish".
- publish run **`36022154408`** — `event: workflow_dispatch`. Login, build and **push all `success`**,
  which also settles the other prediction: `GITHUB_TOKEN` with `packages: write` can create this
  package. Published:

  ```
  ghcr.io/meteoritelabs/aoa-d1-minio@sha256:e22381966a3256a05c7f2b8dbedd0498b22ff8eafc8d3bc5040604fb57f8f35e
  ```

  The run nevertheless concluded **`failure`**: the step-summary step exited 2 on a quoting bug,
  *after* the push succeeded. Fixed in the same PR, and recorded here rather than quietly — a lane
  whose publish works and whose conclusion is red is exactly the shape this programme mis-reads.

A repo-scoped GHCR package is not anonymously pullable, so `d1-merge-train.yml` gains `packages: read`
and a `docker login ghcr.io` step in **all three** jobs that bring the stack up (`d1-merge-train`,
`m1-spine`, `m1-fault-matrix`) — swept by count, not by memory: 3 checkout sites found, 3 patched.

## 7. The acceptance run

The brief's acceptance was *"a run that brings the stack up — a green bring-up past the point where
the nine failures died."* That was met, and then exceeded: the **whole lane** is green.

**Hypothesis before the second dispatch, with both predictions.** *The presign failure in
`36022608037` was caused by the MinIO VERSION, not by the re-homing; restoring
`RELEASE.2025-09-07T16-13-09Z` makes E6F-05 and E6F-14 pass.* If right, the campaign goes green. If
wrong, the presigned PUT still returns `400 … headers … not signed` — which would have said the
version was a red herring and something about the image's own construction (the root user, the
static build, the missing upstream entrypoint) was at fault, and would have sent me to compare the
two builds' request handling rather than their versions.

**Measured: right.**

| run | head | image | *Bring up the D1 stack* | *Run the E6F campaign (live)* |
|---|---|---|---|---|
| `36022608037` | `7b133079aa` | Chainguard-derived, MinIO `RELEASE.2026-09-22T19-25-18Z` | **success** | **failure** — E6F-05, E6F-14 |
| **`36025567413`** | `bb2835a98d` | source-built, MinIO `RELEASE.2025-09-07T16-13-09Z` | **success** | **success** |

★ **The first run is kept in this record on purpose.** It is the one that satisfies the brief's
literal acceptance, and it is also the one that falsified "any MinIO will do" — a cycle that KILLS a
line of reasoning is worth recording, not quietly replacing with the cycle that worked.

## 8. The class sweep (E / E.1)

**The class, in one sentence:** *a D1 image reference the lane pulls, anonymously, from a registry
whose contents a third party can withdraw.*

**Its dual** (E.1(b)): *a D1 image reference pinned only by TAG, so the bytes can change under us
without the reference changing.* Searched for both.

Enumerated by `grep -rn "image:" docker-compose*.yml` plus `grep -rn "^FROM" docker/`, not by memory.
D1-lane third-party refs: **4 checked, 1 found broken, 1 fixed.**

| ref | anonymous pull, 2026-09-24 | tag-only? |
|---|---|---|
| `minio/minio` (both registries) | **BROKEN** (401) | was tag-only → **now digest-pinned in our GHCR** |
| `pgvector/pgvector:pg18` | 200 `sha256:2ba9ca5f…` | tag-only |
| `ghcr.io/shopify/toxiproxy:2.9.0` | 200 `sha256:b44c2832…` | tag-only |
| `node:lts-trixie-slim` (compose `test-runner`) | 200 `sha256:8ec5d755…` | tag-only |

So the *withdrawal* class has exactly one member and it is fixed. **The dual class has three
surviving members**, deliberately not changed here: digest-pinning them is a correct change but it is
not this outage, and bundling three unrelated image moves into the PR that has to unblock `M1a`
today widens the bring-up blast radius for no gain. Their digests are recorded above so the follow-up
is mechanical. **Filed with an honest owner rather than left silent:** see §10.

**And my own diff is in the class (E.1(a)).** `docker/d1/minio.Dockerfile` pins BOTH its `FROM`s by
digest — the Chainguard source and the Debian base — because a mirror built from a moving tag would
reproduce the very defect it exists to fix. Checked; it does not.

## 9. Evidence

**Acceptance — run `36025567413`, job `d1-merge-train`, conclusion `success`** (head
`bb2835a98d27d32f8fe60db338625e4e189196c1`). Cited by job and step, not by run conclusion alone,
because `E6-F023` records that a run conclusion can be blind to its jobs:

| step | conclusion |
|---|---|
| Login to GitHub Container Registry (D1 MinIO mirror) | success |
| Least-privilege assertions on the BUILT images (DEP-001 / WRK-009) | success |
| **Bring up the D1 stack** | **success** |
| **Run the E6F campaign (live)** | **success** |
| Collect distributed evidence (on failure) | skipped (nothing failed) |
| Tear down the D1 stack | success |

**Executed counts, non-zero** (a campaign that ran nothing would report the same green):
**47 pass / 0 fail / 0 skipped** and **9 pass / 0 fail / 0 skipped**. The two tests that the wrong
MinIO version broke are individually green:

```
✔ E6F-05 … live MinIO: grant(upload) -> PUT -> commit -> grant(download) -> GET round-trip
✔ E6F-05 … live MinIO: toxiproxy-truncated upload never commits (fail-closed on hash/size)
✔ E6F-14 … live orphan sweep: fence lost mid-flight -> commit refuses -> the object is DELETED
```

**RED, recorded rather than smoothed over** — run `36022608037`, same job, *Run the E6F campaign
(live)* `failure`, `fail 2`:

```
✖ E6F-05 … AssertionError: presigned PUT must succeed (200/204); got 400:
  <Error><Code>AccessDenied</Code>
  <Message>There were headers present in the request which were not signed</Message>…
✖ E6F-14 … AssertionError: presigned PUT must succeed; got 400: …
```

**Mirror lane runs.**

| run | event | conclusion | what it proves |
|---|---|---|---|
| `36022093784` | push | `skipped`, zero steps | the registration push cannot publish — positive control |
| `36022154408` | dispatch | `failure` | build + push `success`; the step-summary step exited 2 on a quoting bug, fixed |
| `36025048514` | dispatch | `success` | first source-built cut, `sha256:407cbf75…` (amd64) |
| **`36026285594`** | dispatch | **`success`** | **`sha256:187391a6…`, the pinned INDEX** |

The pinned digest was verified to be a real two-platform index, not a single-arch manifest wearing
an index's name — `mediaType: application/vnd.oci.image.index.v1+json`, with
`linux/amd64` → `sha256:5db57326…` and `linux/arm64` → `sha256:d89f975e…`.

**Local, before any dispatch:** §5. **Guard set:** the full pure-node set from M1-AGENT-RULES plus
`check-evidence-immutability --base origin/docs/replatform-program`, run with the changes STAGED
(so newly-added files are visible to the tracked-file walks) — `failures: 0` before every push.
`node --test scripts/check-d1-compose.test.mjs` 60/60;
`node --test docker/images/__tests__/image-pipeline.test.mjs` 13/13.

**Register delta, asserted two-sided against the MERGE REF** (`origin/docs/replatform-program`),
not against the worktree's own copy — `scripts/workflow-verdict-manifest.json`:

```
base 26 streams, head 27
ADDED  : ['d1-image-mirror.yml@*']
DROPPED: []
```

Applied as a text-level delta on the base's copy, never by rewriting the file whole.

### 9.1 Guard narrowed, with its control

`docker/images/__tests__/image-pipeline.test.mjs`'s *"no provider credential in the lane"* assertion
was `!/E2B_API_KEY|secrets\./`, which is **broader than its own name**: it banned every `secrets.`
reference, including the run's own automatic `GITHUB_TOKEN`, which is not a provider credential and
cannot reach a provider. It went red on the GHCR login.

It is narrowed **to its stated intent, by allowlist**, and deliberately NOT dodged — writing
`github.token` to slip past the regex would have left a check that no longer says what it means.
`laneSecretRefs()` must equal exactly `["GITHUB_TOKEN"]`, so every other `secrets.X` still reds.

| mutant | result |
|---|---|
| an E2B key via `secrets` | red |
| a bare `E2B_API_KEY`, not via `secrets` | red |
| a model key added alongside the GHCR login | red |
| a plausibly-innocent extra `secrets.REGISTRY_PASSWORD` | red |

Non-vacuity is asserted first: the real lane genuinely references the token, so the allowlist arm is
exercised rather than satisfied by an empty set.

### 9.2 Codex

Two findings, both real, both verified at source before fixing, **both the same class**: *CI logs in
and CI is amd64, so the LOCAL operator path regressed silently.* Fixed together in `24912e59d`.

1. **arm64.** The withdrawn upstream image served a multi-arch manifest LIST, so amd64-only was a
   silent narrowing. Now `linux/amd64` + `linux/arm64`, pinned by the index digest, cross-compiled
   NATIVELY (`--platform=$BUILDPLATFORM` + `GOOS`/`GOARCH`), with QEMU used only for the runtime
   stage's `apt-get`.
2. **GHCR auth for a local bring-up.** `docker/d1/README.md`'s *Verification* section gains the
   prerequisite, the `read:packages` scope, the `AOA_D1_MINIO_IMAGE` escape hatch, the architecture
   note and the re-cut procedure. The package was **not** made anonymously readable — that needs an
   org admin and `GITHUB_TOKEN` cannot set it, so it is a founder decision, not a build agent's.

Fixing these also caught an invented pin of my own: `setup-qemu-action` was written as
`c7c53464… # v4.0.0`, which is neither — that sha is `v3.7.0`. Corrected to
`99012661954931238ded8c8b007157a8430204e1 # v4.4.0`, read from the tags API. Recorded because an
action pinned to a sha that does not match its comment is precisely the record-rot this programme
keeps paying for, and I introduced it.

## 10. Follow-ups, owned

- **The dual class (§8)** — digest-pin `pgvector/pgvector:pg18`, `ghcr.io/shopify/toxiproxy:2.9.0`
  and the compose `test-runner`'s `node:lts-trixie-slim`, whose current digests are recorded in §8.
  Owner: `unowned`, with the honest reason that it is a separate, mechanical change deliberately kept
  out of the PR unblocking `M1a`.
- **Mirror refresh is manual by design.** Nothing automatically re-cuts the mirror or re-pins the
  digest, which is intentional — an automatic re-pin would be a tag by another name. The cost is that
  a MinIO version bump in the harness is a human act.

## 11. What I did NOT do

- **Nothing was made quieter.** No service was dropped from the compose stack, no pull failure was
  made non-fatal, and no healthcheck was relaxed or `||`-defaulted. The `minio` service's
  `healthcheck` block is unchanged.
- No keyed workflow was dispatched. Both lanes used here are keyless.
- `E6-F021` was **amended in place, not rewritten**: its 2026-09-20 quay `200` row stands verbatim,
  with the re-measurement beneath it. Same for the superseded comment block in `docker-compose.d1.yml`.
- No QA record and no milestone handoff was written by this ticket.
