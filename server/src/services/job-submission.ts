import { createHash, randomUUID } from "node:crypto";
import type { Db, TenantRepositories } from "@armyofagents/db";
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
// DEP-009 — submit-time org-capacity admission. The deployment-flag reader is imported
// statically because `config/distributed-execution.ts` is logger-free (a single type
// import). `admitAttemptCapacity` (org-concurrency) is DYNAMICALLY imported inside the
// flag-gated block below: org-concurrency → budgets.ts → middleware/logger.js, and a
// STATIC import would pull the logger into every early importer of this module (a test
// that statically imports job-submission before setting AOA_LOG_DIR would bind the logger
// to the wrong sink). The dynamic import keeps this module's static graph logger-free and
// keeps the admission code dormant (loaded only when the flag is on at runtime).
import { readDistributedExecutionDeploymentFlag } from "../config/distributed-execution.js";

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

/**
 * The complete admission + per-source authority resolution + immutable persistence
 * of ONE job submission, INSIDE an already-open tenant transaction. Extracted verbatim
 * from `jobSubmissionService.submit`'s inner `runInTenant` callback so it can be composed
 * into a LARGER authoritative transaction — the JOB-010 admission bridge drives the legacy
 * assignment authority (e.g. `issueService.checkout`) and then calls this within the SAME
 * `runInTenant` tx, so the legacy claim and the distributed submission commit atomically
 * (one authoritative transaction, no second tx). `submit` itself is unchanged behaviour:
 * it opens its own `runInTenant` and delegates here.
 *
 * The caller MUST have already validated `assertAdmissibleOrganization(input.organizationId)`
 * (sentinel) before opening the transaction; this helper assumes the Organization context
 * is set on `repos`.
 */
export async function submitJobWithinTenant(
  repos: TenantRepositories,
  input: SubmitJobRequest,
  // DEP-009 — the SAME tenant transaction handle `runInTenant` already yields alongside
  // `repos`. It composes the submit-time org-capacity admission (`admitAttemptCapacity`)
  // into ONE authoritative transaction, so a denied/over-cap admit rolls the whole
  // submission back (no orphan job/attempt). Optional so existing behaviour is unchanged
  // when a caller does not opt into capacity admission (the two production call sites pass it).
  tx?: Db,
): Promise<SubmitJobResponse> {
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
  {
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
    let executionPrincipal: { kind: string; id: string } | null = null;
    if (source.kind === "task_run") {
          executionPrincipal = await repos.jobControl.taskSourceIsAdmitted({
            companyId: input.companyId,
            runId: source.runId,
            issueId: source.issueId,
            assigneeAgentId: source.assigneeAgentId,
          });
          if (!executionPrincipal) throw denial();
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
          executionPrincipal = await repos.jobControl.commanderSourceIsAdmitted({
            companyId: input.companyId,
            runId: source.internalAgentRunId,
            conversationId: source.conversationId,
            userId: admission.requester.id,
          });
          if (!executionPrincipal) throw denial();
        } else if (source.kind === "crew_run") {
          executionPrincipal = await repos.jobControl.internalRunSourceIsAdmitted({
            companyId: input.companyId,
            runId: source.crewRunId,
            requesterKind: admission.requester.kind,
            requesterId: admission.requester.id,
            triggerSource: "crew_dispatch",
          });
          if (!executionPrincipal) throw denial();
        } else if (source.kind === "one_shot") {
          // The admitted one-shot engine is worker-class in the frozen FND-007
          // authority. The operation is its opaque engine identity; no worker,
          // target, placement, or lease is selected at submission.
          executionPrincipal = { kind: "worker", id: source.operationId };
        } else if (source.kind === "browser_request") {
          executionPrincipal = await repos.jobControl.internalRunSourceIsAdmitted({
            companyId: input.companyId,
            runId: source.browserRequestId,
            requesterKind: admission.requester.kind,
            requesterId: admission.requester.id,
            triggerSource: "browser_request",
          });
          if (!executionPrincipal) throw denial();
        } else if (source.kind === "service_reconcile") {
          executionPrincipal = await repos.jobControl.serviceSourceIsAdmitted({
            organizationId: input.organizationId,
            companyId: input.companyId,
            serviceId: source.serviceId,
            generation: source.generation,
          });
          if (!executionPrincipal) throw denial();
        }
        if (!executionPrincipal) throw denial();

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
        // DEP-009 — SUBMIT-TIME org-capacity admission. The FIRST attempt was just created
        // (the point at which the job first becomes leasable — §7 Q2), so claim its
        // Organization capacity slot NOW, inside the SAME tenant transaction, BEFORE the
        // attempt-ready outbox makes it pollable. admitAttemptCapacity serializes
        // count-then-claim under one shared advisory lock per Organization, so concurrent
        // submits across BOTH control-plane replicas cannot exceed the cap. An over-cap /
        // budget denial throws (429) → the whole submission rolls back (no leasable orphan);
        // a shared-store error propagates so the submit FAILS CLOSED (never a silent admit).
        // The claim is balanced by the existing releaseAttemptCapacity on terminal/revoke.
        // Idempotent by construction: a redelivered submission returns on the replay path
        // above and never reaches this claim, so no attempt is ever double-claimed.
        // Dormant behind the deployment flag — off, the legacy poll-time behaviour is exactly as before.
        if (tx && readDistributedExecutionDeploymentFlag(process.env)) {
          const { admitAttemptCapacity } = await import("./org-concurrency.js");
          const admission = await admitAttemptCapacity(tx, {
            organizationId: input.organizationId,
            companyId: input.companyId,
            workloadType: workloadType(input.command.source),
            attemptId: attempt.id,
          });
          if (!admission.admitted) {
            throw new HttpError(
              429,
              admission.reason === "budget"
                ? "Organization budget hard-stop reached"
                : "Organization concurrency capacity exceeded",
            );
          }
        }
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
  }
}

/**
 * JOB-010: resolve an already-committed idempotent replay for this submission composite
 * WITHOUT writing anything. Returns the replayed response if a prior submission for the
 * exact `(principal, source-identity, idempotencyKey)` composite already exists (throwing
 * the same 409 on a digest conflict as `submitJobWithinTenant`), or `null` if this is a
 * first-time submission. The admission bridge calls this INSIDE its authoritative tenant
 * transaction BEFORE driving a non-idempotent legacy side effect (`issueService.checkout`,
 * which resets `issues.startedAt` and re-broadcasts `issue.status_changed` if re-run), so a
 * redelivery is a true no-op — honoring the bridge's `idempotencyKey` contract without
 * changing the legacy checkout engine (parity preserved). `submitJobWithinTenant` remains
 * the authoritative winner-vs-replay resolver on the write path; this is a read-only
 * fast-path for the same composite.
 */
export async function findIdempotentReplay(
  repos: TenantRepositories,
  input: SubmitJobRequest,
): Promise<SubmitJobResponse | null> {
  const existing = await repos.jobControl.findSubmission({
    organizationId: input.organizationId,
    companyId: input.companyId,
    authenticatedPrincipalKind: input.principal.kind,
    authenticatedPrincipalId: input.principal.id,
    authenticatedSourceKind: input.command.source.kind,
    authenticatedSourceIdentity: sourceIdentity(input.command.source),
    idempotencyKey: input.command.idempotencyKey,
  });
  if (!existing) return null;
  if (existing.commandDigest !== digest(input.command)) {
    throw new HttpError(409, "Idempotency key conflicts with a different command");
  }
  const existingAttempt = await repos.jobControl.findInitialAttempt(existing.id);
  if (!existingAttempt) throw new Error("idempotent submission is missing its initial attempt");
  return { jobId: existing.id, attemptId: existingAttempt.id, status: "queued", replayed: true };
}

export function jobSubmissionService(appDb: Db) {
  return {
    async submit(input: SubmitJobRequest): Promise<SubmitJobResponse> {
      try {
        assertAdmissibleOrganization(input.organizationId);
      } catch (error) {
        if (error instanceof ForbiddenOrganizationSentinelError) throw denial();
        throw error;
      }
      return runInTenant(appDb, input.organizationId, (repos, tx) => submitJobWithinTenant(repos, input, tx));
    },
  };
}
