#!/usr/bin/env node
/**
 * check-secret-resolve-vectors.mjs
 *
 * Independent reference verifier for the DAT-004 secret-resolve authorization
 * fixture `tests/fixtures/secret-resolve/v1/vectors.json`. It owns a THIRD,
 * from-scratch re-derivation of the POST-fence resolve DECISION (the half of
 * `resolveExecutionSecret` that runs AFTER `guardActiveFence` has proven the lease
 * identity): given the widened handle row's non-secret binding + the LOCKED job
 * owner + owner-membership + the live target generation, it decides admit | <reason>
 * purely, mirroring but NOT importing the `authorizeSecretResolve` decision in
 * `@armyofagents/db`. Because two independent implementations pin to one fixture,
 * neither can silently diverge on which handles may be resolved and which must be
 * refused.
 *
 * The decision NEVER sees a secret value — only identifiers/enums (the widened row
 * stores no bytes). Reasons are INTERNAL + precise; the server maps every non-fence
 * refusal onto the coarse, non-disclosing `malformed`. Fence identity
 * (org/job/attempt/target/generation-cutoff/fresh-expiry/terminal) is out of scope
 * here — it is proven by the guard and exercised by the embedded-PG integration suite.
 *
 * The helpers are exported for the dependency-free node:test corpus
 * (`check-secret-resolve-vectors.test.mjs`).
 *
 * Usage:
 *   node scripts/check-secret-resolve-vectors.mjs
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const FIXTURE_SEGMENTS = ["tests", "fixtures", "secret-resolve", "v1", "vectors.json"];

/** Thrown by the reference validation for any fixture problem. */
export class SecretResolveVectorError extends Error {}

/** The CLOSED set of legacy value stores a handle's ref_kind may dispatch to. */
export const SECRET_REF_KINDS = ["company_secret", "connector_oauth", "provider_key", "device_local"];

/**
 * The CLOSED rejection vocabulary, mirrored from `SECRET_RESOLVE_REJECTION_REASONS`
 * in `job-fence.ts`.
 *
 * Hand-written, like `decideResolve` itself — importing the real one would collapse
 * two independent derivations into one and defeat the point of this lane. The
 * corpus pins it by parsing the array out of the TypeScript source, so a mirror
 * that drifts fails rather than rots.
 */
export const SECRET_RESOLVE_REJECTION_REASONS = [
  "handle_revoked",
  "unknown_ref_kind",
  "ref_pointer_missing",
  "materialization_policy_conflict",
  "ref_kind_policy_conflict",
  "sandbox_local_network_destination",
  "network_destination_missing",
  "target_generation_mismatch",
  "owner_binding_incomplete",
  "owner_membership_lost",
];

/**
 * The pure post-fence resolve decision. Mirrors `authorizeSecretResolve` in
 * `@armyofagents/db` (job-fence.ts) WITHOUT importing it. Returns "admit" or a
 * closed internal reason.
 */
export function decideResolve(input) {
  const h = input.handle ?? {};

  // 1. A revoked handle never resolves.
  if (h.status !== "active") return "handle_revoked";

  // 2. ref_kind must be one of the four legacy stores.
  if (!h.refKind || !SECRET_REF_KINDS.includes(h.refKind)) return "unknown_ref_kind";

  // 2b. The broker pointer must be present (a half-minted handle is unresolvable).
  if (!h.refId) return "ref_pointer_missing";

  // 3. materialization x use_policy invariant (defense in depth vs a hand-built
  //    envelope): proxy <=> fence_proxy; env/file => NOT fence_proxy.
  const m = h.materialization;
  const u = h.usePolicy;
  if (m !== "proxy" && m !== "env" && m !== "file") return "materialization_policy_conflict";
  if (u !== "fence_proxy" && u !== "remote_server_fenced" && u !== "sandbox_local_only") {
    return "materialization_policy_conflict";
  }
  if (m === "proxy" && u !== "fence_proxy") return "materialization_policy_conflict";
  if ((m === "env" || m === "file") && u === "fence_proxy") return "materialization_policy_conflict";

  // 3b. ref_kind x policy binding: connector_oauth (headers-only) => fence_proxy+proxy
  //     (never the sandbox); device_local => never remote_server_fenced.
  if (h.refKind === "connector_oauth" && (u !== "fence_proxy" || m !== "proxy")) {
    return "ref_kind_policy_conflict";
  }
  if (h.refKind === "device_local" && u === "remote_server_fenced") {
    return "ref_kind_policy_conflict";
  }

  // 4. sandbox_local_only can NEVER carry a network destination (no egress path).
  if (u === "sandbox_local_only" && h.destination !== null && h.destination !== undefined && h.destination !== "") {
    return "sandbox_local_network_destination";
  }

  // 4b. A network-use handle (fence_proxy / remote_server_fenced) MUST carry a bound
  //     egress destination (DAT-004 binds; DAT-005 enforces).
  if ((u === "fence_proxy" || u === "remote_server_fenced")
    && (h.destination === null || h.destination === undefined || h.destination === "")) {
    return "network_destination_missing";
  }

  // 5. Target-generation binding (D5): pinned handles resolve only on their placement.
  if (h.boundTargetGeneration !== null && h.boundTargetGeneration !== undefined
    && h.boundTargetGeneration !== input.liveTargetGeneration) {
    return "target_generation_mismatch";
  }

  // 6. Owner binding + membership re-check.
  const ownerBound = !!(h.ownerPrincipalKind && h.ownerPrincipalId);
  if (h.refKind === "device_local" && !ownerBound) return "owner_binding_incomplete";
  if (ownerBound) {
    if (h.ownerPrincipalKind !== input.jobOwner.executorPrincipalKind
      || h.ownerPrincipalId !== input.jobOwner.executorPrincipalId) {
      return "owner_binding_incomplete";
    }
    if (input.ownerMembershipActive !== true) return "owner_membership_lost";
  }

  return "admit";
}

export function verifyFixture(fixture) {
  const problems = [];
  if (fixture?.version !== "1") problems.push(`version must be "1", got ${JSON.stringify(fixture?.version)}`);
  if (fixture?.schema !== "aoa-secret-resolve-vectors/v1") problems.push("schema id mismatch");
  const ctx = fixture?.context;
  if (typeof ctx !== "object" || ctx === null) problems.push("context missing");
  const jobOwner = ctx?.jobOwner;
  const liveTargetGeneration = ctx?.liveTargetGeneration;
  if (typeof jobOwner !== "object" || jobOwner === null) problems.push("context.jobOwner missing");
  if (!Number.isInteger(liveTargetGeneration)) problems.push("context.liveTargetGeneration must be an integer");

  const admits = Array.isArray(fixture?.admitVectors) ? fixture.admitVectors : null;
  const rejects = Array.isArray(fixture?.rejectVectors) ? fixture.rejectVectors : null;
  if (!admits || admits.length === 0) problems.push("admitVectors must be a non-empty array");
  if (!rejects || rejects.length === 0) problems.push("rejectVectors must be a non-empty array");

  const seen = new Set();
  for (const [i, v] of (admits ?? []).entries()) {
    const label = v?.name ?? `#${i}`;
    if (!v?.name || seen.has(v.name)) problems.push(`admit vector ${label}: missing or duplicate name`);
    seen.add(v?.name);
    const decision = decideResolve({
      handle: v.handle,
      jobOwner,
      ownerMembershipActive: v.ownerMembershipActive ?? null,
      liveTargetGeneration,
    });
    if (decision !== "admit") {
      problems.push(`admit vector ${label}: reference decided ${decision}, expected admit`);
    }
  }

  for (const [i, r] of (rejects ?? []).entries()) {
    const label = r?.name ?? `#${i}`;
    if (!r?.name || seen.has(r.name)) problems.push(`reject vector ${label}: missing or duplicate name`);
    seen.add(r?.name);
    if (typeof r?.reason !== "string") { problems.push(`reject vector ${label}: missing reason`); continue; }
    const decision = decideResolve({
      handle: r.handle,
      jobOwner,
      ownerMembershipActive: r.ownerMembershipActive ?? null,
      liveTargetGeneration,
    });
    if (decision === "admit") {
      problems.push(`reject vector ${label}: reference ADMITTED a handle that must be refused`);
    } else if (decision !== r.reason) {
      problems.push(`reject vector ${label}: reference decided ${decision}, expected ${r.reason}`);
    }
  }

  // EVERY rejection reason must be exercised. Without this, adding a reason to the
  // vocabulary and forgetting its vector leaves every lane green — the decision
  // surface would grow a branch that no gate has ever evaluated.
  const covered = new Set((rejects ?? []).map((r) => r?.reason));
  for (const reason of SECRET_RESOLVE_REJECTION_REASONS) {
    if (!covered.has(reason)) {
      problems.push(`rejection reason ${reason} has no reject vector`);
    }
  }

  if (problems.length > 0) {
    throw new SecretResolveVectorError(`secret-resolve fixture invalid:\n - ${problems.join("\n - ")}`);
  }
  return { admits: admits.length, rejects: rejects.length };
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadFixture(root = repoRoot()) {
  return JSON.parse(fs.readFileSync(path.join(root, ...FIXTURE_SEGMENTS), "utf8"));
}

function main() {
  let fixture;
  try {
    fixture = loadFixture();
  } catch (error) {
    console.error(`secret-resolve vectors: FAIL — cannot read/parse fixture: ${error.message}`);
    process.exit(1);
  }
  try {
    const { admits, rejects } = verifyFixture(fixture);
    console.log(`secret-resolve vectors: PASS (${admits} admit vectors, ${rejects} reject vectors)`);
  } catch (error) {
    console.error(`secret-resolve vectors: FAIL — ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
