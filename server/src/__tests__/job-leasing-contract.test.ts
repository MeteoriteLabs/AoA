import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  OPERATION_DESCRIPTORS,
  pollRequestV1Schema,
  protocolErrorV1Schema,
} from "@armyofagents/worker-protocol";
import { createWorkerSessionToken } from "../middleware/worker-session-auth.js";
import {
  verifyWorkerOperationProof,
  WorkerOperationProofError,
} from "../middleware/worker-operation-proof.js";
import { buildDeviceProofCanonicalInput } from "../services/worker-device-proof.js";
import { workerOperationProtocolErrorV1 } from "../services/worker-protocol-http.js";

type AuthorityWriter = {
  file: string;
  functionName: string;
  table: "executionTargets" | "workers";
  fields: string[];
  mode: "authority" | "last_seen_only";
};

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function productionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "migrations" || entry.name === "dist") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...productionTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

function propertyName(node: ts.PropertyName | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function enclosingFunctionName(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) {
      return propertyName(current.name) ?? "<anonymous>";
    }
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
      if (ts.isPropertyAssignment(parent)) return propertyName(parent.name) ?? "<anonymous>";
    }
    current = current.parent;
  }
  return "<module>";
}

function scanAuthorityWriters(sources: Array<{ file: string; source: string }>): AuthorityWriter[] {
  const writers: AuthorityWriter[] = [];
  for (const input of sources) {
    const sourceFile = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "set") {
        const update = node.expression.expression;
        if (ts.isCallExpression(update) && ts.isPropertyAccessExpression(update.expression) &&
            update.expression.name.text === "update") {
          const tableNode = update.arguments[0];
          const table = tableNode && ts.isIdentifier(tableNode) ? tableNode.text : null;
          if (table === "executionTargets" || table === "workers") {
            const value = node.arguments[0];
            const fields = value && ts.isObjectLiteralExpression(value)
              ? value.properties.map((property) => {
                  if (ts.isSpreadAssignment(property)) return "<spread>";
                  return propertyName(property.name) ?? "<computed>";
                }).sort()
              : ["<dynamic>"];
            const lastSeenOnly = fields.every((field) => field === "lastSeenAt" || field === "updatedAt");
            writers.push({
              file: input.file.replaceAll("\\", "/"),
              functionName: enclosingFunctionName(node),
              table,
              fields,
              mode: lastSeenOnly ? "last_seen_only" : "authority",
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return writers.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function writerIdentity(writer: AuthorityWriter): string {
  return `${writer.file}#${writer.functionName}:${writer.table}:${writer.fields.join(",")}:${writer.mode}`;
}

function namedFunctionSource(source: string, name: string): string {
  const file = ts.createSourceFile("named-source.ts", source, ts.ScriptTarget.Latest, true);
  let match: string | null = null;
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        propertyName(node.name) === name) {
      match = ts.isMethodDeclaration(node)
        ? `const fixture = { ${node.getText(file)} };`
        : node.getText(file);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!match) throw new Error(`writer function ${name} was not found`);
  return match;
}

function platformGuardOrderViolations(source: string): string[] {
  const file = ts.createSourceFile("guard-fixture.ts", source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node.body) {
      const markers: Array<{
        kind: "target" | "worker" | "combined" | "exclusive" | "mutation";
        position: number;
      }> = [];
      const scan = (child: ts.Node): void => {
        if (ts.isCallExpression(child)) {
          const callName = ts.isIdentifier(child.expression)
            ? child.expression.text
            : ts.isPropertyAccessExpression(child.expression)
              ? child.expression.name.text
              : null;
          if (callName === "for" && child.arguments[0] && ts.isStringLiteral(child.arguments[0]) &&
              child.arguments[0].text === "update" && ts.isPropertyAccessExpression(child.expression)) {
            const lockedQuery = child.expression.expression.getText(file);
            if (/\.from\(executionTargets\)/.test(lockedQuery)) {
              markers.push({ kind: "target", position: child.getStart(file) });
            }
            if (/\.from\(workers\)/.test(lockedQuery)) {
              markers.push({ kind: "worker", position: child.getStart(file) });
            }
          }
          if (callName === "acquirePlatformTargetAuthorityExclusive") {
            markers.push({ kind: "exclusive", position: child.getStart(file) });
          }
          if (callName === "lockPlatformAuthorityForMutation") {
            markers.push({ kind: "combined", position: child.getStart(file) });
          }
          if (callName === "set" && ts.isPropertyAccessExpression(child.expression)) {
            const update = child.expression.expression;
            if (ts.isCallExpression(update) && ts.isPropertyAccessExpression(update.expression) &&
                update.expression.name.text === "update" && update.arguments[0] &&
                ts.isIdentifier(update.arguments[0]) && update.arguments[0].text === "executionTargets") {
              markers.push({ kind: "mutation", position: child.getStart(file) });
            }
          }
        }
        ts.forEachChild(child, scan);
      };
      scan(node.body);
      const firstPosition = (kind: (typeof markers)[number]["kind"]): number | undefined => {
        const positions = markers.filter((marker) => marker.kind === kind).map((marker) => marker.position);
        return positions.length > 0 ? Math.min(...positions) : undefined;
      };
      const mutation = firstPosition("mutation");
      if (mutation !== undefined) {
        const target = firstPosition("target");
        const worker = firstPosition("worker");
        const combined = firstPosition("combined");
        const exclusive = firstPosition("exclusive");
        const directOrder = target !== undefined && worker !== undefined && exclusive !== undefined &&
          target < worker && worker < exclusive && exclusive < mutation;
        const delegatedOrder = combined !== undefined && combined < mutation &&
          (exclusive === undefined || combined < exclusive && exclusive < mutation);
        if (!directOrder && !delegatedOrder) {
          violations.push(enclosingFunctionName(node));
        }
      } else if (enclosingFunctionName(node) === "lockPlatformAuthorityForMutation") {
        const target = firstPosition("target");
        const worker = firstPosition("worker");
        const exclusive = firstPosition("exclusive");
        const rowOrder = target !== undefined && worker !== undefined && target < worker;
        const exclusiveOrder = exclusive === undefined || worker !== undefined && worker < exclusive;
        if (!rowOrder || !exclusiveOrder) violations.push("lockPlatformAuthorityForMutation");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(violations)].sort();
}

function signedPoll() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const publicKeyHeader = publicKeyBytes.toString("base64url");
  const deviceThumbprint = createHash("sha256").update(publicKeyBytes).digest("hex");
  const now = new Date();
  const request = pollRequestV1Schema.parse({
    protocolVersion: 1,
    correlationId: randomUUID(),
    issuedAt: now.toISOString(),
    nonce: "job-003-contract-poll",
    audience: "worker_poll",
    workerId: "b3000000-0000-4000-8000-000000000001",
    targetId: "b3000000-0000-4000-8000-000000000002",
    deviceGeneration: 3,
    capacity: {
      batchSlots: 1,
      browserSessionSlots: 0,
      serviceSlots: 0,
      freeCpuMillis: 1_000,
      freeMemoryMiB: 1_024,
      freeDiskMiB: 2_048,
    },
  });
  const rawBody = Buffer.from(JSON.stringify(request));
  const proofId = "job-003-contract-proof";
  const canonical = buildDeviceProofCanonicalInput({
    method: "POST",
    path: "/api/worker-control/poll",
    bodyDigest: createHash("sha256").update(rawBody).digest("hex"),
    correlationId: request.correlationId,
    issuedAt: now.toISOString(),
    proofId,
  });
  const sessionKey = "job-003-contract-session-signing-key-which-is-long-enough";
  return {
    now,
    request,
    rawBody,
    authorization: `Bearer ${createWorkerSessionToken(sessionKey, {
      aud: "device_session",
      sub: request.workerId,
      organizationId: "b3000000-0000-4000-8000-000000000003",
      targetId: request.targetId,
      generation: 3,
      scope: "organization",
      deviceThumbprint,
      profileHash: "9".repeat(64),
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor((now.getTime() + 10 * 60_000) / 1000),
    })}`,
    sessionKey,
    deviceThumbprint,
    proof: {
      version: "1",
      publicKey: publicKeyHeader,
      signature: sign(null, Buffer.from(canonical), privateKey).toString("base64url"),
      issuedAt: now.toISOString(),
      proofId,
    },
  };
}

describe("JOB-003 frozen worker-operation HTTP contract", () => {
  it("verifies the session and Ed25519 proof without opening a database transaction", () => {
    const signed = signedPoll();
    const verified = verifyWorkerOperationProof({
      sessionSigningKey: signed.sessionKey,
      authorization: signed.authorization,
      rawBody: signed.rawBody,
      proof: signed.proof,
      method: "POST",
      path: "/api/worker-control/poll",
      correlationId: signed.request.correlationId,
      now: signed.now,
    });
    expect(verified).toMatchObject({
      organizationId: "b3000000-0000-4000-8000-000000000003",
      workerId: signed.request.workerId,
      targetId: signed.request.targetId,
      targetGeneration: 3,
      profileHash: "9".repeat(64),
      proofId: "job-003-contract-proof",
    });
    expect(Object.keys(verified)).not.toContain("fenceToken");
  });

  it("binds proof to method/path/body/correlation and denies a copied bearer token", () => {
    const signed = signedPoll();
    const base = {
      sessionSigningKey: signed.sessionKey,
      authorization: signed.authorization,
      rawBody: signed.rawBody,
      proof: signed.proof,
      method: "POST",
      path: "/api/worker-control/poll",
      correlationId: signed.request.correlationId,
      now: signed.now,
    };
    expect(() => verifyWorkerOperationProof({ ...base, method: "PUT" })).toThrow(WorkerOperationProofError);
    expect(() => verifyWorkerOperationProof({ ...base, path: "/api/worker-control/lease-ack" })).toThrow(WorkerOperationProofError);
    expect(() => verifyWorkerOperationProof({ ...base, rawBody: Buffer.from("{}") })).toThrow(WorkerOperationProofError);
    expect(() => verifyWorkerOperationProof({
      ...base,
      proof: { ...signed.proof, signature: "copied-session-without-device-key" },
    })).toThrow(WorkerOperationProofError);
  });

  it("rejects the platform-scoped physical session before any tenant lookup", () => {
    const signed = signedPoll();
    const platformAuthorization = `Bearer ${createWorkerSessionToken(signed.sessionKey, {
      aud: "device_session",
      sub: signed.request.workerId,
      organizationId: null,
      targetId: signed.request.targetId,
      generation: 3,
      scope: "platform",
      deviceThumbprint: signed.deviceThumbprint,
      profileHash: "9".repeat(64),
      iat: Math.floor(signed.now.getTime() / 1000),
      exp: Math.floor((signed.now.getTime() + 10 * 60_000) / 1000),
    })}`;
    expect(() => verifyWorkerOperationProof({
      sessionSigningKey: signed.sessionKey,
      authorization: platformAuthorization,
      rawBody: signed.rawBody,
      proof: signed.proof,
      method: "POST",
      path: "/api/worker-control/poll",
      correlationId: signed.request.correlationId,
      now: signed.now,
    })).toThrow(WorkerOperationProofError);
  });

  it("uses only descriptor-allowed frozen poll errors with redacted detail", () => {
    const request = {
      body: { correlationId: randomUUID() },
      header: () => undefined,
    } as never;
    for (const code of OPERATION_DESCRIPTORS.poll.errors) {
      const error = workerOperationProtocolErrorV1(request, "poll", code, new Date());
      expect(protocolErrorV1Schema.parse(error)).toEqual(error);
      expect(error.detail).toEqual({});
      expect(error.redaction).toBe("secret");
    }
  });

  it("keeps worker routes behind the default-off distributed execution composition", () => {
    const source = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    const flagBlock = source.slice(
      source.indexOf("if (opts.distributedExecutionEnabled)"),
      source.indexOf("// Settings -> Providers"),
    );
    expect(flagBlock).toContain("workerControlRoutes");
    expect(flagBlock).toContain("tenantAppDb");
    expect(flagBlock).toContain("operatorDb");
    expect(flagBlock).toContain("workerSessionSigningKey");
    expect(flagBlock).toContain("owner fallback is forbidden");
    expect(flagBlock).not.toContain("appDb: db");
  });

  it("enforces an exhaustive authority-writer allowlist and target-worker-exclusive lock order", () => {
    const dbHelper = new URL("../../../packages/db/src/platform-target-authority-lock.ts", import.meta.url);
    expect(existsSync(dbHelper), "platform-target lock helper must exist before writers can be guarded").toBe(true);
    const sourceFiles = [
      ...productionTypeScriptFiles(join(repositoryRoot, "server", "src")),
      ...productionTypeScriptFiles(join(repositoryRoot, "packages", "db", "src")),
    ].map((path) => ({
      file: relative(repositoryRoot, path).replaceAll("\\", "/"),
      source: readFileSync(path, "utf8"),
    }));
    const inventory = scanAuthorityWriters(sourceFiles).map(writerIdentity);
    const expected = [
      "packages/db/src/repositories/tenant/job-control.ts#touchWorkerLeaseProfile:workers:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#advanceTargetGeneration:executionTargets:deviceGeneration,updatedAt:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatPlatformPhysicalLivenessOnly:executionTargets:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatPlatformPhysicalLivenessOnly:workers:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatSessionProfile:workers:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatSessionTarget:executionTargets:lastSeenAt,status,updatedAt:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatSharedPlatformTarget:executionTargets:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#heartbeatSharedPlatformTarget:workers:lastSeenAt,updatedAt:last_seen_only",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#ratifyPlacementProfile:executionTargets:providerConstraintProfile,registeredProfile,registeredProfileHash,updatedAt:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#retireBootstrapCredential:executionTargets:updatedAt,workerTokenHash:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#revokeTargetAuthority:executionTargets:deviceGeneration,status,updatedAt,workerTokenHash:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#revokeTargetAuthority:workers:revokedAt,status,updatedAt:authority",
      "packages/db/src/repositories/tenant/worker-enrollment.ts#rotateWorker:workers:deviceGeneration,devicePublicKey,deviceThumbprint,enrolledAt,profileHash,profileSnapshot,revokedAt,status,updatedAt:authority",
      "server/src/services/execution-targets.ts#ratifyPlatformExecutionTargetPlacementProfile:executionTargets:<spread>,updatedAt:authority",
      "server/src/services/execution-targets.ts#registerWorkerHeartbeat:executionTargets:<spread>,lastSeenAt,status,updatedAt:authority",
      "server/src/services/execution-targets.ts#revokeExecutionTargetWorkerToken:executionTargets:status,updatedAt,workerTokenHash:authority",
      "server/src/services/execution-targets.ts#rotateExecutionTargetWorkerToken:executionTargets:updatedAt,workerTokenHash:authority",
    ].sort();
    expect.soft(inventory).toEqual(expected);

    const injected = scanAuthorityWriters([...sourceFiles, {
      file: "server/src/services/injected-platform-bypass.ts",
      source: `export async function injectedBypass(tx: any) {
        await tx.update(executionTargets).set({ status: "offline" });
      }`,
    }]).map(writerIdentity);
    expect.soft(injected.filter((identity) => !expected.includes(identity))).toEqual([
      "server/src/services/injected-platform-bypass.ts#injectedBypass:executionTargets:status:authority",
    ]);

    const guarded = `async function guarded(tx: any) {
      await tx.select().from(executionTargets).where(ok).for("update");
      await tx.select().from(workers).where(ok).for("update");
      await acquirePlatformTargetAuthorityExclusive(tx, targetId);
      await tx.update(executionTargets).set({ status: "offline" });
    }`;
    const wrongOrder = `async function wrongOrder(tx: any) {
      await tx.select().from(executionTargets).where(ok).for("update");
      await acquirePlatformTargetAuthorityExclusive(tx, targetId);
      await tx.select().from(workers).where(ok).for("update");
      await tx.update(executionTargets).set({ status: "offline" });
    }`;
    const unguarded = `async function unguarded(tx: any) {
      await tx.update(executionTargets).set({ deviceGeneration: 2 });
    }`;
    expect.soft(platformGuardOrderViolations(guarded)).toEqual([]);
    expect.soft(platformGuardOrderViolations(wrongOrder)).toEqual(["wrongOrder"]);
    expect.soft(platformGuardOrderViolations(unguarded)).toEqual(["unguarded"]);

    const sourceByFile = new Map(sourceFiles.map((entry) => [entry.file, entry.source]));
    const targetWriters = sourceByFile.get("server/src/services/execution-targets.ts")!;
    const workerRepository = sourceByFile.get(
      "packages/db/src/repositories/tenant/worker-enrollment.ts",
    )!;
    const operatorRepository = sourceByFile.get(
      "packages/db/src/repositories/operator/job-leasing.ts",
    )!;
    expect.soft(platformGuardOrderViolations(namedFunctionSource(
      targetWriters,
      "ratifyPlatformExecutionTargetPlacementProfile",
    ))).toEqual([]);
    expect.soft(platformGuardOrderViolations(namedFunctionSource(
      workerRepository,
      "lockPlatformAuthorityForMutation",
    ))).toEqual([]);
    expect.soft(platformGuardOrderViolations(namedFunctionSource(
      workerRepository,
      "revokeTargetAuthority",
    ))).toEqual([]);
    expect.soft(platformGuardOrderViolations(namedFunctionSource(
      operatorRepository,
      "lockPlatformAuthorityForMutation",
    ))).toEqual([]);

    const writerFiles = new Set(inventory.map((identity) => identity.slice(0, identity.indexOf("#"))));
    for (const { file, source } of sourceFiles.filter((entry) => writerFiles.has(entry.file))) {
      expect(source, `${file} must not widen platform target RLS or grants`).not.toContain(
        "execution_targets_tenant_enrollment_update",
      );
    }
  });

  it("selects one database-native global head with an exact static-certificate anti-join", () => {
    const repository = readFileSync(
      new URL("../../../packages/db/src/repositories/tenant/job-control.ts", import.meta.url),
      "utf8",
    );
    const leasing = readFileSync(new URL("../services/job-leasing.ts", import.meta.url), "utf8");
    const scheduler = readFileSync(new URL("../services/job-ready-scheduler.ts", import.meta.url), "utf8");

    expect.soft(repository).not.toMatch(/lockEligibleLeaseCandidates[\s\S]{0,500}attemptIds\??:/);
    expect.soft(repository).toContain("workerLeaseRejections");
    expect.soft(repository).toMatch(/notExists\s*\(|NOT EXISTS/i);
    for (const column of [
      "organizationId", "companyId", "jobId", "attemptId", "workerId", "targetId",
      "targetAuthorityKey", "workloadType", "placementOwner", "placementTargetClass",
      "placementTargetScope", "placementTargetGeneration", "placementProfileHash",
      "placementProviderConstraintHash", "placementInputDigest", "placementPolicyDigest",
      "eligibilityVersion", "staticContextHash",
    ]) expect.soft(repository, `certificate anti-join must bind ${column}`).toContain(column);
    expect.soft(repository).toContain("statement_timestamp()");
    expect.soft(repository).toMatch(
      /orderBy\(asc\(jobs\.availableAt\),\s*desc\(jobs\.priority\),\s*asc\(jobs\.createdAt\),\s*asc\(jobs\.id\)\)/,
    );
    expect.soft(repository).toMatch(/\.limit\(256\)/);
    expect.soft(repository).toMatch(/\.for\(["']update["'],\s*\{[^}]*skipLocked:\s*true/);
    expect.soft(repository).toMatch(/inArray\(jobs\.workloadType,\s*input\.admissibleWorkloadTypes\)/);

    expect.soft(leasing).not.toContain("hintedAttemptIds");
    expect.soft(leasing).not.toMatch(/scheduler\?\.take|scheduler\.take/);
    expect.soft(leasing).toContain("LEASE_STATIC_ELIGIBILITY_VERSION");
    expect.soft(leasing).toContain("static_requirements_mismatch");
    expect.soft(leasing).toMatch(/(?:MAX_|max).*HEAD.*RESTART|headRestart/si);
    expect.soft(leasing).toMatch(/(?:3|THREE)[\s\S]{0,100}(?:restart|attempt)/i);
    expect.soft(leasing.match(/snapshotLiveLeaseCapacity\s*\(/g) ?? []).toHaveLength(1);
    expect.soft(leasing).not.toMatch(/for\s*\([^)]*candidate[^)]*\)[\s\S]{0,500}countLiveWorkerLeases/);
    const hasCapacitySnapshot = repository.includes("snapshotLiveLeaseCapacity");
    expect.soft(hasCapacitySnapshot).toBe(true);
    if (hasCapacitySnapshot) {
      const capacitySnapshot = namedFunctionSource(repository, "snapshotLiveLeaseCapacity");
      for (const predicate of ["organizationId", "workerId", "targetId"]) {
        expect.soft(capacitySnapshot, `capacity snapshot must bind ${predicate}`).toContain(predicate);
      }
      expect.soft(capacitySnapshot).toMatch(/groupBy\([^)]*workloadType|FILTER\s*\(\s*WHERE[^)]*workload_type/is);
      expect.soft(capacitySnapshot).not.toMatch(/executionTargetId[\s\S]{0,500}(?:organizationId\s+IS\s+NULL|isNull\([^)]*organization)/i);
    }
    expect.soft(repository).toMatch(/cleanupLeaseRejectionCertificates[\s\S]*\.limit\(256\)/);
    expect.soft(repository).toMatch(/cleanupLeaseRejectionCertificates[\s\S]*(?:terminal|retired|status)/i);
    expect.soft(scheduler).not.toContain("attemptId");
    expect.soft(scheduler).toMatch(/consume\(/);
  });

  it("keeps protected candidate facts immutable and certificate writers certificate-only", () => {
    const production = [
      ...productionTypeScriptFiles(join(repositoryRoot, "server", "src")),
      ...productionTypeScriptFiles(join(repositoryRoot, "packages", "db", "src")),
    ].map((path) => ({
      file: relative(repositoryRoot, path).replaceAll("\\", "/"),
      source: readFileSync(path, "utf8"),
    }));
    const protectedFields = new Map<string, Set<string>>([
      ["jobs", new Set([
        "workloadType", "input", "inputHash", "policySnapshot", "policyHash",
        "requirements", "placementRequest", "priority", "availableAt", "createdAt",
      ])],
      ["jobAttempts", new Set([
        "placementDisposition", "placementOwner", "placementTargetId",
        "placementTargetClass", "placementTargetScope", "placementTargetGeneration",
        "placementProfileHash", "placementProviderConstraintHash",
        "placementMode", "placementLeaseEligible", "placementInputDigest",
        "placementPolicyDigest", "placementDecidedAt",
      ])],
    ]);

    function scan(inputs: typeof production): string[] {
      const found: string[] = [];
      for (const input of inputs) {
        const file = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === "set") {
            const update = node.expression.expression;
            if (ts.isCallExpression(update) && ts.isPropertyAccessExpression(update.expression) &&
                update.expression.name.text === "update") {
              const tableNode = update.arguments[0];
              const table = tableNode && ts.isIdentifier(tableNode) ? tableNode.text : "";
              const protectedForTable = protectedFields.get(table);
              const values = node.arguments[0];
              if (protectedForTable && values && ts.isObjectLiteralExpression(values)) {
                const fields = values.properties
                  .map((property) => ts.isSpreadAssignment(property) ? "<spread>" : propertyName(property.name) ?? "<computed>")
                  .filter((field) => field === "<spread>" || protectedForTable.has(field))
                  .sort();
                if (fields.length > 0) {
                  found.push(`${input.file}#${enclosingFunctionName(node)}:${table}:${fields.join(",")}`);
                }
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(file);
      }
      return found.sort();
    }

    expect.soft(scan(production)).toEqual([
      "packages/db/src/repositories/tenant/job-control.ts#persistPlacementDecision:jobAttempts:placementDecidedAt,placementDisposition,placementInputDigest,placementLeaseEligible,placementMode,placementOwner,placementPolicyDigest,placementProfileHash,placementProviderConstraintHash,placementTargetClass,placementTargetGeneration,placementTargetId,placementTargetScope",
    ]);
    const injected = scan([...production, {
      file: "server/src/services/injected-candidate-mutation.ts",
      source: `async function mutate(tx: any) {
        await tx.update(jobAttempts).set({ placementProfileHash: "changed" });
      }`,
    }]);
    expect.soft(injected).toContain(
      "server/src/services/injected-candidate-mutation.ts#mutate:jobAttempts:placementProfileHash",
    );

    const repository = readFileSync(
      new URL("../../../packages/db/src/repositories/tenant/job-control.ts", import.meta.url),
      "utf8",
    );
    expect.soft(repository).toMatch(/upsertLeaseRejectionCertificates[\s\S]*workerLeaseRejections/);
    expect.soft(repository).toMatch(/cleanupLeaseRejectionCertificates[\s\S]*workerLeaseRejections/);
    expect.soft(repository).not.toMatch(
      /(?:upsert|cleanup)LeaseRejectionCertificates[\s\S]{0,1500}\.update\((?:workers|executionTargets|jobs|jobAttempts|leases)\)/,
    );
    for (const predicate of ["organizationId", "workerId", "targetId", "attemptId"]) {
      expect.soft(repository, `certificate mutation must bind ${predicate}`).toContain(predicate);
    }
  });
});
