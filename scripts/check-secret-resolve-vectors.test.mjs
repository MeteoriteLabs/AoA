import assert from "node:assert/strict";
import test from "node:test";

import {
  SecretResolveVectorError,
  SECRET_REF_KINDS,
  decideResolve,
  loadFixture,
  verifyFixture,
} from "./check-secret-resolve-vectors.mjs";

const OWNER = { executorPrincipalKind: "user", executorPrincipalId: "owner-1" };

function decide(handle, overrides = {}) {
  return decideResolve({
    handle,
    jobOwner: OWNER,
    ownerMembershipActive: null,
    liveTargetGeneration: 7,
    ...overrides,
  });
}

function activeHandle(extra = {}) {
  return {
    status: "active", refKind: "company_secret", refId: "secret-1", materialization: "env",
    usePolicy: "sandbox_local_only", destination: null, boundTargetGeneration: null,
    ownerPrincipalKind: null, ownerPrincipalId: null, ...extra,
  };
}

test("the checked-in fixture passes the reference checker", () => {
  const { admits, rejects } = verifyFixture(loadFixture());
  assert.ok(admits >= 4);
  assert.ok(rejects >= 7);
});

test("SECRET_REF_KINDS is exactly the four legacy stores", () => {
  assert.deepEqual([...SECRET_REF_KINDS].sort(), ["company_secret", "connector_oauth", "device_local", "provider_key"]);
});

test("admits a well-formed sandbox-local company_secret", () => {
  assert.equal(decide(activeHandle()), "admit");
});

test("admits a fence_proxy connector_oauth with a destination", () => {
  assert.equal(decide(activeHandle({ refKind: "connector_oauth", materialization: "proxy", usePolicy: "fence_proxy", destination: "https://x" })), "admit");
});

test("denies revoked / unknown ref_kind / missing ref pointer", () => {
  assert.equal(decide(activeHandle({ status: "revoked" })), "handle_revoked");
  assert.equal(decide(activeHandle({ refKind: "aws_kms" })), "unknown_ref_kind");
  assert.equal(decide(activeHandle({ refKind: null })), "unknown_ref_kind");
  assert.equal(decide(activeHandle({ refId: null })), "ref_pointer_missing");
  assert.equal(decide(activeHandle({ refId: "" })), "ref_pointer_missing");
});

test("denies materialization x use_policy conflicts", () => {
  assert.equal(decide(activeHandle({ refKind: "connector_oauth", materialization: "proxy", usePolicy: "remote_server_fenced" })), "materialization_policy_conflict");
  assert.equal(decide(activeHandle({ materialization: "env", usePolicy: "fence_proxy" })), "materialization_policy_conflict");
  assert.equal(decide(activeHandle({ materialization: "file", usePolicy: "fence_proxy" })), "materialization_policy_conflict");
});

test("denies a sandbox_local_only handle carrying a network destination", () => {
  assert.equal(decide(activeHandle({ usePolicy: "sandbox_local_only", destination: "https://exfil" })), "sandbox_local_network_destination");
});

test("denies a target-generation mismatch and admits an equal pin", () => {
  assert.equal(decide(activeHandle({ boundTargetGeneration: 6 })), "target_generation_mismatch");
  assert.equal(decide(activeHandle({ boundTargetGeneration: 7 })), "admit");
});

test("device_local owner binding + membership re-check", () => {
  const owned = { refKind: "device_local", materialization: "file", usePolicy: "sandbox_local_only", ownerPrincipalKind: "user", ownerPrincipalId: "owner-1" };
  assert.equal(decide(activeHandle({ refKind: "device_local", materialization: "file", usePolicy: "sandbox_local_only" }), { ownerMembershipActive: true }), "owner_binding_incomplete");
  assert.equal(decide(activeHandle({ ...owned, ownerPrincipalId: "other" }), { ownerMembershipActive: true }), "owner_binding_incomplete");
  assert.equal(decide(activeHandle(owned), { ownerMembershipActive: false }), "owner_membership_lost");
  assert.equal(decide(activeHandle(owned), { ownerMembershipActive: true }), "admit");
});

test("verifyFixture throws when an admit vector is mutated to a denial shape", () => {
  const fixture = loadFixture();
  const mutated = structuredClone(fixture);
  mutated.admitVectors[0].handle.status = "revoked";
  assert.throws(() => verifyFixture(mutated), SecretResolveVectorError);
});

test("verifyFixture throws when a reject vector's expected reason is wrong", () => {
  const fixture = loadFixture();
  const mutated = structuredClone(fixture);
  const target = mutated.rejectVectors.find((v) => v.name === "revoked_handle");
  target.reason = "unknown_ref_kind";
  assert.throws(() => verifyFixture(mutated), SecretResolveVectorError);
});
