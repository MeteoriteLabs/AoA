import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../../client.js";
import {
  agents,
  companies,
  companyMemberships,
  heartbeatRuns,
  internalAgentConversations,
  internalAgentMessages,
  internalAgentRuns,
  issues,
  jobAttempts,
  jobOutbox,
  jobs,
  mcpApiKeys,
  organizationMemberships,
  organizations,
  services,
  type Job,
  type JobAttempt,
  type JobOutbox,
  type NewJob,
  type NewJobAttempt,
  type NewJobOutbox,
} from "../../schema/index.js";

export interface TenantAdmissionRecord {
  organizationExists: boolean;
  companyInOrganization: boolean;
  principalAuthorized: boolean;
  requester: { kind: SourceRequesterKind; id: string } | null;
}

export type SourceRequesterKind =
  | "founder"
  | "team_lead"
  | "team_member"
  | "agent"
  | "commander"
  | "system";

export type SourceExecutorKind =
  | "worker"
  | "sandbox"
  | "browser_worker"
  | "service_instance";

export interface SourceExecutorAuthority {
  kind: SourceExecutorKind;
  id: string;
}

export interface JobControlRepository {
  admission(input: {
    organizationId: string;
    companyId: string;
    principalKind: string;
    principalId: string;
    principalRole?: string;
  }): Promise<TenantAdmissionRecord>;
  taskSourceIsAdmitted(input: {
    companyId: string;
    runId: string;
    issueId: string;
    assigneeAgentId: string;
  }): Promise<SourceExecutorAuthority | null>;
  internalRunSourceIsAdmitted(input: {
    companyId: string;
    runId: string;
    requesterKind: SourceRequesterKind;
    requesterId: string;
    triggerSource: "crew_dispatch" | "browser_request";
  }): Promise<SourceExecutorAuthority | null>;
  commanderSourceIsAdmitted(input: {
    companyId: string;
    runId: string;
    conversationId: string;
    userId: string;
  }): Promise<SourceExecutorAuthority | null>;
  serviceSourceIsAdmitted(input: {
    organizationId: string;
    companyId: string;
    serviceId: string;
    generation: number;
  }): Promise<SourceExecutorAuthority | null>;
  insertJobOnce(values: NewJob): Promise<Job | null>;
  findSubmission(input: {
    organizationId: string;
    companyId: string;
    authenticatedPrincipalKind: string;
    authenticatedPrincipalId: string;
    authenticatedSourceKind: string;
    authenticatedSourceIdentity: string;
    idempotencyKey: string;
  }): Promise<Job | null>;
  insertAttempt(values: NewJobAttempt): Promise<JobAttempt>;
  findInitialAttempt(jobId: string): Promise<JobAttempt | null>;
  insertOutbox(values: NewJobOutbox): Promise<JobOutbox>;
}

export function createJobControlRepository(tx: Db): JobControlRepository {
  function requesterKindForOrganizationRole(role: string): SourceRequesterKind | null {
    if (role === "owner") return "founder";
    if (role === "admin") return "team_lead";
    if (role === "member") return "team_member";
    return null;
  }

  async function admittedUserRequester(input: {
    organizationId: string;
    companyId: string;
    userId: string;
  }): Promise<{ kind: SourceRequesterKind; id: string } | null> {
    const [orgMembership] = await tx
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, input.organizationId),
        eq(organizationMemberships.userId, input.userId),
        eq(organizationMemberships.status, "active"),
      ))
      .limit(1);
    const [companyMembership] = await tx
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(and(
        eq(companyMemberships.companyId, input.companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, input.userId),
        eq(companyMemberships.status, "active"),
      ))
      .limit(1);
    const kind = orgMembership ? requesterKindForOrganizationRole(orgMembership.role) : null;
    return companyMembership && kind ? { kind, id: input.userId } : null;
  }

  return {
    async admission(input) {
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1);
      const [company] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(and(
          eq(companies.id, input.companyId),
          eq(companies.organizationId, input.organizationId),
        ))
        .limit(1);

      let requester: { kind: SourceRequesterKind; id: string } | null = null;
      if (input.principalKind === "user") {
        requester = await admittedUserRequester({
          organizationId: input.organizationId,
          companyId: input.companyId,
          userId: input.principalId,
        });
      } else if (input.principalKind === "agent") {
        const [agent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, input.principalId), eq(agents.companyId, input.companyId)))
          .limit(1);
        requester = agent ? { kind: "agent", id: input.principalId } : null;
      } else if (input.principalKind === "mcp") {
        const [key] = await tx
          .select({ id: mcpApiKeys.id, userId: mcpApiKeys.userId })
          .from(mcpApiKeys)
          .where(and(
            eq(mcpApiKeys.id, input.principalId),
            eq(mcpApiKeys.companyId, input.companyId),
            isNull(mcpApiKeys.revokedAt),
          ))
          .limit(1);
        requester = key
          ? await admittedUserRequester({
              organizationId: input.organizationId,
              companyId: input.companyId,
              userId: key.userId,
            })
          : null;
      } else if (input.principalKind === "commander") {
        // These actors are authenticated by a company-bound run JWT or the
        // explicitly enabled local loopback identity. Re-check the admitted
        // Organization→Company edge in this transaction; neither actor has a
        // durable membership/key row of its own.
        requester = company && ["founder", "team_lead", "team_member"].includes(input.principalRole ?? "")
          ? { kind: "commander", id: input.principalId }
          : null;
      } else if (input.principalKind === "local_board") {
        requester = company ? { kind: "founder", id: input.principalId } : null;
      } else if (input.principalKind === "system") {
        requester = company ? { kind: "system", id: input.principalId } : null;
      }

      return {
        organizationExists: Boolean(organization),
        companyInOrganization: Boolean(company),
        principalAuthorized: Boolean(requester),
        requester,
      };
    },

    async taskSourceIsAdmitted(input) {
      const [row] = await tx
        .select({ agentId: heartbeatRuns.agentId })
        .from(heartbeatRuns)
        .innerJoin(
          issues,
          and(
            eq(issues.id, input.issueId),
            eq(issues.companyId, input.companyId),
            eq(issues.assigneeAgentId, input.assigneeAgentId),
            eq(issues.checkoutRunId, input.runId),
            eq(issues.executionRunId, input.runId),
          ),
        )
        .innerJoin(
          agents,
          and(eq(agents.id, input.assigneeAgentId), eq(agents.companyId, input.companyId)),
        )
        .where(and(
          eq(heartbeatRuns.id, input.runId),
          eq(heartbeatRuns.companyId, input.companyId),
          eq(heartbeatRuns.agentId, input.assigneeAgentId),
        ))
        .limit(1);
      // The admitted legacy heartbeat engine supplies the domain worker role;
      // JOB-009 may later place that work, but no concrete worker is chosen here.
      return row ? { kind: "worker", id: row.agentId } : null;
    },

    async internalRunSourceIsAdmitted(input) {
      const ownership = input.requesterKind === "agent"
        ? eq(internalAgentRuns.agentId, input.requesterId)
        : eq(internalAgentRuns.userId, input.requesterId);
      const [row] = await tx
        .select({ id: internalAgentRuns.id, agentId: internalAgentRuns.agentId })
        .from(internalAgentRuns)
        .where(and(
          eq(internalAgentRuns.id, input.runId),
          eq(internalAgentRuns.companyId, input.companyId),
          eq(internalAgentRuns.triggerSource, input.triggerSource),
          ownership,
        ))
        .limit(1);
      if (!row) return null;
      if (input.triggerSource === "browser_request") {
        return { kind: "browser_worker", id: row.id };
      }
      // Crew's admitted source engine is worker-class. Its bound agent is the
      // opaque executor identity when present; the run remains the fallback for
      // a user-owned crew source without an assigned agent. This is not placement.
      return { kind: "worker", id: row.agentId ?? row.id };
    },

    async commanderSourceIsAdmitted(input) {
      const [row] = await tx
        .select({ id: internalAgentRuns.id })
        .from(internalAgentRuns)
        .innerJoin(internalAgentMessages, eq(internalAgentMessages.runId, internalAgentRuns.id))
        .innerJoin(
          internalAgentConversations,
          eq(internalAgentConversations.id, internalAgentMessages.conversationId),
        )
        .where(and(
          eq(internalAgentRuns.id, input.runId),
          eq(internalAgentRuns.companyId, input.companyId),
          eq(internalAgentRuns.triggerType, "conversation"),
          eq(internalAgentRuns.userId, input.userId),
          eq(internalAgentConversations.id, input.conversationId),
          eq(internalAgentConversations.companyId, input.companyId),
          eq(internalAgentConversations.userId, input.userId),
        ))
        .limit(1);
      return row ? { kind: "sandbox", id: row.id } : null;
    },

    async serviceSourceIsAdmitted(input) {
      const [row] = await tx
        .select({ id: services.id })
        .from(services)
        .where(and(
          eq(services.id, input.serviceId),
          eq(services.organizationId, input.organizationId),
          eq(services.companyId, input.companyId),
          eq(services.generation, input.generation),
        ))
        .limit(1);
      return row ? { kind: "service_instance", id: row.id } : null;
    },

    async insertJobOnce(values) {
      const [row] = await tx
        .insert(jobs)
        .values(values)
        .onConflictDoNothing({
          target: [
            jobs.organizationId,
            jobs.companyId,
            jobs.authenticatedPrincipalKind,
            jobs.authenticatedPrincipalId,
            jobs.authenticatedSourceKind,
            jobs.authenticatedSourceIdentity,
            jobs.idempotencyKey,
          ],
        })
        .returning();
      return row ?? null;
    },

    async findSubmission(input) {
      const [row] = await tx
        .select()
        .from(jobs)
        .where(and(
          eq(jobs.organizationId, input.organizationId),
          eq(jobs.companyId, input.companyId),
          eq(jobs.authenticatedPrincipalKind, input.authenticatedPrincipalKind),
          eq(jobs.authenticatedPrincipalId, input.authenticatedPrincipalId),
          eq(jobs.authenticatedSourceKind, input.authenticatedSourceKind),
          eq(jobs.authenticatedSourceIdentity, input.authenticatedSourceIdentity),
          eq(jobs.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      return row ?? null;
    },

    async insertAttempt(values) {
      const [row] = await tx.insert(jobAttempts).values(values).returning();
      return row!;
    },

    async findInitialAttempt(jobId) {
      const [row] = await tx
        .select()
        .from(jobAttempts)
        .where(and(eq(jobAttempts.jobId, jobId), eq(jobAttempts.attemptNumber, 1)))
        .limit(1);
      return row ?? null;
    },

    async insertOutbox(values) {
      const [row] = await tx.insert(jobOutbox).values(values).returning();
      return row!;
    },
  };
}
