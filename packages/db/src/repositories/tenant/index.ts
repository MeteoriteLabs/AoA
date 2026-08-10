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
import { eq } from "drizzle-orm";
import type { Db } from "../../client.js";
import { jobs, type Job, type NewJob } from "../../schema/jobs.js";
import { jobAttempts, type JobAttempt, type NewJobAttempt } from "../../schema/job_attempts.js";
import { leases, type Lease, type NewLease } from "../../schema/leases.js";
import { workers, type Worker, type NewWorker } from "../../schema/workers.js";
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
  insert(values: NewWorker): Promise<Worker>;
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
      async insert(values) {
        const [row] = await tx.insert(workers).values(values).returning();
        return row!;
      },
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
