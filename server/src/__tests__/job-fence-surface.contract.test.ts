import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  GUARDED_JOB_MUTATORS,
  isActiveFence,
  classifyFence,
  JobFenceError,
} from "@armyofagents/db";
import {
  GOVERNED_FENCE_SURFACE,
  isActiveFence as fencingIsActiveFence,
  JobFenceError as FencingJobFenceError,
} from "../services/job-fencing.js";
import { createJobControlRepository } from "../../../packages/db/src/repositories/tenant/job-control.js";
import type { Db } from "../../../packages/db/src/client.js";

// -----------------------------------------------------------------------------
// JOB-004 — STATIC governed-fence-surface contract.
//
// Every governed job-control mutator on the tenant repository MUST gate on the ONE
// common active-fence guard (`guardActiveFence`, which decides admission through the
// shared `isActiveFence` predicate) BEFORE it touches or reads any governed row.
// This test AST-scans the REAL repository source and fails closed if:
//   * the returned repository object grows a method not on the closed allowlist
//     (so a future ticket cannot add an UNGUARDED governed mutator silently);
//   * any of the seven enumerated governed mutators does not call the guard;
//   * the guard does not run BEFORE the first `tx` access in a governed mutator;
//   * the guard is not itself bound to the shared `isActiveFence` predicate.
//
// It is a pure test (TypeScript AST + a lazy stub repository) — no database.
// -----------------------------------------------------------------------------

const JOB_CONTROL_PATH = fileURLToPath(
  new URL("../../../packages/db/src/repositories/tenant/job-control.ts", import.meta.url),
);
const JOB_FENCE_PATH = fileURLToPath(
  new URL("../../../packages/db/src/repositories/tenant/job-fence.ts", import.meta.url),
);

/** The CLOSED governed mutators, per the ticket's enumerated surface. DAT-002 adds
 * `commitArtifactVersion` (the fenced verified-commit sibling of the thin
 * `authorizeArtifactCommit`). */
const EXPECTED_GUARDED = [
  "acceptEvent",
  "authorizeArtifactCommit",
  "commitArtifactVersion",
  // DAT-003 — the fenced workspace-patch apply/review disposition mutator.
  "recordPatchApplyState",
  "readSecretHandle",
  // DAT-004 — the fenced lease-scoped secret-handle resolve authorization mutator.
  "resolveExecutionSecret",
  "completeAttempt",
  "recordServiceHealth",
  "applyProjectionReceipt",
  "ackControlCommand",
].sort();

/**
 * The closed allowlist of every OTHER repository method (pre-JOB-004 lifecycle,
 * placement, and read accessors, plus the JOB-004 renewal). The returned
 * repository object's method set must equal exactly (this ∪ the guarded set) — a
 * new method fails the test until an author classifies it here or as guarded.
 */
const EXPECTED_UNGUARDED = [
  "admission",
  "taskSourceIsAdmitted",
  "internalRunSourceIsAdmitted",
  "commanderSourceIsAdmitted",
  "serviceSourceIsAdmitted",
  "insertJobOnce",
  "findSubmission",
  "insertAttempt",
  "findInitialAttempt",
  "insertOutbox",
  "lockPlacementContext",
  "listPlacementCandidateSnapshots",
  "persistPlacementDecision",
  "lockWorkerLeaseAuthority",
  "lockEligibleLeaseCandidates",
  "snapshotLiveLeaseCapacity",
  "upsertLeaseRejectionCertificates",
  "cleanupLeaseRejectionCertificates",
  "acquirePlatformTargetAuthorityShared",
  "recheckPlatformTargetAuthority",
  "touchWorkerLeaseProfile",
  "currentDatabaseTime",
  "setLocalStatementTimeout",
  "offerLease",
  "cleanupExpiredOperationReceipts",
  "findOperationReceipt",
  "lockLeaseAckContext",
  "activateLeaseAck",
  "renewLease",
  "readAcceptedThroughSeq",
  "claimReadyOutbox",
  "deliverReadyOutbox",
  // JOB-006 server-authority (operator/reaper) surface: these lock the authoritative
  // job/attempt/lease rows directly and PERMANENTLY revoke the fence, so they are
  // deliberately NOT worker-fence-guarded (the reaper acts when the fence is stale).
  "requestCancellation",
  "listPendingControlCommands",
  "allocateRetryAttempt",
  "reapExpiredLeases",
  // JOB-011 SERVER-authored governance-projection surface: invoked ONLY from the
  // control-plane approval bridge (never a worker route), so they are outside the
  // worker-fenced closed set. They still gate on guardActiveFence internally
  // (defense in depth — a governance moment must act on a LIVE distributed attempt),
  // but they are classified here because they are not worker-reachable mutators.
  "recordGovernedProjection",
  "markGovernedProjectionApplied",
  "queueGovernedControlCommand",
  // JOB-011 guard-only lock: `lockActiveFence` calls guardActiveFence and returns its
  // locked lease+attempt WITHOUT writing anything (a read-only serialization primitive
  // the approval bridge uses to close a create TOCTOU). It is not a worker-reachable
  // governed mutator, so it is classified here like the other control-plane methods.
  "lockActiveFence",
];

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function findFunction(source: ts.SourceFile, name: string): ts.FunctionDeclaration {
  let found: ts.FunctionDeclaration | undefined;
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) found = node;
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (!found) throw new Error(`function ${name} not found`);
  return found;
}

/** The repository object literal returned as a DIRECT statement of `fn`'s body. */
function returnedObjectLiteral(fn: ts.FunctionDeclaration): ts.ObjectLiteralExpression {
  for (const statement of fn.body!.statements) {
    if (ts.isReturnStatement(statement) && statement.expression
      && ts.isObjectLiteralExpression(statement.expression)) {
      return statement.expression;
    }
  }
  throw new Error("no returned object literal");
}

function methodMembers(object: ts.ObjectLiteralExpression): Map<string, ts.Node> {
  const members = new Map<string, ts.Node>();
  for (const member of object.properties) {
    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      members.set(member.name.text, member);
    } else if (ts.isPropertyAssignment(member) && ts.isIdentifier(member.name)) {
      members.set(member.name.text, member.initializer);
    }
  }
  return members;
}

/** Earliest source position of a call to `guardActiveFence(...)` in `node`. */
function guardCallStart(node: ts.Node): number {
  let start = Number.POSITIVE_INFINITY;
  const walk = (current: ts.Node): void => {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)
      && current.expression.text === "guardActiveFence") {
      start = Math.min(start, current.getStart());
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return start;
}

/** Earliest source position of ANY `tx.select|insert|update|delete(...)` in `node`. */
function firstTxAccessStart(node: ts.Node): number {
  let start = Number.POSITIVE_INFINITY;
  const walk = (current: ts.Node): void => {
    if (ts.isCallExpression(current)
      && ts.isPropertyAccessExpression(current.expression)
      && ts.isIdentifier(current.expression.expression)
      && current.expression.expression.text === "tx"
      && ["select", "insert", "update", "delete"].includes(current.expression.name.text)) {
      start = Math.min(start, current.getStart());
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return start;
}

function callsIdentifier(node: ts.Node, name: string): boolean {
  let found = false;
  const walk = (current: ts.Node): void => {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)
      && current.expression.text === name) {
      found = true;
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return found;
}

describe("JOB-004 governed active-fence surface (static contract)", () => {
  const jobControl = parse(JOB_CONTROL_PATH);
  const repositoryFactory = findFunction(jobControl, "createJobControlRepository");
  const repositoryObject = returnedObjectLiteral(repositoryFactory);
  const methods = methodMembers(repositoryObject);

  it("enumerates the exact seven guarded mutators as the shared closed surface", () => {
    expect([...GUARDED_JOB_MUTATORS].sort()).toEqual(EXPECTED_GUARDED);
    // The server-side mirror agrees byte-for-byte with the db-owned list.
    expect([...GOVERNED_FENCE_SURFACE].sort()).toEqual(EXPECTED_GUARDED);
    expect([...GOVERNED_FENCE_SURFACE].sort()).toEqual([...GUARDED_JOB_MUTATORS].sort());
  });

  it("keeps the returned repository object a CLOSED method surface (fail-closed on new methods)", () => {
    const actual = [...methods.keys()].sort();
    const expected = [...new Set([...EXPECTED_UNGUARDED, ...GUARDED_JOB_MUTATORS])].sort();
    // A new repository method (governed or not) must be classified here before it
    // can land — an unclassified addition fails this equality.
    expect(actual).toEqual(expected);
  });

  it("defines and exposes every guarded mutator at runtime", () => {
    const repository = createJobControlRepository({} as unknown as Db);
    for (const name of GUARDED_JOB_MUTATORS) {
      expect(methods.has(name), `${name} must be defined on the repository object`).toBe(true);
      expect(typeof (repository as unknown as Record<string, unknown>)[name]).toBe("function");
    }
    expect(typeof (repository as unknown as Record<string, unknown>).renewLease).toBe("function");
  });

  it("gates EVERY guarded mutator on guardActiveFence BEFORE any tx access", () => {
    for (const name of GUARDED_JOB_MUTATORS) {
      const method = methods.get(name);
      expect(method, `${name} missing`).toBeDefined();
      const guardStart = guardCallStart(method!);
      const txStart = firstTxAccessStart(method!);
      expect(Number.isFinite(guardStart), `${name} must call guardActiveFence`).toBe(true);
      expect(
        guardStart < txStart,
        `${name} must call guardActiveFence before any tx.select/insert/update/delete`,
      ).toBe(true);
    }
  });

  it("also gates the conditional lease renewal on guardActiveFence before any tx access", () => {
    const renew = methods.get("renewLease");
    expect(renew).toBeDefined();
    const guardStart = guardCallStart(renew!);
    const txStart = firstTxAccessStart(renew!);
    expect(Number.isFinite(guardStart)).toBe(true);
    expect(guardStart < txStart).toBe(true);
  });

  it("binds the guard to the shared active-fence predicate", () => {
    const guard = findFunction(jobControl, "guardActiveFence");
    expect(callsIdentifier(guard, "isActiveFence"), "guardActiveFence must use isActiveFence").toBe(true);
    expect(callsIdentifier(guard, "classifyFence"), "guardActiveFence must classify the refusal").toBe(true);
    // The guard's locking read must evaluate expiry against a FRESH database clock.
    expect(guard.getFullText()).toContain("clock_timestamp()");
  });

  it("owns the predicate + closed surface in the shared job-fence module", () => {
    const fence = readFileSync(JOB_FENCE_PATH, "utf8");
    for (const token of ["isActiveFence", "classifyFence", "JobFenceError", "GUARDED_JOB_MUTATORS"]) {
      expect(fence).toContain(`export`);
      expect(fence).toContain(token);
    }
    // The server fence module re-exports the SAME predicate + error (identity check).
    expect(fencingIsActiveFence).toBe(isActiveFence);
    expect(FencingJobFenceError).toBe(JobFenceError);
    expect(typeof classifyFence).toBe("function");
  });

  it("declares the predicate honestly: active only when active + fresh + non-terminal", () => {
    expect(isActiveFence({ leaseStatus: "active", attemptStatus: "leased", expiresFresh: true })).toBe(true);
    expect(isActiveFence({ leaseStatus: "active", attemptStatus: "running", expiresFresh: true })).toBe(true);
    expect(isActiveFence({ leaseStatus: "offered", attemptStatus: "leased", expiresFresh: true })).toBe(false);
    expect(isActiveFence({ leaseStatus: "active", attemptStatus: "leased", expiresFresh: false })).toBe(false);
    expect(isActiveFence({ leaseStatus: "active", attemptStatus: "succeeded", expiresFresh: true })).toBe(false);
    expect(classifyFence({ leaseStatus: "active", attemptStatus: "succeeded", expiresFresh: true })).toBe("attempt_terminal");
    expect(classifyFence({ leaseStatus: "active", attemptStatus: "leased", expiresFresh: false })).toBe("stale_fence");
    expect(classifyFence({ leaseStatus: "active", attemptStatus: "leased", expiresFresh: true })).toBeNull();
  });
});
