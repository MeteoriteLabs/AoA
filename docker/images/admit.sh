#!/usr/bin/env bash
# docker/images/admit.sh — admit every split image through the DEP-001 admission
# verifier (DEP-014).
#
# The last step of the chain build.sh -> sbom.sh -> sign.sh -> admit.sh. For each of the
# three split images recorded in digests.env (control-plane, worker, adapter-manager):
#   1. the image LOADED under the recorded tag must still have the recorded digest —
#      read the same way build.sh read it — so a tampered or retagged image is refused
#      even when its paperwork is intact;
#   2. the allowlist must carry an admission entry for THIS image name AND digest — the
#      adapter-manager had none before DEP-014, and that is refused;
#   3. scripts/verify-image-admission.mjs (the DEP-001 verifier, unchanged) must ADMIT
#      the digest with that entry's signature and the recorded source revision — so a
#      corrupted signature, an unsigned entry or a mismatched revision is refused;
#   4. the image's SBOM (sbom.sh) and provenance (sign.sh) must exist.
# Any refusal exits non-zero after reporting every image, so one lane run shows all
# failures at once.
#
# WHAT THIS PROVES, AND WHAT IT DOES NOT. It proves the lane's own chain is whole: each
# image it built was recorded, signed, and is admitted by the verifier the release gate
# uses, and nothing was swapped in between. It is NOT approval — the lane signs with an
# ephemeral TEST root it generated itself. Promotion is REL-004's
# scripts/check-release-admission.mjs, whose frozen RELEASE_ARTIFACT_CLASSES this script
# does not touch (the adapter-manager is deliberately outside it; DEP-012 design S45).
#
# Reads the build record from AOA_IMAGES_OUT_DIR (default docker/images/), and
# optionally AOA_IMAGES_DIGESTS / AOA_IMAGES_ALLOWLIST to point at a mutated copy — the
# D1 lane's in-run positive controls use those. Needs `docker` (for step 1) and node.
# TEST ROOT ONLY.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

IMAGES_DIR="${AOA_IMAGES_OUT_DIR:-${REPO_ROOT}/docker/images}"
DIGESTS="${AOA_IMAGES_DIGESTS:-${IMAGES_DIR}/digests.env}"
ALLOWLIST="${AOA_IMAGES_ALLOWLIST:-${IMAGES_DIR}/allowlist.json}"
TRUST_ROOT="${IMAGES_DIR}/trust-root.pub.pem"

for f in "${DIGESTS}" "${ALLOWLIST}" "${TRUST_ROOT}"; do
  [ -f "${f}" ] || { echo "ERROR: ${f} missing — run build.sh, sbom.sh and sign.sh first" >&2; exit 1; }
done

# PARSE digests.env; never `source` it (hyphenated keys — see build.sh).
digest_value() {
  grep -E "^$1=" "${DIGESTS}" | head -n1 | cut -d= -f2- || true
}

# The live digest of a loaded image, derived EXACTLY as build.sh derives it.
live_digest() {
  local tag="$1" digest
  digest="$(docker inspect --format '{{index .RepoDigests 0}}' "${tag}" 2>/dev/null \
    | sed 's/.*@//' || true)"
  if [ -z "${digest}" ]; then
    digest="$(docker inspect --format '{{.Id}}' "${tag}" 2>/dev/null || true)"
  fi
  printf '%s' "${digest}"
}

# The signature on the allowlist entry for (image, digest). Prints `none` when there is
# no such entry, so an entry whose signature is EMPTY still reaches the verifier and is
# refused there as unsigned — the verifier, not this script, owns that decision.
entry_signature() {
  node -e '
    const fs = require("fs");
    const [file, image, digest] = process.argv.slice(1);
    const a = JSON.parse(fs.readFileSync(file, "utf8"));
    const e = (a.entries || []).find((x) => x.image === image && x.digest === digest);
    process.stdout.write(e ? `entry:${e.signature ?? ""}` : "none");
  ' "${ALLOWLIST}" "$1" "$2"
}

refused=0
refuse() {
  echo "image admission: $1: REFUSED — $2" >&2
  refused=$((refused + 1))
}

for name in control-plane worker adapter-manager; do
  key="${name^^}"
  image="$(digest_value "${key}_IMAGE")"
  digest="$(digest_value "${key}_DIGEST")"
  revision="$(digest_value "${key}_REVISION")"
  if [ -z "${image}" ] || [ -z "${digest}" ] || [ -z "${revision}" ]; then
    refuse "${name}" "no ${key}_IMAGE/_DIGEST/_REVISION record in ${DIGESTS} (not built?)"
    continue
  fi

  live="$(live_digest "${image}")"
  if [ "${live}" != "${digest}" ]; then
    refuse "${name}" "live digest '${live}' of ${image} does not match the recorded ${digest} (tampered or retagged)"
    continue
  fi

  found="$(entry_signature "${name}" "${digest}")"
  if [ "${found}" = "none" ]; then
    refuse "${name}" "no admission entry for ${digest} on ${ALLOWLIST} (unsigned build)"
    continue
  fi
  signature="${found#entry:}"

  if ! node scripts/verify-image-admission.mjs \
      --allowlist "${ALLOWLIST}" \
      --trust-root "${TRUST_ROOT}" \
      --digest "${digest}" \
      --signature "${signature}" \
      --source-revision "${revision}"; then
    refuse "${name}" "the DEP-001 verifier rejected ${digest}"
    continue
  fi

  for record in "sbom/${name}.sbom.json" "provenance.${name}.json"; do
    if [ ! -s "${IMAGES_DIR}/${record}" ]; then
      refuse "${name}" "missing ${record} (run sbom.sh and sign.sh)"
    fi
  done
done

if [ "${refused}" -ne 0 ]; then
  echo "image admission: ${refused} refusal(s) — the image chain is NOT whole" >&2
  exit 1
fi
echo "image admission: all three split images admitted"
