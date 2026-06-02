import { and, eq, desc, sql, inArray, asc } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  discussions,
  discussionEntries,
  discussionExtractedItems,
  discussionAnnotations,
  discussionEntryAttachments,
  artifacts,
  agents,
  projects,
  goals,
  threadPlanSteps,
  threadParticipants,
  authUsers,
} from "@armyofagents/db";
import { badRequest, notFound } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { publishLiveEvent } from "./live-events.js";
import { issueService } from "./issues.js";
import { memoryService } from "./memory.js";
import { getThreadEventListener } from "./thread-events.js";
import { threadOrchestrationService } from "./thread-orchestration.js";
// parseMentions is a pure regex helper (no DB). threads.ts is already in the
// module graph via live-events.ts → threads.ts, so this static import adds no
// new load-time cost or cycle (discussions → threads is one-directional;
// threads.ts does not import discussions.ts).
import { parseMentions } from "./threads.js";
// NOTE: workspace-ttl-sweeper is imported dynamically in `update()` to keep
// the top-level import graph free of execution-workspaces → git → child_process.
// Several test suites (notably cli-mode.test.ts) partially mock node:child_process
// and the eager import causes their indirect resolution chain to fail.

export interface DiscussionFilters {
  status?: string;
  scopeType?: string;
  scopeId?: string;
  hasPendingItems?: boolean;
  inputType?: string;
}

/**
 * Validate that scopeId references the correct table based on scopeType.
 * Gotcha 1.1: Polymorphic scope — Drizzle/PostgreSQL can't enforce polymorphic FKs.
 */
async function validateScope(
  db: Db,
  scopeType: string | null | undefined,
  scopeId: string | null | undefined,
) {
  if (!scopeType && !scopeId) return;
  if (scopeType && !scopeId) {
    throw badRequest("scopeId is required when scopeType is set");
  }
  if (!scopeType && scopeId) {
    throw badRequest("scopeType is required when scopeId is set");
  }

  if (scopeType === "department" || scopeType === "project") {
    const row = await db
      .select({ id: projects.id, type: projects.type })
      .from(projects)
      .where(eq(projects.id, scopeId!))
      .then((rows) => rows[0] ?? null);
    if (!row) {
      throw badRequest(`${scopeType} with id '${scopeId}' not found`);
    }
    if (scopeType === "department" && row.type !== "department") {
      throw badRequest(`Scope references a project, not a department`);
    }
    if (scopeType === "project" && row.type !== "project") {
      throw badRequest(`Scope references a department, not a project`);
    }
  } else if (scopeType === "goal") {
    const row = await db
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.id, scopeId!))
      .then((rows) => rows[0] ?? null);
    if (!row) {
      throw badRequest(`Goal with id '${scopeId}' not found`);
    }
  } else {
    throw badRequest(`Invalid scopeType '${scopeType}'`);
  }
}

function isMemoryType(
  type: string,
): type is "decision" | "insight" | "context" | "reference" | "preference" {
  return ["decision", "insight", "context", "reference", "preference"].includes(
    type,
  );
}

/**
 * Minimal entry shape consumed by `emitEntryCreatedSideEffects`. Mirrors the
 * fields read off a freshly-inserted `discussion_entries` row — both `addEntry`'s
 * `entry` and `create()`'s `result.entry` satisfy this.
 */
interface EmittableEntry {
  id: string;
  discussionId: string;
  authorAgentId: string | null;
  inputType: string;
  createdBy: string;
  seq: number;
  rawContent: string;
}

/**
 * Post-entry side effects shared by `addEntry` and `create()` (live-QA BUG-1).
 *
 * After a discussion entry is committed, both the add-entry path AND the
 * create-with-first-entry path must:
 *   1. publish the thread-scoped `thread.entry.created` poke (Plan 7) so live
 *      thread viewers refetch (RBAC-scoped fan-out keyed by `threadId`); and
 *   2. resolve whether the entry directly @mentions a kind='aoa' crew agent
 *      (Task 1.3 de-dup), then notify the thread-event listener's
 *      `onEntryCreated` so it can arm the 30s human-silence Adjutant debounce
 *      (skipping when `hasCrewMention` — the mentioned agent answers directly).
 *
 * Extracted DRY from `addEntry` so `create()` arms proactive crew engagement on
 * the FIRST message of a thread. Behavior-preserving for `addEntry`: same calls,
 * same order. The crew lookup runs only when `rawContent` actually contains an
 * @mention (no extra round-trip for plain chatter). Fire-and-forget: the
 * `onEntryCreated` promise is not awaited and its rejection is swallowed so the
 * caller's happy path is never blocked by listener failures.
 *
 * NOTE: the legacy company-scoped `discussion.entry.created` publish is NOT part
 * of this helper — both callers publish it inline (before invoking this helper)
 * so existing consumers of that event are unaffected and no double-publish occurs.
 */
async function emitEntryCreatedSideEffects(
  db: Db,
  companyId: string,
  entry: EmittableEntry,
): Promise<void> {
  // Plan 7: thread-scoped poke for the live thread view. Carries threadId so
  // the WS envelope-RBAC fan-out only delivers it to viewers who can see the
  // thread. The frontend refetches the thread (refetch-on-poke) using seq.
  publishLiveEvent({
    companyId,
    type: "thread.entry.created",
    payload: {
      threadId: entry.discussionId,
      entryId: entry.id,
      seq: entry.seq,
    },
  });

  // Task 1.3 — de-dup the double-drive. Resolve whether this entry directly
  // @mentions a kind='aoa' crew agent BEFORE notifying the listener. If it
  // does, that agent answers directly via the controller participation path
  // (processMentions → requestParticipation, Task 1.2), so the proactive
  // Adjutant debounce must NOT also arm on the same entry. We stamp
  // `hasCrewMention` onto the event and let onEntryCreated skip arming when
  // true. The lookup is a single lightweight `name IN (...)` query and only
  // runs when the text actually contains an @mention (no extra round-trip
  // for the common case of plain chatter).
  let hasCrewMention = false;
  const mentionNames = parseMentions(entry.rawContent).map((m) => m.name);
  if (mentionNames.length > 0) {
    const crewRows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.kind, "aoa"),
          inArray(agents.name, mentionNames),
        ),
      )
      .limit(1);
    hasCrewMention = crewRows.length > 0;
  }

  // Task B2: notify the thread-event listener so it can debounce and wake
  // Adjutant 30s after the last *human* entry. The listener filters out
  // agent/system/scope_proposal entries internally — we pass everything and
  // let it decide. Fire-and-forget: any failure inside the listener is its
  // own concern (logged there) and must not block the caller's response.
  // getThreadEventListener() returns null in test/bootstrap contexts where
  // the singleton isn't initialized — that's expected, treat as no-op.
  const threadListener = getThreadEventListener();
  if (threadListener) {
    void threadListener
      .onEntryCreated({
        id: entry.id,
        discussionId: entry.discussionId,
        authorAgentId: entry.authorAgentId,
        inputType: entry.inputType,
        createdBy: entry.createdBy,
        hasCrewMention,
      })
      .catch(() => {
        // Listener already logs its own errors; we swallow here so the
        // caller's happy path is unaffected by listener failures.
      });
  }
}

export function discussionService(db: Db) {
  const issues = issueService(db);
  const memory = memoryService(db);

  return {
    /**
     * List discussions with optional filters.
     */
    list: async (companyId: string, filters: DiscussionFilters = {}) => {
      const conditions = [eq(discussions.companyId, companyId)];

      if (filters.status) {
        conditions.push(eq(discussions.status, filters.status));
      }
      if (filters.scopeType) {
        conditions.push(eq(discussions.scopeType, filters.scopeType));
      }
      if (filters.scopeId) {
        conditions.push(eq(discussions.scopeId, filters.scopeId));
      }
      if (filters.hasPendingItems === true) {
        conditions.push(sql`${discussions.pendingItemCount} > 0`);
      }
      if (filters.hasPendingItems === false) {
        conditions.push(sql`${discussions.pendingItemCount} = 0`);
      }

      // If inputType filter is set, join with entries to filter
      if (filters.inputType) {
        const rows = await db
          .selectDistinctOn([discussions.id])
          .from(discussions)
          .innerJoin(
            discussionEntries,
            eq(discussions.id, discussionEntries.discussionId),
          )
          .where(
            and(
              ...conditions,
              eq(discussionEntries.inputType, filters.inputType),
            ),
          )
          .orderBy(discussions.id, desc(discussions.lastEntryAt));

        return rows.map((r) => r.discussions);
      }

      return db
        .select()
        .from(discussions)
        .where(and(...conditions))
        .orderBy(desc(discussions.lastEntryAt));
    },

    /**
     * Get a discussion by ID with entries and extracted items.
     */
    getById: async (companyId: string, id: string) => {
      const discussion = await db
        .select()
        .from(discussions)
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!discussion) return null;

      const entryRows = await db
        .select({
          entry: discussionEntries,
          authorAgentName: agents.name,
          authorAgentAvatar: agents.icon,
        })
        .from(discussionEntries)
        .leftJoin(agents, eq(discussionEntries.authorAgentId, agents.id))
        .where(eq(discussionEntries.discussionId, id))
        .orderBy(discussionEntries.createdAt);

      const entries = entryRows.map((r: { entry: typeof discussionEntries.$inferSelect; authorAgentName: string | null; authorAgentAvatar: string | null }) => ({
        ...r.entry,
        authorAgentName: r.authorAgentName ?? null,
        authorAgentAvatar: r.authorAgentAvatar ?? null,
      }));

      const entryIds = entries.map((e) => e.id);

      let items: (typeof discussionExtractedItems.$inferSelect)[] = [];
      let annotations: (typeof discussionAnnotations.$inferSelect)[] = [];
      // Phase E2: attachments joined via artifacts so the FE can render
      // inline artifact cards (title + type) without a second round-trip.
      let attachmentRows: Array<{
        id: string;
        discussionEntryId: string;
        assetId: string | null;
        artifactId: string | null;
        artifactType: string | null;
        artifactTitle: string | null;
      }> = [];

      if (entryIds.length > 0) {
        items = await db
          .select()
          .from(discussionExtractedItems)
          .where(inArray(discussionExtractedItems.discussionEntryId, entryIds));

        annotations = await db
          .select()
          .from(discussionAnnotations)
          .where(inArray(discussionAnnotations.discussionEntryId, entryIds));

        attachmentRows = await db
          .select({
            id: discussionEntryAttachments.id,
            discussionEntryId: discussionEntryAttachments.discussionEntryId,
            assetId: discussionEntryAttachments.assetId,
            artifactId: discussionEntryAttachments.artifactId,
            artifactType: artifacts.type,
            artifactTitle: artifacts.title,
          })
          .from(discussionEntryAttachments)
          .leftJoin(artifacts, eq(discussionEntryAttachments.artifactId, artifacts.id))
          .where(inArray(discussionEntryAttachments.discussionEntryId, entryIds));
      }

      // Group items and annotations by entry for the frontend
      const itemsByEntry = new Map<string, typeof items>();
      for (const item of items) {
        const list = itemsByEntry.get(item.discussionEntryId) ?? [];
        list.push(item);
        itemsByEntry.set(item.discussionEntryId, list);
      }

      const annotationsByEntry = new Map<string, typeof annotations>();
      for (const ann of annotations) {
        const list = annotationsByEntry.get(ann.discussionEntryId) ?? [];
        list.push(ann);
        annotationsByEntry.set(ann.discussionEntryId, list);
      }

      const attachmentsByEntry = new Map<string, typeof attachmentRows>();
      for (const att of attachmentRows) {
        const list = attachmentsByEntry.get(att.discussionEntryId) ?? [];
        list.push(att);
        attachmentsByEntry.set(att.discussionEntryId, list);
      }

      const enrichedEntries = entries.map((e) => ({
        ...e,
        extractedItems: itemsByEntry.get(e.id) ?? [],
        annotations: annotationsByEntry.get(e.id) ?? [],
        attachments: (attachmentsByEntry.get(e.id) ?? []).map((a) => ({
          id: a.id,
          assetId: a.assetId,
          artifactId: a.artifactId,
          artifactType: a.artifactType,
          artifactTitle: a.artifactTitle,
        })),
      }));

      const planSteps = await db
        .select()
        .from(threadPlanSteps)
        .where(eq(threadPlanSteps.threadId, id))
        .orderBy(asc(threadPlanSteps.stepOrder))
        .then((rows: typeof threadPlanSteps.$inferSelect[]) => rows);

      // Phase 1 Phase E batch 2 (T22): static roster of thread_participants
      // with name resolution. principalType branches to authUsers (text id) or
      // agents (uuid stored as text). Both joins are LEFT so a stale row with
      // a deleted principal still surfaces with a fallback name.
      const participantRows = await db
        .select({
          principalType: threadParticipants.principalType,
          principalId: threadParticipants.principalId,
          role: threadParticipants.role,
          addedAt: threadParticipants.addedAt,
          userName: authUsers.name,
          userEmail: authUsers.email,
          agentName: agents.name,
        })
        .from(threadParticipants)
        .leftJoin(authUsers, eq(threadParticipants.principalId, authUsers.id))
        .leftJoin(agents, eq(threadParticipants.principalId, sql`${agents.id}::text`))
        .where(eq(threadParticipants.threadId, id))
        .orderBy(asc(threadParticipants.addedAt));

      const participants = participantRows.map((p) => {
        const fallback =
          p.principalType === "agent"
            ? p.agentName ?? "Agent"
            : p.userName ?? (p.userEmail ? p.userEmail.split("@")[0] : p.principalId);
        return {
          principalType: p.principalType as "user" | "agent",
          principalId: p.principalId,
          name: fallback,
          role: p.role,
          addedAt:
            p.addedAt instanceof Date
              ? p.addedAt.toISOString()
              : (p.addedAt as unknown as string),
        };
      });

      return { ...discussion, entries: enrichedEntries, planSteps, participants };
    },

    /**
     * Create a new discussion, optionally with a first entry.
     * Gotcha 1.1: validates scope if provided.
     * Gotcha 1.2: increments denormalized counts in same transaction.
     */
    create: async (
      companyId: string,
      data: {
        title?: string | null;
        scopeType?: string | null;
        scopeId?: string | null;
        tags?: string[];
        entry?: {
          inputType: string;
          rawContent: string;
          title?: string | null;
          departmentId?: string | null;
          projectId?: string | null;
          goalId?: string | null;
          sourceInfo?: Record<string, unknown> | null;
        };
      },
      actorId: string,
    ) => {
      await validateScope(db, data.scopeType, data.scopeId);

      const now = new Date();
      const hasEntry = !!data.entry;

      // Wrap in transaction to keep discussion + entry atomic (Gotcha 1.2)
      const result = await db.transaction(async (tx) => {
        const [discussion] = await tx
          .insert(discussions)
          .values({
            companyId,
            title: data.title ?? null,
            scopeType: data.scopeType ?? null,
            scopeId: data.scopeId ?? null,
            tags: data.tags ?? [],
            entryCount: hasEntry ? 1 : 0,
            lastEntryAt: hasEntry ? now : null,
            createdBy: actorId,
            useControllerPath: true,   // P1-T11: new threads use orchestration controller path
          })
          .returning();

        let entry: typeof discussionEntries.$inferSelect | null = null;

        if (data.entry) {
          [entry] = await tx
            .insert(discussionEntries)
            .values({
              discussionId: discussion.id,
              inputType: data.entry.inputType,
              rawContent: data.entry.rawContent,
              title: data.entry.title ?? null,
              departmentId: data.entry.departmentId ?? null,
              projectId: data.entry.projectId ?? null,
              goalId: data.entry.goalId ?? null,
              sourceInfo: data.entry.sourceInfo ?? null,
              // QA-BUG-015: see addEntry — discuss-phase entries are not
              // auto-extracted; extraction is a deliberate done-phase /
              // Adjutant-judgment activity.
              extractionStatus: "skipped",
              createdBy: actorId,
            })
            .returning();
        }

        return { ...discussion, entry };
      });

      // P1-T3: ensure a thread orchestration controller row exists for every
      // newly created thread. Best-effort — failure must not block thread
      // creation. The ensureController call uses onConflictDoNothing so it is
      // always safe to call; any error here is a monitoring concern only.
      void threadOrchestrationService(db)
        .ensureController(result.id)
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(
            "[discussions.create] ensureController failed — thread created without controller",
            { threadId: result.id, err },
          );
        });

      // Side effects outside transaction
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.created",
        entityType: "discussion",
        entityId: result.id,
        details: { title: result.title, hasEntry },
      });

      if (data.entry && result.entry) {
        publishLiveEvent({
          companyId,
          type: "discussion.entry.created",
          payload: {
            discussionId: result.id,
            entryId: result.entry.id,
            inputType: data.entry.inputType,
          },
        });

        // Live-QA BUG-1: a thread opened WITH a first message must arm proactive
        // crew engagement (and resolve @mentions) exactly like a follow-up entry
        // does. Run the same post-entry side effects addEntry runs — the
        // thread-scoped poke + crew-mention resolution + onEntryCreated debounce
        // arm. Without this the first message never wakes the Adjutant (until a
        // 2nd message) and an @mention in it is dropped. result.entry carries
        // rawContent + seq off the inserted row.
        await emitEntryCreatedSideEffects(db, companyId, {
          id: result.entry.id,
          discussionId: result.id,
          authorAgentId: result.entry.authorAgentId,
          inputType: result.entry.inputType,
          createdBy: result.entry.createdBy,
          seq: result.entry.seq,
          rawContent: result.entry.rawContent,
        });
      }

      return result;
    },

    /**
     * Update a discussion's title, status, scope, or tags.
     * Validates scope if changed. Follows goals.ts update pattern.
     */
    update: async (
      companyId: string,
      id: string,
      data: {
        title?: string | null;
        status?: string;
        scopeType?: string | null;
        scopeId?: string | null;
        tags?: string[];
        autonomyLevel?: number | null;
        // Phase 1 Phase E batch 2 (T22): visibility patch from OriginCard's
        // 3-option dropdown (private | department | company).
        visibility?: "private" | "department" | "company";
        // Phase G3 (T5, D6): per-thread Memory Keeper opt-out. Default true.
        allowMemoryExtraction?: boolean;
      },
    ) => {
      // Validate scope if being changed
      if (data.scopeType !== undefined || data.scopeId !== undefined) {
        // Need to merge with existing values for validation
        const existing = await db
          .select({
            scopeType: discussions.scopeType,
            scopeId: discussions.scopeId,
          })
          .from(discussions)
          .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!existing) {
          throw notFound("Discussion not found");
        }

        const newScopeType = data.scopeType !== undefined ? data.scopeType : existing.scopeType;
        const newScopeId = data.scopeId !== undefined ? data.scopeId : existing.scopeId;
        await validateScope(db, newScopeType, newScopeId);
      }

      const [updated] = await db
        .update(discussions)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .returning();

      // Phase G1 (T7/D8): if this update archived the thread, mark any
      // thread-scoped workspaces eligible for cleanup immediately. The
      // generic PATCH /discussions/:id endpoint is the primary archive path
      // (merge has its own hook in threads.ts:merge). Best-effort —
      // workspace cleanup must never block the discussion update. Dynamic
      // import avoids the execution-workspaces → git → child_process chain
      // at module load time (see note above).
      if (updated && data.status === "archived") {
        try {
          const { markThreadWorkspacesForCleanup } = await import(
            "./workspace-ttl-sweeper.js"
          );
          await markThreadWorkspacesForCleanup(db, id);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            "[discussions.update] markThreadWorkspacesForCleanup failed",
            { id, err },
          );
        }

        // P3-T1: capture the closing thread's durable knowledge as Memory Keeper
        // proposals (founder-gated, status: pending) before it goes dormant.
        // Best-effort + idempotent — separate try/catch so a failure here never
        // blocks the archive or the workspace-cleanup hook above. Dynamic import
        // keeps the dispatcher/agent subtree off the discussions module-load path.
        try {
          const { enqueueMemoryExtractionOnClose } = await import(
            "./internal-agent/aoa-agents/memory-extraction-on-close.js"
          );
          await enqueueMemoryExtractionOnClose(db, companyId, id);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            "[discussions.update] enqueueMemoryExtractionOnClose failed",
            { id, err },
          );
        }
      }

      return updated ?? null;
    },

    /**
     * Add an entry to an existing discussion.
     * Entry is created with extractionStatus='pending'. The durable extraction sweeper
     * (server/src/index.ts, 45 s tick, M2 atomic claim) picks it up automatically.
     * "Reprocess" in the UI is a manual fast-path that bypasses the sweeper interval.
     * Updates lastEntryAt, publishes discussion.entry.created LiveEvent.
     * Gotcha 1.2: increments entryCount in same operation.
     */
    addEntry: async (
      companyId: string,
      discussionId: string,
      data: {
        inputType: string;
        rawContent: string;
        title?: string | null;
        departmentId?: string | null;
        projectId?: string | null;
        goalId?: string | null;
        sourceInfo?: Record<string, unknown> | null;
        parentEntryId?: string | null;
        authorAgentId?: string | null;
        attachments?: Array<{ assetId?: string | null; artifactId?: string | null }>;
      },
      actorId: string,
    ) => {
      if (data.authorAgentId && data.inputType !== "agent") {
        throw badRequest(
          "inputType must be 'agent' when authorAgentId is set",
        );
      }

      // Verify discussion exists and belongs to company
      const discussion = await db
        .select()
        .from(discussions)
        .where(
          and(
            eq(discussions.id, discussionId),
            eq(discussions.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!discussion) {
        throw notFound("Discussion not found");
      }

      if (data.parentEntryId) {
        const parent = await db
          .select({ id: discussionEntries.id })
          .from(discussionEntries)
          .where(
            and(
              eq(discussionEntries.id, data.parentEntryId),
              eq(discussionEntries.discussionId, discussionId),
            ),
          )
          .then((rows) => rows[0] ?? null);
        if (!parent) {
          throw badRequest(
            "parentEntryId must reference an entry in the same discussion",
          );
        }
      }

      const now = new Date();

      // Plan 7 (D1): assign a per-thread monotonic seq for catch-up. We bump the
      // atomic discussions.entrySeq counter with UPDATE ... RETURNING (atomic per
      // row, so concurrent inserts serialize on the discussions row) instead of
      // max(seq)+1, which races. The counter bump also carries the denormalized
      // count update (Gotcha 1.2) so both land in one statement.
      const entry = await db.transaction(async (tx) => {
        const [{ entrySeq }] = await tx
          .update(discussions)
          .set({
            entrySeq: sql`${discussions.entrySeq} + 1`,
            entryCount: sql`${discussions.entryCount} + 1`,
            lastEntryAt: now,
            updatedAt: now,
          })
          .where(eq(discussions.id, discussionId))
          .returning({ entrySeq: discussions.entrySeq });

        const [inserted] = await tx
          .insert(discussionEntries)
          .values({
            discussionId,
            inputType: data.inputType,
            rawContent: data.rawContent,
            title: data.title ?? null,
            departmentId: data.departmentId ?? null,
            projectId: data.projectId ?? null,
            goalId: data.goalId ?? null,
            sourceInfo: data.sourceInfo ?? null,
            parentEntryId: data.parentEntryId ?? null,
            authorAgentId: data.authorAgentId ?? null,
            // QA-BUG-015: discuss-phase entries are NOT auto-extracted. Mark
            // 'skipped' so the (gated-off) durable drain never picks them up
            // and the UI doesn't show a misleading "pending extraction"
            // state. Extraction happens later, deliberately, via Memory
            // Keeper at phase=done or Adjutant's extract_memory_candidates.
            extractionStatus: "skipped",
            seq: entrySeq,
            createdBy: actorId,
          })
          .returning();

        // Phase E1: link attachments (assets or artifacts) to the entry in the
        // same transaction so the entry+attachments commit atomically.
        if (data.attachments && data.attachments.length > 0) {
          const rows = data.attachments
            .filter((a) => a.assetId || a.artifactId)
            .map((a) => ({
              discussionEntryId: inserted.id,
              assetId: a.assetId ?? null,
              artifactId: a.artifactId ?? null,
            }));
          if (rows.length > 0) {
            await tx.insert(discussionEntryAttachments).values(rows);
          }
        }

        return inserted;
      });

      publishLiveEvent({
        companyId,
        type: "discussion.entry.created",
        payload: {
          discussionId,
          entryId: entry.id,
          inputType: data.inputType,
        },
      });

      // Plan 7 + Task 1.3 + Task B2 — thread-scoped poke, crew-mention
      // resolution, and the proactive Adjutant debounce arm. DRY-extracted into
      // emitEntryCreatedSideEffects so create()'s first-entry path runs the
      // identical wiring (live-QA BUG-1). Behavior-preserving for addEntry:
      // same publish, same crew lookup, same fire-and-forget onEntryCreated.
      await emitEntryCreatedSideEffects(db, companyId, {
        id: entry.id,
        discussionId: entry.discussionId,
        authorAgentId: entry.authorAgentId,
        inputType: entry.inputType,
        createdBy: entry.createdBy,
        seq: entry.seq,
        rawContent: data.rawContent,
      });

      // Design §4.9 + §5 (locked): the `discuss` phase is a pure conversation
      // between humans and the crew (Adjutant facilitating, delegating to
      // Scout / Engineer / Navigator). Structured extraction is NOT a
      // fire-on-every-entry behaviour — "Scribe is ELIMINATED" and the
      // extraction logic now runs only as deliberate tool calls:
      //   - Memory Keeper at `phase=done` (extract_decisions / _insights /
      //     _references → propose_memory), the canonical path; and
      //   - Adjutant mid-`discuss` IF it judges something was decided, via
      //     extract_memory_candidates (its own call, not automatic).
      // The previous unconditional extractFromDiscussionEntry call here made
      // Scribe run on every message and dumped decision/task/insight cards
      // into the Scope tab while humans were still talking — premature and
      // against the design (QA-BUG-015). Removed. The thread-event listener
      // above still wakes Adjutant after the 30s human-silence debounce so
      // the conversation moves forward; extraction waits for the right phase.

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.entry.added",
        entityType: "discussion_entry",
        entityId: entry.id,
        details: { discussionId, inputType: data.inputType },
      });

      return entry;
    },

    /**
     * Approve extracted items — atomic transaction.
     * For task items: creates issue. For memory items: creates memoryItem.
     * Sets status='approved', links resultTaskId/resultMemoryId.
     * Decrements pendingItemCount.
     */
    approveItems: async (
      companyId: string,
      discussionId: string,
      itemIds: string[],
      actorId: string,
    ) => {
      if (itemIds.length === 0) {
        throw badRequest("No items to approve");
      }

      // Verify discussion exists
      const discussion = await db
        .select()
        .from(discussions)
        .where(
          and(
            eq(discussions.id, discussionId),
            eq(discussions.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!discussion) {
        throw notFound("Discussion not found");
      }

      const result = await db.transaction(async (tx) => {
        const itemRows = await tx
          .select()
          .from(discussionExtractedItems)
          .where(inArray(discussionExtractedItems.id, itemIds));

        if (itemRows.length !== itemIds.length) {
          throw badRequest("Some item IDs not found");
        }

        // Verify all items belong to entries in this discussion
        const entryIds = [...new Set(itemRows.map((i) => i.discussionEntryId))];
        const entries = await tx
          .select({ id: discussionEntries.id })
          .from(discussionEntries)
          .where(
            and(
              inArray(discussionEntries.id, entryIds),
              eq(discussionEntries.discussionId, discussionId),
            ),
          );

        if (entries.length !== entryIds.length) {
          throw badRequest(
            "Some items do not belong to this discussion",
          );
        }

        const createdTaskIds: string[] = [];
        const createdMemoryIds: string[] = [];
        let approvedCount = 0;

        for (const item of itemRows) {
          if (item.status === "approved") continue; // already approved

          if (item.type === "task") {
            const task = await issues.create(
              companyId,
              {
                title: item.title,
                description: item.description,
                priority: item.priority ?? item.suggestedPriority ?? "medium",
                source: "discussion",
                projectId:
                  item.suggestedDepartmentId ??
                  item.suggestedProjectId ??
                  undefined,
                goalId: item.suggestedGoalId ?? undefined,
                assigneeAgentId: item.suggestedAssigneeId ?? undefined,
                status: item.suggestedAssigneeId ? "todo" : "backlog",
              },
              tx,
            );

            if (task) {
              createdTaskIds.push(task.id);
              await tx
                .update(discussionExtractedItems)
                .set({
                  status: "approved",
                  resultTaskId: task.id,
                  updatedAt: new Date(),
                })
                .where(eq(discussionExtractedItems.id, item.id));
              approvedCount++;
            }
          } else if (isMemoryType(item.type)) {
            const layer = item.layer ?? item.suggestedLayer ?? "domain";
            const content = item.mergedContent?.trim() || item.description?.trim() || item.title;

            const memoryItem = await memory.create(
              companyId,
              {
                title: item.title,
                content,
                category: item.type,
                source: "discussion",
                status: "approved",
                departmentId: item.suggestedDepartmentId ?? null,
                projectId: item.suggestedProjectId ?? null,
                createdBy: actorId,
                layer,
                goalId: item.suggestedGoalId ?? null,
              },
              tx,
            );

            if (memoryItem) {
              createdMemoryIds.push(memoryItem.id);
              await tx
                .update(discussionExtractedItems)
                .set({
                  status: "approved",
                  resultMemoryId: memoryItem.id,
                  updatedAt: new Date(),
                })
                .where(eq(discussionExtractedItems.id, item.id));
              approvedCount++;
            }
          }
        }

        // Gotcha 1.2: decrement pendingItemCount
        if (approvedCount > 0) {
          await tx
            .update(discussions)
            .set({
              pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${approvedCount}, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(discussions.id, discussionId));
        }

        return { createdTaskIds, createdMemoryIds, approvedCount };
      });

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.items.approved",
        entityType: "discussion",
        entityId: discussionId,
        details: { approvedCount: result.approvedCount, createdTaskIds: result.createdTaskIds, createdMemoryIds: result.createdMemoryIds },
      });

      return result;
    },

    /**
     * Reject extracted items. Sets status='rejected', decrements pendingItemCount.
     */
    rejectItems: async (
      companyId: string,
      discussionId: string,
      itemIds: string[],
      actorId: string,
    ) => {
      if (itemIds.length === 0) {
        throw badRequest("No items to reject");
      }

      // Verify discussion
      const discussion = await db
        .select()
        .from(discussions)
        .where(
          and(
            eq(discussions.id, discussionId),
            eq(discussions.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!discussion) {
        throw notFound("Discussion not found");
      }

      // Verify items belong to this discussion
      const itemRows = await db
        .select({
          id: discussionExtractedItems.id,
          entryId: discussionExtractedItems.discussionEntryId,
        })
        .from(discussionExtractedItems)
        .where(inArray(discussionExtractedItems.id, itemIds));

      if (itemRows.length > 0) {
        const entryIds = [...new Set(itemRows.map((i) => i.entryId))];
        const entries = await db
          .select({ id: discussionEntries.id })
          .from(discussionEntries)
          .where(
            and(
              inArray(discussionEntries.id, entryIds),
              eq(discussionEntries.discussionId, discussionId),
            ),
          );
        if (entries.length !== entryIds.length) {
          throw badRequest("Some items do not belong to this discussion");
        }
      }

      const updated = await db
        .update(discussionExtractedItems)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(
          and(
            inArray(discussionExtractedItems.id, itemIds),
            eq(discussionExtractedItems.status, "pending"),
          ),
        )
        .returning();

      const rejectedCount = updated.length;

      if (rejectedCount > 0) {
        await db
          .update(discussions)
          .set({
            pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${rejectedCount}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(discussions.id, discussionId));
      }

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.items.rejected",
        entityType: "discussion",
        entityId: discussionId,
        details: { rejectedCount, itemIds },
      });

      return { rejectedCount };
    },

    /**
     * Update an extracted item's fields (founder edits during review).
     * Gotcha 1.4: sets status to 'edited' so it's included in "Confirm All".
     */
    updateItem: async (
      companyId: string,
      itemId: string,
      data: Partial<
        Pick<
          typeof discussionExtractedItems.$inferInsert,
          | "title"
          | "description"
          | "type"
          | "priority"
          | "layer"
          | "dedupAction"
          | "selectedMemoryId"
          | "mergedContent"
          | "suggestedAssigneeId"
          | "suggestedDepartmentId"
          | "suggestedProjectId"
          | "suggestedGoalId"
        >
      >,
    ) => {
      // Verify item exists and belongs to company's discussion
      const item = await db
        .select({
          id: discussionExtractedItems.id,
          discussionEntryId: discussionExtractedItems.discussionEntryId,
        })
        .from(discussionExtractedItems)
        .where(eq(discussionExtractedItems.id, itemId))
        .then((rows) => rows[0] ?? null);

      if (!item) {
        throw notFound("Extracted item not found");
      }

      // Verify entry's discussion belongs to this company
      const entry = await db
        .select({ discussionId: discussionEntries.discussionId })
        .from(discussionEntries)
        .where(eq(discussionEntries.id, item.discussionEntryId))
        .then((rows) => rows[0] ?? null);

      if (entry) {
        const disc = await db
          .select({ companyId: discussions.companyId })
          .from(discussions)
          .where(eq(discussions.id, entry.discussionId))
          .then((rows) => rows[0] ?? null);

        if (!disc || disc.companyId !== companyId) {
          throw notFound("Extracted item not found");
        }
      }

      // Gotcha 1.4: editing sets status to 'edited'
      const [updated] = await db
        .update(discussionExtractedItems)
        .set({ ...data, status: "edited", updatedAt: new Date() })
        .where(eq(discussionExtractedItems.id, itemId))
        .returning();

      return updated;
    },

    /**
     * Reprocess an entry: reset extraction status, delete extracted items, trigger re-extraction.
     */
    reprocessEntry: async (companyId: string, entryId: string) => {
      // Verify entry belongs to company
      const entry = await db
        .select()
        .from(discussionEntries)
        .where(eq(discussionEntries.id, entryId))
        .then((rows) => rows[0] ?? null);

      if (!entry) {
        throw notFound("Entry not found");
      }

      const disc = await db
        .select({ companyId: discussions.companyId })
        .from(discussions)
        .where(eq(discussions.id, entry.discussionId))
        .then((rows) => rows[0] ?? null);

      if (!disc || disc.companyId !== companyId) {
        throw notFound("Entry not found");
      }

      // P1-T7: a scope_proposal is not an extractable prose entry. Reprocessing
      // it would reset its extractionStatus and feed the proposal JSON to the
      // LLM extractor. Refuse — proposals are approved via the proposals/approve
      // route, not the extraction pipeline.
      if (entry.inputType === "scope_proposal") {
        throw badRequest("Scope proposals cannot be reprocessed for extraction.");
      }

      // Check for approved items that would be orphaned
      const approvedItems = await db
        .select({ id: discussionExtractedItems.id })
        .from(discussionExtractedItems)
        .where(
          and(
            eq(discussionExtractedItems.discussionEntryId, entryId),
            eq(discussionExtractedItems.status, "approved"),
          ),
        );

      if (approvedItems.length > 0) {
        throw badRequest(
          "Cannot reprocess entry with approved items. Approved items have linked tasks/memory that would be orphaned.",
        );
      }

      // Count pending items being deleted to update discussion count
      const pendingItems = await db
        .select({ id: discussionExtractedItems.id })
        .from(discussionExtractedItems)
        .where(
          and(
            eq(discussionExtractedItems.discussionEntryId, entryId),
            eq(discussionExtractedItems.status, "pending"),
          ),
        );

      // Delete non-approved extracted items (pending, rejected, edited)
      await db
        .delete(discussionExtractedItems)
        .where(eq(discussionExtractedItems.discussionEntryId, entryId));

      // Reset extraction status
      await db
        .update(discussionEntries)
        .set({ extractionStatus: "pending", extractionRunId: null })
        .where(eq(discussionEntries.id, entryId));

      // Update pending count on discussion
      if (pendingItems.length > 0) {
        await db
          .update(discussions)
          .set({
            pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${pendingItems.length}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(discussions.id, entry.discussionId));
      }

      // Trigger re-extraction via the event pipeline
      publishLiveEvent({
        companyId,
        type: "discussion.entry.created",
        payload: { discussionId: entry.discussionId, entryId },
      });

      // Trigger extraction directly (fire-and-forget)
      import("./extraction.js")
        .then(({ extractionService }) => {
          extractionService(db)
            .extractFromDiscussionEntry(companyId, entryId)
            .catch(() => {}); // errors handled internally
        })
        .catch(() => {}); // module load error — swallow

      return { entryId, extractionStatus: "pending" as const };
    },

    /**
     * Reprocess all failed/pending/skipped entries in a discussion.
     */
    reprocessAllEntries: async (companyId: string, discussionId: string) => {
      // Verify discussion belongs to company
      const disc = await db
        .select({ id: discussions.id, companyId: discussions.companyId })
        .from(discussions)
        .where(and(eq(discussions.id, discussionId), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!disc) {
        throw notFound("Discussion not found");
      }

      // Fetch entries that need reprocessing
      const entries = await db
        .select()
        .from(discussionEntries)
        .where(eq(discussionEntries.discussionId, discussionId));

      const reprocessable = entries.filter(
        (e) =>
          // P1-T7: never re-extract a scope_proposal. Proposals are stored with
          // extractionStatus="skipped" (so they don't auto-extract) and carry
          // their approval lifecycle in proposalStatus. Without this guard,
          // reprocessAllEntries would reset a pending/rejected proposal's
          // extractionStatus to "pending" and feed the proposal JSON to the
          // LLM extractor — corrupting state and burning budget.
          e.inputType !== "scope_proposal" &&
          (e.extractionStatus === "failed" ||
            e.extractionStatus === "pending" ||
            e.extractionStatus === "skipped"),
      );

      let reprocessedCount = 0;
      let skippedCount = 0;
      let deletedPendingCount = 0;

      for (const entry of reprocessable) {
        // Check for approved items — skip if any
        const approvedItems = await db
          .select({ id: discussionExtractedItems.id })
          .from(discussionExtractedItems)
          .where(
            and(
              eq(discussionExtractedItems.discussionEntryId, entry.id),
              eq(discussionExtractedItems.status, "approved"),
            ),
          );

        if (approvedItems.length > 0) {
          skippedCount++;
          continue;
        }

        // Count pending items being deleted
        const pendingItems = await db
          .select({ id: discussionExtractedItems.id })
          .from(discussionExtractedItems)
          .where(
            and(
              eq(discussionExtractedItems.discussionEntryId, entry.id),
              eq(discussionExtractedItems.status, "pending"),
            ),
          );
        deletedPendingCount += pendingItems.length;

        // Delete non-approved extracted items
        await db
          .delete(discussionExtractedItems)
          .where(eq(discussionExtractedItems.discussionEntryId, entry.id));

        // Reset extraction status
        await db
          .update(discussionEntries)
          .set({ extractionStatus: "pending", extractionRunId: null })
          .where(eq(discussionEntries.id, entry.id));

        // Trigger extraction
        publishLiveEvent({
          companyId,
          type: "discussion.entry.created",
          payload: { discussionId, entryId: entry.id },
        });

        // Trigger extraction directly (fire-and-forget)
        import("./extraction.js")
          .then(({ extractionService }) => {
            extractionService(db)
              .extractFromDiscussionEntry(companyId, entry.id)
              .catch(() => {}); // errors handled internally
          })
          .catch(() => {}); // module load error — swallow

        reprocessedCount++;
      }

      // Update pending count on discussion
      if (deletedPendingCount > 0) {
        await db
          .update(discussions)
          .set({
            pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${deletedPendingCount}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(discussions.id, discussionId));
      }

      return { reprocessedCount, skippedCount };
    },

    /**
     * Add an annotation to an entry.
     */
    addAnnotation: async (
      companyId: string,
      entryId: string,
      data: {
        content: string;
        anchorStart?: number | null;
        anchorEnd?: number | null;
      },
      actorId: string,
    ) => {
      // Verify entry belongs to company
      const entry = await db
        .select({ discussionId: discussionEntries.discussionId })
        .from(discussionEntries)
        .where(eq(discussionEntries.id, entryId))
        .then((rows) => rows[0] ?? null);

      if (!entry) {
        throw notFound("Entry not found");
      }

      const disc = await db
        .select({ companyId: discussions.companyId })
        .from(discussions)
        .where(eq(discussions.id, entry.discussionId))
        .then((rows) => rows[0] ?? null);

      if (!disc || disc.companyId !== companyId) {
        throw notFound("Entry not found");
      }

      const [annotation] = await db
        .insert(discussionAnnotations)
        .values({
          discussionEntryId: entryId,
          content: data.content,
          anchorStart: data.anchorStart ?? null,
          anchorEnd: data.anchorEnd ?? null,
          createdBy: actorId,
        })
        .returning();

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.annotation.added",
        entityType: "discussion_annotation",
        entityId: annotation.id,
        details: { entryId, discussionId: entry.discussionId },
      });

      return annotation;
    },

    /**
     * Link an entry to a different discussion (move between threads).
     */
    linkEntry: async (
      companyId: string,
      entryId: string,
      targetDiscussionId: string,
    ) => {
      // Verify entry exists
      const entry = await db
        .select()
        .from(discussionEntries)
        .where(eq(discussionEntries.id, entryId))
        .then((rows) => rows[0] ?? null);

      if (!entry) {
        throw notFound("Entry not found");
      }

      const sourceDiscussionId = entry.discussionId;
      if (sourceDiscussionId === targetDiscussionId) {
        throw badRequest("Entry already belongs to this discussion");
      }

      // Verify both discussions belong to company
      const [sourceDisc, targetDisc] = await Promise.all([
        db
          .select()
          .from(discussions)
          .where(
            and(
              eq(discussions.id, sourceDiscussionId),
              eq(discussions.companyId, companyId),
            ),
          )
          .then((rows) => rows[0] ?? null),
        db
          .select()
          .from(discussions)
          .where(
            and(
              eq(discussions.id, targetDiscussionId),
              eq(discussions.companyId, companyId),
            ),
          )
          .then((rows) => rows[0] ?? null),
      ]);

      if (!sourceDisc) throw notFound("Source discussion not found");
      if (!targetDisc) throw notFound("Target discussion not found");

      return db.transaction(async (tx) => {
        // Count pending items for this entry to move counts
        const pendingItems = await tx
          .select({ id: discussionExtractedItems.id })
          .from(discussionExtractedItems)
          .where(
            and(
              eq(discussionExtractedItems.discussionEntryId, entryId),
              eq(discussionExtractedItems.status, "pending"),
            ),
          );
        const pendingCount = pendingItems.length;

        // Move entry
        await tx
          .update(discussionEntries)
          .set({ discussionId: targetDiscussionId })
          .where(eq(discussionEntries.id, entryId));

        const now = new Date();

        // Update source discussion counts
        await tx
          .update(discussions)
          .set({
            entryCount: sql`GREATEST(${discussions.entryCount} - 1, 0)`,
            pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${pendingCount}, 0)`,
            updatedAt: now,
          })
          .where(eq(discussions.id, sourceDiscussionId));

        // Update target discussion counts
        await tx
          .update(discussions)
          .set({
            entryCount: sql`${discussions.entryCount} + 1`,
            pendingItemCount: sql`${discussions.pendingItemCount} + ${pendingCount}`,
            lastEntryAt: now,
            updatedAt: now,
          })
          .where(eq(discussions.id, targetDiscussionId));

        return { entryId, sourceDiscussionId, targetDiscussionId };
      });
    },
  };
}
