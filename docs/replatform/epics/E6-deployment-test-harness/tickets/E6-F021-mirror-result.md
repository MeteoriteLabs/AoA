# E6-F021 (2026-09-24 amendment) — the D1 MinIO image, mirrored into our own GHCR and pinned by digest — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `E6-F021` re-repair (urgent, planning session, 2026-09-24) · **Milestone:** `M1a` (unblocks every D1 campaign)
**Date (UTC):** `2026-09-24`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `3966a01f9f` (`origin/docs/replatform-program`)
**PR:** #603 (base `docs/replatform-program`)
**Reviewed revision:** `c0ffdb9fa25a7a9f2f413045f14c89eec8551d39`

> **On the revisions, stated precisely — and RE-STATED, because the first version of this note went
> stale the moment the §10.1 ruling landed.** `c0ffdb9fa` is the revision the FINAL live lane evidence
> in §7/§9 was produced on (run `36027175548`, both `Bring up the D1 stack` and `Run the E6F campaign
> (live)` green, 47/47 + 9/9).
>
> This note previously read: *"The only commit after it is the one that writes THIS paragraph and the
> `36027175548` rows into this record — documentation only, touching no workflow, no Dockerfile, no
> compose file and no test."* **That is no longer true**, and it is kept here rather than edited away.
> `git diff --name-only c0ffdb9fa..HEAD` is, in full:
>
> ```
> docker/d1/.env.example
> docker/d1/README.md
> docs/replatform/epics/E6-deployment-test-harness/findings.md
> docs/replatform/epics/E6-deployment-test-harness/tickets/E6-F021-mirror-result.md
> scripts/finding-ownership.json
> ```
>
> **Why the citation still holds, stated as a claim that can be checked rather than asserted.** No
> workflow, Dockerfile, compose file or test is in that list. The one entry that is neither prose nor
> a register is `docker/d1/.env.example` — and the lane **never reads it**: `d1-merge-train.yml`
> writes `docker/d1/.env` itself and never writes `AOA_D1_MINIO_IMAGE` at all. That is not a
> convenient argument, it is the content of `E6-F029`, and it cuts both ways: the same property that
> makes this deletion unable to affect run `36027175548` is the property that let the stale value
> survive three green runs.
>
> Saying the evidence rests on a docs-only delta when a `docker/**` file moved would be exactly the
> records-disagreeing-with-code defect this programme keeps paying for.

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

★ **Read §7 before §4 if you are re-cutting this.** The mirror had TWO implementations. The first
copied the binary out of a public third-party image; it brought the stack up and then failed the
presign tests, and it is NOT what is pinned. This section describes the one that is.

`docker/d1/minio.Dockerfile` **builds MinIO from upstream source** and runs it on
`debian:trixie-slim`:

- a `--platform=$BUILDPLATFORM` Go builder stage (`GO_IMAGE`, digest-pinned) clones
  `github.com/minio/minio` at `MINIO_VERSION` (`RELEASE.2025-09-07T16-13-09Z`), and **fails closed**
  unless the checkout is `MINIO_SOURCE_COMMIT` — the 40-hex commit the tag PEELS to;
- it builds `CGO_ENABLED=0` with `GOOS`/`GOARCH` from `TARGETOS`/`TARGETARCH`, so arm64 is a native
  cross-compile rather than a QEMU build, and with upstream's release `ldflags`, so the binary
  reports its real version rather than `DEVELOPMENT.GOGET`;
- the runtime stage (`BASE_IMAGE`, digest-pinned) adds `curl` + `ca-certificates`, copies the binary
  to `/usr/bin/minio`, and sets `USER root` and `ENTRYPOINT ["/usr/bin/minio"]`.

There is **no source-IMAGE override**: `MINIO_VERSION` and `MINIO_SOURCE_COMMIT` are the overrides,
they must be given together, and the mirror lane refuses a half-specified pair.

The Debian runtime stage exists so that **nothing in the compose service had to be softened**:

| the compose service assumes | a stock distroless/non-root MinIO image | this image |
|---|---|---|
| runs as root, so `/root/.minio/certs` (the DAT-002 slice-7 `:ro` bind) is readable | non-root uid cannot read that mount | root |
| ships `curl`, which the healthcheck shells out to | distroless — no curl | `curl` + `ca-certificates` |
| `ENTRYPOINT` is the server, so `command: ["server","/data",…]` works | varies | the binary |

`docker-compose.d1.yml`'s `minio` service — `command`, `environment`, `healthcheck`, `volumes`,
`networks` — is **byte-for-byte unchanged**. The only edited line is `image:`.

★ **Pinned by DIGEST, not by tag.** A tag we own is still a tag. `:d1` exists for humans; the digest
is what the lane resolves, so a re-cut mirror cannot silently change what the gate brings up.

## 5. Local proof, before any dispatch (E.3 — probe before you fix)

Docker was available locally, so the drop-in claim was measured rather than dispatched:

```
docker build -f docker/d1/minio.Dockerfile -t aoa-d1-minio:src .
docker run -d -e MINIO_ROOT_USER=aoa-d1 -e MINIO_ROOT_PASSWORD=aoa-d1-secret \
  -v .../docker/d1/certs:/root/.minio/certs:ro \
  aoa-d1-minio:src server /data --console-address :9001
```

**On the SOURCE-BUILT image — the implementation that is pinned:**

- logs: `Version: RELEASE.2025-09-07T16-13-09Z (go1.25.14 linux/amd64)` — the release the lane was
  pinned to, self-reported by the binary rather than asserted by this document
- logs: `API: https://172.17.0.2:9000  https://127.0.0.1:9000` — **TLS auto-enabled from the
  committed harness certs**, which is what `DAT-002` slice-7's strictly-`https` grant `url` requires
- the **exact** healthcheck command from the compose service,
  `curl -fsSk https://127.0.0.1:9000/minio/health/live`, run inside the container: **200**
- `docker buildx build --platform linux/amd64,linux/arm64` succeeds, and the amd64 image out of that
  multi-arch build reproduces all three results above

**The fail-closed commit arm got a positive control here for free.** The first pin was
`01ce918d…` — what `git ls-remote refs/tags/<tag>` prints, which is the ANNOTATED TAG OBJECT, not
the commit. The build refused:

```
minio source commit mismatch: got 07c3a429…, expected 01ce918d…
```

★ **The same local probe was run on the FIRST, rejected implementation** (the third-party-derived
one), and it passed: `API: https://127.0.0.1:9000`, healthcheck 200 — on
`Version: RELEASE.2026-09-22T19-25-18Z`. **That is the honest limit of this local probe**, and it is
why the acceptance is the D1 campaign and not this section: a healthcheck cannot see a presign
incompatibility. Recorded rather than dropped, because a probe that cannot distinguish two
implementations should not be quoted as if it validated one.

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
| `36025567413` | `bb2835a98d` | source-built amd64, MinIO `RELEASE.2025-09-07T16-13-09Z` | **success** | **success** |
| **`36027175548`** | **`c0ffdb9fa2`** | **the pinned multi-arch INDEX, same release** | **success** | **success** |

`36027175548` is the run on the FINAL pin: `36025567413` proved the version hypothesis on the
amd64-only cut, and the arm64 half (a Codex finding, §9.2) then changed the digest. A green on a
digest that is no longer the one the compose file resolves would have been evidence for a
configuration that does not exist, so the lane was re-dispatched rather than the earlier run
re-labelled.

★ **The first run is kept in this record on purpose.** It is the one that satisfies the brief's
literal acceptance, and it is also the one that falsified "any MinIO will do" — a cycle that KILLS a
line of reasoning is worth recording, not quietly replacing with the cycle that worked.

## 8. The class sweep (E / E.1)

**The class, in one sentence:** *a D1 image reference the lane pulls, anonymously, from a registry
whose contents a third party can withdraw.*

**Its dual** (E.1(b)): *a D1 image reference pinned only by TAG, so the bytes can change under us
without the reference changing.* Searched for both.

★★★ **THE ENUMERATION BELOW WAS BROKEN, AND THE CLAIM IT SUPPORTED WAS FALSE.** Corrected
2026-09-24 after Codex round 4 (P1). Superseded text, kept verbatim: *"Enumerated by
`grep -rn "image:" docker-compose*.yml` plus `grep -rn "^FROM" docker/`, not by memory. D1-lane
third-party refs: **4 checked, 1 found broken, 1 fixed.**"* — and the sentence two paragraphs down
that read *"So the withdrawal class has exactly one member and it is fixed."*

**The defect in the sweep itself.** `grep -rn … docker-compose*.yml` looks recursive and is not: the
**shell** expands `docker-compose*.yml` before grep runs, and it expands only to the five
**root-level** files. `-r` recursed into nothing. Two compose files were never inspected:

```
./docker/campaign/docker-compose.campaign.yml
./docker/m1-boot/docker-compose.m1-boot.yml
```

Re-enumerated with `find . -name "docker-compose*.yml"`, which is the enumeration this should always
have used: **7 compose files, not 5.** `docker/campaign/…` is clean (control-plane / adapter-manager
/ worker only). `docker/m1-boot/docker-compose.m1-boot.yml:91` is **not**:

```
image: "${AOA_M1_MINIO_IMAGE:-quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z}"
```

— the identical withdrawn reference, and `grep -rn "AOA_M1_MINIO_IMAGE"` returns **that line and
nothing else**, so no workflow or script overrides it and the dead default is what resolves.

★ This is the E.2.1 lesson landing on me: *a check whose input is the thing under test cannot tell
you what is missing.* My sweep's domain was itself the artefact I was reasoning from, and a
enumeration that silently covers five of seven reads exactly like one that covers all seven.

**So the withdrawal class has TWO members, and only ONE of them is fixed by this PR.** The open half
is `E6-F030`, filed with its blocker measured; §10 carries the disposition. What follows is the
corrected table.

Enumerated by `find . -name "docker-compose*.yml"` plus `grep -rn "^FROM" docker/`, not by memory.
Third-party refs across **all** compose files: **5 checked, 2 found broken, 1 fixed, 1 filed with a
measured blocker.**

| ref | anonymous pull, 2026-09-24 | tag-only? |
|---|---|---|
| `minio/minio` (both registries) | **BROKEN** (401) | was tag-only → **now digest-pinned in our GHCR** |
| `pgvector/pgvector:pg18` | 200 `sha256:2ba9ca5f…` | tag-only |
| `ghcr.io/shopify/toxiproxy:2.9.0` | 200 `sha256:b44c2832…` | tag-only |
| `node:lts-trixie-slim` (compose `test-runner`) | 200 `sha256:8ec5d755…` | tag-only |

| `quay.io/minio/minio` in `docker/m1-boot/…:91` | **BROKEN** (401) | tag-pinned — **NOT fixed here**, see `E6-F030` |

So the *withdrawal* class has **two** members: one fixed, one filed (`E6-F030`) because fixing it
needs a ruling, not a keystroke — see §10.2. **The dual class has three
surviving members**, deliberately not changed here: digest-pinning them is a correct change but it is
not this outage, and bundling three unrelated image moves into the PR that has to unblock `M1a`
today widens the bring-up blast radius for no gain. Their digests are recorded above so the follow-up
is mechanical. **Filed with an honest owner rather than left silent:** see §10.

**And my own diff is in the class (E.1(a)).** `docker/d1/minio.Dockerfile` pins BOTH its `FROM`s by
digest — the Go builder and the Debian runtime base — and pins its MinIO source by the COMMIT the
release tag peels to, because a mirror built from a moving tag or a moving base would reproduce the
very defect it exists to fix. Checked; it does not.

## 9. Evidence

**Acceptance — run `36027175548`, job `d1-merge-train`, conclusion `success`** (head
`c0ffdb9fa25a7a9f2f413045f14c89eec8551d39`, the pinned multi-arch index). Cited by job and step, not
by run conclusion alone, because `E6-F023` records that a run conclusion can be blind to its jobs:

| step | conclusion |
|---|---|
| Login to GitHub Container Registry (D1 MinIO mirror) | success |
| Least-privilege assertions on the BUILT images (DEP-001 / WRK-009) | success |
| **Bring up the D1 stack** | **success** |
| **Run the E6F campaign (live)** | **success** |
| Collect distributed evidence (on failure) | skipped (nothing failed) |
| Tear down the D1 stack | success |

**Executed counts, non-zero** (a campaign that ran nothing would report the same green):
**47 pass / 0 fail / 0 skipped** and **9 pass / 0 fail / 0 skipped** — identical on `36027175548` and
on `36025567413`. The two tests that the wrong MinIO version broke are individually green:

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

## 10. Follow-ups, owned — all OPEN, none closed by this ticket

- **`E6-F029` — the D1 harness's documented HUMAN path is exercised by no lane.** Filed by this
  ticket, `unowned`, MEDIUM. **Three** of this PR's defects lived there at once, each invisible to CI
  for a structural reason: arm64 (**CI is amd64**), the missing `docker login` (**CI
  authenticates**), and the stale `.env.example` override (**CI never reads that file**). All three
  are repaired; the *absence of a check* is not. ★ The finding records that a green `d1-merge-train`
  run is **not** evidence about any of them — three went green while the third instance was live in
  the tree — because the lane cannot reach the path. Closure route: exercise the README's own steps
  in a job, or at minimum a static `.env.example` ↔ Compose-default agreement check, with a positive
  control either way.
- **GHCR package visibility — org-admin, deliberately NOT done here.** `ghcr.io/…/aoa-d1-minio` is
  repo-scoped, `GITHUB_TOKEN` cannot change that, and it is not a call a build agent should make
  unilaterally. **Until it flips, the documented local bring-up has a hard prerequisite** — a
  `docker login ghcr.io` with `read:packages` — and `docker/d1/README.md` states it as a requirement
  rather than a convenience. CI is unaffected: it logs in with its own run token. If the package is
  later made public, the login becomes optional and that README paragraph can go.
- **The dual class (§8)** — digest-pin `pgvector/pgvector:pg18`, `ghcr.io/shopify/toxiproxy:2.9.0`
  and the compose `test-runner`'s `node:lts-trixie-slim`, whose current digests are recorded in §8.
  Owner: `unowned`. Deliberately not a rider on this PR: pinning them is its own unit with its own
  verification, and bundling three unrelated image moves into the change that has to unblock `M1a`
  widens the bring-up blast radius for no gain. The recorded digests make it mechanical.
- **Mirror refresh is manual by design.** Nothing automatically re-cuts the mirror or re-pins the
  digest, which is intentional — an automatic re-pin would be a tag by another name. The cost is that
  a MinIO version bump in the harness is a human act, and `E6F-05`/`E6F-14` are what tell you whether
  the new version's presign still behaves.

### 10.2 The FOURTH Codex round — the sweep was wrong, and the second site needs a ruling

**STOPPED HERE, not fixed.** `docker/m1-boot/docker-compose.m1-boot.yml:91` carries the same
withdrawn image, and it is reached: `.github/workflows/m1-shipped-boot.yml` boots that overlay and
`scripts/m1-shipped-boot/journey.mjs:423` brings MinIO up as a dependency of the first control-plane
replica during `boot-core`. So **shipped-boot dispatches fail before the journey**, which matters
because that is the `M1a` lane.

The one-line fix — point it at the mirror — **does not work, and I measured why rather than trying
it.** `scripts/lib/m1-shipped-boot-shape.mjs:215` fails the lane on
`/\bdocker (pull|login)\b/`: *"the lane must never `docker pull`/`docker login` — images are built
from the candidate's source"*. That guard runs on every PR. The mirror is a **repo-scoped, private**
GHCR package, so the lane cannot authenticate to it without redding the guard that defines its shape.

Three routes, none of them a build agent's call:

1. **Make the GHCR package anonymously readable** (org-admin). Then no login is needed, the guard
   stays untouched, and the fix really is one line. Also closes the `E6-F021` §10 item and the login
   prerequisite in `docker/d1/README.md`.
2. **Have the shipped-boot lane build MinIO from source itself**, the way it builds everything else.
   This is the option most consistent with the guard's stated intent — *images are built from the
   candidate's source* — and `docker/d1/minio.Dockerfile` already does exactly that build. It costs
   the lane a Go compile.
3. **Amend the guard and its owning decision** to permit a `ghcr.io` login specifically. Weakest:
   it edits the shape guard to accommodate a need it was written to forbid, and that is the
   "make the failure quieter" shape this programme keeps paying for.

My recommendation is **(1) if the org will do it, else (2)**. Not actioned: M1-BUILD-RULES §C caps
me at two Codex rounds and this is the fourth, and M1-AGENT-RULES says to stop on anything needing a
decision beyond the unit's brief. Filed as `E6-F030`, `unowned`.

**What this does NOT change.** The D1 lane is fixed and proven — runs `36025567413` and
`36027175548`, bring-up **and** full campaign, 47/47 + 9/9. `docker-compose.d1.yml` and
`docker/m1-boot/docker-compose.m1-boot.yml` are separate stacks; the second was missed by a broken
enumeration, not by a failed repair.

### 10.1 The third Codex round, and the ruling on it

`docker/d1/.env.example:30` set `AOA_D1_MINIO_IMAGE=minio/minio:latest` — the DELETED Docker Hub
image — while `README.md:152` instructs `cp docker/d1/.env.example docker/d1/.env`. An env value
**overrides** the Compose default, so the documented local bring-up still resolved the dead image and
the GHCR login could not repair the pull.

Per M1-BUILD-RULES §C (hard cap: two Codex rounds) this was **escalated rather than fixed
unilaterally**, with the verification and a proposed fix. **The planning session ruled: delete the
line, as proposed** — not re-pin it to the mirror's digest, because *a second copy of the digest is a
tag by another name*: two places to drift, and the next person to re-cut the mirror updates one and
not the other. The Compose default is the single source, and `.env.example` now carries a comment
saying why it is silent.

Checked while there, as the ruling asked: the README's *"(set admitted digests)"* still points at
something real — `AOA_D1_CONTROL_PLANE_IMAGE` and `AOA_D1_WORKER_IMAGE`, `.env.example:23-24` — and
is now explicit about which variables it means and about MinIO no longer being among them.

## 11. What I did NOT do

- **Nothing was made quieter.** No service was dropped from the compose stack, no pull failure was
  made non-fatal, and no healthcheck was relaxed or `||`-defaulted. The `minio` service's
  `healthcheck` block is unchanged.
- No keyed workflow was dispatched. Both lanes used here are keyless.
- `E6-F021` was **amended in place, not rewritten**: its 2026-09-20 quay `200` row stands verbatim,
  with the re-measurement beneath it. Same for the superseded comment block in `docker-compose.d1.yml`.
- No QA record and no milestone handoff was written by this ticket.
