import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  workerEnrollmentCodeRoutes,
  type Db,
} from "@armyofagents/db";
import {
  enrollmentRequestV1Schema,
  enrollmentResponseV1Schema,
  type EnrollmentRequestV1,
  type EnrollmentResponseV1,
} from "@armyofagents/worker-protocol";
import { runInTenant } from "../db/tenant-context.js";
import { verifyDeviceProof, type DeviceProofHeaders } from "./worker-device-proof.js";

const CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 15 * 60_000;

export class WorkerEnrollmentError extends Error {
  constructor(public readonly code: "unauthorized" | "malformed" | "target_revoked") {
    super(code === "malformed" ? "Enrollment request is malformed" : "Enrollment is unauthorized");
    this.name = "WorkerEnrollmentError";
  }
}

interface IssueTenantCodeInput {
  organizationId: string;
  executionTargetId: string;
  scope: "organization" | "owner";
  ownerUserId: string | null;
  createdByPrincipalKind: string;
  createdByPrincipalId: string;
}

interface EnrollInput {
  code: string;
  request: unknown;
  rawBody: Buffer;
  proof: DeviceProofHeaders;
  method: string;
  path: string;
}

interface StoredEnrollmentResult {
  response: EnrollmentResponseV1;
  session: string;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalDigest(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function parseCode(rawCode: string): { locatorHash: string; secretHash: string } {
  const match = /^aoa_enr_([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{32,128})$/.exec(rawCode);
  if (!match) throw new WorkerEnrollmentError("unauthorized");
  return { locatorHash: sha256(match[1]!), secretHash: sha256(match[2]!) };
}

function parseRequest(rawBody: Buffer, supplied: unknown): EnrollmentRequestV1 {
  try {
    const parsedJson = JSON.parse(rawBody.toString("utf8")) as unknown;
    const parsed = enrollmentRequestV1Schema.parse(parsedJson);
    if (JSON.stringify(parsedJson) !== JSON.stringify(supplied)) {
      throw new WorkerEnrollmentError("malformed");
    }
    return parsed;
  } catch (error) {
    if (error instanceof WorkerEnrollmentError) throw error;
    throw new WorkerEnrollmentError("malformed");
  }
}

function providerConstraints(capabilities: Record<string, unknown>): unknown {
  return capabilities.providerConstraints;
}

function sessionToken(key: string, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "worker-session-v1" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function storedResult(value: Record<string, unknown> | null): StoredEnrollmentResult {
  if (!value || typeof value.session !== "string") throw new WorkerEnrollmentError("unauthorized");
  return {
    response: enrollmentResponseV1Schema.parse(value.response),
    session: value.session,
  };
}

export function createWorkerEnrollmentService(input: {
  appDb: Db;
  operatorDb: Db;
  sessionSigningKey: string;
  now?: () => Date;
}) {
  if (Buffer.byteLength(input.sessionSigningKey) < 32) {
    throw new Error("Worker session signing key must be at least 32 bytes");
  }
  const now = input.now ?? (() => new Date());

  return {
    async issueTenantCode(issue: IssueTenantCodeInput): Promise<{ code: string; expiresAt: string }> {
      if ((issue.scope === "owner") !== Boolean(issue.ownerUserId)) {
        throw new WorkerEnrollmentError("unauthorized");
      }
      const locator = randomBytes(18).toString("base64url");
      const secret = randomBytes(32).toString("base64url");
      const locatorHash = sha256(locator);
      const secretHash = sha256(secret);
      const expiresAt = new Date(now().getTime() + CODE_TTL_MS);
      await runInTenant(input.appDb, issue.organizationId, async (repos) => {
        const target = await repos.workerEnrollment.findActiveTarget({
          executionTargetId: issue.executionTargetId,
          scope: issue.scope,
          ownerUserId: issue.ownerUserId,
        });
        if (!target) throw new WorkerEnrollmentError("unauthorized");
        await repos.workerEnrollment.insertCodeRoute({
          locatorHash,
          candidateOrganizationId: issue.organizationId,
          expiresAt,
        });
        await repos.workerEnrollment.insertCode({
          organizationId: issue.organizationId,
          scope: issue.scope,
          ownerUserId: issue.ownerUserId,
          executionTargetId: target.id,
          targetAuthorityKey: target.targetAuthorityKey,
          locatorHash,
          secretHash,
          expiresAt,
          createdByPrincipalKind: issue.createdByPrincipalKind,
          createdByPrincipalId: issue.createdByPrincipalId,
        });
      });
      return { code: `aoa_enr_${locator}.${secret}`, expiresAt: expiresAt.toISOString() };
    },

    async enroll(enrollInput: EnrollInput): Promise<StoredEnrollmentResult> {
      const code = parseCode(enrollInput.code);
      const request = parseRequest(enrollInput.rawBody, enrollInput.request);
      const semanticDigest = sha256(enrollInput.rawBody);
      let verified;
      try {
        verified = verifyDeviceProof({
          method: enrollInput.method,
          path: enrollInput.path,
          bodyDigest: semanticDigest,
          correlationId: request.correlationId,
          proof: enrollInput.proof,
          now: now(),
        });
      } catch {
        throw new WorkerEnrollmentError("unauthorized");
      }

      const [route] = await input.operatorDb.select({
        candidateOrganizationId: workerEnrollmentCodeRoutes.candidateOrganizationId,
        expiresAt: workerEnrollmentCodeRoutes.expiresAt,
      }).from(workerEnrollmentCodeRoutes)
        .where(eq(workerEnrollmentCodeRoutes.locatorHash, code.locatorHash))
        .limit(1);
      if (!route?.candidateOrganizationId || route.expiresAt.getTime() < now().getTime()) {
        throw new WorkerEnrollmentError("unauthorized");
      }

      return runInTenant(input.appDb, route.candidateOrganizationId, async (repos) => {
        const authority = repos.workerEnrollment;
        const stored = await authority.lockCode(code.locatorHash);
        if (!stored || !equalDigest(stored.secretHash, code.secretHash)) {
          throw new WorkerEnrollmentError("unauthorized");
        }
        const proofRecorded = await authority.recordProof({
          organizationId: route.candidateOrganizationId,
          deviceThumbprint: verified.deviceThumbprint,
          proofId: verified.proofId,
          issuedAt: verified.issuedAt,
          expiresAt: new Date(now().getTime() + SESSION_TTL_MS),
        });
        if (!proofRecorded) throw new WorkerEnrollmentError("unauthorized");

        if (stored.consumedAt) {
          if (stored.semanticIdempotencyKey !== request.idempotencyKey ||
              stored.semanticDigest !== semanticDigest) {
            throw new WorkerEnrollmentError("malformed");
          }
          if (!stored.deviceThumbprint || !equalDigest(stored.deviceThumbprint, verified.deviceThumbprint)) {
            throw new WorkerEnrollmentError("unauthorized");
          }
          return storedResult(stored.semanticResult);
        }
        if (stored.expiresAt.getTime() < now().getTime()) throw new WorkerEnrollmentError("unauthorized");

        const target = await authority.findTargetByAuthority({
          executionTargetId: stored.executionTargetId,
          targetAuthorityKey: stored.targetAuthorityKey,
        });
        if (!target || request.hello.targetId !== target.id ||
            request.hello.deviceGeneration !== target.deviceGeneration) {
          throw new WorkerEnrollmentError("unauthorized");
        }
        const existingWorker = await authority.findWorker(request.hello.workerId);
        if (existingWorker) throw new WorkerEnrollmentError("unauthorized");

        const response = enrollmentResponseV1Schema.parse({
          protocolVersion: 1,
          correlationId: request.correlationId,
          serverTime: now().toISOString(),
          outcome: "enrolled",
          workerId: request.hello.workerId,
          targetId: target.id,
          deviceGeneration: target.deviceGeneration,
          providerConstraints: providerConstraints(target.capabilities),
        });
        const expiresAt = new Date(now().getTime() + SESSION_TTL_MS);
        const session = sessionToken(input.sessionSigningKey, {
          aud: "device_session",
          sub: request.hello.workerId,
          organizationId: stored.organizationId,
          targetId: target.id,
          generation: target.deviceGeneration,
          scope: stored.scope,
          deviceThumbprint: verified.deviceThumbprint,
          iat: Math.floor(now().getTime() / 1000),
          exp: Math.floor(expiresAt.getTime() / 1000),
        });
        const result: StoredEnrollmentResult = { response, session };
        await authority.insertWorker({
          id: request.hello.workerId,
          scope: stored.scope,
          organizationId: stored.organizationId,
          ownerUserId: stored.ownerUserId,
          executionTargetId: target.id,
          targetAuthorityKey: target.targetAuthorityKey,
          devicePublicKey: verified.publicKey,
          deviceThumbprint: verified.deviceThumbprint,
          deviceGeneration: target.deviceGeneration,
          profileHash: sha256(JSON.stringify(request.hello)),
          enrolledAt: now(),
          label: `Worker ${request.hello.workerId.slice(0, 8)}`,
          status: "enrolled",
        });
        await authority.retireBootstrapCredential(target.id);
        await authority.consumeCode({
          id: stored.id,
          consumedAt: now(),
          semanticIdempotencyKey: request.idempotencyKey,
          semanticDigest,
          deviceThumbprint: verified.deviceThumbprint,
          semanticResult: result as unknown as Record<string, unknown>,
        });
        return result;
      });
    },
  };
}
