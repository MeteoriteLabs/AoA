import type { IssueMonitorPolicy } from "@armyofagents/shared";

export type MonitorEligibleIssue = {
  id: string;
  status: string;
  assigneeAgentId: string | null;
};

export type IssueMonitorInsert = {
  companyId: string;
  issueId: string;
  agentId: string;
  status: "scheduled";
  kind: string;
  scheduledBy: "board" | "assignee";
  nextCheckAt: Date;
  notes: string | null;
  maxAttempts: number | null;
  timeoutAt: Date | null;
  externalRef: string | null;
  recoveryPolicy: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readDate(value: unknown): Date | null {
  const raw = readNonEmptyString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const integer = Math.floor(parsed);
  return integer > 0 ? integer : null;
}

export function normalizeIssueMonitorPolicy(input: unknown): IssueMonitorPolicy | null {
  const record = readRecord(input);
  if (!record) return null;

  const nextCheckAt = readDate(record.nextCheckAt);
  if (!nextCheckAt) return null;

  const scheduledByRaw = readNonEmptyString(record.scheduledBy);
  const scheduledBy = scheduledByRaw === "assignee" ? "assignee" : "board";
  const kind = readNonEmptyString(record.kind) ?? "generic";
  const timeoutAt = readDate(record.timeoutAt);
  const recoveryPolicy = readRecord(record.recoveryPolicy);

  return {
    kind,
    nextCheckAt: nextCheckAt.toISOString(),
    scheduledBy,
    notes: readNonEmptyString(record.notes),
    maxAttempts: readPositiveInteger(record.maxAttempts),
    timeoutAt: timeoutAt?.toISOString() ?? null,
    externalRef: readNonEmptyString(record.externalRef),
    recoveryPolicy,
  };
}

export function buildInitialIssueMonitorFields(input: {
  companyId: string;
  issue: MonitorEligibleIssue;
  policy: IssueMonitorPolicy;
}): IssueMonitorInsert | null {
  if (!input.issue.assigneeAgentId) return null;
  if (input.issue.status !== "in_progress" && input.issue.status !== "in_review") return null;

  return {
    companyId: input.companyId,
    issueId: input.issue.id,
    agentId: input.issue.assigneeAgentId,
    status: "scheduled",
    kind: input.policy.kind,
    scheduledBy: input.policy.scheduledBy,
    nextCheckAt: new Date(input.policy.nextCheckAt),
    notes: input.policy.notes ?? null,
    maxAttempts: input.policy.maxAttempts ?? null,
    timeoutAt: input.policy.timeoutAt ? new Date(input.policy.timeoutAt) : null,
    externalRef: input.policy.externalRef ?? null,
    recoveryPolicy: input.policy.recoveryPolicy ?? null,
    metadata: input.policy.externalRef ? { externalRefRedacted: true } : null,
  };
}

export function buildIssueMonitorTriggeredPatch(input: { now: Date; nextAttempt: number }) {
  return {
    status: "triggered" as const,
    attemptCount: input.nextAttempt,
    lastTriggeredAt: input.now,
    nextCheckAt: null,
    updatedAt: input.now,
  };
}

export function buildIssueMonitorClearedPatch(input: { now: Date; clearReason: string }) {
  return {
    status: "cleared" as const,
    clearedAt: input.now,
    clearReason: input.clearReason,
    updatedAt: input.now,
  };
}
