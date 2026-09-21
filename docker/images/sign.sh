#!/usr/bin/env bash
# docker/images/sign.sh — sign each split-image digest (DEP-001; the adapter-manager
# joined in DEP-014) with the TEST root and record it on the signed-digest allowlist.
#
# For each built image (docker/images/digests.env) this:
#   1. ensures a TEST signing keypair exists (docker/images/trust-root.key +
#      trust-root.pub.pem) — a deterministic openssl EC P-256 key;
#   2. computes the canonical simple-signing payload binding {digest, revision}
#      via scripts/lib/image-admission.mjs (the SAME bytes the verifier checks);
#   3. produces a detached ECDSA-P256/SHA256 signature (base64);
#   4. appends/updates the {image, digest, sourceRevision, signature} entry in
#      docker/images/allowlist.json.
#
# The resulting signature is exactly what scripts/lib/image-admission.mjs
# verifies with node:crypto — no cosign binary is needed at ADMISSION time.
#
# LINUX/CI-ONLY for a full run (needs the built digests). TEST ROOT ONLY —
# never release trust; REL-004 owns release signing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

# Scripts live beside this file; the build RECORD (digests.env, the keypair, the
# allowlist, provenance) lives in AOA_IMAGES_OUT_DIR — the seam
# docker/images/__tests__/image-pipeline.test.mjs uses to run this script docker-free
# on every PR. Unset, both are docker/images/ exactly as before.
SCRIPTS_DIR="${REPO_ROOT}/docker/images"
IMAGES_DIR="${AOA_IMAGES_OUT_DIR:-${SCRIPTS_DIR}}"
KEY="${IMAGES_DIR}/trust-root.key"
PUB="${IMAGES_DIR}/trust-root.pub.pem"
ALLOWLIST="${IMAGES_DIR}/allowlist.json"
DIGESTS="${IMAGES_DIR}/digests.env"

[ -f "${DIGESTS}" ] || { echo "ERROR: ${DIGESTS} missing — run build.sh first" >&2; exit 1; }

# PARSE digests.env; never `source` it. build.sh writes `${name^^}_…` keys and bash's
# `^^` keeps the hyphen (`CONTROL-PLANE_DIGEST=…`), which is not an assignment: sourcing
# it ran the line as a command and aborted this script with exit 127 (DEP-014).
digest_value() {
  local key="$1" value
  value="$(grep -E "^${key}=" "${DIGESTS}" | head -n1 | cut -d= -f2- || true)"
  [ -n "${value}" ] || { echo "ERROR: ${key} missing from ${DIGESTS}" >&2; exit 1; }
  printf '%s' "${value}"
}

# 1. TEST keypair — a deterministic openssl EC P-256 (prime256v1) keypair. This
# is the ONLY producer that round-trips with the node:crypto admission verifier
# (`scripts/lib/image-admission.mjs`, 22/22): `openssl dgst -sha256 -sign` emits a
# DER ECDSA-P256/SHA256 signature that `crypto.verify("sha256", …)` accepts, and
# `openssl ec -pubout` writes an SPKI `BEGIN PUBLIC KEY` PEM that the verifier's
# trust-root normalizer accepts.
#
# We deliberately do NOT branch on cosign here. `cosign generate-key-pair` emits
# an ENCRYPTED sigstore private key (its own PEM envelope) that `openssl dgst
# -sha256 -sign "${KEY}"` below cannot consume — under `set -euo pipefail` that
# aborts signing before any allowlist entry is recorded (fail-closed, but images
# then silently never sign). No cosign binary is needed at sign OR admission time.
if [ ! -f "${KEY}" ] || [ ! -f "${PUB}" ]; then
  echo ">> generating TEST signing keypair (openssl EC P-256)"
  openssl ecparam -name prime256v1 -genkey -noout -out "${KEY}"
  openssl ec -in "${KEY}" -pubout -out "${PUB}"
fi

sign_one() {
  local name="$1" digest="$2" revision="$3"
  echo ">> signing ${name} ${digest} @ ${revision}"

  local payload_file sig_file
  payload_file="$(mktemp)"
  sig_file="$(mktemp)"

  # Canonical simple-signing payload — SAME function the verifier reconstructs.
  node -e '
    import("./scripts/lib/image-admission.mjs").then((m) => {
      process.stdout.write(m.canonicalSigningPayload({ digest: process.argv[1], sourceRevision: process.argv[2] }));
    });
  ' "${digest}" "${revision}" > "${payload_file}"

  # Detached ECDSA-P256/SHA256 signature (base64). openssl DER output matches
  # node:crypto.verify("sha256", payload, pub, der).
  openssl dgst -sha256 -sign "${KEY}" -out "${sig_file}" "${payload_file}"
  local signature
  signature="$(base64 -w0 < "${sig_file}" 2>/dev/null || base64 < "${sig_file}" | tr -d '\n')"

  # Attach provenance next to the signature for auditing.
  AOA_IMAGE_REVISION="${revision}" bash "${SCRIPTS_DIR}/provenance.sh" "${name}" \
    > "${IMAGES_DIR}/provenance.${name}.json"

  # Append/update the allowlist entry (idempotent by digest).
  node -e '
    const fs = require("fs");
    const [file, image, digest, sourceRevision, signature] = process.argv.slice(1);
    const a = JSON.parse(fs.readFileSync(file, "utf8"));
    a.entries = (a.entries || []).filter((e) => e.digest !== digest);
    a.entries.push({ image, digest, sourceRevision, signature });
    fs.writeFileSync(file, JSON.stringify(a, null, 2) + "\n");
  ' "${ALLOWLIST}" "${name}" "${digest}" "${revision}" "${signature}"

  rm -f "${payload_file}" "${sig_file}"
}

# The three split images build.sh builds (DEP-001 + DEP-014), in build order.
# Each value is ASSIGNED before use: under `set -e` a failed substitution aborts an
# assignment, but NOT an argument list.
for name in control-plane worker adapter-manager; do
  key="${name^^}"
  digest="$(digest_value "${key}_DIGEST")"
  revision="$(digest_value "${key}_REVISION")"
  sign_one "${name}" "${digest}" "${revision}"
done

echo ">> allowlist updated: ${ALLOWLIST}"
echo ">> admit with: bash docker/images/admit.sh (runs scripts/verify-image-admission.mjs per image)"
