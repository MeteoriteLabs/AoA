import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
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
import { logger } from "../middleware/logger.js";
import { redactEventPayload, redactSecretsInString } from "../redaction.js";
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

const PERMISSION_DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const WORK_QUESTION_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function defaultTtlMs(kind: RuntimeDecisionKind) {
  return kind === "permission" ? PERMISSION_DEFAULT_TTL_MS : WORK_QUESTION_DEFAULT_TTL_MS;
}

export function defaultTimeoutPolicy(kind: RuntimeDecisionKind): RuntimeDecisionTimeoutPolicy {
  return kind === "permission" ? "deny" : "park_run";
}

const TRUST_RULE_DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function buildTrustRuleInsert(
  row: AgentRuntimeDecisionRow,
  actorUserId: string,
  nowDate: Date,
): typeof agentRuntimeTrustRules.$inferInsert {
  return {
    companyId: row.companyId,
    agentId: row.agentId,
    adapterType: row.adapterType,
    toolName: row.toolName,
    commandHash: row.commandHash,
    pathScope: row.path,
    networkScope: row.networkTarget,
    riskClass: row.riskClass,
    enabled: true,
    expiresAt: new Date(nowDate.getTime() + TRUST_RULE_DEFAULT_TTL_MS),
    createdByUserId: actorUserId,
  };
}

function isVisibleTimeoutFollowUp(row: AgentRuntimeDecisionRow) {
  return row.status === "cancelled" && (row.timeoutPolicy === "park_run" || row.timeoutPolicy === "escalate");
}

export type AgentRuntimeDecisionRow = typeof agentRuntimeDecisions.$inferSelect;
export type AgentRuntimeTrustRuleRow = typeof agentRuntimeTrustRules.$inferSelect;

export class RuntimeDecisionCancelledError extends Error {
  readonly decision: AgentRuntimeDecisionRow;

  constructor(decision: AgentRuntimeDecisionRow) {
    super(decision.relayError ?? "Runtime decision prompt was cancelled");
    this.name = "RuntimeDecisionCancelledError";
    this.decision = decision;
  }
}

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
  commandHash?: string | null;
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
  answerWithTrustRule(
    decisionId: string,
    patch: Partial<typeof agentRuntimeDecisions.$inferInsert>,
    guard: { sourceRevision: number; statuses: RuntimeDecisionStatus[] },
    trustRule: typeof agentRuntimeTrustRules.$inferInsert,
  ): Promise<{ decision: AgentRuntimeDecisionRow | null; rule: AgentRuntimeTrustRuleRow | null }>;
  listDueForExpiry(input: { companyId?: string; now: Date; limit: number }): Promise<AgentRuntimeDecisionRow[]>;
};

type HubItemsApi = Pick<ReturnType<typeof hubItemsService>, "emit" | "reconcile">;

type ServiceDeps = {
  repo?: DecisionRepo;
  hubItems?: HubItemsApi;
  activityLogger?: (input: LogActivityInput) => Promise<void>;
  runCanceller?: (input: { companyId: string; runId: string; reason: string }) => Promise<void>;
  now?: () => Date;
};

function safeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return redactSecretsInString(value);
}

function redactJsonSecrets(value: unknown): unknown {
  if (typeof value === "string") return redactSecretsInString(value);
  if (Array.isArray(value)) return value.map((item) => redactJsonSecrets(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactJsonSecrets(item)]),
    );
  }
  return value;
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
  return command ? hashString(command) : null;
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
  commandHash?: string | null;
  path?: string | null;
  pathScope?: string | null;
  networkTarget?: string | null;
  networkScope?: string | null;
  riskClass?: string | null;
}) {
  return Boolean(
    input.command ||
    input.commandHash ||
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
            commandHash: input.commandHash ?? null,
            cwd: input.cwd ?? null,
            path: input.path ?? null,
            networkTarget: input.networkTarget ?? null,
            riskClass: input.riskClass ?? null,
            options: input.options ?? null,
            expiresAt: input.expiresAt ?? null,
            timeoutPolicy: input.timeoutPolicy,
            status: input.status,
            sourceRevision: sql`${agentRuntimeDecisions.sourceRevision} + 1`,
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
    async answerWithTrustRule(decisionId, patch, guard, trustRule) {
      return db.transaction(async (tx) => {
        const conditions = [
          eq(agentRuntimeDecisions.id, decisionId),
          eq(agentRuntimeDecisions.sourceRevision, guard.sourceRevision),
          inArray(agentRuntimeDecisions.status, guard.statuses),
        ];
        const [decision] = await tx
          .update(agentRuntimeDecisions)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(...conditions))
          .returning();
        if (!decision) return { decision: null, rule: null };
        const scopeConds = [
          eq(agentRuntimeTrustRules.companyId, trustRule.companyId),
          eq(agentRuntimeTrustRules.adapterType, trustRule.adapterType),
          eq(agentRuntimeTrustRules.enabled, true),
          trustRule.agentId
            ? eq(agentRuntimeTrustRules.agentId, trustRule.agentId)
            : isNull(agentRuntimeTrustRules.agentId),
          trustRule.toolName
            ? eq(agentRuntimeTrustRules.toolName, trustRule.toolName)
            : isNull(agentRuntimeTrustRules.toolName),
          trustRule.commandHash
            ? eq(agentRuntimeTrustRules.commandHash, trustRule.commandHash)
            : isNull(agentRuntimeTrustRules.commandHash),
          trustRule.pathScope
            ? eq(agentRuntimeTrustRules.pathScope, trustRule.pathScope)
            : isNull(agentRuntimeTrustRules.pathScope),
          trustRule.networkScope
            ? eq(agentRuntimeTrustRules.networkScope, trustRule.networkScope)
            : isNull(agentRuntimeTrustRules.networkScope),
          trustRule.riskClass
            ? eq(agentRuntimeTrustRules.riskClass, trustRule.riskClass)
            : isNull(agentRuntimeTrustRules.riskClass),
        ];
        const [existing] = await tx
          .select()
          .from(agentRuntimeTrustRules)
          .where(and(...scopeConds))
          .limit(1);
        let rule: AgentRuntimeTrustRuleRow;
        if (existing) {
          [rule] = await tx
            .update(agentRuntimeTrustRules)
            .set({ expiresAt: trustRule.expiresAt, enabled: true, updatedAt: new Date() })
            .where(eq(agentRuntimeTrustRules.id, existing.id))
            .returning();
        } else {
          [rule] = await tx.insert(agentRuntimeTrustRules).values(trustRule).returning();
        }
        return { decision, rule };
      });
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
        .orderBy(asc(agentRuntimeDecisions.expiresAt))
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
    // BUG-2 (2026-07-04): terminality tracks TERMINAL_STATUSES exactly. The old
    // isVisibleTimeoutFollowUp carve-out kept parked/escalated timeouts open in
    // Waiting-on-you forever (phantom answerable items). Escalate-visibility
    // (Decisions #105/#106, mechanism amended) now lives in a notifications-lane
    // agent_error follow-up emitted by expireDuePrompts; the follow-up summary
    // branch below is kept so pre-close refreshes still surface the timeout text.
    terminal: TERMINAL_STATUSES.has(status),
    title: row.title,
    summary: isVisibleTimeoutFollowUp(row)
      ? row.relayError ?? row.summary ?? row.promptText ?? null
      : row.summary ?? row.promptText ?? row.relayError ?? null,
    permissionRevision: String(row.sourceRevision),
  };
}

type TimeoutOutcome = {
  patch: Partial<typeof agentRuntimeDecisions.$inferInsert>;
  cancelsRun: boolean;
  parked: boolean;
};

function resolveExplicitDefault(row: AgentRuntimeDecisionRow):
  | { decision: RuntimeDecisionPermissionDecision }
  | { answer: Record<string, unknown> }
  | null {
  const options = Array.isArray(row.options) ? row.options : [];
  const def = options.find(
    (o): o is Record<string, unknown> =>
      Boolean(o) && typeof o === "object" && (o as Record<string, unknown>).isDefault === true,
  );
  if (!def) return null;
  const value = def.value;
  if (row.kind === "permission") {
    return typeof value === "string" &&
      value !== "allow_always" &&
      (RUNTIME_DECISION_PERMISSION_DECISIONS as readonly string[]).includes(value)
      ? { decision: value as RuntimeDecisionPermissionDecision }
      : null;
  }
  return { answer: { selected: value ?? null } };
}

function fallbackPolicyOutcome(
  row: AgentRuntimeDecisionRow,
  policy: RuntimeDecisionTimeoutPolicy,
  bumpRev: number,
  nowDate: Date,
): TimeoutOutcome {
  if (row.kind === "permission" && policy === "deny") {
    return {
      patch: { status: "answered", decision: "deny", answeredAt: nowDate, sourceRevision: bumpRev },
      cancelsRun: false,
      parked: false,
    };
  }
  if (policy === "park_run" || policy === "escalate") {
    return {
      patch: {
        status: "cancelled",
        relayError: policy === "escalate"
          ? "timeout policy escalated the run"
          : "timeout policy parked the run",
        expiresAt: null,
        sourceRevision: bumpRev,
      },
      cancelsRun: true,
      parked: true,
    };
  }
  return {
    patch: {
      status: policy === "cancel_run" ? "cancelled" : "expired",
      relayError: policy === "cancel_run" ? "timeout policy cancelled the run" : undefined,
      sourceRevision: bumpRev,
    },
    cancelsRun: policy === "cancel_run",
    parked: false,
  };
}

function timeoutOutcome(row: AgentRuntimeDecisionRow, nowDate: Date): TimeoutOutcome {
  const bumpRev = row.sourceRevision + 1;
  if (row.timeoutPolicy === "continue_with_default") {
    const def = resolveExplicitDefault(row);
    if (def) {
      return {
        patch: {
          status: "answered",
          decision: "decision" in def ? def.decision : null,
          answerPayload: "answer" in def ? def.answer : null,
          answeredAt: nowDate,
          sourceRevision: bumpRev,
        },
        cancelsRun: false,
        parked: false,
      };
    }
    return fallbackPolicyOutcome(row, defaultTimeoutPolicy(row.kind as RuntimeDecisionKind), bumpRev, nowDate);
  }
  return fallbackPolicyOutcome(row, row.timeoutPolicy as RuntimeDecisionTimeoutPolicy, bumpRev, nowDate);
}

export function agentRuntimeDecisionService(db: Db, deps: ServiceDeps = {}) {
  const repo = deps.repo ?? realRepo(db);
  const hub = deps.hubItems ?? hubItemsService(db);
  const activityLogger = deps.activityLogger ?? ((input: LogActivityInput) => logActivity(db, input));
  const runCanceller = deps.runCanceller;
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

  // BUG-2 push-close: archive the projected waiting-lane hub item on every
  // terminal transition (relayed / expired / cancelled) instead of waiting for
  // the next GET-path sweep. Always call AFTER emitHubItem — emit refreshes the
  // final relayError onto the still-open row; the close does not depend on emit
  // side-effects (emit() is change-aware and skips no-op side-effects).
  async function closeProjectedHubItem(decision: AgentRuntimeDecisionRow) {
    try {
      await hub.reconcile(decision.companyId, {
        sourceType: SOURCE_TYPE,
        sourceId: decision.id,
      });
    } catch (err) {
      // Best-effort: the decision flip is already durable; the GET-path sweep
      // reconciles on the next read. Never poison the terminal transition.
      logger.warn({ err, decisionId: decision.id }, "runtime decision hub-item close failed");
    }
  }

  async function createPrompt(input: CreatePromptInput) {
    const nowDate = now();
    const matchingTrustRule = input.kind === "permission"
      ? (await repo.listTrustRules({ companyId: input.companyId, adapterType: input.adapterType }))
        .find((rule) => trustRuleMatchesPrompt(rule, input, nowDate))
      : null;
    const resolvedExpiresAt =
      input.expiresAt ?? new Date(nowDate.getTime() + defaultTtlMs(input.kind));
    const created = await repo.createDecision({
      companyId: input.companyId,
      agentId: input.agentId,
      runId: input.runId,
      adapterType: input.adapterType,
      adapterSessionId: input.adapterSessionId ?? null,
      adapterSessionParams: redactEventPayload(input.adapterSessionParams ?? null),
      kind: input.kind,
      status: matchingTrustRule ? "answered" : "created",
      nonce: input.nonce,
      sourceRevision: matchingTrustRule ? 1 : 0,
      promptHash: promptHash(input),
      sourceUniqueKey: sourceUniqueKey(input),
      title: safeText(input.title) ?? "Runtime decision",
      summary: safeText(input.summary),
      promptText: safeText(input.promptText),
      toolName: safeText(input.toolName),
      command: safeText(input.command),
      commandHash: commandHash(input.command),
      cwd: safeText(input.cwd),
      path: safeText(input.path),
      networkTarget: safeText(input.networkTarget),
      riskClass: input.riskClass ?? null,
      options: input.options ? redactJsonSecrets(input.options) as Array<Record<string, unknown>> : null,
      expiresAt: resolvedExpiresAt,
      timeoutPolicy: input.timeoutPolicy,
      decision: matchingTrustRule ? "allow_always" : null,
      answeredByUserId: matchingTrustRule?.createdByUserId ?? null,
      answeredAt: matchingTrustRule ? nowDate : null,
    });
    if (!matchingTrustRule && (TERMINAL_STATUSES.has(created.status as RuntimeDecisionStatus) || created.status === "answered")) {
      throw conflict("Runtime decision prompt already consumed for this nonce");
    }
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
      commandHash: input.commandHash ?? commandHash(input.command),
      pathScope: input.pathScope ?? null,
      networkScope: input.networkScope ?? null,
      riskClass: input.riskClass ?? null,
      enabled: true,
      expiresAt: input.expiresAt ?? new Date(now().getTime() + TRUST_RULE_DEFAULT_TTL_MS),
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
    if ((row.status === "answered" || row.status === "relayed") && isIdempotentAnswerReplay(row, input)) {
      return row;
    }
    if (!ACTIVE_STATUSES.has(row.status as RuntimeDecisionStatus)) {
      throw conflict("Runtime decision prompt is no longer actionable");
    }
    assertAnswerMatches(row, input);
    if (input.kind === "permission" && input.decision === "allow_always" && !hasConcreteTrustScope(row)) {
      throw unprocessable("Allow always requires a concrete command, path, network, or risk scope");
    }
    const answerPatch: Partial<typeof agentRuntimeDecisions.$inferInsert> = {
      status: "answered",
      decision: input.kind === "permission" ? input.decision : null,
      answerPayload: input.kind === "work_question" ? input.answer : null,
      answerIdempotencyKey: input.idempotencyKey ?? null,
      answeredByUserId: input.actorUserId,
      answeredAt: now(),
      sourceRevision: row.sourceRevision + 1,
    };
    const guard = {
      sourceRevision: row.sourceRevision,
      statuses: ["created", "shown", "relay_failed"] as RuntimeDecisionStatus[],
    };

    let answered: AgentRuntimeDecisionRow | null;
    if (input.kind === "permission" && input.decision === "allow_always") {
      const trustRule = buildTrustRuleInsert(row, input.actorUserId, now());
      const result = await repo.answerWithTrustRule(row.id, answerPatch, guard, trustRule);
      answered = result.decision;
      if (answered && result.rule) {
        await activityLogger({
          companyId: input.companyId,
          actorType: "user",
          actorId: input.actorUserId,
          action: "runtime_decision_trust_rule.created",
          entityType: "agent_runtime_trust_rule",
          entityId: result.rule.id,
          details: {
            agentId: result.rule.agentId,
            adapterType: result.rule.adapterType,
            toolName: result.rule.toolName,
            pathScope: result.rule.pathScope,
            networkScope: result.rule.networkScope,
            riskClass: result.rule.riskClass,
            expiresAt: result.rule.expiresAt?.toISOString() ?? null,
          },
        });
      }
    } else {
      answered = await repo.updateDecision(row.id, answerPatch, guard);
    }
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
      if (row.status === "cancelled") {
        throw new RuntimeDecisionCancelledError(row);
      }
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
    const failed = await repo.updateDecision(row.id, {
      status: "relay_failed",
      relayError: safeText(input.relayError),
      sourceRevision: row.sourceRevision + 1,
    }, {
      sourceRevision: row.sourceRevision,
      statuses: ["answered"],
    });
    if (!failed) {
      return throwRelayTransitionConflict(input.companyId, input.decisionId, "Runtime decision prompt changed before relay failure could be recorded");
    }
    await activityLogger({
      companyId: failed.companyId,
      actorType: "system",
      actorId: "runtime_decision_relay",
      action: "runtime_decision.relay_failed",
      entityType: "agent_runtime_decision",
      entityId: failed.id,
      agentId: failed.agentId,
      runId: failed.runId,
      details: { sourceRevision: row.sourceRevision, relayError: input.relayError },
    });
    await emitHubItem(failed);
    return failed;
  }

  async function markRelayed(input: { companyId: string; decisionId: string }) {
    const row = await loadActive(input.companyId, input.decisionId);
    const relayed = await repo.updateDecision(row.id, {
      status: "relayed",
      relayedAt: now(),
      sourceRevision: row.sourceRevision + 1,
    }, {
      sourceRevision: row.sourceRevision,
      statuses: ["answered"],
    });
    if (!relayed) {
      return throwRelayTransitionConflict(input.companyId, input.decisionId, "Runtime decision prompt changed before relay could be recorded");
    }
    await activityLogger({
      companyId: relayed.companyId,
      actorType: "system",
      actorId: "runtime_decision_relay",
      action: "runtime_decision.relayed",
      entityType: "agent_runtime_decision",
      entityId: relayed.id,
      agentId: relayed.agentId,
      runId: relayed.runId,
      details: { sourceRevision: row.sourceRevision },
    });
    await emitHubItem(relayed);
    await closeProjectedHubItem(relayed);
    return relayed;
  }

  async function throwRelayTransitionConflict(companyId: string, decisionId: string, message: string): Promise<never> {
    const current = await repo.getDecision(companyId, decisionId);
    if (current?.status === "cancelled") {
      throw new RuntimeDecisionCancelledError(current);
    }
    throw conflict(message);
  }

  async function expireDuePrompts(input: ExpireDueInput) {
    const nowDate = now();
    const due = await repo.listDueForExpiry({ companyId: input.companyId, now: nowDate, limit: input.limit });
    let expired = 0;
    let processed = 0;
    for (const row of due) {
      const outcome = timeoutOutcome(row, nowDate);
      const updated = await repo.updateDecision(row.id, outcome.patch, {
        sourceRevision: row.sourceRevision,
        statuses: ["created", "shown"],
      });
      if (!updated) continue;
      processed += 1;
      await activityLogger({
        companyId: updated.companyId,
        actorType: "system",
        actorId: "runtime_decision_timeout",
        action: outcome.parked ? "runtime_decision.timeout_parked" : "runtime_decision.expired",
        entityType: "agent_runtime_decision",
        entityId: updated.id,
        agentId: updated.agentId,
        runId: updated.runId,
        details: { sourceRevision: row.sourceRevision, timeoutPolicy: row.timeoutPolicy },
      });
      await emitHubItem(updated);
      if (outcome.parked) {
        // Escalate-visible (Decisions #105/#106): the waiting-lane item closes, so
        // surface WHAT HAPPENED as a notifications-lane item instead.
        await hub.emit({
          companyId: updated.companyId,
          semanticType: "agent_error",
          sourceType: SOURCE_TYPE,
          sourceId: updated.id,
          title: `Permission request timed out: ${updated.title}`,
          summary: updated.relayError ?? "timeout policy parked the run",
          relatedEntityType: "heartbeat_run",
          relatedEntityId: updated.runId,
          sourceActorType: "agent",
          sourceActorId: updated.agentId,
          priority: "high",
        });
      }
      // Deny-timeout flips to "answered" (non-terminal) — the close is a safe
      // no-op there (reconcile refreshes, never archives a live source).
      await closeProjectedHubItem(updated);
      if (outcome.cancelsRun) {
        try {
          await runCanceller?.({
            companyId: updated.companyId,
            runId: updated.runId,
            reason: updated.relayError ?? "runtime decision timeout policy cancelled the run",
          });
        } catch (err) {
          // Run may already be gone (FK cascade / purge); the decision row is
          // already flipped (durable effect). Log so a real DB failure during
          // cancellation isn't masked, but don't poison the batch.
          logger.warn({ err, runId: updated.runId }, "runtime decision timeout run cancellation failed");
        }
      }
      if (!outcome.parked) expired += 1;
    }
    return { expired, processed };
  }

  async function cancelActiveForRun(input: { companyId: string; runId: string; reason: string }) {
    const active = await repo.listActiveForRun({ companyId: input.companyId, runId: input.runId });
    let cancelled = 0;
    for (const row of active) {
      const updated = await repo.updateDecision(row.id, {
        status: "cancelled",
        relayError: safeText(input.reason),
        sourceRevision: row.sourceRevision + 1,
      }, {
        sourceRevision: row.sourceRevision,
        statuses: ["created", "shown", "answered", "relay_failed"],
      });
      if (!updated) continue;
      await activityLogger({
        companyId: updated.companyId,
        actorType: "system",
        actorId: "runtime_decision_run_cleanup",
        action: "runtime_decision.cancelled",
        entityType: "agent_runtime_decision",
        entityId: updated.id,
        agentId: updated.agentId,
        runId: updated.runId,
        details: { sourceRevision: row.sourceRevision, reason: input.reason },
      });
      await emitHubItem(updated);
      await closeProjectedHubItem(updated);
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
