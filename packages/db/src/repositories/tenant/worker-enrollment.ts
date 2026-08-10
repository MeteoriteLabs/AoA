import { and, eq, isNull, or } from "drizzle-orm";
import type { Db } from "../../client.js";
import {
  executionTargets,
  workerEnrollmentCodeRoutes,
  workerEnrollmentCodes,
  workerProofReplays,
  workers,
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
    scope: "organization" | "owner";
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
  insertWorker(values: NewWorker): Promise<Worker>;
  consumeCode(input: {
    id: string;
    consumedAt: Date;
    semanticIdempotencyKey: string;
    semanticDigest: string;
    deviceThumbprint: string;
    semanticResult: Record<string, unknown>;
  }): Promise<void>;
  retireBootstrapCredential(executionTargetId: string): Promise<void>;
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
          : and(
              or(eq(executionTargets.scope, "organization"), eq(executionTargets.scope, "platform")),
              isNull(executionTargets.ownerUserId),
            ),
      )).limit(1);
      return target ?? null;
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
    async insertWorker(values) {
      const [worker] = await tx.insert(workers).values(values).returning();
      return worker!;
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
  };
}
