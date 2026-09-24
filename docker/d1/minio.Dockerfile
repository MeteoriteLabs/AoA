# syntax=docker/dockerfile:1
#
# E6-F021 (2026-09-24 amendment) — the D1 harness MinIO image, MIRRORED into this
# organisation's own GHCR so the lane no longer depends on a third party's registry
# policy. See docs/replatform/epics/E6-deployment-test-harness/findings.md#e6-f021.
#
# WHY THIS FILE EXISTS. Both documented sources for the upstream MinIO server image
# are now closed to anonymous pulls (measured 2026-09-24, see the finding): Docker
# Hub's `minio/minio` is deleted, and `quay.io/minio/minio` — which the finding's
# original repair pinned to, and which served a 200 then — now returns 401 for a
# pull-scoped token on both the dated tag and `:latest`. `mirror.gcr.io/minio/minio`
# is a 404 and `dl.min.io`'s server binary is a 410 Gone. The MinIO GitHub releases
# carry SOURCE tags and ZERO binary assets.
#
# WHAT IT DOES. It BUILDS the MinIO server from upstream source, at the EXACT release
# tag the lane was already pinned to, and runs it on a Debian base so the runtime
# posture is byte-for-byte what docker-compose.d1.yml has always assumed of the
# official image:
#   - runs as ROOT, so MinIO reads its TLS material from /root/.minio/certs (the
#     DAT-002 slice-7 bind); a non-root image cannot read that mount;
#   - ships `curl`, which the compose healthcheck shells out to and which a
#     distroless base does not have;
#   - ENTRYPOINT is the server binary, so the existing
#     `command: ["server", "/data", "--console-address", ":9001"]` is unchanged.
# Nothing in the compose service had to be softened to accommodate it, which is the
# point: a lane that skipped MinIO, or tolerated a pull failure, would convert a loud
# blocker into a silent hole.
#
# ★ WHY FROM SOURCE, AND NOT FROM A PUBLIC THIRD-PARTY BUILD. The first cut of this
# mirror lifted the binary out of `cgr.dev/chainguard/minio`, which is public and is a
# build of this same project. It worked — the stack came up and the healthcheck passed
# — but that build is `:latest` only, so it carried RELEASE.2026-09-22T19-25-18Z rather
# than the RELEASE.2025-09-07T16-13-09Z the lane was pinned to, and a MinIO that new is
# STRICTER about presigning. Run `36022608037` brought the stack up and then failed
# `E6F-05` and `E6F-14` with
# `400 AccessDenied: There were headers present in the request which were not signed`
# on the presigned PUT — exactly the `DAT-002` slice-7 behaviour the brief warned to
# verify before substituting anything.
#
# So the version is NOT a free variable. Restoring the lane means restoring the lane's
# MinIO, not the newest one that happens to be obtainable; relaxing E6F-05 to accept a
# newer server's stricter presign would have been fixing the measurement instead of the
# thing. Upstream source at that tag IS public even though every built image of it is
# gone, so this builds it.
#
# INTEGRITY. `MINIO_SOURCE_COMMIT` pins the 40-hex COMMIT that
# `refs/tags/RELEASE.2025-09-07T16-13-09Z` peels to, and the build FAILS CLOSED if the
# checkout is not that commit. A tag can be moved; a commit id cannot. The Go and Debian
# base images are pinned by digest for the same reason.
#
# ★ That arm has a real positive control, obtained for free: the first pin here was
# `01ce918d…`, which is what `git ls-remote refs/tags/<tag>` prints — the ANNOTATED TAG
# OBJECT, not the commit. The build refused, printing
# `minio source commit mismatch: got 07c3a429…, expected 01ce918d…`. Read the peeled
# ref (`refs/tags/<tag>^{}`) when re-pinning this; the two ids are different and only
# one of them is what a checkout lands on.
#
# REFRESH STORY. `.github/workflows/d1-image-mirror.yml` (workflow_dispatch) builds and
# pushes this to ghcr.io/<owner>/aoa-d1-minio and PRINTS the pushed digest. To move the
# harness to a different MinIO: dispatch it overriding `minio_version` AND
# `minio_commit` together (the guard rejects a mismatched pair), re-run the D1 campaign
# — E6F-05 and E6F-14 are what tell you the new version's presign still behaves — and
# then update the digest in AOA_D1_MINIO_IMAGE's default in docker-compose.d1.yml.

ARG MINIO_VERSION=RELEASE.2025-09-07T16-13-09Z
ARG MINIO_SOURCE_COMMIT=07c3a429bfed433e49018cb0f78a52145d4bedeb
ARG GO_IMAGE=golang:1.25-trixie@sha256:2c4c60ef415fbfa5e90300722293bef36c5e63fae17570ce18f580af933dbd73
ARG BASE_IMAGE=debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a

# --platform=$BUILDPLATFORM plus an explicit GOARCH is a NATIVE cross-compile, not a
# QEMU one: the Go toolchain runs on the builder's own architecture and emits the
# target's. Building arm64 under emulation would be slow enough to become its own
# problem, and the runtime stage below is the only thing emulated.
FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS builder
ARG MINIO_VERSION
ARG MINIO_SOURCE_COMMIT
ARG TARGETOS
ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The commit `test` below is the FAIL-CLOSED arm: a moved tag, a redirected host or a
# cached mirror all surface here as a mismatch and abort the build.
WORKDIR /src
RUN set -eux; \
    git clone --depth 1 --branch "${MINIO_VERSION}" https://github.com/minio/minio.git .; \
    actual="$(git rev-parse HEAD)"; \
    test "${actual}" = "${MINIO_SOURCE_COMMIT}" \
      || { echo "minio source commit mismatch: got ${actual}, expected ${MINIO_SOURCE_COMMIT}" >&2; exit 1; }

# The release ldflags are what upstream's Makefile sets. Without them the binary reports
# `Version: DEVELOPMENT.GOGET`, and an image that cannot say which MinIO it is would make
# the next reader re-derive it from this file.
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} GOFLAGS=-trimpath go build \
      -ldflags "-s -w \
        -X github.com/minio/minio/cmd.Version=${MINIO_VERSION} \
        -X github.com/minio/minio/cmd.ReleaseTag=${MINIO_VERSION} \
        -X github.com/minio/minio/cmd.CommitID=${MINIO_SOURCE_COMMIT} \
        -X github.com/minio/minio/cmd.ShortCommitID=${MINIO_SOURCE_COMMIT}" \
      -o /out/minio .

FROM ${BASE_IMAGE} AS production
ARG MINIO_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /out/minio /usr/bin/minio
LABEL org.opencontainers.image.title="aoa-d1-minio" \
      org.opencontainers.image.description="D1 harness MinIO, built from upstream source at ${MINIO_VERSION}" \
      org.opencontainers.image.version="${MINIO_VERSION}"
# Deliberately root: /root/.minio/certs is where MinIO auto-enables TLS from, and the
# compose service binds ./docker/d1/certs there read-only. This image is a CI harness
# service on an isolated compose network; it is never shipped.
USER root
ENTRYPOINT ["/usr/bin/minio"]
