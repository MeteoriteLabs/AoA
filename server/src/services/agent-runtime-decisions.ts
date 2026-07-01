import { createHash } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agentRuntimeDecisions } from "@armyofagents/db";
import type {
  RuntimeDecisionDetail,
  RuntimeDecisionKind,
  RuntimeDecisionPermissionDecision,
  RuntimeDecisionStatus,
  RuntimeDecisionTimeoutPolicy,
} from "@armyofagents/shared";
import { RUNTIME_DECISION_PERMISSION_DECISIONS } from "@armyofagents/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { redactSecretsInString } from "../redaction.js";
import { logActivity, type LogActivityInput } from "./activity-log.js";
import { hubItemsService } from "./hub-items.js";

const SOURCE_TYPE = "runtime_decision";
const ACTIVE_STATUSES = new Set<RuntimeDecisionStatus>([
  "created",
  "shown",
  "answered",
  "relay_failed",
]);
const TERMINAL_STATUSES = new Set<RuntimeDecisionStatus>([
  "relayed",
  "expired",
  "cancelled",
]);

export type AgentRuntimeDecisionRow = typeof agentRuntimeDecisions.$inferSelect;

type CreatePromptInput = {
  companyId: string;
  agentId: string;
  runId: string;
  adapterType: string;
  adapterSessionId?: string | null;
  adapterSessionParams?: Record<string, unknown> | null;
  kind: RuntimeDecisionKind;
  nonce: string;
  title: string;
  summary?: string | null;
  promptText?: string | null;
  toolName?: string | null;
  command?: string | null;
  cwd?: string | null;
  path?: string | null;
  networkTarget?: string | null;
  riskClass?: string | null;
  options?: Array<Record<string, unknown>> | null;
  expiresAt?: Date | null;
  timeoutPolicy: RuntimeDecisionTimeoutPolicy;
};

type AnswerPromptInput = {
  companyId: string;
  decisionId: string;
  actorUserId: string;
  expectedSourceRevision: number;
  nonce: string;
  kind: RuntimeDecisionKind;
  decision?: RuntimeDecisionPermissionDecision;
  answer?: Record<string, unknown>;
  idempotencyKey?: string;
};

type RelayFailedInput = {
  companyId: string;
  decisionId: string;
  relayError: string;
};

type ExpireDueInput = {
  companyId: string;
  limit: number;
};

type DecisionRepo = {
  createDecision(input: typeof agentRuntimeDecisions.$inferInsert): Promise<AgentRuntimeDecisionRow>;
  getDecision(companyId: string, decisionId: string): Promise<AgentRuntimeDecisionRow | null>;
  updateDecision(
    decisionId: string,
    patch: Partial<typeof agentRuntimeDecisions.$inferInsert>,
  ): Promise<AgentRuntimeDecisionRow>;
  listDueForExpiry(input: { companyId: string; now: Date; limit: number }): Promise<AgentRuntimeDecisionRow[]>;
};

type HubItemsApi = Pick<ReturnType<typeof hubItemsService>, "emit">;

type ServiceDeps = {
  repo?: DecisionRepo;
  hubItems?: HubItemsApi;
  activityLogger?: (input: LogActivityInput) => Promise<void>;
  now?: () => Date;
};

function safeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return redactSecretsInString(value);
}

function promptHash(input: Pick<CreatePromptInput, "kind" | "title" | "summary" | "promptText" | "command">) {
  return createHash("sha256")
    .update(JSON.stringify({
      kind: input.kind,
      title: input.title,
      summary: input.summary ?? null,
      promptText: input.promptText ?? null,
      command: input.command ?? null,
    }))
    .digest("hex");
}

function sourceUniqueKey(input: { companyId: string; runId: string; nonce: string }) {
  return `runtime:${input.companyId}:${input.runId}:${input.nonce}`;
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function runtimeDecisionDetail(row: AgentRuntimeDecisionRow): RuntimeDecisionDetail {
  return {
    id: row.id,
    hubItemId: null,
    companyId: row.companyId,
    agentId: row.agentId,
    runId: row.runId,
    adapterType: row.adapterType as RuntimeDecisionDetail["adapterType"],
    adapterSessionId: row.adapterSessionId,
    kind: row.kind as RuntimeDecisionKind,
    status: row.status as RuntimeDecisionStatus,
    sourceRevision: row.sourceRevision,
    nonce: row.nonce,
    title: row.title,
    summary: row.summary,
    promptText: row.promptText,
    toolName: row.toolName,
    command: row.command,
    cwd: row.cwd,
    path: row.path,
    networkTarget: row.networkTarget,
    riskClass: row.riskClass,
    options: row.options as RuntimeDecisionDetail["options"],
    timeoutPolicy: row.timeoutPolicy as RuntimeDecisionTimeoutPolicy,
    expiresAt: toIso(row.expiresAt),
    answeredAt: toIso(row.answeredAt),
    relayedAt: toIso(row.relayedAt),
    relayError: row.relayError,
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

function realRepo(db: Db): DecisionRepo {
  return {
    async createDecision(input) {
      return db
        .insert(agentRuntimeDecisions)
        .values(input)
        .onConflictDoUpdate({
          target: agentRuntimeDecisions.sourceUniqueKey,
          set: {
            title: input.title,
            summary: input.summary ?? null,
            promptText: input.promptText ?? null,
            toolName: input.toolName ?? null,
            command: input.command ?? null,
            cwd: input.cwd ?? null,
            path: input.path ?? null,
            networkTarget: input.networkTarget ?? null,
            riskClass: input.riskClass ?? null,
            options: input.options ?? null,
            expiresAt: input.expiresAt ?? null,
            timeoutPolicy: input.timeoutPolicy,
            updatedAt: new Date(),
          },
        })
        .returning()
        .then((rows) => rows[0]);
    },
    async getDecision(companyId, decisionId) {
      return db
        .select()
        .from(agentRuntimeDecisions)
        .where(and(eq(agentRuntimeDecisions.id, decisionId), eq(agentRuntimeDecisions.companyId, companyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    },
    async updateDecision(decisionId, patch) {
      return db
        .update(agentRuntimeDecisions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(agentRuntimeDecisions.id, decisionId))
        .returning()
        .then((rows) => rows[0]);
    },
    async listDueForExpiry(input) {
      return db
        .select()
        .from(agentRuntimeDecisions)
        .where(
          and(
            eq(agentRuntimeDecisions.companyId, input.companyId),
            inArray(agentRuntimeDecisions.status, ["created", "shown"]),
            lte(agentRuntimeDecisions.expiresAt, input.now),
          ),
        )
        .limit(input.limit);
    },
  };
}

export function runtimeDecisionSourceSnapshot(row: AgentRuntimeDecisionRow | null): {
  terminal: boolean;
  title?: string | null;
  summary: string | null;
  permissionRevision: string | null;
} {
  if (!row) return { terminal: true, summary: null, permissionRevision: null };
  const status = row.status as RuntimeDecisionStatus;
  return {
    terminal: TERMINAL_STATUSES.has(status),
    title: row.title,
    summary: row.summary ?? row.promptText ?? row.relayError ?? null,
    permissionRevision: String(row.sourceRevision),
  };
}

export function agentRuntimeDecisionService(db: Db, deps: ServiceDeps = {}) {
  const repo = deps.repo ?? realRepo(db);
  const hub = deps.hubItems ?? hubItemsService(db);
  const activityLogger = deps.activityLogger ?? ((input: LogActivityInput) => logActivity(db, input));
  const now = deps.now ?? (() => new Date());

  async function emitHubItem(decision: AgentRuntimeDecisionRow) {
    return hub.emit({
      companyId: decision.companyId,
      semanticType: "agent_runtime_decision",
      sourceType: SOURCE_TYPE,
      sourceId: decision.id,
      title: decision.title,
      summary: decision.summary ?? decision.promptText ?? decision.relayError ?? null,
      relatedEntityType: "heartbeat_run",
      relatedEntityId: decision.runId,
      sourceActorType: "agent",
      sourceActorId: decision.agentId,
      priority: decision.status === "relay_failed" ? "urgent" : "high",
      sourcePermissionRevision: String(decision.sourceRevision),
    });
  }

  async function createPrompt(input: CreatePromptInput) {
    const created = await repo.createDecision({
      companyId: input.companyId,
      agentId: input.agentId,
      runId: input.runId,
      adapterType: input.adapterType,
      adapterSessionId: input.adapterSessionId ?? null,
      adapterSessionParams: input.adapterSessionParams ?? null,
      kind: input.kind,
      status: "created",
      nonce: input.nonce,
      sourceRevision: 0,
      promptHash: promptHash(input),
      sourceUniqueKey: sourceUniqueKey(input),
      title: safeText(input.title) ?? "Runtime decision",
      summary: safeText(input.summary),
      promptText: safeText(input.promptText),
      toolName: input.toolName ?? null,
      command: safeText(input.command),
      cwd: safeText(input.cwd),
      path: safeText(input.path),
      networkTarget: safeText(input.networkTarget),
      riskClass: input.riskClass ?? null,
      options: input.options ?? null,
      expiresAt: input.expiresAt ?? null,
      timeoutPolicy: input.timeoutPolicy,
    });
    const hubItem = await emitHubItem(created);
    return { decision: created, hubItem };
  }

  async function getDetail(companyId: string, decisionId: string) {
    const row = await repo.getDecision(companyId, decisionId);
    if (!row) throw notFound("Runtime decision prompt not found");
    return runtimeDecisionDetail(row);
  }

  async function loadActive(companyId: string, decisionId: string) {
    const row = await repo.getDecision(companyId, decisionId);
    if (!row) throw notFound("Runtime decision prompt not found");
    if (!ACTIVE_STATUSES.has(row.status as RuntimeDecisionStatus)) {
      throw conflict("Runtime decision prompt is no longer actionable");
    }
    return row;
  }

  function assertAnswerMatches(row: AgentRuntimeDecisionRow, input: AnswerPromptInput) {
    if (row.nonce !== input.nonce) throw conflict("Runtime decision nonce mismatch");
    if (row.sourceRevision !== input.expectedSourceRevision) {
      throw conflict("Runtime decision source revision mismatch");
    }
    if (row.kind !== input.kind) throw conflict("Runtime decision kind mismatch");
    if (input.kind === "permission") {
      if (!input.decision || !RUNTIME_DECISION_PERMISSION_DECISIONS.includes(input.decision)) {
        throw unprocessable("Permission runtime decisions require an allow/deny decision");
      }
      return;
    }
    if (!input.answer || input.decision) {
      throw unprocessable("Work-question runtime decisions require an answer payload");
    }
  }

  async function answerPrompt(input: AnswerPromptInput) {
    const row = await loadActive(input.companyId, input.decisionId);
    assertAnswerMatches(row, input);
    await activityLogger({
      companyId: row.companyId,
      actorType: "user",
      actorId: input.actorUserId,
      action: "runtime_decision.answered",
      entityType: "agent_runtime_decision",
      entityId: row.id,
      agentId: row.agentId,
      runId: row.runId,
      details: {
        kind: row.kind,
        decision: input.kind === "permission" ? input.decision : null,
        sourceRevision: row.sourceRevision,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    const answered = await repo.updateDecision(row.id, {
      status: "answered",
      decision: input.kind === "permission" ? input.decision : null,
      answerPayload: input.kind === "work_question" ? input.answer : null,
      answeredByUserId: input.actorUserId,
      answeredAt: now(),
      sourceRevision: row.sourceRevision + 1,
    });
    await emitHubItem(answered);
    return answered;
  }

  async function markRelayFailed(input: RelayFailedInput) {
    const row = await loadActive(input.companyId, input.decisionId);
    await activityLogger({
      companyId: row.companyId,
      actorType: "system",
      actorId: "runtime_decision_relay",
      action: "runtime_decision.relay_failed",
      entityType: "agent_runtime_decision",
      entityId: row.id,
      agentId: row.agentId,
      runId: row.runId,
      details: { sourceRevision: row.sourceRevision, relayError: input.relayError },
    });
    const failed = await repo.updateDecision(row.id, {
      status: "relay_failed",
      relayError: safeText(input.relayError),
      sourceRevision: row.sourceRevision + 1,
    });
    await emitHubItem(failed);
    return failed;
  }

  async function markRelayed(input: { companyId: string; decisionId: string }) {
    const row = await loadActive(input.companyId, input.decisionId);
    await activityLogger({
      companyId: row.companyId,
      actorType: "system",
      actorId: "runtime_decision_relay",
      action: "runtime_decision.relayed",
      entityType: "agent_runtime_decision",
      entityId: row.id,
      agentId: row.agentId,
      runId: row.runId,
      details: { sourceRevision: row.sourceRevision },
    });
    const relayed = await repo.updateDecision(row.id, {
      status: "relayed",
      relayedAt: now(),
      sourceRevision: row.sourceRevision + 1,
    });
    await emitHubItem(relayed);
    return relayed;
  }

  async function expireDuePrompts(input: ExpireDueInput) {
    const due = await repo.listDueForExpiry({ companyId: input.companyId, now: now(), limit: input.limit });
    let expired = 0;
    for (const row of due) {
      await activityLogger({
        companyId: row.companyId,
        actorType: "system",
        actorId: "runtime_decision_timeout",
        action: "runtime_decision.expired",
        entityType: "agent_runtime_decision",
        entityId: row.id,
        agentId: row.agentId,
        runId: row.runId,
        details: { sourceRevision: row.sourceRevision, timeoutPolicy: row.timeoutPolicy },
      });
      const updated = await repo.updateDecision(row.id, {
        status: "expired",
        sourceRevision: row.sourceRevision + 1,
      });
      await emitHubItem(updated);
      expired += 1;
    }
    return { expired };
  }

  return {
    createPrompt,
    getDetail,
    answerPrompt,
    markRelayFailed,
    markRelayed,
    expireDuePrompts,
    emitHubItemForPrompt: emitHubItem,
  };
}
