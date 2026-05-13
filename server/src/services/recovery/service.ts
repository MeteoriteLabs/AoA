import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { activityLog, agentWakeupRequests, heartbeatRuns, issues } from "@armyofagents/db";
import { issueService } from "../issues.js";
import {
  buildSuccessfulRunHandoffNotice,
  decideSuccessfulRunHandoff,
} from "./successful-run-handoff.js";

export function recoveryService(db: Db) {
  const issuesSvc = issueService(db);

  async function handleCompletedRun(runId: string) {
    const run = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    if (!run) return { queued: false, reason: "run_not_found" };

    const context = typeof run.contextSnapshot === "object" && run.contextSnapshot !== null
      ? (run.contextSnapshot as Record<string, unknown>)
      : {};
    const issueId = typeof context.issueId === "string" ? context.issueId : null;
    if (!issueId) return { queued: false, reason: "issue_not_found" };

    const issue = await db
      .select()
      .from(issues)
      .where(and(eq(issues.companyId, run.companyId), eq(issues.id, issueId)))
      .then((rows) => rows[0] ?? null);

    const existingAttempts = await db
      .select()
      .from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.companyId, run.companyId), eq(agentWakeupRequests.reason, "finish_successful_run_handoff")))
      .then((rows) => rows.filter((row) => row.idempotencyKey?.includes(`${issueId}:${run.id}`)).length);

    const decision = decideSuccessfulRunHandoff({ run, issue, existingAttempts });
    if (decision.action !== "queue_handoff") return { queued: false, reason: decision.reason };

    const existingWake = await db
      .select()
      .from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.companyId, run.companyId), eq(agentWakeupRequests.idempotencyKey, decision.idempotencyKey)))
      .then((rows) => rows[0] ?? null);
    if (existingWake) return { queued: false, reason: "already_queued", wakeId: existingWake.id };

    const wake = await db
      .insert(agentWakeupRequests)
      .values({
        companyId: run.companyId,
        agentId: decision.agentId,
        source: "automation",
        triggerDetail: "recovery.successful_run_handoff",
        reason: "finish_successful_run_handoff",
        payload: decision.payload,
        status: "queued",
        idempotencyKey: decision.idempotencyKey,
      })
      .returning()
      .then((rows) => rows[0]);

    const notice = buildSuccessfulRunHandoffNotice({
      runId: run.id,
      agentId: run.agentId,
      reason: decision.reason,
    });
    await issuesSvc.addComment(issueId, notice.body, {
      authorType: notice.authorType,
      presentation: notice.presentation,
      metadata: notice.metadata,
    });
    await db.insert(activityLog).values({
      companyId: run.companyId,
      actorType: "system",
      actorId: "recovery",
      action: "issue.successful_run_handoff_queued",
      entityType: "issue",
      entityId: issueId,
      runId: run.id,
      details: { wakeId: wake.id },
    });

    return { queued: true, wakeId: wake.id };
  }

  async function reconcileIssueGraphLiveness() {
    return { checked: 0 };
  }

  return {
    handleCompletedRun,
    reconcileIssueGraphLiveness,
  };
}
