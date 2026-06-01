// server/src/__tests__/set-task-status-tool.test.ts
//
// Task 4 (Spec B) — `set_task_status` tool DELEGATION-CONTRACT tests.
//
// This suite tests ONLY the tool's delegation contract: that it company-scopes
// the task, resolves effectiveDial from ctx.effectiveAutonomy (default 0), and
// forwards the exact actor args into issueService.update — and that it never
// lets the guard's thrown rejection escape `execute`.
//
// The guard's own dial/ownership logic (Assist≥1→in_review, Drive≥2→done, own-
// task enforcement) is already covered by Task 1's 12 tests on
// assertAgentStatusTransition. We do NOT re-test that here — `update` is mocked.

import { describe, expect, it, vi } from "vitest";
import { setTaskStatusTool } from "../services/internal-agent/tools/set-task-status-tool.js";
import type { ToolContext } from "../services/internal-agent/types.js";

function makeCtx(
  overrides: {
    effectiveAutonomy?: number | null;
    companyId?: string;
    agentId?: string;
    getById?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
    enabledCapabilities?: readonly string[];
  } = {},
): { ctx: ToolContext; getById: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const companyId = overrides.companyId ?? "comp-1";
  const getById =
    overrides.getById ??
    vi.fn().mockResolvedValue({ id: "task-1", companyId, status: "in_progress", assigneeAgentId: "agent-1" });
  const update = overrides.update ?? vi.fn().mockResolvedValue({ id: "task-1", status: "in_review" });

  const ctx = {
    companyId,
    userId: "user-1",
    userRole: "team_member",
    enabledCapabilities: overrides.enabledCapabilities ?? [],
    agentId: overrides.agentId ?? "agent-1",
    effectiveAutonomy: overrides.effectiveAutonomy,
    db: {} as any,
    services: {
      issues: { getById, update },
    } as any,
  } as unknown as ToolContext;

  return { ctx, getById, update };
}

describe("set_task_status tool — delegation contract", () => {
  it("is coordination category (confers no capability), open to team_member", () => {
    expect(setTaskStatusTool.name).toBe("set_task_status");
    expect(setTaskStatusTool.category).toBe("coordination");
    expect(setTaskStatusTool.requiredRole).toBe("team_member");
    expect(setTaskStatusTool.requiresConfirmation).toBe(false);
  });

  // (a) happy path — exact actor args, effectiveDial sourced from ctx.effectiveAutonomy
  it("forwards { status } + actor { actorType:'agent', agentId, effectiveDial } from ctx.effectiveAutonomy", async () => {
    const { ctx, getById, update } = makeCtx({ effectiveAutonomy: 2, agentId: "agent-1" });

    const result = await setTaskStatusTool.execute(
      { taskId: "task-1", status: "in_review" },
      ctx,
    );

    expect(getById).toHaveBeenCalledWith("task-1");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      "task-1",
      { status: "in_review" },
      { actorType: "agent", agentId: "agent-1", effectiveDial: 2 },
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ taskId: "task-1", status: "in_review" });
  });

  // (b) ctx.effectiveAutonomy undefined → effectiveDial defaults to 0 in forwarded args
  it("defaults effectiveDial to 0 when ctx.effectiveAutonomy is undefined", async () => {
    const { ctx, update } = makeCtx({ effectiveAutonomy: undefined, agentId: "agent-9" });

    await setTaskStatusTool.execute({ taskId: "task-1", status: "done" }, ctx);

    expect(update).toHaveBeenCalledWith(
      "task-1",
      { status: "done" },
      { actorType: "agent", agentId: "agent-9", effectiveDial: 0 },
    );
  });

  it("defaults effectiveDial to 0 when ctx.effectiveAutonomy is null", async () => {
    const { ctx, update } = makeCtx({ effectiveAutonomy: null });

    await setTaskStatusTool.execute({ taskId: "task-1", status: "in_review" }, ctx);

    expect(update).toHaveBeenCalledWith(
      "task-1",
      { status: "in_review" },
      expect.objectContaining({ effectiveDial: 0 }),
    );
  });

  // (c) update throws (simulate guard rejection) → tool returns {success:false}, NOT an exception
  it("maps a guard rejection (update throws) to { success:false } without throwing", async () => {
    const update = vi.fn().mockRejectedValue(
      Object.assign(new Error("Only at Drive may a crew agent complete its own task"), {
        status: 422,
        code: "invalid_issue_disposition",
      }),
    );
    const { ctx } = makeCtx({ effectiveAutonomy: 1, update });

    // Must resolve (not reject) — execute must never throw.
    const result = await setTaskStatusTool.execute({ taskId: "task-1", status: "done" }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // The guard's message should be surfaced (not swallowed into a generic).
    expect(String(result.error) + String(result.summary)).toContain("Drive");
  });

  // (d) cross-company task → not-found, update NOT called
  it("returns NOT_FOUND for a cross-company task and never calls update", async () => {
    const getById = vi
      .fn()
      .mockResolvedValue({ id: "task-1", companyId: "OTHER-co", status: "in_progress", assigneeAgentId: "agent-1" });
    const { ctx, update } = makeCtx({ companyId: "comp-1", getById });

    const result = await setTaskStatusTool.execute({ taskId: "task-1", status: "in_review" }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_FOUND");
    expect(update).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when getById returns null and never calls update", async () => {
    const getById = vi.fn().mockResolvedValue(null);
    const { ctx, update } = makeCtx({ getById });

    const result = await setTaskStatusTool.execute({ taskId: "missing", status: "in_review" }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_FOUND");
    expect(update).not.toHaveBeenCalled();
  });

  // (e) param validation — missing/non-string taskId or status → INVALID_PARAMS, no getById/update
  it("rejects a missing taskId with INVALID_PARAMS before any service call", async () => {
    const { ctx, getById, update } = makeCtx();
    const result = await setTaskStatusTool.execute({ status: "in_review" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(getById).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a non-string taskId with INVALID_PARAMS", async () => {
    const { ctx, getById, update } = makeCtx();
    const result = await setTaskStatusTool.execute({ taskId: 123, status: "in_review" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(getById).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a missing status with INVALID_PARAMS before any service call", async () => {
    const { ctx, getById, update } = makeCtx();
    const result = await setTaskStatusTool.execute({ taskId: "task-1" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(getById).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a non-string status with INVALID_PARAMS", async () => {
    const { ctx, getById, update } = makeCtx();
    const result = await setTaskStatusTool.execute({ taskId: "task-1", status: 5 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(getById).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects null params with INVALID_PARAMS", async () => {
    const { ctx, getById, update } = makeCtx();
    const result = await setTaskStatusTool.execute(null, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(getById).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // (f) a zero-capability caller can invoke (coordination doesn't widen).
  // The tool's execute does no capability check itself; with no enabledCapabilities
  // the happy path still reaches update. (Registry-level authorization is covered
  // separately; coordination is absent from CAPABILITY_TO_CATEGORY, so it can never
  // widen a capability.)
  it("a zero-capability caller still reaches update (coordination confers nothing)", async () => {
    const { ctx, update } = makeCtx({ effectiveAutonomy: 1, enabledCapabilities: [] });

    const result = await setTaskStatusTool.execute({ taskId: "task-1", status: "in_review" }, ctx);

    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
