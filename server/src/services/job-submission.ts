import { createHash, randomUUID } from "node:crypto";
import type { Db } from "@armyofagents/db";
import type {
  SubmitJobCommand,
  SubmitJobResponse,
  SubmitJobSource,
} from "@armyofagents/shared";
import { HttpError } from "../errors.js";
import { runInTenant } from "../db/tenant-context.js";
import {
  assertAdmissibleOrganization,
  ForbiddenOrganizationSentinelError,
  TenantAdmissionDeniedError,
} from "./tenant-admission.js";
import { attemptReadyOutbox } from "./job-outbox.js";

export interface AuthenticatedJobPrincipal {
  kind: "user" | "agent" | "mcp" | "commander" | "local_board" | "system";
  id: string;
  role?: string;
  commanderClaims?: {
    userId: string;
    conversationId: string;
    turnId: string;
  };
}

export interface SubmitJobRequest {
  organizationId: string;
  companyId: string;
  principal: AuthenticatedJobPrincipal;
  command: SubmitJobCommand;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sourceIdentity(source: SubmitJobSource): string {
  switch (source.kind) {
    case "task_run": return source.runId;
    case "commander_turn": return source.internalAgentRunId;
    case "crew_run": return source.crewRunId;
    case "one_shot": return source.operationId;
    case "browser_request": return source.browserRequestId;
    case "service_reconcile": return source.reconciliationId;
  }
}

function executor(source: SubmitJobSource): { kind: string; id: string } {
  switch (source.kind) {
    case "task_run": return { kind: "agent", id: source.assigneeAgentId };
    case "service_reconcile": return { kind: "service", id: source.serviceId };
    case "browser_request": return { kind: "system", id: "aoa-browser" };
    case "commander_turn": return { kind: "system", id: "aoa-commander" };
    case "crew_run": return { kind: "system", id: "aoa-crew" };
    case "one_shot": return { kind: "system", id: "aoa-one-shot" };
  }
}

function workloadType(source: SubmitJobSource): string {
  if (source.kind === "browser_request") return "browser_session";
  if (source.kind === "service_reconcile") return "service";
  return "batch";
}

function priority(source: SubmitJobSource): number {
  return {
    task_run: 50,
    commander_turn: 60,
    crew_run: 40,
    one_shot: 20,
    browser_request: 50,
    service_reconcile: 30,
  }[source.kind];
}

function denial(): TenantAdmissionDeniedError {
  return new TenantAdmissionDeniedError();
}

const SOURCE_REQUESTER_KINDS = Object.freeze({
  task_run: ["founder", "team_lead", "team_member", "agent"],
  commander_turn: ["founder", "team_lead", "team_member", "commander"],
  crew_run: ["founder", "team_lead", "team_member", "agent"],
  one_shot: ["agent", "system", "commander"],
  browser_request: ["founder", "team_lead", "team_member", "agent"],
  service_reconcile: ["system"],
} satisfies Record<SubmitJobSource["kind"], readonly string[]>);

export function jobSubmissionService(appDb: Db) {
  return {
    async submit(input: SubmitJobRequest): Promise<SubmitJobResponse> {
      try {
        assertAdmissibleOrganization(input.organizationId);
      } catch (error) {
        if (error instanceof ForbiddenOrganizationSentinelError) throw denial();
        throw error;
      }

      const sourceId = sourceIdentity(input.command.source);
      const commandDigest = digest(input.command);
      const inputHash = digest(input.command.input);
      const policySnapshot = {
        policyId: "job-submission-default",
        version: 1,
        sourceKind: input.command.source.kind,
      };
      const policyHash = digest(policySnapshot);
      const requirements = {
        workloadType: workloadType(input.command.source),
        requiredCapabilities: input.command.source.kind === "browser_request" ? ["browser.chromium"] : [],
      };
      // This is immutable policy input, not a placement decision. JOB-009 owns placement.
      const placementRequest = {
        policyId: "job-submission-default",
        policyVersion: 1,
        requestedTarget: null,
      };
      const executionPrincipal = executor(input.command.source);

      return runInTenant(appDb, input.organizationId, async (repos) => {
        const admission = await repos.jobControl.admission({
          organizationId: input.organizationId,
          companyId: input.companyId,
          principalKind: input.principal.kind,
          principalId: input.principal.id,
          principalRole: input.principal.role,
        });
        if (
          !admission.organizationExists ||
          !admission.companyInOrganization ||
          !admission.principalAuthorized ||
          !admission.requester ||
          !SOURCE_REQUESTER_KINDS[input.command.source.kind].includes(admission.requester.kind)
        ) {
          throw denial();
        }
        const source = input.command.source;
        if (source.kind === "task_run") {
          const admitted = await repos.jobControl.taskSourceIsAdmitted({
            companyId: input.companyId,
            runId: source.runId,
            issueId: source.issueId,
            assigneeAgentId: source.assigneeAgentId,
          });
          if (!admitted) throw denial();
          if (input.principal.kind === "agent" && input.principal.id !== source.assigneeAgentId) {
            throw denial();
          }
        } else if (source.kind === "commander_turn") {
          const claims = input.principal.commanderClaims;
          if (
            input.principal.kind === "commander" &&
            (!claims ||
              claims.userId !== input.principal.id ||
              claims.conversationId !== source.conversationId ||
              claims.turnId !== source.internalAgentRunId)
          ) {
            throw denial();
          }
          const admitted = await repos.jobControl.commanderSourceIsAdmitted({
            companyId: input.companyId,
            runId: source.internalAgentRunId,
            conversationId: source.conversationId,
            userId: admission.requester.id,
          });
          if (!admitted) throw denial();
        } else if (source.kind === "crew_run") {
          const admitted = await repos.jobControl.internalRunSourceIsAdmitted({
            companyId: input.companyId,
            runId: source.crewRunId,
            requesterKind: admission.requester.kind,
            requesterId: admission.requester.id,
            triggerSource: "crew_dispatch",
          });
          if (!admitted) throw denial();
        } else if (source.kind === "browser_request") {
          const admitted = await repos.jobControl.internalRunSourceIsAdmitted({
            companyId: input.companyId,
            runId: source.browserRequestId,
            requesterKind: admission.requester.kind,
            requesterId: admission.requester.id,
            triggerSource: "browser_request",
          });
          if (!admitted) throw denial();
        } else if (source.kind === "service_reconcile") {
          const admitted = await repos.jobControl.serviceSourceIsAdmitted({
            organizationId: input.organizationId,
            companyId: input.companyId,
            serviceId: source.serviceId,
            generation: source.generation,
          });
          if (!admitted) throw denial();
        }

        const now = new Date();
        const jobId = randomUUID();
        const attemptId = randomUUID();
        const outboxId = randomUUID();
        const job = await repos.jobControl.insertJobOnce({
          id: jobId,
          organizationId: input.organizationId,
          companyId: input.companyId,
          workloadType: workloadType(input.command.source),
          authenticatedPrincipalKind: input.principal.kind,
          authenticatedPrincipalId: input.principal.id,
          authenticatedSourceKind: input.command.source.kind,
          authenticatedSourceIdentity: sourceId,
          idempotencyKey: input.command.idempotencyKey,
          commandDigest,
          sourceKind: input.command.source.kind,
          sourceIdentity: sourceId,
          sourceIntent: input.command.source,
          requesterPrincipalKind: admission.requester.kind,
          requesterPrincipalId: admission.requester.id,
          executorPrincipalKind: executionPrincipal.kind,
          executorPrincipalId: executionPrincipal.id,
          input: input.command.input,
          inputHash,
          policySnapshot,
          policyHash,
          requirements,
          placementRequest,
          priority: priority(input.command.source),
          availableAt: now,
          status: "queued",
          createdAt: now,
          updatedAt: now,
        });

        if (!job) {
          const existing = await repos.jobControl.findSubmission({
            organizationId: input.organizationId,
            companyId: input.companyId,
            authenticatedPrincipalKind: input.principal.kind,
            authenticatedPrincipalId: input.principal.id,
            authenticatedSourceKind: input.command.source.kind,
            authenticatedSourceIdentity: sourceId,
            idempotencyKey: input.command.idempotencyKey,
          });
          if (!existing) throw new Error("idempotent submission winner was not visible");
          if (existing.commandDigest !== commandDigest) {
            throw new HttpError(409, "Idempotency key conflicts with a different command");
          }
          const existingAttempt = await repos.jobControl.findInitialAttempt(existing.id);
          if (!existingAttempt) throw new Error("idempotent submission is missing its initial attempt");
          return { jobId: existing.id, attemptId: existingAttempt.id, status: "queued", replayed: true };
        }

        const attempt = await repos.jobControl.insertAttempt({
          id: attemptId,
          organizationId: input.organizationId,
          companyId: input.companyId,
          jobId: job.id,
          attemptNumber: 1,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });
        await repos.jobControl.insertOutbox(attemptReadyOutbox({
          id: outboxId,
          organizationId: input.organizationId,
          companyId: input.companyId,
          jobId: job.id,
          attemptId: attempt.id,
          sourceKind: input.command.source.kind,
          availableAt: now,
          createdAt: now,
        }));
        return { jobId: job.id, attemptId: attempt.id, status: "queued", replayed: false };
      });
    },
  };
}
