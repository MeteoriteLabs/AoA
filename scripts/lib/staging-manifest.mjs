/**
 * staging-manifest.mjs — the installer artifact's declared file set (DSK-003).
 *
 * WHY THIS EXISTS. `embedded-secret-scan.mjs` and `installer-admission.mjs` were both
 * built and both had nothing to run against, because no artifact was ever assembled. A
 * manifest is what turns a directory into an ARTIFACT: a declared file set with a digest
 * over it, which the scan can walk and the verifier can admit.
 *
 * THE PROPERTY THAT MATTERS IS ABOUT FILES NOBODY DECLARED. "Everything I listed is
 * present and correct" is not the same statement as "nothing else is here", and only the
 * second is worth anything for an artifact about to be signed. A build that swept in a
 * `.env`, a test fixture, or a developer's keystore blob satisfies the first and fails the
 * second — so `verifyStagingRoot` fails on an undeclared file, not just a missing or
 * altered one.
 *
 * THE DIGEST BINDS version + platform, matching `installer-admission.mjs`'s payload. The
 * same bytes built for a different platform are a different artifact, and a digest that
 * could not tell them apart would let a signature cross that line.
 *
 * Dependencies: Node built-ins only. This runs around a build, not inside one.
 */

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Paths that must never enter an artifact.
 *
 * Test files are not a tidiness concern here: `embedded-secret-scan`'s own suite contains
 * PLANTED credentials by design, so shipping tests would fail the secret gate — correctly
 * — and the natural response would be to weaken the gate. Excluding them at assembly is
 * what keeps it meaningful.
 */
const EXCLUDED = [
  /(^|\/)__tests__\//,
  /(^|\/)tests\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.map$/,
  /(^|\/)\.env($|\.)/,
  /(^|\/)fixtures\//,
];

/** True iff `path` may be assembled into the artifact. */
export function isShippableStagingPath(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  const normalized = path.split("\\").join("/");
  return !EXCLUDED.some((re) => re.test(normalized));
}

/** UTF-8 byte-order comparison, so the sort is not locale-dependent. */
function compareUtf8(a, b) {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return Buffer.compare(ba, bb);
}

/**
 * Build the manifest for an assembled file set.
 *
 * Entries are sorted by UTF-8 path bytes so the digest does not depend on the order the
 * filesystem happened to hand files back — a manifest whose digest changed between two
 * identical builds could never be signed.
 */
export function buildStagingManifest(files, { version, platform }) {
  const entries = (files ?? [])
    .filter((f) => f && typeof f.path === "string")
    .map((f) => ({
      path: f.path.split("\\").join("/"),
      sha256: createHash("sha256").update(f.text ?? "").digest("hex"),
      sizeBytes: Buffer.byteLength(f.text ?? ""),
    }))
    .sort((a, b) => compareUtf8(a.path, b.path));

  // Hand-serialized in a fixed key order: object key order is an implementation detail
  // and this string IS the contract, exactly as in `installer-admission.mjs`.
  const payload = JSON.stringify({
    kind: "aoa-desktop-staging-manifest-v1",
    platform: String(platform),
    version: String(version),
    files: entries.map((e) => ({ path: e.path, sha256: e.sha256, sizeBytes: e.sizeBytes })),
  });

  return {
    kind: "aoa-desktop-staging-manifest-v1",
    version: String(version),
    platform: String(platform),
    files: entries,
    digest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
  };
}

export const STAGING_VERIFY_FAILURES = [
  "undeclared_file",
  "missing_file",
  "digest_mismatch",
  "empty_artifact",
];

/**
 * Verify an assembled root against its manifest.
 *
 * Checks in this order, and the FIRST one is the one that is usually forgotten:
 *
 *   1. `undeclared_file` — something on disk the manifest does not list.
 *   2. `missing_file`    — something listed that is not on disk.
 *   3. `digest_mismatch` — listed and present, but not the same bytes.
 *
 * An empty artifact is refused outright: zero files is not a passing verification, it is
 * a build that produced nothing.
 */
export function verifyStagingRoot(onDisk, manifest) {
  const declared = new Map((manifest?.files ?? []).map((e) => [e.path, e]));
  const present = new Map(
    (onDisk ?? [])
      .filter((f) => f && typeof f.path === "string")
      .map((f) => [f.path.split("\\").join("/"), f]),
  );

  if (declared.size === 0 || present.size === 0) {
    return { ok: false, reason: "empty_artifact", detail: "the artifact declares or contains no files" };
  }

  for (const path of present.keys()) {
    if (!declared.has(path)) {
      return { ok: false, reason: "undeclared_file", detail: `undeclared file in the artifact: ${path}` };
    }
  }

  for (const [path, entry] of declared) {
    const file = present.get(path);
    if (!file) {
      return { ok: false, reason: "missing_file", detail: `declared file is absent: ${path}` };
    }
    const text = file.text ?? "";
    if (Buffer.byteLength(text) !== entry.sizeBytes) {
      return { ok: false, reason: "digest_mismatch", detail: `size differs: ${path}` };
    }
    if (createHash("sha256").update(text).digest("hex") !== entry.sha256) {
      return { ok: false, reason: "digest_mismatch", detail: `content differs: ${path}` };
    }
  }

  return { ok: true };
}
