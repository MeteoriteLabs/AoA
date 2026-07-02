import { createHash } from "node:crypto";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agentRuntimeDecisions, agentRuntimeTrustRules } from "@armyofagents/db";
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
export type AgentRuntimeTrustRuleRow = typeof agentRuntimeTrustRules.$inferSelect;

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
  companyId?: string;
  limit: number;
};

type WaitForAnswerInput = {
  companyId: string;
  decisionId: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

type CreateTrustRuleInput = {
  companyId: string;
  agentId?: string | null;
  adapterType: string;
  toolName?: string | null;
  command?: string | null;
  pathScope?: string | null;
  networkScope?: string | null;
  riskClass?: string | null;
  expiresAt?: Date | null;
  createdByUserId: string;
};

type DecisionRepo = {
  createDecision(input: typeof agentRuntimeDecisions.$inferInsert): Promise<AgentRuntimeDecisionRow>;
  getDecision(companyId: string, decisionId: string): Promise<AgentRuntimeDecisionRow | null>;
  listActiveForRun(input: { companyId: string; runId: string }): Promise<AgentRuntimeDecisionRow[]>;
  listTrustRules(input: { companyId: string; adapterType?: string; includeDisabled?: boolean }): Promise<AgentRuntimeTrustRuleRow[]>;
  createTrustRule(input: typeof agentRuntimeTrustRules.$inferInsert): Promise<AgentRuntimeTrustRuleRow>;
  revokeTrustRule(input: { companyId: string; ruleId: string }): Promise<AgentRuntimeTrustRuleRow | null>;
  markTrustRuleUsed(input: { ruleId: string; usedAt: Date }): Promise<void>;
  updateDecision(
    decisionId: string,
    patch: Partial<typeof agentRuntimeDecisions.$inferInsert>,
    guard?: { sourceRevision?: number; statuses?: RuntimeDecisionStatus[] },
  ): Promise<AgentRuntimeDecisionRow | null>;
  listDueForExpiry(input: { companyId?: string; now: Date; limit: number }): Promise<AgentRuntimeDecisionRow[]>;
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
  return hashString(JSON.stringify({
      kind: input.kind,
      title: input.title,
      summary: input.summary ?? null,
      promptText: input.promptText ?? null,
      command: input.command ?? null,
    }));
}

function hashString(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceUniqueKey(input: { companyId: string; runId: string; nonce: string }) {
  return `runtime:${input.companyId}:${input.runId}:${input.nonce}`;
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commandHash(command: string | null | undefined) {
  const redacted = safeText(command);
  return redacted ? hashString(redacted) : null;
}

function jsonEquivalent(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isIdempotentAnswerReplay(row: AgentRuntimeDecisionRow, input: AnswerPromptInput) {
  if (!input.idempotencyKey || row.answerIdempotencyKey !== input.idempotencyKey) return false;
  if (row.nonce !== input.nonce || row.kind !== input.kind) return false;
  if (input.kind === "permission") return row.decision === input.decision;
  return jsonEquivalent(row.answerPayload, input.answer);
}

function pathMatchesScope(path: string | null | undefined, scope: string | null) {
  if (!scope) return true;
  if (!path) return false;
  const normalizedPath = normalizePathForScopeMatch(path);
  const normalizedScope = normalizePathForScopeMatch(scope);
  if (!normalizedPath || !normalizedScope) return false;
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function normalizePathForScopeMatch(value: string) {
  const segments = value
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) return null;
  return segments.join("/").replace(/\/+$/, "");
}

function networkMatchesScope(networkTarget: string | null | undefined, scope: string | null) {
  if (!scope) return true;
  return networkTarget === scope;
}

function hasConcreteTrustScope(input: {
  command?: string | null;
  path?: string | null;
  pathScope?: string | null;
  networkTarget?: string | null;
  networkScope?: string | null;
  riskClass?: string | null;
}) {
  return Boolean(
    input.command ||
    input.path ||
    input.pathScope ||
    input.networkTarget ||
    input.networkScope ||
    input.riskClass,
  );
}

function trustRuleMatchesPrompt(rule: AgentRuntimeTrustRuleRow, input: CreatePromptInput, now: Date) {
  if (!rule.enabled) return false;
  if (rule.expiresAt && rule.expiresAt.getTime() <= now.getTime()) return false;
  if (rule.companyId !== input.companyId) return false;
  if (rule.adapterType !== input.adapterType) return false;
  if (rule.agentId && rule.agentId !== input.agentId) return false;
  if (rule.toolName && rule.toolName !== input.toolName) return false;
  if (rule.commandHash && rule.commandHash !== commandHash(input.command)) return false;
  if (!pathMatchesScope(input.path, rule.pathScope)) return false;
  if (!networkMatchesScope(input.networkTarget, rule.networkScope)) return false;
  if (rule.riskClass && rule.riskClass !== input.riskClass) return false;
  return true;
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
          targetWhere: sql`source_unique_key is not null`,
          setWhere: sql`${agentRuntimeDecisions.status} in ('created', 'shown', 'relay_failed')`,
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
            status: input.status,
            sourceRevision: input.sourceRevision,
            decision: input.decision ?? null,
            answerIdempotencyKey: input.answerIdempotencyKey ?? null,
            answeredByUserId: input.answeredByUserId ?? null,
            answeredAt: input.answeredAt ?? null,
            updatedAt: new Date(),
          },
        })
        .returning()
        .then(async (rows) => {
          if (rows[0]) return rows[0];
          if (!input.sourceUniqueKey) {
            throw new Error("Runtime decision conflict fallback requires source_unique_key");
          }
          return db
            .select()
            .from(agentRuntimeDecisions)
            .where(eq(agentRuntimeDecisions.sourceUniqueKey, input.sourceUniqueKey))
            .limit(1)
            .then((existing) => existing[0]);
        });
    },
    async getDecision(companyId, decisionId) {
      return db
        .select()
        .from(agentRuntimeDecisions)
        .where(and(eq(agentRuntimeDecisions.id, decisionId), eq(agentRuntimeDecisions.companyId, companyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    },
    async listActiveForRun(input) {
      return db
        .select()
        .from(agentRuntimeDecisions)
        .where(
          and(
            eq(agentRuntimeDecisions.companyId, input.companyId),
            eq(agentRuntimeDecisions.runId, input.runId),
            inArray(agentRuntimeDecisions.status, ["created", "shown", "answered", "relay_failed"]),
          ),
        );
    },
    async listTrustRules(input) {
      const conditions = [
        eq(agentRuntimeTrustRules.companyId, input.companyId),
      ];
      if (input.adapterType) conditions.push(eq(agentRuntimeTrustRules.adapterType, input.adapterType));
      if (!input.includeDisabled) conditions.push(eq(agentRuntimeTrustRules.enabled, true));
      return db.select().from(agentRuntimeTrustRules).where(and(...conditions));
    },
    async createTrustRule(input) {
      return db
        .insert(agentRuntimeTrustRules)
        .values(input)
        .returning()
        .then((rows) => rows[0]);
    },
    async revokeTrustRule(input) {
      return db
        .update(agentRuntimeTrustRules)
        .set({ enabled: false, updatedAt: new Date() })
        .where(and(eq(agentRuntimeTrustRules.companyId, input.companyId), eq(agentRuntimeTrustRules.id, input.ruleId)))
        .returning()
        .then((rows) => rows[0] ?? null);
    },
    async markTrustRuleUsed(input) {
      await db
        .update(agentRuntimeTrustRules)
        .set({ lastUsedAt: input.usedAt, updatedAt: input.usedAt })
        .where(eq(agentRuntimeTrustRules.id, input.ruleId));
    },
    async updateDecision(decisionId, patch, guard) {
      const conditions = [eq(agentRuntimeDecisions.id, decisionId)];
      if (guard?.sourceRevision !== undefined) {
        conditions.push(eq(agentRuntimeDecisions.sourceRevision, guard.sourceRevision));
      }
      if (guard?.statuses?.length) {
        conditions.push(inArray(agentRuntimeDecisions.status, guard.statuses));
      }
      return db
        .update(agentRuntimeDecisions)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(...conditions))
        .returning()
        .then((rows) => rows[0] ?? null);
    },
    async listDueForExpiry(input) {
      const conditions = [
        inArray(agentRuntimeDecisions.status, ["created", "shown"]),
        lte(agentRuntimeDecisions.expiresAt, input.now),
      ];
      if (input.companyId) conditions.push(eq(agentRuntimeDecisions.companyId, input.companyId));
      return db
        .select()
        .from(agentRuntimeDecisions)
        .where(and(...conditions))
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
    const matchingTrustRule = input.kind === "permission"
      ? (await repo.listTrustRules({ companyId: input.companyId, adapterType: input.adapterType }))
        .find((rule) => trustRuleMatchesPrompt(rule, input, now()))
      : null;
    const created = await repo.createDecision({
      companyId: input.companyId,
      agentId: input.agentId,
      runId: input.runId,
      adapterType: input.adapterType,
      adapterSessionId: input.adapterSessionId ?? null,
      adapterSessionParams: input.adapterSessionParams ?? null,
      kind: input.kind,
      status: matchingTrustRule ? "answered" : "created",
      nonce: input.nonce,
      sourceRevision: matchingTrustRule ? 1 : 0,
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
      decision: matchingTrustRule ? "allow_always" : null,
      answeredByUserId: matchingTrustRule?.createdByUserId ?? null,
      answeredAt: matchingTrustRule ? now() : null,
    });
    if (matchingTrustRule) {
      await repo.markTrustRuleUsed({ ruleId: matchingTrustRule.id, usedAt: now() });
    }
    const hubItem = await emitHubItem(created);
    return { decision: created, hubItem };
  }

  async function createTrustRule(input: CreateTrustRuleInput) {
    if (!hasConcreteTrustScope(input)) {
      throw unprocessable("Allow always requires a concrete command, path, network, or risk scope");
    }
    const rule = await repo.createTrustRule({
      companyId: input.companyId,
      agentId: input.agentId ?? null,
      adapterType: input.adapterType,
      toolName: input.toolName ?? null,
      commandHash: commandHash(input.command),
      pathScope: input.pathScope ?? null,
      networkScope: input.networkScope ?? null,
      riskClass: input.riskClass ?? null,
      enabled: true,
      expiresAt: input.expiresAt ?? null,
      createdByUserId: input.createdByUserId,
    });
    await activityLogger({
      companyId: input.companyId,
      actorType: "user",
      actorId: input.createdByUserId,
      action: "runtime_decision_trust_rule.created",
      entityType: "agent_runtime_trust_rule",
      entityId: rule.id,
      details: {
        agentId: input.agentId ?? null,
        adapterType: input.adapterType,
        toolName: input.toolName ?? null,
        hasCommandScope: Boolean(input.command),
        pathScope: input.pathScope ?? null,
        networkScope: input.networkScope ?? null,
        riskClass: input.riskClass ?? null,
      },
    });
    return rule;
  }

  async function listTrustRules(input: { companyId: string; adapterType?: string; includeDisabled?: boolean }) {
    return repo.listTrustRules(input);
  }

  async function revokeTrustRule(input: { companyId: string; ruleId: string; actorUserId: string }) {
    const rule = await repo.revokeTrustRule({ companyId: input.companyId, ruleId: input.ruleId });
    if (!rule) throw notFound("Runtime decision trust rule not found");
    await activityLogger({
      companyId: input.companyId,
      actorType: "user",
      actorId: input.actorUserId,
      action: "runtime_decision_trust_rule.revoked",
      entityType: "agent_runtime_trust_rule",
      entityId: rule.id,
      details: { adapterType: rule.adapterType, toolName: rule.toolName },
    });
    return rule;
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
    const row = await repo.getDecision(input.companyId, input.decisionId);
    if (!row) throw notFound("Runtime decision prompt not found");
    if (row.status === "answered" && isIdempotentAnswerReplay(row, input)) {
      return row;
    }
    if (!ACTIVE_STATUSES.has(row.status as RuntimeDecisionStatus)) {
      throw conflict("Runtime decision prompt is no longer actionable");
    }
    assertAnswerMatches(row, input);
    if (input.kind === "permission" && input.decision === "allow_always" && !hasConcreteTrustScope(row)) {
      throw unprocessable("Allow always requires a concrete command, path, network, or risk scope");
    }
    const answered = await repo.updateDecision(row.id, {
      status: "answered",
      decision: input.kind === "permission" ? input.decision : null,
      answerPayload: input.kind === "work_question" ? input.answer : null,
      answerIdempotencyKey: input.idempotencyKey ?? null,
      answeredByUserId: input.actorUserId,
      answeredAt: now(),
      sourceRevision: row.sourceRevision + 1,
    }, {
      sourceRevision: row.sourceRevision,
      statuses: ["created", "shown", "relay_failed"],
    });
    if (!answered) throw conflict("Runtime decision prompt was already answered");
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
    if (input.kind === "permission" && input.decision === "allow_always") {
      await createTrustRule({
        companyId: row.companyId,
        agentId: row.agentId,
        adapterType: row.adapterType,
        toolName: row.toolName,
        command: row.command,
        pathScope: row.path,
        networkScope: row.networkTarget,
        riskClass: row.riskClass,
        createdByUserId: input.actorUserId,
      });
    }
    await emitHubItem(answered);
    return answered;
  }

  async function waitForAnswer(input: WaitForAnswerInput) {
    const startedAt = Date.now();
    const pollIntervalMs = Math.max(0, input.pollIntervalMs ?? 1000);
    for (;;) {
      const row = await repo.getDecision(input.companyId, input.decisionId);
      if (!row) throw notFound("Runtime decision prompt not found");
      if (row.status === "answered") return row;
      if (TERMINAL_STATUSES.has(row.status as RuntimeDecisionStatus)) {
        throw conflict("Runtime decision prompt is no longer actionable");
      }
      if (input.timeoutMs != null && Date.now() - startedAt >= input.timeoutMs) {
        throw conflict("Timed out waiting for runtime decision answer");
      }
      await sleep(pollIntervalMs);
    }
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
    if (!failed) throw conflict("Runtime decision prompt changed before relay failure could be recorded");
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
    if (!relayed) throw conflict("Runtime decision prompt changed before relay could be recorded");
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
      const patch: Partial<typeof agentRuntimeDecisions.$inferInsert> =
        row.kind === "permission" && row.timeoutPolicy === "deny"
          ? {
              status: "answered",
              decision: "deny",
              answeredAt: now(),
              sourceRevision: row.sourceRevision + 1,
            }
          : {
              status: row.timeoutPolicy === "cancel_run" ? "cancelled" : "expired",
              relayError: row.timeoutPolicy === "cancel_run" ? "timeout policy cancelled the run" : undefined,
              sourceRevision: row.sourceRevision + 1,
            };
      const updated = await repo.updateDecision(row.id, patch, {
        sourceRevision: row.sourceRevision,
        statuses: ["created", "shown"],
      });
      if (!updated) continue;
      await emitHubItem(updated);
      expired += 1;
    }
    return { expired };
  }

  async function cancelActiveForRun(input: { companyId: string; runId: string; reason: string }) {
    const active = await repo.listActiveForRun({ companyId: input.companyId, runId: input.runId });
    let cancelled = 0;
    for (const row of active) {
      await activityLogger({
        companyId: row.companyId,
        actorType: "system",
        actorId: "runtime_decision_run_cleanup",
        action: "runtime_decision.cancelled",
        entityType: "agent_runtime_decision",
        entityId: row.id,
        agentId: row.agentId,
        runId: row.runId,
        details: { sourceRevision: row.sourceRevision, reason: input.reason },
      });
      const updated = await repo.updateDecision(row.id, {
        status: "cancelled",
        relayError: safeText(input.reason),
        sourceRevision: row.sourceRevision + 1,
      });
      if (!updated) continue;
      await emitHubItem(updated);
      cancelled += 1;
    }
    return { cancelled };
  }

  return {
    createPrompt,
    createTrustRule,
    listTrustRules,
    revokeTrustRule,
    getDetail,
    answerPrompt,
    waitForAnswer,
    markRelayFailed,
    markRelayed,
    expireDuePrompts,
    cancelActiveForRun,
    emitHubItemForPrompt: emitHubItem,
  };
}
