/**
 * Ignore-policy evaluation + digest attribution (DAT-001-D4).
 *
 *   - `git_commit` base → `gitignore_plus_aoa`. GIT is the ignore engine (the
 *     producer enumerates with `--exclude-standard` and does NOT re-implement
 *     gitignore semantics). The digest attributes the ACTUAL rules in force: the
 *     ordered (by UTF-8 path) list of every `.gitignore` present in the tree
 *     (`{path, sha256}`) plus the pinned AOA built-in rule set.
 *   - `content_manifest` base → `explicit`. The caller supplies an ordered rule
 *     list; the producer applies a PINNED MINIMAL matcher — each rule is one of:
 *     an exact relative path, a `dir/` path-prefix, or a `*.ext` suffix — NOT
 *     full gitignore semantics (richer semantics are a documented §8 residual).
 *     Ignored files are dropped before entry-building (leakage fail-closed); an
 *     empty rule list includes all non-special entries.
 */

import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";

import type { Sha256Fn } from "./hashing.js";

/** The ignore policy the caller declares; the kind must match the base kind. */
export type IgnorePolicyInput =
  | { readonly kind: "gitignore_plus_aoa" }
  | { readonly kind: "explicit"; readonly rules: readonly string[] };

/**
 * The PINNED AOA built-in ignore rule set for a `gitignore_plus_aoa` base. It is
 * BOTH folded into the digest (attribution) AND independently APPLIED during git
 * enumeration (`captureGitBase` drops matching paths — see Finding B): git's own
 * `--exclude-standard` covers `.gitignore` only, so these rules are the overlay
 * that keeps the `.aoa/` keystore dir out of a snapshot and makes the attested
 * policy match what was applied. `.git/` is a no-op (git never lists it) kept for
 * an explicit, versioned marker. Changing this constant changes every
 * `gitignore_plus_aoa` digest and its frozen vectors.
 */
export const AOA_BUILTIN_IGNORE_RULES: readonly string[] = [".git/", ".aoa/"];

/** A discovered `.gitignore` source, attributed into the git-base digest. */
export interface GitignoreSource {
  readonly path: string;
  readonly sha256: string;
}

type ExplicitRule =
  | { readonly type: "exact"; readonly value: string }
  | { readonly type: "dir"; readonly value: string }
  | { readonly type: "ext"; readonly value: string };

/** Classify one explicit rule string into the pinned minimal grammar. */
export function classifyExplicitRule(rule: string): ExplicitRule {
  if (rule.endsWith("/")) {
    return { type: "dir", value: rule.slice(0, -1) };
  }
  if (rule.startsWith("*.")) {
    return { type: "ext", value: rule.slice(1) }; // ".ext"
  }
  return { type: "exact", value: rule };
}

/**
 * True iff the normalized relative path is ignored by the explicit rule list.
 * `dir/` matches the directory itself and everything below it; `*.ext` matches by
 * suffix; an exact rule matches the whole path.
 */
export function isIgnoredByExplicit(relPath: string, rules: readonly string[]): boolean {
  for (const rule of rules) {
    const classified = classifyExplicitRule(rule);
    if (classified.type === "exact") {
      if (relPath === classified.value) return true;
    } else if (classified.type === "dir") {
      if (relPath === classified.value || relPath.startsWith(`${classified.value}/`)) return true;
    } else if (relPath.endsWith(classified.value)) {
      return true;
    }
  }
  return false;
}

/** Compute the `explicit` ignore-policy digest (order-preserving over rules). */
export function computeExplicitIgnoreDigest(rules: readonly string[], sha256: Sha256Fn): string {
  return sha256(canonicalizeJsonV1({ kind: "explicit", rules: [...rules] }));
}

/**
 * Compute the `gitignore_plus_aoa` ignore-policy digest over the AOA built-in
 * rule set plus the discovered `.gitignore` sources (sorted by UTF-8 path).
 */
export function computeGitignoreDigest(sources: readonly GitignoreSource[], sha256: Sha256Fn): string {
  const encoder = new TextEncoder();
  const sorted = [...sources].sort((a, b) => {
    const ba = encoder.encode(a.path);
    const bb = encoder.encode(b.path);
    const len = Math.min(ba.length, bb.length);
    for (let i = 0; i < len; i += 1) {
      if (ba[i] !== bb[i]) return ba[i] < bb[i] ? -1 : 1;
    }
    return ba.length - bb.length;
  });
  return sha256(
    canonicalizeJsonV1({
      kind: "gitignore_plus_aoa",
      aoaBuiltinRules: [...AOA_BUILTIN_IGNORE_RULES],
      sources: sorted.map((source) => ({ path: source.path, sha256: source.sha256 })),
    }),
  );
}
