import { and, asc, eq, exists, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Db } from "../../client.js";
import {
  executionTargets,
  workerEnrollmentCodeRoutes,
  workerEnrollmentCodes,
  workerProofReplays,
  workers,
  organizationMemberships,
  type NewWorker,
  type Worker,
  type WorkerEnrollmentCode,
} from "../../schema/index.js";

type ExecutionTarget = typeof executionTargets.$inferSelect;
type EnrollmentTarget = Pick<ExecutionTarget,
  "id" | "organizationId" | "ownerUserId" | "scope" | "targetAuthorityKey" |
  "status" | "deviceGeneration" | "capabilities"
>;

const enrollmentTargetColumns = {
  id: executionTargets.id,
  organizationId: executionTargets.organizationId,
  ownerUserId: executionTargets.ownerUserId,
  scope: executionTargets.scope,
  targetAuthorityKey: executionTargets.targetAuthorityKey,
  status: executionTargets.status,
  deviceGeneration: executionTargets.deviceGeneration,
  capabilities: executionTargets.capabilities,
};

export interface WorkerEnrollmentRepository {
  findActiveTarget(input: {
    executionTargetId: string;
    scope: "platform" | "organization" | "owner";
    ownerUserId: string | null;
  }): Promise<EnrollmentTarget | null>;
  insertCodeRoute(values: typeof workerEnrollmentCodeRoutes.$inferInsert): Promise<void>;
  insertCode(values: typeof workerEnrollmentCodes.$inferInsert): Promise<void>;
  lockCode(locatorHash: string): Promise<WorkerEnrollmentCode | null>;
  recordProof(values: typeof workerProofReplays.$inferInsert): Promise<boolean>;
  findTargetByAuthority(input: {
    executionTargetId: string;
    targetAuthorityKey: string;
  }): Promise<EnrollmentTarget | null>;
  findWorker(id: string): Promise<Worker | null>;
  findWorkerForBinding(input: {
    scope: string;
    organizationId: string | null;
    ownerUserId: string | null;
    executionTargetId: string;
  }): Promise<Worker | null>;
  findPlatformPhysicalAuthority(executionTargetId: string): Promise<{
    worker: Worker;
    target: EnrollmentTarget;
  } | null>;
  insertWorker(values: NewWorker): Promise<Worker>;
  rotateWorker(input: {
    id: string;
    expectedGeneration: number;
    nextGeneration: number;
    devicePublicKey: string;
    deviceThumbprint: string;
    profileHash: string;
    enrolledAt: Date;
  }): Promise<boolean>;
  advanceTargetGeneration(input: {
    executionTargetId: string;
    expectedGeneration: number;
    now: Date;
  }): Promise<number | null>;
  consumeCode(input: {
    id: string;
    consumedAt: Date;
    semanticIdempotencyKey: string;
    semanticDigest: string;
    deviceThumbprint: string;
    semanticResult: Record<string, unknown>;
  }): Promise<void>;
  retireBootstrapCredential(executionTargetId: string): Promise<void>;
  findSessionAuthority(input: { workerId: string; executionTargetId: string }): Promise<{
    worker: Worker;
    target: EnrollmentTarget;
    ownerMembershipActive: boolean;
  } | null>;
  cleanupExpiredProofs(expiresBefore: Date, limit?: number): Promise<number>;
  heartbeatSessionTarget(input: {
    executionTargetId: string;
    deviceGeneration: number;
    status: "active" | "draining" | "offline";
    now: Date;
  }): Promise<boolean>;
  heartbeatSessionProfile(input: {
    workerId: string;
    executionTargetId: string;
    deviceGeneration: number;
    now: Date;
  }): Promise<boolean>;
  heartbeatSharedPlatformTarget(input: {
    executionTargetId: string;
    targetAuthorityKey: "platform";
    deviceGeneration: number;
    physicalWorkerId: string;
    physicalProfileHash: string;
    devicePublicKey: string;
    deviceThumbprint: string;
    now: Date;
  }): Promise<boolean>;
  revokeTargetAuthority(input: { executionTargetId: string; now: Date }): Promise<number | null>;
}

export function createWorkerEnrollmentRepository(tx: Db): WorkerEnrollmentRepository {
  return {
    async findActiveTarget(input) {
      const [target] = await tx.select(enrollmentTargetColumns).from(executionTargets).where(and(
        eq(executionTargets.id, input.executionTargetId),
        eq(executionTargets.status, "active"),
        input.scope === "owner"
          ? and(
              eq(executionTargets.scope, "owner"),
              eq(executionTargets.ownerUserId, input.ownerUserId!),
            )
          : input.scope === "organization" ? and(
              or(eq(executionTargets.scope, "organization"), eq(executionTargets.scope, "platform")),
              isNull(executionTargets.ownerUserId),
            ) : and(
              eq(executionTargets.scope, "platform"),
              isNull(executionTargets.organizationId),
              isNull(executionTargets.ownerUserId),
            ),
      )).limit(1);
      if (!target) return null;
      if (input.scope === "owner") {
        const [membership] = await tx.select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(and(
            eq(organizationMemberships.organizationId, target.organizationId!),
            eq(organizationMemberships.userId, input.ownerUserId!),
            eq(organizationMemberships.status, "active"),
          ))
          .limit(1);
        if (!membership) return null;
      }
      return target;
    },
    async insertCodeRoute(values) {
      await tx.insert(workerEnrollmentCodeRoutes).values(values);
    },
    async insertCode(values) {
      await tx.insert(workerEnrollmentCodes).values(values);
    },
    async lockCode(locatorHash) {
      const [code] = await tx.select().from(workerEnrollmentCodes)
        .where(eq(workerEnrollmentCodes.locatorHash, locatorHash))
        .limit(1)
        .for("update");
      return code ?? null;
    },
    async recordProof(values) {
      await tx.delete(workerProofReplays).where(and(
        eq(workerProofReplays.deviceThumbprint, values.deviceThumbprint),
        eq(workerProofReplays.proofId, values.proofId),
        lte(workerProofReplays.expiresAt, sql`clock_timestamp()`),
      ));
      const rows = await tx.insert(workerProofReplays).values(values)
        .onConflictDoNothing()
        .returning({ id: workerProofReplays.id });
      return rows.length === 1;
    },
    async findTargetByAuthority(input) {
      const [target] = await tx.select(enrollmentTargetColumns).from(executionTargets).where(and(
        eq(executionTargets.id, input.executionTargetId),
        eq(executionTargets.targetAuthorityKey, input.targetAuthorityKey),
        eq(executionTargets.status, "active"),
      )).limit(1);
      return target ?? null;
    },
    async findWorker(id) {
      const [worker] = await tx.select().from(workers).where(eq(workers.id, id)).limit(1);
      return worker ?? null;
    },
    async findWorkerForBinding(input) {
      const conditions = [
        eq(workers.scope, input.scope),
        eq(workers.executionTargetId, input.executionTargetId),
        input.organizationId === null
          ? isNull(workers.organizationId)
          : eq(workers.organizationId, input.organizationId),
        input.ownerUserId === null
          ? isNull(workers.ownerUserId)
          : eq(workers.ownerUserId, input.ownerUserId),
      ];
      const [worker] = await tx.select().from(workers).where(and(...conditions)).limit(1).for("update");
      return worker ?? null;
    },
    async findPlatformPhysicalAuthority(executionTargetId) {
      const [row] = await tx.select({
        worker: workers,
        target: enrollmentTargetColumns,
      }).from(workers)
        .innerJoin(executionTargets, and(
          eq(workers.executionTargetId, executionTargets.id),
          eq(workers.targetAuthorityKey, executionTargets.targetAuthorityKey),
        ))
        .where(and(
          eq(executionTargets.id, executionTargetId),
          isNull(executionTargets.organizationId),
          isNull(executionTargets.ownerUserId),
          eq(executionTargets.scope, "platform"),
          eq(workers.scope, "platform"),
          isNull(workers.organizationId),
          isNull(workers.ownerUserId),
        ))
        .limit(1);
      return row ?? null;
    },
    async insertWorker(values) {
      const [worker] = await tx.insert(workers).values(values).returning();
      return worker!;
    },
    async rotateWorker(input) {
      const rows = await tx.update(workers).set({
        devicePublicKey: input.devicePublicKey,
        deviceThumbprint: input.deviceThumbprint,
        deviceGeneration: input.nextGeneration,
        profileHash: input.profileHash,
        enrolledAt: input.enrolledAt,
        revokedAt: null,
        status: "enrolled",
        updatedAt: input.enrolledAt,
      }).where(and(
        eq(workers.id, input.id),
        eq(workers.deviceGeneration, input.expectedGeneration),
      )).returning({ id: workers.id });
      return rows.length === 1;
    },
    async advanceTargetGeneration(input) {
      const [target] = await tx.update(executionTargets).set({
        deviceGeneration: sql`${executionTargets.deviceGeneration} + 1`,
        updatedAt: input.now,
      }).where(and(
        eq(executionTargets.id, input.executionTargetId),
        eq(executionTargets.deviceGeneration, input.expectedGeneration),
        ne(executionTargets.status, "disabled"),
      )).returning({ deviceGeneration: executionTargets.deviceGeneration });
      return target?.deviceGeneration ?? null;
    },
    async consumeCode(input) {
      await tx.update(workerEnrollmentCodes).set({
        consumedAt: input.consumedAt,
        semanticIdempotencyKey: input.semanticIdempotencyKey,
        semanticDigest: input.semanticDigest,
        deviceThumbprint: input.deviceThumbprint,
        semanticResult: input.semanticResult,
      }).where(eq(workerEnrollmentCodes.id, input.id));
    },
    async retireBootstrapCredential(executionTargetId) {
      await tx.update(executionTargets).set({
        workerTokenHash: null,
        updatedAt: new Date(),
      }).where(eq(executionTargets.id, executionTargetId));
    },
    async findSessionAuthority(input) {
      const [row] = await tx.select({
        worker: workers,
        target: enrollmentTargetColumns,
      }).from(workers)
        .innerJoin(executionTargets, and(
          eq(workers.executionTargetId, executionTargets.id),
          eq(workers.targetAuthorityKey, executionTargets.targetAuthorityKey),
        ))
        .where(and(
          eq(workers.id, input.workerId),
          eq(workers.executionTargetId, input.executionTargetId),
        ))
        .limit(1);
      if (!row) return null;
      let ownerMembershipActive = true;
      if (row.worker.scope === "owner") {
        const [membership] = await tx.select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(and(
            eq(organizationMemberships.organizationId, row.worker.organizationId!),
            eq(organizationMemberships.userId, row.worker.ownerUserId!),
            eq(organizationMemberships.status, "active"),
          ))
          .limit(1);
        ownerMembershipActive = Boolean(membership);
      }
      return { worker: row.worker, target: row.target, ownerMembershipActive };
    },
    async cleanupExpiredProofs(expiresBefore, limit = 100) {
      const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
      const rows = await tx.select({ id: workerProofReplays.id })
        .from(workerProofReplays)
        .where(lte(workerProofReplays.expiresAt, expiresBefore))
        .orderBy(asc(workerProofReplays.expiresAt), asc(workerProofReplays.id))
        .limit(boundedLimit);
      if (rows.length === 0) return 0;
      const deleted = await tx.delete(workerProofReplays)
        .where(inArray(workerProofReplays.id, rows.map((row) => row.id)))
        .returning({ id: workerProofReplays.id });
      return deleted.length;
    },
    async heartbeatSessionTarget(input) {
      const rows = await tx.update(executionTargets).set({
        status: input.status,
        lastSeenAt: input.now,
        updatedAt: input.now,
      }).where(and(
        eq(executionTargets.id, input.executionTargetId),
        eq(executionTargets.deviceGeneration, input.deviceGeneration),
        ne(executionTargets.status, "disabled"),
      )).returning({ id: executionTargets.id });
      return rows.length === 1;
    },
    async heartbeatSessionProfile(input) {
      const rows = await tx.update(workers).set({
        lastSeenAt: input.now,
        updatedAt: input.now,
      }).where(and(
        eq(workers.id, input.workerId),
        eq(workers.executionTargetId, input.executionTargetId),
        eq(workers.deviceGeneration, input.deviceGeneration),
        ne(workers.status, "revoked"),
      )).returning({ id: workers.id });
      return rows.length === 1;
    },
    async heartbeatSharedPlatformTarget(input) {
      const physicalAuthorityExists = tx.select({ id: workers.id })
        .from(workers)
        .where(and(
          eq(workers.id, input.physicalWorkerId),
          eq(workers.executionTargetId, input.executionTargetId),
          eq(workers.targetAuthorityKey, input.targetAuthorityKey),
          eq(workers.scope, "platform"),
          isNull(workers.organizationId),
          isNull(workers.ownerUserId),
          ne(workers.status, "revoked"),
          isNull(workers.revokedAt),
          eq(workers.deviceGeneration, input.deviceGeneration),
          eq(workers.devicePublicKey, input.devicePublicKey),
          eq(workers.deviceThumbprint, input.deviceThumbprint),
          eq(workers.profileHash, input.physicalProfileHash),
        ));
      const rows = await tx.update(executionTargets).set({
        lastSeenAt: input.now,
        updatedAt: input.now,
      }).where(and(
        eq(executionTargets.id, input.executionTargetId),
        eq(executionTargets.targetAuthorityKey, input.targetAuthorityKey),
        eq(executionTargets.scope, "platform"),
        isNull(executionTargets.organizationId),
        isNull(executionTargets.ownerUserId),
        eq(executionTargets.status, "active"),
        eq(executionTargets.deviceGeneration, input.deviceGeneration),
        exists(physicalAuthorityExists),
      )).returning({ id: executionTargets.id });
      return rows.length === 1;
    },
    async revokeTargetAuthority(input) {
      const [target] = await tx.update(executionTargets).set({
        status: "disabled",
        workerTokenHash: null,
        deviceGeneration: sql`${executionTargets.deviceGeneration} + 1`,
        updatedAt: input.now,
      }).where(eq(executionTargets.id, input.executionTargetId))
        .returning({ deviceGeneration: executionTargets.deviceGeneration });
      if (!target) return null;
      await tx.update(workers).set({
        status: "revoked",
        revokedAt: input.now,
        updatedAt: input.now,
      }).where(eq(workers.executionTargetId, input.executionTargetId));
      return target.deviceGeneration;
    },
  };
}
