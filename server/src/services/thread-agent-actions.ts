import { and, asc, eq } from "drizzle-orm";
import type {
  ThreadAgentActionStatus,
  ThreadAgentActionType,
  ThreadPhase,
} from "@armyofagents/shared";
import {
  agentWakeupRequests,
  agents,
  discussionEntryAttachments,
  discussions,
  threadAgentActions,
  threadScopeItems,
} from "@armyofagents/db";
import type { Db } from "@armyofagents/db";
import {
  compareFreshnessSnapshot,
  type ThreadFreshnessSnapshot,
  type ThreadFreshnessComparison,
} from "./thread-agent-action-freshness.js";
import { discussionService } from "./discussions.js";
import { threadScopeVersionService } from "./thread-scope-versions.js";
import { artifactService } from "./artifacts.js";
import { threadService } from "./threads.js";

type QueryChain = PromiseLike<unknown[]> & {
  from: (table: unknown) => QueryChain;
  where: (...args: unknown[]) => QueryChain;
  orderBy: (...args: unknown[]) => QueryChain;
  limit: (...args: unknown[]) => QueryChain;
  values: (value: unknown) => QueryChain;
  set: (value: unknown) => QueryChain;
  onConflictDoNothing: (...args: unknown[]) => QueryChain;
  returning: (...args: unknown[]) => QueryChain;
};

type DbLike = {
  select: (...args: unknown[]) => QueryChain;
  insert: (...args: unknown[]) => QueryChain;
  update: (...args: unknown[]) => QueryChain;
};

type ThreadActionRow = {
  id: string;
  companyId: string;
  threadId: string;
  runId: string | null;
  agentId: string | null;
  actionType: string;
  status: string;
  payload: unknown;
  idempotencyKey: string;
  freshness: ThreadFreshnessSnapshot;
};

export type ProposeThreadActionInput = {
  companyId: string;
  threadId: string;
  runId?: string | null;
  agentId?: string | null;
  actionType: ThreadAgentActionType;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  freshness?: Record<string, unknown>;
};

export type CommitThreadAgentActionsInput = {
  companyId: string;
  threadId: string;
  runId: string;
};

export type CommitThreadAgentActionsResult = {
  committed: number;
  suppressed: number;
  blocked: number;
  failed: number;
};

type DiscussionCommitService = {
  addEntry: (
    companyId: string,
    discussionId: string,
    data: {
      inputType: string;
      rawContent: string;
      parentEntryId?: string | null;
      authorAgentId?: string | null;
    },
    actorId: string,
  ) => Promise<{ id: string }>;
};

type ScopeVersionCommitService = {
  createDraftFromThread: (
    companyId: string,
    threadId: string,
    actor: { userId?: string; agentId?: string; isHuman?: boolean },
    input: {
      summary?: string;
      assumptions?: unknown[];
      decisions?: unknown[];
      openQuestions?: unknown[];
    },
  ) => Promise<{ status: string; version?: { id: string } }>;
};

type ArtifactCommitService = {
  create: (
    companyId: string,
    actorId: string,
    input: {
      title: string;
      type: string;
      source: string;
      content?: string | null;
      fileUrl?: string | null;
    },
  ) => Promise<{ id: string; versions?: Array<{ id: string }> }>;
};

type ThreadCommitService = {
  advancePhase: (
    companyId: string,
    threadId: string,
    toPhase: string,
    actor: { userId: string; role: "team_member"; isHuman: false },
  ) => Promise<unknown>;
};

type ThreadAgentActionDeps = {
  compareFreshnessSnapshot?: (
    db: DbLike,
    threadId: string,
    snapshot: ThreadFreshnessSnapshot,
  ) => Promise<ThreadFreshnessComparison>;
  discussions?: DiscussionCommitService;
  scopeVersions?: ScopeVersionCommitService;
  artifacts?: ArtifactCommitService;
  threads?: ThreadCommitService;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function isThreadPhase(value: unknown): value is ThreadPhase {
  return value === "discuss" || value === "scope" || value === "assign" || value === "done";
}

async function updateActionStatus(
  db: DbLike,
  actionId: string,
  values: {
    status: ThreadAgentActionStatus;
    blockedReason?: string | null;
    committedEntryId?: string | null;
    committedScopeVersionId?: string | null;
    committedScopeItemId?: string | null;
  },
) {
  const [updated] = await db
    .update(threadAgentActions)
    .set({
      ...values,
      committedAt: values.status === "committed" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(threadAgentActions.id, actionId))
    .returning();
  return updated;
}

export function threadAgentActionService(db: Db | DbLike, deps: ThreadAgentActionDeps = {}) {
  const actionDb = db as unknown as DbLike;
  const discussionCommitter =
    deps.discussions ?? discussionService(db as unknown as Db);
  const scopeVersionCommitter =
    deps.scopeVersions ?? threadScopeVersionService(db as unknown as Db);
  const artifactCommitter =
    deps.artifacts ?? artifactService(db as unknown as Db);
  const threadCommitter =
    deps.threads ?? threadService(db as unknown as Db);
  const compare = deps.compareFreshnessSnapshot ?? compareFreshnessSnapshot;

  return {
    proposeThreadAction: async (input: ProposeThreadActionInput) => {
      const [thread] = await actionDb
        .select({ id: discussions.id })
        .from(discussions)
        .where(and(eq(discussions.id, input.threadId), eq(discussions.companyId, input.companyId)))
        .limit(1);

      if (!thread) {
        throw new Error("Thread not found");
      }

      const [existing] = await actionDb
        .select()
        .from(threadAgentActions)
        .where(
          and(
            eq(threadAgentActions.companyId, input.companyId),
            eq(threadAgentActions.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) return existing;

      const [inserted] = await actionDb
        .insert(threadAgentActions)
        .values({
          companyId: input.companyId,
          threadId: input.threadId,
          runId: input.runId ?? null,
          agentId: input.agentId ?? null,
          actionType: input.actionType,
          status: "proposed",
          payload: input.payload ?? {},
          idempotencyKey: input.idempotencyKey,
          freshness: input.freshness ?? {},
        })
        .returning();

      return inserted;
    },

    commitThreadAgentActions: async (
      input: CommitThreadAgentActionsInput,
    ): Promise<CommitThreadAgentActionsResult> => {
      const result: CommitThreadAgentActionsResult = {
        committed: 0,
        suppressed: 0,
        blocked: 0,
        failed: 0,
      };

      const actions = await actionDb
        .select()
        .from(threadAgentActions)
        .where(
          and(
            eq(threadAgentActions.companyId, input.companyId),
            eq(threadAgentActions.threadId, input.threadId),
            eq(threadAgentActions.runId, input.runId),
            eq(threadAgentActions.status, "proposed"),
          ),
        )
        .orderBy(asc(threadAgentActions.createdAt)) as ThreadActionRow[];

      const freshActions: ThreadActionRow[] = [];
      for (const action of actions) {
        const freshness = await compare(actionDb, input.threadId, action.freshness);
        if (!freshness.fresh) {
          await updateActionStatus(actionDb, action.id, {
            status: "suppressed_stale",
            blockedReason: freshness.reason,
          });
          result.suppressed += 1;
          continue;
        }
        freshActions.push(action);
      }

      const sameRunArtifacts: Array<{ artifactId: string; attachedEntryId: string | null }> = [];
      let sameRunReplyEntryId: string | null = null;
      const attachArtifactToEntry = async (artifactId: string, entryId: string) => {
        await actionDb
          .insert(discussionEntryAttachments)
          .values({
            discussionEntryId: entryId,
            artifactId,
          })
          .returning();
      };

      for (const action of freshActions) {
        try {
          // NOTE: the "committing" status only de-duplicates within a single
          // commitThreadAgentActions invocation (the action query above selects
          // status="proposed" only). It does NOT prevent duplicate side effects on
          // the cross-run retry path (orchestration re-proposes with a fresh runId →
          // new idempotencyKey). Real retry-safety is a tracked follow-up: wrap each
          // action body in db.transaction(), make idempotencyKey stable, add a reaper
          // for stale "committing" rows.
          await updateActionStatus(actionDb, action.id, {
            status: "committing",
          });

          if (action.actionType === "post_reply") {
            const payload = asRecord(action.payload);
            const rawContent = asString(payload.rawContent);
            if (!rawContent || !action.agentId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_post_reply_payload",
              });
              result.blocked += 1;
              continue;
            }

            const entry = await discussionCommitter.addEntry(
              input.companyId,
              input.threadId,
              {
                inputType: "agent",
                rawContent,
                parentEntryId: asString(payload.parentEntryId) ?? null,
                authorAgentId: action.agentId,
              },
              `agent:${action.agentId}`,
            );
            sameRunReplyEntryId = entry.id;
            for (const artifactRef of sameRunArtifacts) {
              if (artifactRef.attachedEntryId) continue;
              await attachArtifactToEntry(artifactRef.artifactId, entry.id);
              artifactRef.attachedEntryId = entry.id;
            }
            await updateActionStatus(actionDb, action.id, {
              status: "committed",
              committedEntryId: entry.id,
            });
            result.committed += 1;
            continue;
          }

          if (action.actionType === "create_scope_draft") {
            const payload = asRecord(action.payload);
            const draft = await scopeVersionCommitter.createDraftFromThread(
              input.companyId,
              input.threadId,
              { agentId: action.agentId ?? undefined, isHuman: false },
              {
                summary: asString(payload.summary),
                assumptions: asArray(payload.assumptions),
                decisions: asArray(payload.decisions),
                openQuestions: asArray(payload.openQuestions),
              },
            );
            await updateActionStatus(actionDb, action.id, {
              status: "committed",
              committedScopeVersionId: draft.version?.id ?? null,
            });
            result.committed += 1;
            continue;
          }

          if (action.actionType === "add_scope_item") {
            const payload = asRecord(action.payload);
            const kind = asString(payload.kind);
            const title = asString(payload.title);
            if (!kind || !title) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_scope_item_payload",
              });
              result.blocked += 1;
              continue;
            }

            const draft = await scopeVersionCommitter.createDraftFromThread(
              input.companyId,
              input.threadId,
              { agentId: action.agentId ?? undefined, isHuman: false },
              {},
            );
            const scopeVersionId = draft.version?.id;
            if (!scopeVersionId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "scope_draft_unavailable",
              });
              result.blocked += 1;
              continue;
            }

            const [item] = await actionDb
              .insert(threadScopeItems)
              .values({
                companyId: input.companyId,
                scopeVersionId,
                kind,
                status: "draft",
                title,
                description: asString(payload.content) ?? asString(payload.description) ?? null,
                payload,
                sourceEntryIds: asArray(payload.sourceEntryIds) ?? [],
              })
              .returning();

            await updateActionStatus(actionDb, action.id, {
              status: "committed",
              committedScopeVersionId: scopeVersionId,
              committedScopeItemId: (item as { id?: string } | undefined)?.id ?? null,
            });
            result.committed += 1;
            continue;
          }

          if (action.actionType === "convene_agent") {
            const payload = asRecord(action.payload);
            const targetAgentId = asString(payload.targetAgentId);
            if (!targetAgentId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_convene_agent_payload",
              });
              result.blocked += 1;
              continue;
            }

            const [targetAgent] = await actionDb
              .select({ id: agents.id, companyId: agents.companyId })
              .from(agents)
              .where(eq(agents.id, targetAgentId))
              .limit(1) as Array<{ id: string; companyId: string }>;

            if (!targetAgent || targetAgent.companyId !== input.companyId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "target_agent_not_in_company",
              });
              result.blocked += 1;
              continue;
            }

            const context = asRecord(payload.context);
            const reason = asString(payload.reason) ?? "agent_dispatch";
            const dedupKey = `${targetAgentId}:${input.threadId}:queued`;
            await actionDb
              .insert(agentWakeupRequests)
              .values({
                companyId: input.companyId,
                agentId: targetAgentId,
                source: "agent.dispatch",
                reason,
                payload: context,
                dedupKey,
                status: "queued",
              })
              .onConflictDoNothing()
              .returning();

            await updateActionStatus(actionDb, action.id, {
              status: "committed",
            });
            result.committed += 1;
            continue;
          }

          if (action.actionType === "create_artifact_candidate") {
            const payload = asRecord(action.payload);
            const title = asString(payload.title);
            if (!title || !action.agentId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_artifact_candidate_payload",
              });
              result.blocked += 1;
              continue;
            }

            const artifact = await artifactCommitter.create(
              input.companyId,
              action.agentId,
              {
                title,
                type: asString(payload.artifactType) ?? "document",
                source: "agent",
                content: asString(payload.content) ?? null,
                fileUrl: asString(payload.fileRef) ?? null,
              },
            );
            const artifactVersionId = artifact.versions?.[0]?.id ?? null;
            const explicitEntryId = asString(payload.attachToEntryId);

            const draft = await scopeVersionCommitter.createDraftFromThread(
              input.companyId,
              input.threadId,
              { agentId: action.agentId, isHuman: false },
              {},
            );
            const scopeVersionId = draft.version?.id;
            if (!scopeVersionId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "scope_draft_unavailable",
              });
              result.blocked += 1;
              continue;
            }

            const [item] = await actionDb
              .insert(threadScopeItems)
              .values({
                companyId: input.companyId,
                scopeVersionId,
                kind: "artifact_link",
                status: "draft",
                title,
                description: "Artifact candidate created by agent",
                artifactId: artifact.id,
                artifactVersionId,
                payload: {
                  ...payload,
                  artifactId: artifact.id,
                  artifactVersionId,
                  role: "reference",
                },
                sourceEntryIds: explicitEntryId ? [explicitEntryId] : [],
              })
              .returning();

            if (explicitEntryId) {
              await attachArtifactToEntry(artifact.id, explicitEntryId);
            } else if (sameRunReplyEntryId) {
              await attachArtifactToEntry(artifact.id, sameRunReplyEntryId);
            } else {
              sameRunArtifacts.push({ artifactId: artifact.id, attachedEntryId: null });
            }

            await updateActionStatus(actionDb, action.id, {
              status: "committed",
              committedScopeVersionId: scopeVersionId,
              committedScopeItemId: (item as { id?: string } | undefined)?.id ?? null,
            });
            result.committed += 1;
            continue;
          }

          if (action.actionType === "advance_phase") {
            const payload = asRecord(action.payload);
            const toPhase = asString(payload.toPhase);
            const effectiveAutonomy =
              typeof payload.effectiveAutonomy === "number" ? payload.effectiveAutonomy : 0;
            if (!isThreadPhase(toPhase)) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_advance_phase_payload",
              });
              result.blocked += 1;
              continue;
            }
            if (effectiveAutonomy < 2) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "autonomy_insufficient",
              });
              result.blocked += 1;
              continue;
            }

            await threadCommitter.advancePhase(
              input.companyId,
              input.threadId,
              toPhase,
              {
                userId: action.agentId ?? "aoa-agent",
                role: "team_member",
                isHuman: false,
              },
            );

            await updateActionStatus(actionDb, action.id, {
              status: "committed",
            });
            result.committed += 1;
            continue;
          }

          await updateActionStatus(actionDb, action.id, {
            status: "blocked_policy",
            blockedReason: `unsupported_action:${action.actionType}`,
          });
          result.blocked += 1;
        } catch (error) {
          await updateActionStatus(actionDb, action.id, {
            status: "failed",
            blockedReason: error instanceof Error ? error.message : "commit_failed",
          });
          result.failed += 1;
        }
      }

      return result;
    },
  };
}
