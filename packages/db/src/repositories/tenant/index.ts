// packages/db/src/repositories/tenant/index.ts
//
// Tenant repository boundary for the new-path distributed-execution kernel
// (TEN-001a). This is the ONLY sanctioned reader/writer of jobs / job_attempts /
// leases, and every accessor operates strictly through the caller-supplied `tx`
// handle. TEN-003's `runInTenant` will supply a tenant-scoped transaction (over
// the non-owner pool, with the `aoa.organization_id` GUC set) so forced RLS
// filters every query; nothing here opens its own connection or reaches a pool.
//
// The public surface is EXACTLY `tenantRepositories` (a factory) plus TypeScript
// types (which erase at runtime). There is deliberately NO standalone unscoped
// reader (e.g. `getAllJobs(db)`) — a raw cross-tenant helper would sidestep the
// tenant context and forced RLS. Enforced by tenant-repository-surface.test.ts.
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../../client.js";
import { jobs, type Job, type NewJob } from "../../schema/jobs.js";
import { jobAttempts, type JobAttempt, type NewJobAttempt } from "../../schema/job_attempts.js";
import { leases, type Lease, type NewLease } from "../../schema/leases.js";
import { workers, type Worker } from "../../schema/workers.js";
import { services, type Service, type NewService } from "../../schema/services.js";
import {
  serviceInstances,
  type ServiceInstance,
  type NewServiceInstance,
} from "../../schema/service_instances.js";
import { jobArtifacts, type JobArtifact, type NewJobArtifact } from "../../schema/job_artifacts.js";
import {
  jobSecretHandles,
  type JobSecretHandle,
  type NewJobSecretHandle,
} from "../../schema/job_secret_handles.js";
import {
  createJobControlRepository,
  type JobControlRepository,
} from "./job-control.js";
import {
  createWorkerEnrollmentRepository,
  type WorkerEnrollmentRepository,
} from "./worker-enrollment.js";

export interface JobsRepository {
  insert(values: NewJob): Promise<Job>;
  getById(id: string): Promise<Job | null>;
  listForCompany(companyId: string): Promise<Job[]>;
}

export interface JobAttemptsRepository {
  insert(values: NewJobAttempt): Promise<JobAttempt>;
  getById(id: string): Promise<JobAttempt | null>;
  listForJob(jobId: string): Promise<JobAttempt[]>;
}

export interface LeasesRepository {
  insert(values: NewLease): Promise<Lease>;
  getById(id: string): Promise<Lease | null>;
  listForAttempt(attemptId: string): Promise<Lease[]>;
}

export interface WorkersRepository {
  getById(id: string): Promise<Worker | null>;
  listForOrganization(organizationId: string): Promise<Worker[]>;
}

export interface ServicesRepository {
  insert(values: NewService): Promise<Service>;
  getById(id: string): Promise<Service | null>;
  listForCompany(companyId: string): Promise<Service[]>;
}

export interface ServiceInstancesRepository {
  insert(values: NewServiceInstance): Promise<ServiceInstance>;
  getById(id: string): Promise<ServiceInstance | null>;
  listForService(serviceId: string): Promise<ServiceInstance[]>;
}

export interface JobArtifactsRepository {
  insert(values: NewJobArtifact): Promise<JobArtifact>;
  getById(id: string): Promise<JobArtifact | null>;
  listForJob(jobId: string): Promise<JobArtifact[]>;
  /** DAT-002 — the tenant-scoped committed row for a (job, attempt, identifier),
   * used to prove object-existence when issuing a fence-independent download grant
   * (a committed artifact stays readable after lease loss). RLS scopes to the org. */
  findCommitted(input: { jobId: string; attempt: number; identifier: string }): Promise<JobArtifact | null>;
  /**
   * DAT-009 slice 2 §4.3 — expired grant intents, with the one fact the sweep decision
   * cannot get from the row itself: whether a COMMITTED sibling exists for the same
   * natural key.
   *
   * That flag is load-bearing. The granted and committed partial-unique keys are
   * DISJOINT, so commit inserts a second row and the intent SURVIVES it, both naming the
   * same object. Without the flag a sweeper would delete a committed artifact's bytes on
   * the happy path.
   */
  findSweepCandidates(input: { before: Date; limit: number }): Promise<
    Array<{
      id: string;
      status: string | null;
      objectKey: string | null;
      expiresAt: string | null;
      hasCommittedSibling: boolean;
    }>
  >;
  /**
   * DAT-009 slice 2 §4.3 — transition a swept intent `granted` → `swept`.
   *
   * ★ DELIBERATELY NOT FENCE-GUARDED, and this is the whole point: the sweeper runs
   * precisely WHEN THE FENCE IS GONE. A `guardActiveFence` here would refuse every real
   * call, making the sweeper a guard that can never fire.
   *
   * Its safety therefore comes from two other places, not from a fence:
   *   1. the `WHERE status = 'granted'` below, so this can ONLY ever move a granted row
   *      and can never touch a committed or quarantined one, whatever the caller passes;
   *   2. the caller having satisfied `isSweepEligible`, which refuses anything still
   *      redeemable or committed.
   *
   * Stated here rather than left implicit, because an unguarded write next to a set of
   * guarded ones is exactly how a second, quieter door gets built.
   */
  markSwept(input: { id: string }): Promise<JobArtifact | null>;
}

export interface JobSecretHandlesRepository {
  insert(values: NewJobSecretHandle): Promise<JobSecretHandle>;
  getById(id: string): Promise<JobSecretHandle | null>;
  listForJob(jobId: string): Promise<JobSecretHandle[]>;
}

export interface TenantRepositories {
  jobs: JobsRepository;
  attempts: JobAttemptsRepository;
  leases: LeasesRepository;
  workers: WorkersRepository;
  services: ServicesRepository;
  serviceInstances: ServiceInstancesRepository;
  jobArtifacts: JobArtifactsRepository;
  jobSecretHandles: JobSecretHandlesRepository;
  jobControl: JobControlRepository;
  workerEnrollment: WorkerEnrollmentRepository;
}

/**
 * Build the tenant repositories bound to a caller-supplied transaction handle.
 *
 * `tx` is typed as {@link Db} for TEN-001a; TEN-003 passes the tenant-scoped
 * transaction it opens inside `runInTenant`, which shares this query-builder
 * surface. Every method runs only through `tx` — the handle (and the rows it
 * returns) MUST NOT escape the caller's transaction callback.
 */
export function tenantRepositories(tx: Db): TenantRepositories {
  const repositories: Omit<TenantRepositories, "jobControl" | "workerEnrollment"> = {
    jobs: {
      async insert(values) {
        const [row] = await tx.insert(jobs).values(values).returning();
        return row!;
      },
      async getById(id) {
        const [row] = await tx.select().from(jobs).where(eq(jobs.id, id)).limit(1);
        return row ?? null;
      },
      async listForCompany(companyId) {
        return tx.select().from(jobs).where(eq(jobs.companyId, companyId));
      },
    },
    attempts: {
      async insert(values) {
        const [row] = await tx.insert(jobAttempts).values(values).returning();
        return row!;
      },
      async getById(id) {
        const [row] = await tx
          .select()
          .from(jobAttempts)
          .where(eq(jobAttempts.id, id))
          .limit(1);
        return row ?? null;
      },
      async listForJob(jobId) {
        return tx.select().from(jobAttempts).where(eq(jobAttempts.jobId, jobId));
      },
    },
    leases: {
      async insert(values) {
        const [row] = await tx.insert(leases).values(values).returning();
        return row!;
      },
      async getById(id) {
        const [row] = await tx.select().from(leases).where(eq(leases.id, id)).limit(1);
        return row ?? null;
      },
      async listForAttempt(attemptId) {
        return tx.select().from(leases).where(eq(leases.attemptId, attemptId));
      },
    },
    workers: {
      async getById(id) {
        const [row] = await tx.select().from(workers).where(eq(workers.id, id)).limit(1);
        return row ?? null;
      },
      async listForOrganization(organizationId) {
        return tx.select().from(workers).where(eq(workers.organizationId, organizationId));
      },
    },
    services: {
      async insert(values) {
        const [row] = await tx.insert(services).values(values).returning();
        return row!;
      },
      async getById(id) {
        const [row] = await tx.select().from(services).where(eq(services.id, id)).limit(1);
        return row ?? null;
      },
      async listForCompany(companyId) {
        return tx.select().from(services).where(eq(services.companyId, companyId));
      },
    },
    serviceInstances: {
      async insert(values) {
        const [row] = await tx.insert(serviceInstances).values(values).returning();
        return row!;
      },
      async getById(id) {
        const [row] = await tx
          .select()
          .from(serviceInstances)
          .where(eq(serviceInstances.id, id))
          .limit(1);
        return row ?? null;
      },
      async listForService(serviceId) {
        return tx
          .select()
          .from(serviceInstances)
          .where(eq(serviceInstances.serviceId, serviceId));
      },
    },
    jobArtifacts: {
      async insert(values) {
        const [row] = await tx.insert(jobArtifacts).values(values).returning();
        return row!;
      },
      async getById(id) {
        const [row] = await tx
          .select()
          .from(jobArtifacts)
          .where(eq(jobArtifacts.id, id))
          .limit(1);
        return row ?? null;
      },
      async listForJob(jobId) {
        return tx.select().from(jobArtifacts).where(eq(jobArtifacts.jobId, jobId));
      },
      async findCommitted(input) {
        const [row] = await tx
          .select()
          .from(jobArtifacts)
          .where(and(
            eq(jobArtifacts.jobId, input.jobId),
            eq(jobArtifacts.attempt, input.attempt),
            eq(jobArtifacts.identifier, input.identifier),
            eq(jobArtifacts.status, "committed"),
          ))
          .limit(1);
        return row ?? null;
      },
      async findSweepCandidates(input) {
        // The committed-sibling fact comes from an EXISTS over the SAME natural key the
        // partial-uniques use. Correlated rather than a join so a granted row with no
        // sibling is still returned (a join would need to be a LEFT JOIN and would
        // duplicate on multiple committed versions).
        const rows = await tx
          .select({
            id: jobArtifacts.id,
            status: jobArtifacts.status,
            objectKey: jobArtifacts.objectKey,
            expiresAt: jobArtifacts.expiresAt,
            hasCommittedSibling: sql<boolean>`EXISTS (
              SELECT 1 FROM job_artifacts c
              WHERE c.organization_id = ${jobArtifacts.organizationId}
                AND c.job_id = ${jobArtifacts.jobId}
                AND c.attempt IS NOT DISTINCT FROM ${jobArtifacts.attempt}
                AND c.identifier = ${jobArtifacts.identifier}
                AND c.status = 'committed'
            )`,
          })
          .from(jobArtifacts)
          .where(and(
            eq(jobArtifacts.status, "granted"),
            lt(jobArtifacts.expiresAt, input.before),
          ))
          .limit(input.limit);
        return rows.map((r) => ({
          id: r.id,
          status: r.status,
          objectKey: r.objectKey,
          // The pure decision parses an ISO string; normalise here so the boundary
          // between storage types and that decision stays in one place.
          expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
          hasCommittedSibling: Boolean(r.hasCommittedSibling),
        }));
      },
      async markSwept(input) {
        // `status = 'granted'` in the WHERE is the structural guard: this can only ever
        // move a granted row, never a committed or quarantined one. See the interface.
        const [row] = await tx
          .update(jobArtifacts)
          .set({ status: "swept", updatedAt: sql`clock_timestamp()` })
          .where(and(eq(jobArtifacts.id, input.id), eq(jobArtifacts.status, "granted")))
          .returning();
        return row ?? null;
      },
    },
    jobSecretHandles: {
      async insert(values) {
        const [row] = await tx.insert(jobSecretHandles).values(values).returning();
        return row!;
      },
      async getById(id) {
        const [row] = await tx
          .select()
          .from(jobSecretHandles)
          .where(eq(jobSecretHandles.id, id))
          .limit(1);
        return row ?? null;
      },
      async listForJob(jobId) {
        return tx.select().from(jobSecretHandles).where(eq(jobSecretHandles.jobId, jobId));
      },
    },
  };
  Object.defineProperty(repositories, "jobControl", {
    value: createJobControlRepository(tx),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(repositories, "workerEnrollment", {
    value: createWorkerEnrollmentRepository(tx),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return repositories as TenantRepositories;
}
