export type SubmitJobSource =
  | {
      kind: "task_run";
      runId: string;
      issueId: string;
      assigneeAgentId: string;
    }
  | {
      kind: "commander_turn";
      internalAgentRunId: string;
      conversationId: string;
    }
  | {
      kind: "crew_run";
      crewRunId: string;
    }
  | {
      kind: "one_shot";
      operationId: string;
      operationKind: "extraction" | "compaction" | "readiness_probe";
    }
  | {
      kind: "browser_request";
      browserRequestId: string;
      parentJobId: string | null;
    }
  | {
      kind: "service_reconcile";
      serviceId: string;
      generation: number;
      reconciliationId: string;
    };

/** External, authenticated source intent. Server-owned delivery fields are absent by design. */
export interface SubmitJobCommand {
  idempotencyKey: string;
  source: SubmitJobSource;
  input: Record<string, unknown>;
}

export interface SubmitJobResponse {
  jobId: string;
  attemptId: string;
  status: "queued";
  replayed: boolean;
}

export type JobPlacementMode = "active" | "shadow" | "legacy";
export type JobPlacementOwner =
  | "legacy"
  | "managed_cloud"
  | "organization_dedicated"
  | "owner_desktop";
export type JobPlacementDisposition = "selected" | "legacy" | "queued" | "failed";

/** Immutable, server-owned JOB-009 result persisted before JOB-003 may lease. */
export interface JobPlacementDecision {
  disposition: JobPlacementDisposition;
  owner: JobPlacementOwner | null;
  targetId: string | null;
  targetClass: Exclude<JobPlacementOwner, "legacy"> | null;
  targetScope: "platform" | "organization" | "owner" | null;
  targetGeneration: number | null;
  profileHash: string | null;
  providerConstraintHash: string | null;
  fallbackDisposition: "not_applicable" | "primary" | "ordered_explicit" | "forbidden";
  reasonCode: string;
  mode: JobPlacementMode;
  leaseEligible: boolean;
  inputDigest: string;
  policyDigest: string;
}
