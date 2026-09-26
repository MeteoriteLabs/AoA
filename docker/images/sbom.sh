#!/usr/bin/env bash
# docker/images/sbom.sh — emit a MINIMUM SBOM per split image (DEP-001; the
# adapter-manager joined in DEP-014).
#
# For each built image (from docker/images/digests.env) writes an SPDX-ish JSON
# SBOM listing the image ref, content digest, recorded source revision, base
# image digest, and the top-level runtime package inventory. Prefers `syft` if
# present; otherwise falls back to enumerating the image's node_modules via a
# throwaway container (still Docker-dependent).
#
# LINUX/CI-ONLY (needs a Docker daemon and the built images). TEST ROOT ONLY.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

# AOA_IMAGES_OUT_DIR relocates the build RECORD (digests.env in, sbom/ out) — the
# seam docker/images/__tests__/image-pipeline.test.mjs uses to run this script
# docker-free on every PR. Unset, it is docker/images/ exactly as before.
IMAGES_DIR="${AOA_IMAGES_OUT_DIR:-${REPO_ROOT}/docker/images}"
DIGESTS="${IMAGES_DIR}/digests.env"
[ -f "${DIGESTS}" ] || { echo "ERROR: ${DIGESTS} missing — run build.sh first" >&2; exit 1; }

# PARSE digests.env; never `source` it. build.sh writes `${name^^}_…` keys and bash's
# `^^` keeps the hyphen (`CONTROL-PLANE_IMAGE=…`), which is not an assignment: sourcing
# it ran the line as a command and aborted this script with exit 127 (DEP-014).
digest_value() {
  local key="$1" value
  value="$(grep -E "^${key}=" "${DIGESTS}" | head -n1 | cut -d= -f2- || true)"
  [ -n "${value}" ] || { echo "ERROR: ${key} missing from ${DIGESTS}" >&2; exit 1; }
  printf '%s' "${value}"
}

OUT_DIR="${IMAGES_DIR}/sbom"
mkdir -p "${OUT_DIR}"

emit_sbom() {
  local name="$1" image_ref="$2" digest="$3" revision="$4"
  local out="${OUT_DIR}/${name}.sbom.json"
  echo ">> SBOM for ${name} (${digest})"

  if command -v syft >/dev/null 2>&1; then
    syft "${image_ref}" -o spdx-json > "${out}"
    return
  fi

  # Minimum fallback: image identity + top-level runtime package inventory.
  local packages
  packages="$(docker run --rm --entrypoint sh "${image_ref}" -c \
    'for d in ./node_modules/* ./*/node_modules/*; do [ -f "$d/package.json" ] && node -e "const p=require(process.argv[1]+\"/package.json\");console.log(p.name+\"@\"+p.version)" "$d"; done 2>/dev/null | sort -u' \
    || echo "")"

  {
    echo "{"
    echo "  \"spdxVersion\": \"SPDX-2.3-min\","
    echo "  \"name\": \"${name}\","
    echo "  \"image\": \"${image_ref}\","
    echo "  \"digest\": \"${digest}\","
    echo "  \"sourceRevision\": \"${revision}\","
    echo "  \"packages\": ["
    local first=1
    while IFS= read -r pkg; do
      [ -z "${pkg}" ] && continue
      if [ "${first}" -eq 1 ]; then first=0; else echo ","; fi
      printf '    {"name": "%s"}' "${pkg}"
    done <<< "${packages}"
    echo ""
    echo "  ]"
    echo "}"
  } > "${out}"
  echo ">> wrote ${out}"
}

# The three split images build.sh builds (DEP-001 + DEP-014), in build order.
# Each value is ASSIGNED before use: under `set -e` a failed substitution aborts an
# assignment, but NOT an argument list — `emit_sbom "$(digest_value …)"` would carry on
# with an empty value.
for name in control-plane worker adapter-manager; do
  key="${name^^}"
  image_ref="$(digest_value "${key}_IMAGE")"
  digest="$(digest_value "${key}_DIGEST")"
  revision="$(digest_value "${key}_REVISION")"
  emit_sbom "${name}" "${image_ref}" "${digest}" "${revision}"
done
