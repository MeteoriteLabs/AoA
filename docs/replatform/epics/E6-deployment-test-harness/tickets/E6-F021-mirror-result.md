# E6-F021 (2026-09-24 amendment) — the D1 MinIO image, mirrored into our own GHCR and pinned by digest — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `E6-F021` re-repair (urgent, planning session, 2026-09-24) · **Milestone:** `M1a` (unblocks every D1 campaign)
**Date (UTC):** `2026-09-24`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `3966a01f9f` (`origin/docs/replatform-program`)
**PR:** #603 (base `docs/replatform-program`)
**Reviewed revision:** see §9.

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

*(§9)*

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

*(filled from the acceptance run; see §7)*

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
