import { beforeEach, describe, expect, it, vi } from "vitest";
import { threadAgentActionService } from "../services/thread-agent-actions.js";

function createSequenceDb(config: { selects?: unknown[][]; inserts?: unknown[][]; updates?: Array<unknown[] | Error> } = {}) {
  let selectIdx = 0;
  let insertIdx = 0;
  let updateIdx = 0;
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  function makeChain(getRows: () => unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "limit", "values", "set", "onConflictDoNothing", "returning"]) {
      chain[method] = (arg?: unknown) => {
        if (method === "values") insertValues.push(arg);
        if (method === "set") updateSets.push(arg);
        return chain;
      };
    }
    chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve(getRows()));
    return chain;
  }

  const db = {
    select: () => makeChain(() => config.selects?.[selectIdx++] ?? []),
    insert: () => makeChain(() => config.inserts?.[insertIdx++] ?? []),
    update: () => makeChain(() => {
      const next = config.updates?.[updateIdx++] ?? [];
      if (next instanceof Error) throw next;
      return next;
    }),
    transaction: async (callback: (tx: unknown) => unknown) => callback(db),
    __insertValues: insertValues,
    __updateSets: updateSets,
  };

  return db;
}

const thread = { id: "thread-1", companyId: "company-1" };

const baseAction = {
  id: "action-1",
  companyId: "company-1",
  threadId: "thread-1",
  runId: "run-1",
  agentId: "agent-1",
  actionType: "post_reply",
  status: "proposed",
  payload: { rawContent: "Here is the scoped recommendation.", parentEntryId: "entry-1" },
  idempotencyKey: "run-1:post_reply:1",
  freshness: { latestHumanSeq: 1 },
};

describe("threadAgentActionService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an existing proposed action for the same idempotency key", async () => {
    const existing = { ...baseAction, id: "existing-action" };
    const db = createSequenceDb({ selects: [[thread], [existing]] });

    const result = await threadAgentActionService(db as never).proposeThreadAction({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
      agentId: "agent-1",
      actionType: "post_reply",
      payload: { rawContent: "Hello" },
      idempotencyKey: "run-1:post_reply:1",
      freshness: { latestHumanSeq: 1 },
    });

    expect(result).toEqual(existing);
    expect(db.__insertValues).toHaveLength(0);
  });

  it("rejects action proposals for threads outside the company", async () => {
    const db = createSequenceDb({ selects: [[]] });

    await expect(
      threadAgentActionService(db as never).proposeThreadAction({
        companyId: "company-2",
        threadId: "thread-1",
        runId: "run-1",
        agentId: "agent-1",
        actionType: "post_reply",
        payload: { rawContent: "Hello" },
        idempotencyKey: "run-1:post_reply:1",
        freshness: { latestHumanSeq: 1 },
      }),
    ).rejects.toThrow("Thread not found");

    expect(db.__insertValues).toHaveLength(0);
  });

  it("suppresses proposed actions when freshness comparison is stale", async () => {
    const db = createSequenceDb({ selects: [[baseAction]], updates: [[{ ...baseAction, status: "suppressed_stale" }]] });
    const addEntry = vi.fn();
    const createDraftFromThread = vi.fn();

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: false, reason: "newer_human_entry" }),
      discussions: { addEntry },
      scopeVersions: { createDraftFromThread },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 0, suppressed: 1, blocked: 0, failed: 0 });
    expect(addEntry).not.toHaveBeenCalled();
    expect(createDraftFromThread).not.toHaveBeenCalled();
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "suppressed_stale",
      blockedReason: "newer_human_entry",
    }));
  });

  it("commits a fresh post_reply through discussionService.addEntry", async () => {
    const db = createSequenceDb({ selects: [[baseAction]], updates: [[{ ...baseAction, status: "committed" }]] });
    const addEntry = vi.fn().mockResolvedValue({ id: "entry-committed" });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry },
      scopeVersions: { createDraftFromThread: vi.fn() },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 1, suppressed: 0, blocked: 0, failed: 0 });
    expect(addEntry).toHaveBeenCalledWith(
      "company-1",
      "thread-1",
      expect.objectContaining({
        inputType: "agent",
        rawContent: "Here is the scoped recommendation.",
        parentEntryId: "entry-1",
        authorAgentId: "agent-1",
      }),
      "agent:agent-1",
    );
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "committed",
      committedEntryId: "entry-committed",
    }));
  });

  it("claims a post_reply as committing before writing the discussion entry", async () => {
    const db = createSequenceDb({
      selects: [[baseAction]],
      updates: [
        [{ ...baseAction, status: "committing" }],
        [{ ...baseAction, status: "committed", committedEntryId: "entry-committed" }],
      ],
    });
    const addEntry = vi.fn().mockResolvedValue({ id: "entry-committed" });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry },
      scopeVersions: { createDraftFromThread: vi.fn() },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 1, suppressed: 0, blocked: 0, failed: 0 });
    expect(db.__updateSets[0]).toMatchObject({ status: "committing" });
    expect(addEntry).toHaveBeenCalledTimes(1);
    expect(db.__updateSets[1]).toMatchObject({
      status: "committed",
      committedEntryId: "entry-committed",
    });
  });

  it("does not replay a post_reply side effect after the action was already claimed as committing", async () => {
    const claimedAction = { ...baseAction, status: "committing" };
    const db = createSequenceDb({
      selects: [
        [baseAction],
        [],
      ],
      updates: [
        [{ ...baseAction, status: "committing" }],
        new Error("lost connection after discussion entry write"),
        [{ ...baseAction, status: "failed" }],
      ],
    });
    const addEntry = vi.fn().mockResolvedValue({ id: "entry-committed" });

    const first = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry },
      scopeVersions: { createDraftFromThread: vi.fn() },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });
    expect(first).toEqual({ committed: 0, suppressed: 0, blocked: 0, failed: 1 });
    expect(addEntry).toHaveBeenCalledTimes(1);
    expect(db.__updateSets[0]).toMatchObject({ status: "committing" });

    const second = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry },
      scopeVersions: { createDraftFromThread: vi.fn() },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(claimedAction.status).toBe("committing");
    expect(second).toEqual({ committed: 0, suppressed: 0, blocked: 0, failed: 0 });
    expect(addEntry).toHaveBeenCalledTimes(1);
  });

  it("commits a fresh create_scope_draft through threadScopeVersionService", async () => {
    const action = {
      ...baseAction,
      actionType: "create_scope_draft",
      payload: { summary: "Scope summary", assumptions: ["A"], decisions: ["D"], openQuestions: ["Q"] },
    };
    const db = createSequenceDb({ selects: [[action]], updates: [[{ ...action, status: "committed" }]] });
    const createDraftFromThread = vi.fn().mockResolvedValue({
      status: "created",
      version: { id: "scope-version-1" },
    });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: { createDraftFromThread },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 1, suppressed: 0, blocked: 0, failed: 0 });
    expect(createDraftFromThread).toHaveBeenCalledWith(
      "company-1",
      "thread-1",
      { agentId: "agent-1", isHuman: false },
      { summary: "Scope summary", assumptions: ["A"], decisions: ["D"], openQuestions: ["Q"] },
    );
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "committed",
      committedScopeVersionId: "scope-version-1",
    }));
  });

  it("commits a fresh add_scope_item as a draft scope item", async () => {
    const action = {
      ...baseAction,
      actionType: "add_scope_item",
      payload: {
        kind: "memory_candidate",
        title: "Architecture decision",
        content: "Use the versioned scope as the handoff.",
        layer: "active_context",
        category: "decision",
      },
    };
    const db = createSequenceDb({
      selects: [[action]],
      inserts: [[{ id: "scope-item-1" }]],
      updates: [[{ ...action, status: "committed" }]],
    });
    const createDraftFromThread = vi.fn().mockResolvedValue({
      status: "existing_draft",
      version: { id: "scope-version-1" },
    });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: { createDraftFromThread },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 1, suppressed: 0, blocked: 0, failed: 0 });
    expect(createDraftFromThread).toHaveBeenCalledWith(
      "company-1",
      "thread-1",
      { agentId: "agent-1", isHuman: false },
      {},
    );
    expect(db.__insertValues).toContainEqual(expect.objectContaining({
      companyId: "company-1",
      scopeVersionId: "scope-version-1",
      kind: "memory_candidate",
      title: "Architecture decision",
      description: "Use the versioned scope as the handoff.",
      payload: expect.objectContaining({ layer: "active_context", category: "decision" }),
      status: "draft",
    }));
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "committed",
      committedScopeItemId: "scope-item-1",
    }));
  });

  it("claims add_scope_item before inserting the scope item", async () => {
    const action = {
      ...baseAction,
      actionType: "add_scope_item",
      payload: {
        kind: "memory_candidate",
        title: "Architecture decision",
        content: "Use the versioned scope as the handoff.",
      },
    };
    const db = createSequenceDb({
      selects: [[action]],
      updates: [
        [{ ...action, status: "committing" }],
        [{ ...action, status: "committed", committedScopeItemId: "scope-item-1" }],
      ],
      inserts: [[{ id: "scope-item-1" }]],
    });
    const createDraftFromThread = vi.fn().mockResolvedValue({
      status: "existing_draft",
      version: { id: "scope-version-1" },
    });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: { createDraftFromThread },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 1, suppressed: 0, blocked: 0, failed: 0 });
    expect(db.__updateSets[0]).toMatchObject({ status: "committing" });
    expect(db.__insertValues).toContainEqual(expect.objectContaining({
      kind: "memory_candidate",
      title: "Architecture decision",
    }));
  });

  it("commits a fresh convene_agent as a queued wakeup after company validation", async () => {
    const action = {
      ...baseAction,
      actionType: "convene_agent",
      payload: {
        targetAgentId: "agent-2",
        reason: "Need planning input",
        context: { threadId: "thread-1", hopCount: 2 },
      },
    };
    const db = createSequenceDb({
      selects: [[action], [{ id: "agent-2", companyId: "company-1" }]],
      inserts: [[{ id: "wakeup-1" }]],
      updates: [[{ ...action, status: "committed" }]],
    });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: { createDraftFromThread: vi.fn() },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 1, suppressed: 0, blocked: 0, failed: 0 });
    expect(db.__insertValues).toContainEqual(expect.objectContaining({
      companyId: "company-1",
      agentId: "agent-2",
      source: "agent.dispatch",
      reason: "Need planning input",
      payload: { threadId: "thread-1", hopCount: 2 },
      dedupKey: "agent-2:thread-1:queued",
      status: "queued",
    }));
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "committed",
    }));
  });

  it("commits a fresh create_artifact_candidate as an artifact link scope item", async () => {
    const action = {
      ...baseAction,
      actionType: "create_artifact_candidate",
      payload: {
        title: "Onboarding plan",
        artifactType: "document",
        content: "# Plan",
        fileRef: null,
        discussionId: "thread-1",
        attachToEntryId: "entry-3",
      },
    };
    const db = createSequenceDb({
      selects: [[action]],
      inserts: [[{ id: "scope-item-artifact" }]],
      updates: [[{ ...action, status: "committed" }]],
    });
    const createDraftFromThread = vi.fn().mockResolvedValue({
      status: "existing_draft",
      version: { id: "scope-version-1" },
    });
    const createArtifact = vi.fn().mockResolvedValue({
      id: "artifact-1",
      versions: [{ id: "artifact-version-1" }],
    });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: { createDraftFromThread },
      artifacts: { create: createArtifact },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 1, suppressed: 0, blocked: 0, failed: 0 });
    expect(createArtifact).toHaveBeenCalledWith(
      "company-1",
      "agent-1",
      {
        title: "Onboarding plan",
        type: "document",
        source: "agent",
        content: "# Plan",
        fileUrl: null,
      },
    );
    expect(db.__insertValues).toContainEqual(expect.objectContaining({
      companyId: "company-1",
      scopeVersionId: "scope-version-1",
      kind: "artifact_link",
      title: "Onboarding plan",
      description: "Artifact candidate created by agent",
      artifactId: "artifact-1",
      artifactVersionId: "artifact-version-1",
      status: "draft",
    }));
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "committed",
      committedScopeVersionId: "scope-version-1",
      committedScopeItemId: "scope-item-artifact",
    }));
  });

  it("claims create_artifact_candidate before creating artifact and scope item side effects", async () => {
    const action = {
      ...baseAction,
      actionType: "create_artifact_candidate",
      payload: {
        title: "Onboarding plan",
        artifactType: "document",
        content: "# Plan",
      },
    };
    const db = createSequenceDb({
      selects: [[action]],
      updates: [
        [{ ...action, status: "committing" }],
        [{ ...action, status: "committed", committedScopeItemId: "scope-item-artifact" }],
      ],
      inserts: [[{ id: "scope-item-artifact" }]],
    });
    const createArtifact = vi.fn().mockResolvedValue({
      id: "artifact-1",
      versions: [{ id: "artifact-version-1" }],
    });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: {
        createDraftFromThread: vi.fn().mockResolvedValue({
          status: "existing_draft",
          version: { id: "scope-version-1" },
        }),
      },
      artifacts: { create: createArtifact },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 1, suppressed: 0, blocked: 0, failed: 0 });
    expect(db.__updateSets[0]).toMatchObject({ status: "committing" });
    expect(createArtifact).toHaveBeenCalledTimes(1);
    expect(db.__insertValues).toContainEqual(expect.objectContaining({
      kind: "artifact_link",
      artifactId: "artifact-1",
    }));
  });

  it("evaluates freshness for a run action batch before self-mutating commits", async () => {
    const artifactAction = {
      ...baseAction,
      id: "action-artifact",
      actionType: "create_artifact_candidate",
      payload: {
        title: "Discussion scope notes",
        artifactType: "document",
        content: "# Notes",
      },
    };
    const replyAction = {
      ...baseAction,
      id: "action-reply",
      actionType: "post_reply",
      payload: {
        rawContent: "I created discussion-scope-notes.md and attached it to the scope draft.",
      },
    };
    const db = createSequenceDb({
      selects: [[artifactAction, replyAction]],
      inserts: [[{ id: "scope-item-artifact" }]],
      updates: [
        [{ ...artifactAction, status: "committed" }],
        [{ ...replyAction, status: "committed" }],
      ],
    });
    let scopeMutated = false;
    const compareFreshnessSnapshot = vi.fn(async () => (
      scopeMutated
        ? { fresh: false, reason: "newer_scope_version" }
        : { fresh: true }
    ));
    const createDraftFromThread = vi.fn(async () => {
      scopeMutated = true;
      return {
        status: "created",
        version: { id: "scope-version-1" },
      };
    });
    const createArtifact = vi.fn().mockResolvedValue({
      id: "artifact-1",
      versions: [{ id: "artifact-version-1" }],
    });
    const addEntry = vi.fn().mockResolvedValue({ id: "entry-committed" });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot,
      discussions: { addEntry },
      scopeVersions: { createDraftFromThread },
      artifacts: { create: createArtifact },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 2, suppressed: 0, blocked: 0, failed: 0 });
    expect(compareFreshnessSnapshot).toHaveBeenCalledTimes(2);
    expect(createArtifact).toHaveBeenCalled();
    expect(addEntry).toHaveBeenCalledWith(
      "company-1",
      "thread-1",
      expect.objectContaining({
        inputType: "agent",
        rawContent: "I created discussion-scope-notes.md and attached it to the scope draft.",
        authorAgentId: "agent-1",
      }),
      "agent:agent-1",
    );
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "committed",
      committedScopeItemId: "scope-item-artifact",
    }));
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "committed",
      committedEntryId: "entry-committed",
    }));
  });

  it("attaches same-run artifact candidates to the same-run agent reply", async () => {
    const artifactAction = {
      ...baseAction,
      id: "action-artifact",
      actionType: "create_artifact_candidate",
      payload: {
        title: "Discussion scope notes",
        artifactType: "document",
        content: "# Notes",
      },
    };
    const replyAction = {
      ...baseAction,
      id: "action-reply",
      actionType: "post_reply",
      payload: {
        rawContent: "I created discussion-scope-notes.md.",
      },
    };
    const db = createSequenceDb({
      selects: [[artifactAction, replyAction]],
      inserts: [[{ id: "scope-item-artifact" }], [{ id: "attachment-1" }]],
      updates: [
        [{ ...artifactAction, status: "committed" }],
        [{ ...replyAction, status: "committed" }],
      ],
    });
    const addEntry = vi.fn().mockResolvedValue({ id: "entry-committed" });

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry },
      scopeVersions: {
        createDraftFromThread: vi.fn().mockResolvedValue({
          status: "created",
          version: { id: "scope-version-1" },
        }),
      },
      artifacts: {
        create: vi.fn().mockResolvedValue({
          id: "artifact-1",
          versions: [{ id: "artifact-version-1" }],
        }),
      },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 2, suppressed: 0, blocked: 0, failed: 0 });
    expect(db.__insertValues).toContainEqual(expect.objectContaining({
      discussionEntryId: "entry-committed",
      artifactId: "artifact-1",
    }));
  });

  it("commits a fresh advance_phase action only when queued from Drive autonomy", async () => {
    const action = {
      ...baseAction,
      actionType: "advance_phase",
      payload: {
        toPhase: "assign",
        effectiveAutonomy: 2,
      },
    };
    const db = createSequenceDb({
      selects: [[action]],
      updates: [[{ ...action, status: "committed" }]],
    });
    const advancePhase = vi.fn().mockResolvedValue(undefined);

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: { createDraftFromThread: vi.fn() },
      threads: { advancePhase },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 1, suppressed: 0, blocked: 0, failed: 0 });
    expect(advancePhase).toHaveBeenCalledWith(
      "company-1",
      "thread-1",
      "assign",
      { userId: "agent-1", role: "team_member", isHuman: false },
    );
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "committed",
    }));
  });

  it("blocks a fresh advance_phase action queued below Drive autonomy", async () => {
    const action = {
      ...baseAction,
      actionType: "advance_phase",
      payload: {
        toPhase: "assign",
        effectiveAutonomy: 1,
      },
    };
    const db = createSequenceDb({
      selects: [[action]],
      updates: [[{ ...action, status: "blocked_policy" }]],
    });
    const advancePhase = vi.fn();

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: { createDraftFromThread: vi.fn() },
      threads: { advancePhase },
    }).commitThreadAgentActions({
      companyId: "company-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(result).toEqual({ committed: 0, suppressed: 0, blocked: 1, failed: 0 });
    expect(advancePhase).not.toHaveBeenCalled();
    expect(db.__updateSets).toContainEqual(expect.objectContaining({
      status: "blocked_policy",
      blockedReason: "autonomy_insufficient",
    }));
  });
});
