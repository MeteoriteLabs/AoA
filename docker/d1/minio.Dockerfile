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
# WHAT IT DOES. It takes the MinIO server binary from a build that IS public
# (Chainguard's, Wolfi/glibc, the upstream minio/minio project), and re-homes it on a
# Debian base so the runtime posture is byte-for-byte what docker-compose.d1.yml has
# always assumed of the official image:
#   - runs as ROOT, so MinIO reads its TLS material from /root/.minio/certs (the
#     DAT-002 slice-7 bind), rather than Chainguard's uid 65532 which cannot;
#   - ships `curl`, which the compose healthcheck shells out to and which a
#     distroless base does not have;
#   - ENTRYPOINT is the server binary, so the existing
#     `command: ["server", "/data", "--console-address", ":9001"]` is unchanged.
# Nothing in the compose service had to be softened to accommodate it, which is the
# point: a lane that skipped MinIO, or tolerated a pull failure, would convert a loud
# blocker into a silent hole.
#
# REFRESH STORY. `.github/workflows/d1-image-mirror.yml` (workflow_dispatch) builds
# and pushes this to ghcr.io/<owner>/aoa-d1-minio and PRINTS the pushed index digest.
# To refresh: dispatch it, optionally overriding `minio_source_image` (Chainguard's
# free tier serves `:latest` only and garbage-collects older digests, so a stale
# pinned source digest is the expected reason a refresh needs the override), then
# update the digest in AOA_D1_MINIO_IMAGE's default in docker-compose.d1.yml.
#
# Both images are pinned BY DIGEST, never by tag alone, so a moved tag cannot
# silently change what this builds from.

ARG MINIO_SOURCE_IMAGE=cgr.dev/chainguard/minio@sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1
ARG BASE_IMAGE=debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a

FROM ${MINIO_SOURCE_IMAGE} AS upstream

FROM ${BASE_IMAGE} AS production
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=upstream /usr/bin/minio /usr/bin/minio
# Deliberately root: /root/.minio/certs is where MinIO auto-enables TLS from, and the
# compose service binds ./docker/d1/certs there read-only. This image is a CI harness
# service on an isolated compose network; it is never shipped.
USER root
ENTRYPOINT ["/usr/bin/minio"]
