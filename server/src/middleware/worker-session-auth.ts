import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { operatorWorkerEnrollmentRepository, type Db } from "@armyofagents/db";
import { runInTenant } from "../db/tenant-context.js";
import { verifyDeviceProof, type DeviceProofHeaders } from "../services/worker-device-proof.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_MAX_MS = 15 * 60_000;

export interface WorkerSessionClaims {
  aud: "device_session";
  sub: string;
  organizationId: string | null;
  targetId: string;
  generation: number;
  scope: "platform" | "organization" | "owner";
  deviceThumbprint: string;
  profileHash: string;
  iat: number;
  exp: number;
}

export interface VerifiedTargetPrincipal {
  workerId: string;
  targetId: string;
  targetGeneration: number;
  deviceThumbprint: string;
  profileHash: string;
  expiresAt: string;
  organizationId: string | null;
  scope: WorkerSessionClaims["scope"];
  targetScope: "platform" | "organization" | "owner";
  sharedPlatformAuthority?: {
    physicalWorkerId: string;
    physicalProfileHash: string;
    devicePublicKey: string;
  };
}

export class WorkerSessionError extends Error {
  constructor(public readonly code: "unauthorized" | "target_revoked") {
    super(code === "target_revoked" ? "Worker session target is revoked" : "Worker session is unauthorized");
    this.name = "WorkerSessionError";
  }
}

function fail(): never {
  throw new WorkerSessionError("unauthorized");
}

function assertClaims(value: unknown): WorkerSessionClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const claims = value as Record<string, unknown>;
  const keys = Object.keys(claims).sort().join(",");
  if (keys !== ["aud", "deviceThumbprint", "exp", "generation", "iat", "organizationId", "profileHash", "scope", "sub", "targetId"].sort().join(",")) fail();
  if (claims.aud !== "device_session" || !UUID.test(String(claims.sub)) || !UUID.test(String(claims.targetId)) ||
      (claims.organizationId !== null && !UUID.test(String(claims.organizationId))) ||
      !["platform", "organization", "owner"].includes(String(claims.scope)) ||
      !SHA256_HEX.test(String(claims.deviceThumbprint)) || !SHA256_HEX.test(String(claims.profileHash)) ||
      !Number.isSafeInteger(claims.generation) || Number(claims.generation) < 1 ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) fail();
  if ((claims.scope === "platform") !== (claims.organizationId === null)) fail();
  return claims as unknown as WorkerSessionClaims;
}

function signingInput(header: string, payload: string): string {
  return `${header}.${payload}`;
}

export function createWorkerSessionToken(key: string, claimsInput: WorkerSessionClaims): string {
  if (Buffer.byteLength(key) < 32) throw new Error("Worker session signing key must be at least 32 bytes");
  const claims = assertClaims(claimsInput);
  if ((claims.exp - claims.iat) * 1000 > SESSION_MAX_MS || claims.exp <= claims.iat) fail();
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "worker-session-v1" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key).update(signingInput(header, payload)).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function verifyWorkerSessionToken(key: string, token: string, now: Date = new Date()): WorkerSessionClaims {
  try {
    if (Buffer.byteLength(key) < 32) fail();
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) fail();
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as unknown;
    if (JSON.stringify(header) !== JSON.stringify({ alg: "HS256", typ: "JWT", kid: "worker-session-v1" })) fail();
    const expected = createHmac("sha256", key).update(signingInput(headerPart, payloadPart)).digest();
    const actual = Buffer.from(signaturePart, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail();
    const claims = assertClaims(JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")));
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (claims.exp <= nowSeconds || claims.iat > nowSeconds + 300 ||
        (claims.exp - claims.iat) * 1000 > SESSION_MAX_MS || claims.exp <= claims.iat) fail();
    return claims;
  } catch (error) {
    if (error instanceof WorkerSessionError) throw error;
    fail();
  }
}

export function createWorkerSessionAuthenticator(input: {
  appDb: Db;
  operatorDb: Db;
  sessionSigningKey: string;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  return {
    async authenticate(request: {
      authorization: string;
      rawBody: Buffer;
      proof: DeviceProofHeaders;
      method: string;
      path: string;
      correlationId: string;
    }): Promise<VerifiedTargetPrincipal> {
      const match = /^Bearer\s+([^\s]+)$/i.exec(request.authorization.trim());
      if (!match) fail();
      const claims = verifyWorkerSessionToken(input.sessionSigningKey, match[1]!, now());
      let proof;
      try {
        proof = verifyDeviceProof({
          method: request.method,
          path: request.path,
          bodyDigest: createHash("sha256").update(request.rawBody).digest("hex"),
          correlationId: request.correlationId,
          proof: request.proof,
          now: now(),
        });
      } catch {
        fail();
      }
      if (proof.deviceThumbprint !== claims.deviceThumbprint) fail();

      const verifyCurrent = async (
        authority: ReturnType<typeof operatorWorkerEnrollmentRepository>,
        authoritativeOrganizationId: string | null,
      ): Promise<VerifiedTargetPrincipal> => {
        await authority.cleanupExpiredProofs(now(), 100);
        const recorded = await authority.recordProof({
          organizationId: authoritativeOrganizationId,
          deviceThumbprint: proof.deviceThumbprint,
          proofId: proof.proofId,
          issuedAt: proof.issuedAt,
          expiresAt: new Date(claims.exp * 1000),
        });
        if (!recorded) fail();
        const current = await authority.findSessionAuthority({
          workerId: claims.sub,
          executionTargetId: claims.targetId,
        });
        if (!current || current.target.status === "disabled" || current.worker.status === "revoked" ||
            current.worker.revokedAt !== null || !current.ownerMembershipActive ||
            current.target.deviceGeneration !== claims.generation || current.worker.deviceGeneration !== claims.generation) {
          throw new WorkerSessionError("target_revoked");
        }
        if (current.worker.organizationId !== authoritativeOrganizationId || current.worker.scope !== claims.scope ||
            current.worker.deviceThumbprint !== claims.deviceThumbprint ||
            current.worker.devicePublicKey !== proof.publicKey || current.worker.profileHash !== claims.profileHash) fail();
        return {
          workerId: claims.sub,
          targetId: claims.targetId,
          targetGeneration: claims.generation,
          deviceThumbprint: claims.deviceThumbprint,
          profileHash: claims.profileHash,
          expiresAt: new Date(claims.exp * 1000).toISOString(),
          organizationId: authoritativeOrganizationId,
          scope: claims.scope,
          targetScope: current.target.scope as "platform" | "organization" | "owner",
        };
      };
      if (claims.organizationId === null) {
        return input.operatorDb.transaction((tx) =>
          verifyCurrent(operatorWorkerEnrollmentRepository(tx as unknown as Db), null));
      }
      const principal = await runInTenant(input.appDb, claims.organizationId, (repos) =>
        verifyCurrent(repos.workerEnrollment, claims.organizationId));
      if (principal.targetScope === "platform") {
        const physical = await input.operatorDb.transaction((tx) =>
          operatorWorkerEnrollmentRepository(tx as unknown as Db)
            .findPlatformPhysicalAuthority(principal.targetId));
        if (!physical || physical.target.status !== "active" ||
            physical.target.deviceGeneration !== principal.targetGeneration ||
            physical.worker.status === "revoked" || physical.worker.revokedAt !== null ||
            physical.worker.deviceGeneration !== principal.targetGeneration ||
            physical.worker.deviceThumbprint !== principal.deviceThumbprint ||
            physical.worker.devicePublicKey !== proof.publicKey || !physical.worker.profileHash) {
          throw new WorkerSessionError("target_revoked");
        }
        return {
          ...principal,
          sharedPlatformAuthority: {
            physicalWorkerId: physical.worker.id,
            physicalProfileHash: physical.worker.profileHash,
            devicePublicKey: proof.publicKey,
          },
        };
      }
      return principal;
    },
  };
}

export async function registerProofBoundHeartbeat(input: {
  appDb: Db;
  operatorDb?: Db;
  principal: VerifiedTargetPrincipal;
  status: "active" | "draining" | "offline";
  now?: Date;
}): Promise<boolean> {
  const heartbeatAt = input.now ?? new Date();
  if (!input.principal.organizationId) {
    if (!input.operatorDb || input.principal.scope !== "platform") fail();
    return input.operatorDb.transaction(async (tx) => {
      const authority = operatorWorkerEnrollmentRepository(tx as unknown as Db);
      const targetCurrent = await authority.heartbeatSessionTarget({
        executionTargetId: input.principal.targetId,
        deviceGeneration: input.principal.targetGeneration,
        status: input.status,
        now: heartbeatAt,
      });
      if (!targetCurrent) return false;
      const profileCurrent = await authority.heartbeatSessionProfile({
        workerId: input.principal.workerId,
        executionTargetId: input.principal.targetId,
        deviceGeneration: input.principal.targetGeneration,
        now: heartbeatAt,
      });
      if (!profileCurrent) throw new WorkerSessionError("target_revoked");
      return true;
    });
  }
  if (input.principal.targetScope === "platform") {
    if (!input.operatorDb || !input.principal.sharedPlatformAuthority) fail();
    const physical = input.principal.sharedPlatformAuthority;
    return input.operatorDb.transaction((tx) =>
      operatorWorkerEnrollmentRepository(tx as unknown as Db).heartbeatSharedPlatformTarget({
        executionTargetId: input.principal.targetId,
        targetAuthorityKey: "platform",
        deviceGeneration: input.principal.targetGeneration,
        physicalWorkerId: physical.physicalWorkerId,
        physicalProfileHash: physical.physicalProfileHash,
        devicePublicKey: physical.devicePublicKey,
        deviceThumbprint: input.principal.deviceThumbprint,
        now: heartbeatAt,
      }));
  }
  return runInTenant(input.appDb, input.principal.organizationId, async (repos) => {
    const targetCurrent = await repos.workerEnrollment.heartbeatSessionTarget({
      executionTargetId: input.principal.targetId,
      deviceGeneration: input.principal.targetGeneration,
      status: input.status,
      now: heartbeatAt,
    });
    if (!targetCurrent) return false;
    const profileCurrent = await repos.workerEnrollment.heartbeatSessionProfile({
      workerId: input.principal.workerId,
      executionTargetId: input.principal.targetId,
      deviceGeneration: input.principal.targetGeneration,
      now: heartbeatAt,
    });
    if (!profileCurrent) throw new WorkerSessionError("target_revoked");
    return true;
  });
}

export async function revokeTenantWorkerAuthority(input: {
  appDb: Db;
  organizationId: string;
  executionTargetId: string;
  now?: Date;
}): Promise<number | null> {
  return runInTenant(input.appDb, input.organizationId, (repos) =>
    repos.workerEnrollment.revokeTargetAuthority({
      executionTargetId: input.executionTargetId,
      now: input.now ?? new Date(),
    }));
}
