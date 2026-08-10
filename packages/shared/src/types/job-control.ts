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
